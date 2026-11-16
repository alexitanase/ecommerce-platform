import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ErrorProveedor, type EstadoProducto } from '@ecom/suppliers';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { estadoDeVariante } from './estado-de-variante.js';
import { cargoFijoAplicable, costeDeCompra } from '../catalog/services/margen.js';
import { InventoryService } from '../catalog/services/inventory.service.js';
import { PricingService } from '../catalog/services/pricing.service.js';
import { PriceHistoryService } from '../catalog/services/price-history.service.js';
import { SearchService } from '../search/search.service.js';
import { ImagesService } from '../storage/images.service.js';
import { SuppliersService } from './suppliers.service.js';

export interface ResultadoSync {
  runId: string;
  comprobados: number;
  actualizados: number;
  cambiosPrecio: number;
  cambiosStock: number;
  descatalogados: number;
  errores: number;
  duracionMs: number;
  avisos: string[];
}

/** Cuántos productos se consultan por tanda. */
const TAMANO_LOTE = 25;

/**
 * Sincronización de precio y stock con el proveedor.
 *
 * Es el trabajo más importante que corre de forma continua en la plataforma.
 * En dropshipping el catálogo no es nuestro: el proveedor sube precios, se
 * queda sin stock y retira referencias sin avisar. Cada hora que pasa sin
 * sincronizar es una hora vendiendo a precios que ya no existen — y cada uno
 * de esos pedidos se cobra, no se puede servir, y acaba en devolución.
 */
@Injectable()
export class SupplierSyncService {
  private readonly logger = new Logger(SupplierSyncService.name);
  /** Evita que dos sincronizaciones del mismo proveedor se solapen. */
  private readonly enCurso = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly suppliers: SuppliersService,
    private readonly inventory: InventoryService,
    private readonly pricing: PricingService,
    private readonly search: SearchService,
    private readonly precios: PriceHistoryService,
    private readonly images: ImagesService,
  ) {}

  /**
   * Refresca UN producto contra su proveedor, ahora mismo.
   *
   * La sincronización normal recorre el catálogo entero y se programa de noche,
   * que está bien para mantener los precios al día pero no sirve cuando alguien
   * está delante decidiendo el PVP de un producto concreto: el coste que ve
   * puede ser de hace semanas, y el margen que calcule con él sería el de
   * entonces.
   *
   * No toca el precio de venta ni el stock local: solo actualiza lo que dice el
   * proveedor —coste, existencias, disponibilidad y plazo—. Quién decide qué
   * hacer con esa información es quien está mirando.
   */
  async refrescarProducto(productId: string): Promise<{
    comprobados: number;
    cambios: { sku: string | null; costeAntes: number; costeAhora: number }[];
    descatalogados: number;
    fotosRecuperadas: number;
    aviso?: string;
  }> {
    const enlaces = await this.prisma.client.supplierProduct.findMany({
      where: { productId },
      include: { supplier: { select: { id: true, name: true, isActive: true } } },
    });

    if (enlaces.length === 0) {
      throw new BadRequestException(
        'Este producto no viene de ningún proveedor, así que no hay nada que refrescar.',
      );
    }

    const primero = enlaces[0]!;
    if (!primero.supplier.isActive) {
      throw new BadRequestException(
        `El proveedor ${primero.supplier.name} está desactivado: actívalo para poder consultarlo.`,
      );
    }

    const adaptador = await this.suppliers.adaptador(primero.supplierId);
    const ids = [...new Set(enlaces.map((e) => e.externalProductId))];

    const estados = await adaptador.consultarEstado(ids, 'ES');

    const cambios: { sku: string | null; costeAntes: number; costeAhora: number }[] = [];
    let descatalogados = 0;

    for (const estadoProducto of estados) {
      for (const enlace of enlaces.filter(
        (e) => e.externalProductId === estadoProducto.externalId,
      )) {
        // El de su variante, no el resumen del producto.
        const estado = estadoDeVariante(enlace, estadoProducto);

        const variante = enlace.variantId
          ? await this.prisma.client.productVariant.findUnique({
              where: { id: enlace.variantId },
              select: { sku: true },
            })
          : null;

        if (estado.descatalogado) {
          descatalogados++;
          await this.prisma.client.supplierProduct.update({
            where: { id: enlace.id },
            data: {
              discontinued: true,
              discontinuedAt: new Date(),
              available: false,
              lastCheckedAt: new Date(),
            },
          });
          continue;
        }

        if (estado.costCents !== enlace.costCents) {
          cambios.push({
            sku: variante?.sku ?? null,
            costeAntes: enlace.costCents,
            costeAhora: estado.costCents,
          });
        }

        await this.prisma.client.supplierProduct.update({
          where: { id: enlace.id },
          data: {
            costCents: estado.costCents,
            stock: estado.stock ?? 0,
            available: estado.disponible,
            discontinued: false,
            lastCheckedAt: new Date(),
          },
        });
      }
    }

    // Las fotos de variante van después de los precios y fuera de cualquier
    // transacción: descargar imágenes tarda y no puede bloquear filas.
    const fotos = await this.recuperarFotosDeVariante(productId, enlaces, estados);

    return {
      comprobados: enlaces.length,
      cambios,
      descatalogados,
      fotosRecuperadas: fotos,
      ...(descatalogados > 0
        ? {
            aviso:
              'El proveedor ha retirado alguna variante de su catálogo. Conviene despublicar antes de que alguien la compre.',
          }
        : {}),
    };
  }

  /**
   * Recupera las fotos de variante que faltan.
   *
   * Los productos importados antes de que se leyera `sku_image` no las tienen, y
   * reimportarlos no es una opción: crearía un producto duplicado con otro
   * `handle` y dejaría el original con sus pedidos apuntando a él. Así se
   * arreglan sobre el catálogo que ya existe.
   *
   * Solo actúa donde falta. Si la variante ya tiene foto propia se deja: puede
   * ser una que se haya recortado o subido a mano en el panel, y sobreescribirla
   * con la del proveedor perdería ese trabajo.
   */
  private async recuperarFotosDeVariante(
    productId: string,
    enlaces: {
      variantId: string | null;
      externalProductId: string;
      externalVariantId: string | null;
    }[],
    estados: EstadoProducto[],
  ): Promise<number> {
    let recuperadas = 0;
    /** URL del proveedor → lo ya subido, para no bajar dos veces la misma. */
    const subidas = new Map<
      string,
      {
        key: string;
        url: string;
        width: number;
        height: number;
        sizeBytes: number;
        blurhash: string | null;
      }
    >();

    for (const enlace of enlaces) {
      if (!enlace.variantId || !enlace.externalVariantId) continue;

      const estado = estados.find((e) => e.externalId === enlace.externalProductId);
      const url = estado?.variantes?.find(
        (v) => v.externalVariantId === enlace.externalVariantId,
      )?.imageUrl;
      if (!url) continue;

      const yaTiene = await this.prisma.client.media.count({
        where: { variantId: enlace.variantId, deletedAt: null },
      });
      if (yaTiene > 0) continue;

      try {
        let procesada = subidas.get(url);
        if (!procesada) {
          const buffer = await this.images.descargar(url);
          procesada = await this.images.procesar(buffer, `productos/${productId}`);
          subidas.set(url, procesada);
        }

        await this.prisma.client.media.create({
          data: {
            id: newId(),
            productId,
            variantId: enlace.variantId,
            kind: 'IMAGE',
            storageKey: procesada.key,
            url: procesada.url,
            mimeType: 'image/webp',
            width: procesada.width,
            height: procesada.height,
            sizeBytes: procesada.sizeBytes,
            blurhash: procesada.blurhash,
            position: 100 + recuperadas,
            source: 'supplier',
          },
        });
        recuperadas++;
      } catch (error) {
        // Una foto que falla no puede tumbar el refresco de precios, que es lo
        // que de verdad se venía a buscar.
        this.logger.warn(
          `No se ha podido recuperar la foto de la variante ${enlace.variantId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return recuperadas;
  }

  async sincronizar(
    supplierId: string,
    opciones: { tipo?: 'incremental' | 'completa'; limite?: number } = {},
  ): Promise<ResultadoSync> {
    if (this.enCurso.has(supplierId)) {
      throw new Error('Ya hay una sincronización en curso para este proveedor');
    }
    this.enCurso.add(supplierId);

    const inicio = Date.now();
    const runId = newId();
    const tipo = opciones.tipo ?? 'incremental';

    const proveedor = await this.prisma.client.supplier.findUniqueOrThrow({
      where: { id: supplierId },
    });

    await this.prisma.client.supplierSyncRun.create({
      data: { id: runId, supplierId, type: tipo, status: 'RUNNING' },
    });

    const resultado: ResultadoSync = {
      runId,
      comprobados: 0,
      actualizados: 0,
      cambiosPrecio: 0,
      cambiosStock: 0,
      descatalogados: 0,
      errores: 0,
      duracionMs: 0,
      avisos: [],
    };

    try {
      const adaptador = await this.suppliers.adaptador(supplierId);

      const enlaces = await this.prisma.client.supplierProduct.findMany({
        where: {
          supplierId,
          discontinued: false,
          // En incremental se revisan primero los que llevan más tiempo sin
          // comprobar; en completa, todos.
          ...(tipo === 'incremental' ? {} : {}),
        },
        orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
        ...(opciones.limite ? { take: opciones.limite } : {}),
      });

      const margenDefecto = Number(proveedor.defaultMarginPct);
      const margenMinimo = Number(proveedor.minMarginPct);

      for (let i = 0; i < enlaces.length; i += TAMANO_LOTE) {
        const lote = enlaces.slice(i, i + TAMANO_LOTE);
        const ids = [...new Set(lote.map((e) => e.externalProductId))];

        let estados;
        try {
          estados = await adaptador.consultarEstado(ids, 'ES');
        } catch (error) {
          resultado.errores += lote.length;

          if (error instanceof ErrorProveedor && !error.reintentable) {
            // Un error no reintentable (credenciales caducadas) no mejora
            // consultando el siguiente lote: se aborta y se avisa.
            resultado.avisos.push(`Sincronización abortada: ${error.message}`);
            break;
          }

          this.logger.warn(
            `Lote fallido en ${proveedor.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }

        for (const estado of estados) {
          const enlacesDelProducto = lote.filter((e) => e.externalProductId === estado.externalId);

          for (const enlace of enlacesDelProducto) {
            resultado.comprobados++;

            try {
              const cambios = await this.aplicarEstado(enlace, estadoDeVariante(enlace, estado), {
                margenDefecto,
                margenMinimo,
                priceEnding: proveedor.priceEnding,
                includeShipping: proveedor.includeShipping,
                recargoPct: Number(proveedor.purchaseSurchargePct),
                cargoFijo: {
                  importeCents: proveedor.importFeeCents,
                  umbralCents: proveedor.importFeeThresholdCents,
                },
              });

              if (cambios.precioCambiado) resultado.cambiosPrecio++;
              if (cambios.stockCambiado) resultado.cambiosStock++;
              if (cambios.descatalogado) resultado.descatalogados++;
              if (cambios.precioCambiado || cambios.stockCambiado || cambios.descatalogado) {
                resultado.actualizados++;
              }
              if (cambios.aviso) resultado.avisos.push(cambios.aviso);
            } catch (error) {
              resultado.errores++;
              this.logger.error(
                `Error aplicando estado de ${enlace.externalProductId}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
        }
      }

      resultado.duracionMs = Date.now() - inicio;

      await this.prisma.client.supplierSyncRun.update({
        where: { id: runId },
        data: {
          status: resultado.errores > 0 ? 'PARTIAL' : 'COMPLETED',
          itemsChecked: resultado.comprobados,
          itemsUpdated: resultado.actualizados,
          priceChanges: resultado.cambiosPrecio,
          stockChanges: resultado.cambiosStock,
          itemsDiscontinued: resultado.descatalogados,
          errors: resultado.errores,
          finishedAt: new Date(),
          durationMs: resultado.duracionMs,
        },
      });

      await this.prisma.client.supplier.update({
        where: { id: supplierId },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: resultado.errores > 0 ? 'PARTIAL' : 'OK',
          healthStatus: resultado.errores > resultado.comprobados / 2 ? 'DEGRADED' : 'HEALTHY',
          healthCheckedAt: new Date(),
          consecutiveErrors: resultado.errores > 0 ? { increment: 1 } : 0,
        },
      });

      this.logger.log(
        `Sync ${proveedor.name}: ${resultado.comprobados} comprobados, ` +
          `${resultado.cambiosPrecio} cambios de precio, ${resultado.cambiosStock} de stock, ` +
          `${resultado.descatalogados} descatalogados (${resultado.duracionMs} ms)`,
      );

      return resultado;
    } catch (error) {
      await this.prisma.client.supplierSyncRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          errorDetail: error instanceof Error ? error.message : String(error),
          finishedAt: new Date(),
          durationMs: Date.now() - inicio,
        },
      });

      await this.prisma.client.supplier.update({
        where: { id: supplierId },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: 'FAILED',
          healthStatus: 'ERROR',
          consecutiveErrors: { increment: 1 },
        },
      });

      throw error;
    } finally {
      this.enCurso.delete(supplierId);
    }
  }

  /**
   * Aplica el estado recibido del proveedor a nuestro catálogo.
   *
   * Aquí está la decisión de negocio más delicada: qué hacer cuando el coste
   * sube. Subir el PVP automáticamente puede dejar el producto fuera de mercado;
   * no subirlo puede hacer que vendamos a pérdida. La regla implementada es
   * subir el precio para mantener el margen, y si aun así queda por debajo del
   * mínimo, despublicar y avisar en lugar de vender perdiendo dinero.
   */
  private async aplicarEstado(
    enlace: {
      id: string;
      productId: string;
      variantId: string | null;
      costCents: number;
      stock: number;
      shippingCents: number;
    },
    estado: {
      costCents: number;
      /** El PVP que recomienda hoy el proveedor, si lo publica. Manda sobre el nuestro. */
      rrpCents?: number;
      stock?: number;
      disponible: boolean;
      descatalogado: boolean;
    },
    reglas: {
      margenDefecto: number;
      margenMinimo: number;
      priceEnding: number;
      includeShipping: boolean;
      /** Lo que el proveedor añade al pagar y su API no dice, en % del coste. */
      recargoPct: number;
      /** Cargo fijo por categoría de las importaciones de bajo valor. */
      cargoFijo: { importeCents: number; umbralCents: number };
    },
  ): Promise<{
    precioCambiado: boolean;
    stockCambiado: boolean;
    descatalogado: boolean;
    aviso?: string;
  }> {
    if (estado.descatalogado) {
      await this.prisma.client.supplierProduct.update({
        where: { id: enlace.id },
        data: {
          discontinued: true,
          discontinuedAt: new Date(),
          available: false,
          lastCheckedAt: new Date(),
        },
      });

      if (enlace.variantId) {
        await this.inventory.ajustar(enlace.variantId, 0, 'SUPPLIER_SYNC', {
          nota: 'El proveedor ha retirado el producto de su catálogo',
        });
      }

      return {
        precioCambiado: false,
        stockCambiado: true,
        descatalogado: true,
        aviso: `Producto ${enlace.productId} descatalogado por el proveedor`,
      };
    }

    const stockNuevo = estado.stock ?? 0;
    const costeNuevo = estado.costCents;
    const costeCambiado = costeNuevo !== enlace.costCents;
    const stockCambiado = stockNuevo !== enlace.stock;

    await this.prisma.client.supplierProduct.update({
      where: { id: enlace.id },
      data: {
        costCents: costeNuevo,
        stock: stockNuevo,
        available: estado.disponible,
        lastCheckedAt: new Date(),
      },
    });

    if (enlace.variantId && stockCambiado) {
      await this.inventory.ajustar(enlace.variantId, stockNuevo, 'SUPPLIER_SYNC', {
        nota: `Stock actualizado desde el proveedor`,
      });
    }

    let aviso: string | undefined;
    let precioCambiado = false;

    // El margen se revisa en CADA sincronización, no solo cuando cambia el
    // coste. Si solo se comprobara al cambiar, un producto que ya estuviera por
    // debajo del mínimo —porque alguien bajó el PVP a mano, o por una promoción
    // que se quedó puesta— seguiría vendiéndose a pérdida indefinidamente, y
    // nadie se enteraría hasta cuadrar cuentas a fin de mes.
    if (enlace.variantId) {
      const variante = await this.prisma.client.productVariant.findUnique({
        where: { id: enlace.variantId },
        select: {
          priceCents: true,
          sku: true,
          product: { select: { id: true, status: true, taxRate: true } },
        },
      });

      if (variante) {
        // El coste de COMPRA: lo que cuesta el artículo, su porte si lo
        // repercutimos y el recargo que el proveedor añade al pagar y su API
        // no menciona. Comparar el PVP contra el precio de catálogo a secas es
        // lo que dejó ocho productos vendiéndose por debajo de coste.
        const cargoFijoCents = cargoFijoAplicable(costeNuevo, reglas.cargoFijo);
        const costeTotal = costeDeCompra(
          {
            costCents: costeNuevo,
            ...(reglas.includeShipping ? { envioCents: enlace.shippingCents } : {}),
            cargoFijoCents,
          },
          reglas.recargoPct,
        );
        // El tipo del producto: sin él, el margen se medía contra el precio con
        // IVA y salía unos veinte puntos por encima del real. Con el 25 % de
        // mínimo que trae AliExpress configurado, esta guarda no saltaba hasta
        // que el margen de verdad estaba ya por debajo del 5 %.
        const tipoIva = Number(variante.product.taxRate);

        const margenActual = this.pricing.analizarMargen(variante.priceCents, costeTotal, tipoIva);

        /*
         * Si el proveedor publica PVP, el precio es el suyo. Punto.
         *
         * Esta rama es la que faltaba: hasta aquí la sincronización solo sabía
         * de costes, así que en cuanto el margen se estrechaba recalculaba el
         * PVP con el margen objetivo y **sacaba el producto de la línea del
         * proveedor** cada noche, deshaciendo lo que había hecho la
         * importación. Ahora sigue su precio: si lo sube, se sube; si lo baja,
         * se baja; y si deja poco margen, se avisa y se deja como está, que es
         * una decisión de catálogo y no de calculadora.
         */
        if (estado.rrpCents && estado.rrpCents > 0) {
          const nuevoPvp = estado.rrpCents;
          const margenNuevo = this.pricing.analizarMargen(nuevoPvp, costeTotal, tipoIva);

          if (nuevoPvp !== variante.priceCents || costeCambiado) {
            await this.prisma.client.productVariant.update({
              where: { id: enlace.variantId },
              data: { priceCents: nuevoPvp, costCents: costeTotal },
            });
          }

          if (nuevoPvp !== variante.priceCents) {
            // Queda anotado en el histórico: es lo que permite calcular el
            // precio mínimo de los últimos 30 días y saber qué descuento se
            // puede anunciar legalmente.
            await this.precios.registrarSiCambia(enlace.variantId, nuevoPvp, 'sincronizacion');
            precioCambiado = true;
            await this.search.indexarProducto(variante.product.id);
          }

          if (margenNuevo.margenPorcentaje < reglas.margenMinimo) {
            aviso =
              `${variante.sku}: se vende al PVP del proveedor ` +
              `(${(nuevoPvp / 100).toFixed(2)} €), que deja un ${margenNuevo.margenPorcentaje}% ` +
              `de margen, por debajo del mínimo del ${reglas.margenMinimo}%`;
          }
        } else if (margenActual.margenPorcentaje < reglas.margenMinimo) {
          const nuevo = this.pricing.calcularPvp({
            costeCents: costeNuevo,
            margenObjetivo: reglas.margenDefecto,
            envioCents: reglas.includeShipping ? enlace.shippingCents : 0,
            recargoPct: reglas.recargoPct,
            cargoFijoCents,
            terminacion: reglas.priceEnding,
            taxRate: tipoIva,
            margenMinimo: reglas.margenMinimo,
          });

          await this.prisma.client.productVariant.update({
            where: { id: enlace.variantId },
            data: { priceCents: nuevo.pvpCents, costCents: costeTotal },
          });

          // Queda anotado en el histórico: es lo que permite calcular el
          // precio mínimo de los últimos 30 días y saber qué descuento se
          // puede anunciar legalmente.
          await this.precios.registrarSiCambia(enlace.variantId, nuevo.pvpCents, 'sincronizacion');

          precioCambiado = true;
          aviso =
            `${variante.sku}: el coste ha subido y el margen caía al ${margenActual.margenPorcentaje}%; ` +
            `precio ajustado de ${(variante.priceCents / 100).toFixed(2)} € a ${(nuevo.pvpCents / 100).toFixed(2)} €`;

          await this.search.indexarProducto(variante.product.id);
        } else if (costeCambiado) {
          // El margen sigue siendo aceptable: se actualiza solo el coste para
          // que los informes de rentabilidad reflejen la realidad.
          await this.prisma.client.productVariant.update({
            where: { id: enlace.variantId },
            data: { costCents: costeTotal },
          });
        }
      }
    }

    return { precioCambiado, stockCambiado, descatalogado: false, ...(aviso ? { aviso } : {}) };
  }

  /** Proveedores a los que les toca sincronizar según su intervalo. */
  async proveedoresPendientes(): Promise<string[]> {
    const proveedores = await this.prisma.client.supplier.findMany({
      where: { isActive: true, deletedAt: null, credentials: { not: null } },
      select: { id: true, lastSyncAt: true, syncIntervalMinutes: true },
    });

    const ahora = Date.now();
    return proveedores
      .filter((p) => {
        if (!p.lastSyncAt) return true;
        return ahora - p.lastSyncAt.getTime() >= p.syncIntervalMinutes * 60_000;
      })
      .map((p) => p.id);
  }

  async historial(supplierId: string, limite = 20) {
    return this.prisma.client.supplierSyncRun.findMany({
      where: { supplierId },
      orderBy: { startedAt: 'desc' },
      take: Math.min(limite, 100),
    });
  }
}
