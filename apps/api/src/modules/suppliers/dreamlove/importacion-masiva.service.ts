import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ProductoProveedor, VarianteProveedor } from '@ecom/suppliers';
import { Prisma, type Supplier } from '@ecom/db';
import { newId } from '@ecom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { InventoryService } from '../../catalog/services/inventory.service.js';
import { PriceHistoryService } from '../../catalog/services/price-history.service.js';
import { BrandsService } from '../../catalog/services/brands.service.js';
import { SearchService } from '../../search/search.service.js';
import { cargoFijoAplicable } from '../../catalog/services/margen.js';
import { SuppliersService } from '../suppliers.service.js';
import { SupplierImportService } from '../import.service.js';
import {
  precioDeImportacion,
  type EstrategiaPrecio,
  type ReglasDePrecio,
} from '../precio-de-importacion.js';
import type { ContextoActor } from '../../roles/roles.service.js';

/**
 * Subir el catálogo entero del proveedor a la tienda, de una vez.
 *
 * Hasta aquí, tener el catálogo de Dreamlove procesado no ponía ni un producto
 * a la venta: había que buscar en él y pulsar «importar» artículo por artículo.
 * Con 945 familias eso son semanas de clics, así que en la práctica la tienda
 * se quedaba vacía y el catálogo procesado no servía para nada.
 *
 * Esto es ese botón. Recorre todas las familias del catálogo guardado y, para
 * cada una, crea el producto —en su categoría, con su marca y al PVP que
 * recomienda el proveedor— o actualiza el que ya existe. Es idempotente: se
 * puede volver a pulsar después de cada catálogo nuevo y lo que hace la segunda
 * vez es poner al día precios y existencias.
 *
 * Va en segundo plano por la misma razón que el procesado del fichero, pero
 * multiplicada: entre crear el producto y bajarle las fotos, una pasada
 * completa son de media hora para arriba. La petición HTTP devuelve el
 * identificador del trabajo y la pantalla consulta cómo va.
 */

/** Cuántos fallos se guardan con su motivo. Con eso se investiga; con un contador, no. */
const FALLOS_GUARDADOS = 20;

/** Un trabajo parado más de esto se da por muerto y deja lanzar otro. */
const MINUTOS_PARA_DAR_POR_MUERTO = 30;

export interface OpcionesImportacionMasiva {
  /** De dónde sale el PVP. Por defecto, el que recomienda el proveedor. */
  precio?: EstrategiaPrecio;
  /** Publicar lo que se cree —y lo que esté en borrador—. Por defecto sí. */
  publicar?: boolean;
  /**
   * Trasladar el PVP del proveedor a lo que ya está importado. Por defecto sí.
   *
   * Apagarlo deja los precios de la tienda intactos y actualiza solo el resto:
   * coste, existencias, disponibilidad y la categoría o la marca que falten.
   * Lo que se cree de nuevo entra con el precio del proveedor igualmente,
   * porque ahí no hay ningún precio que respetar.
   */
  actualizarPrecios?: boolean;
  /** Bajar las fotos. Por defecto sí; es lo que más tarda con diferencia. */
  descargarImagenes?: boolean;
  /** Saltarse las familias sin ningún artículo disponible. Por defecto no. */
  soloDisponibles?: boolean;
  /** Tope de familias, para probar con unas pocas antes de soltar el catálogo. */
  limite?: number;
}

/** Lo que se va contando mientras corre, y lo que se enseña al terminar. */
interface Resumen {
  procesados: number;
  creados: number;
  actualizados: number;
  saltados: number;
  errores: number;
  imagenes: number;
  pvpr: number;
  margen: number;
  bajoMinimo: number;
  preciosRespetados: number;
  variantesNuevas: number;
}

@Injectable()
export class ImportacionMasivaService {
  private readonly logger = new Logger(ImportacionMasivaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly suppliers: SuppliersService,
    private readonly importer: SupplierImportService,
    private readonly brands: BrandsService,
    private readonly inventory: InventoryService,
    private readonly precios: PriceHistoryService,
    private readonly search: SearchService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Registra el trabajo y lo lanza sin esperarlo.
   *
   * Devuelve en cuanto la fila existe, que es lo que la pantalla necesita para
   * empezar a enseñar el progreso.
   */
  async lanzar(
    supplierId: string,
    opciones: OpcionesImportacionMasiva,
    ctx: ContextoActor,
  ): Promise<{ jobId: string }> {
    const articulos = await this.prisma.client.supplierCatalogItem.count({
      where: { supplierId, removed: false },
    });

    if (articulos === 0) {
      throw new BadRequestException(
        'Este proveedor no tiene catálogo guardado. Sube primero su fichero: sin él no hay ' +
          'nada que importar.',
      );
    }

    await this.exigirQueNoHayaOtro(supplierId);

    const jobId = newId();
    await this.prisma.client.supplierBulkImport.create({
      data: { id: jobId, supplierId, ...(ctx.actorId ? { startedBy: ctx.actorId } : {}) },
    });

    await this.audit.registrar({
      action: 'supplier.bulk_import',
      resource: 'supplier',
      resourceId: supplierId,
      ...(ctx.actorId ? { actorId: ctx.actorId } : {}),
      ...(ctx.actorIp ? { actorIp: ctx.actorIp } : {}),
      after: { jobId, ...opciones },
    });

    void this.procesar(supplierId, jobId, opciones, ctx).catch((error: unknown) => {
      this.logger.error(
        `Importación masiva ${jobId} fallida: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    return { jobId };
  }

  /**
   * Dos pasadas a la vez se pisarían.
   *
   * Las dos crearían el mismo producto —ninguna vería el enlace de la otra
   * hasta que estuviera escrito— y la tienda acabaría con la mitad del catálogo
   * duplicado, cada copia con su handle y sus fotos ocupando disco.
   */
  private async exigirQueNoHayaOtro(supplierId: string): Promise<void> {
    const enCurso = await this.prisma.client.supplierBulkImport.findFirst({
      where: {
        supplierId,
        status: 'RUNNING',
        startedAt: { gt: new Date(Date.now() - MINUTOS_PARA_DAR_POR_MUERTO * 60_000) },
      },
    });

    if (enCurso) {
      throw new BadRequestException(
        'Ya hay una importación de este catálogo en curso. Espera a que termine o cancélala.',
      );
    }
  }

  /** Pide parar. Lo hecho hasta ahora se queda hecho. */
  async cancelar(supplierId: string): Promise<{ cancelando: boolean }> {
    const { count } = await this.prisma.client.supplierBulkImport.updateMany({
      where: { supplierId, status: 'RUNNING' },
      data: { cancelRequested: true },
    });

    return { cancelando: count > 0 };
  }

  /** El último trabajo, en curso o terminado, para pintar la pantalla. */
  async estado(supplierId: string) {
    const fila = await this.prisma.client.supplierBulkImport.findFirst({
      where: { supplierId },
      orderBy: { startedAt: 'desc' },
    });

    if (!fila) return null;

    return {
      ...fila,
      failures: (fila.failures ?? []) as { referencia: string; motivo: string }[],
    };
  }

  // ── El trabajo ────────────────────────────────────────────

  private async procesar(
    supplierId: string,
    jobId: string,
    opciones: OpcionesImportacionMasiva,
    ctx: ContextoActor,
  ): Promise<void> {
    const inicio = Date.now();
    const resumen: Resumen = {
      procesados: 0,
      creados: 0,
      actualizados: 0,
      saltados: 0,
      errores: 0,
      imagenes: 0,
      pvpr: 0,
      margen: 0,
      bajoMinimo: 0,
      preciosRespetados: 0,
      variantesNuevas: 0,
    };
    const fallos: { referencia: string; motivo: string }[] = [];
    let cancelado = false;

    try {
      const proveedor = await this.prisma.client.supplier.findUniqueOrThrow({
        where: { id: supplierId },
      });
      const adaptador = await this.suppliers.adaptador(supplierId);
      const estrategia: EstrategiaPrecio = opciones.precio ?? 'pvpr';
      const publicar = opciones.publicar !== false;

      const claves = await this.familiasDelCatalogo(supplierId, opciones);

      await this.prisma.client.supplierBulkImport.update({
        where: { id: jobId },
        data: { total: claves.length },
      });

      for (const clave of claves) {
        let etiqueta = clave;

        try {
          const origen = await adaptador.obtenerProducto(clave, 'ES');

          /*
           * Sin ficha no se importa nada, pero tampoco es un error.
           *
           * Pasa cuando el catálogo tiene la familia pero ninguno de sus
           * artículos sirve para armar un producto. Contarlo como fallo
           * llenaría el informe de ruido y taparía los fallos de verdad.
           */
          if (!origen) {
            resumen.saltados++;
          } else {
            etiqueta = origen.title;

            const enlace = await this.enlaceExistente(supplierId, origen);

            if (enlace) {
              const cambios = await this.actualizarProducto(
                proveedor,
                enlace.productId,
                origen,
                estrategia,
                publicar,
                opciones.actualizarPrecios !== false,
              );
              this.sumarPrecios(resumen, cambios.precios);
              resumen.variantesNuevas += cambios.variantesNuevas;
              resumen.actualizados++;
              await this.reindexar(enlace.productId);
            } else {
              const creado = await this.importer.crearDesdeOrigen(
                proveedor,
                origen,
                {
                  precio: estrategia,
                  estado: publicar ? 'ACTIVE' : 'DRAFT',
                  descargarImagenes: opciones.descargarImagenes !== false,
                  // Ni traducción ni auditoría por producto: mil llamadas a un
                  // traductor de pago y mil líneas de auditoría por una sola
                  // pulsación. Se anota una línea al lanzar y otra al terminar.
                  traducir: false,
                  auditar: false,
                },
                ctx,
              );

              this.sumarPrecios(resumen, creado.precios);
              resumen.imagenes += creado.imagenes;
              resumen.creados++;
              await this.reindexar(creado.productId);
            }
          }
        } catch (error) {
          resumen.errores++;
          const motivo = error instanceof Error ? error.message : String(error);
          if (fallos.length < FALLOS_GUARDADOS) {
            fallos.push({ referencia: etiqueta.slice(0, 120), motivo: motivo.slice(0, 300) });
          }
          this.logger.warn(`Importación masiva: «${etiqueta}» ha fallado: ${motivo}`);
        }

        resumen.procesados++;

        /*
         * El progreso se escribe DESPUÉS de cada familia y la respuesta se
         * aprovecha para mirar si alguien ha pulsado «cancelar».
         *
         * Así la parada cuesta una sola consulta por producto en vez de dos, y
         * el que cancela no se queda esperando a que terminen las 900 que
         * faltan: como mucho espera a que acabe la que está en marcha.
         */
        const fila = await this.prisma.client.supplierBulkImport.update({
          where: { id: jobId },
          data: {
            processed: resumen.procesados,
            created: resumen.creados,
            updated: resumen.actualizados,
            skipped: resumen.saltados,
            errors: resumen.errores,
            imagesImported: resumen.imagenes,
            pricedFromRrp: resumen.pvpr,
            belowMinMargin: resumen.bajoMinimo,
            pricedByMargin: resumen.margen,
            pricesKept: resumen.preciosRespetados,
            newVariants: resumen.variantesNuevas,
            currentLabel: etiqueta.slice(0, 200),
            failures: fallos,
          },
          select: { cancelRequested: true },
        });

        if (fila.cancelRequested) {
          cancelado = true;
          break;
        }
      }

      const duracionMs = Date.now() - inicio;

      await this.prisma.client.supplierBulkImport.update({
        where: { id: jobId },
        data: {
          status: cancelado ? 'CANCELLED' : 'COMPLETED',
          currentLabel: null,
          finishedAt: new Date(),
          durationMs: duracionMs,
        },
      });

      await this.audit.registrar({
        action: 'supplier.bulk_import_finished',
        resource: 'supplier',
        resourceId: supplierId,
        ...(ctx.actorId ? { actorId: ctx.actorId } : {}),
        ...(ctx.actorIp ? { actorIp: ctx.actorIp } : {}),
        after: { jobId, cancelado, ...resumen },
      });

      this.logger.log(
        `Importación masiva de ${proveedor.name}: ${resumen.creados} creados, ` +
          `${resumen.actualizados} actualizados, ${resumen.saltados} saltados, ` +
          `${resumen.errores} con error en ${Math.round(duracionMs / 1000)}s` +
          (cancelado ? ' (cancelada)' : ''),
      );
    } catch (error) {
      await this.prisma.client.supplierBulkImport.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          errorDetail: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          finishedAt: new Date(),
          durationMs: Date.now() - inicio,
          failures: fallos,
        },
      });
      throw error;
    }
  }

  /**
   * ¿Ya vendemos esta familia?
   *
   * Se busca por el identificador de la familia y **también por el de sus
   * artículos**. No es rebuscar por rebuscar: quien importó un producto a mano
   * pegando el EAN o el código de caja guardó ese texto como identificador del
   * producto, y buscando solo por la clave de familia no aparecería. El
   * resultado sería crear otra vez algo que ya está a la venta, con otro
   * handle, otras fotos y su propio enlace al proveedor.
   *
   * El identificador de cada artículo, en cambio, es siempre el mismo mire
   * quien lo mire: es lo que ata cada variante nuestra a su color en el
   * catálogo.
   */
  private async enlaceExistente(
    supplierId: string,
    origen: ProductoProveedor,
  ): Promise<{ productId: string } | null> {
    return this.prisma.client.supplierProduct.findFirst({
      where: {
        supplierId,
        OR: [
          { externalProductId: origen.externalId },
          ...(origen.variants.length > 0
            ? [{ externalVariantId: { in: origen.variants.map((v) => v.externalId) } }]
            : []),
        ],
      },
      select: { productId: true },
    });
  }

  /**
   * Las familias que hay que recorrer.
   *
   * Se piden las claves de golpe y no página a página a propósito: importar
   * cambia lo que hay en la tienda, no el catálogo del proveedor, pero paginar
   * durante una hora sobre una consulta ordenada es la clase de cosa que se
   * salta filas en cuanto algo cambia por debajo. Son unas mil cadenas cortas:
   * caben de sobra en memoria.
   */
  private async familiasDelCatalogo(
    supplierId: string,
    opciones: OpcionesImportacionMasiva,
  ): Promise<string[]> {
    /*
     * En SQL y no con el `distinct` del cliente: ese agrupa después de traer
     * las filas, así que con un tope pediría N artículos y devolvería muchas
     * menos familias. Aquí el DISTINCT lo hace Postgres y el límite cuenta
     * familias, que es lo que dice el botón de «probar con unas pocas».
     */
    const filas = await this.prisma.client.$queryRaw<{ groupKey: string }[]>`
      SELECT DISTINCT "groupKey"
      FROM "supplier_catalog_items"
      WHERE "supplierId" = ${supplierId}
        AND "removed" = false
        ${opciones.soloDisponibles ? Prisma.sql`AND "available" = true` : Prisma.empty}
      -- Estable entre pasadas: si una se corta a la mitad, la siguiente vuelve
      -- a empezar por lo mismo y lo ya creado solo se actualiza.
      ORDER BY "groupKey" ASC
      ${opciones.limite ? Prisma.sql`LIMIT ${opciones.limite}` : Prisma.empty}
    `;

    return filas.map((f) => f.groupKey);
  }

  /**
   * Pone al día un producto que ya existía.
   *
   * Se tocan precio, coste, existencias y disponibilidad, y se rellenan la
   * categoría y la marca **solo si faltan**. Lo que no se toca nunca es el
   * título, la descripción ni las fotos: puede haberlas repasado una persona, y
   * machacarlas en cada pasada convertiría ese trabajo en algo que se pierde
   * cada vez que alguien pulsa el botón.
   *
   * Tampoco se dan de alta las variantes nuevas —un color que el proveedor
   * añade a un producto que ya vendemos—: hacerlo implica tocar las opciones
   * de una ficha viva y, mal hecho, deja un desplegable con un valor que no
   * corresponde a ninguna variante. Se cuentan y se enseñan.
   *
   * Con `actualizarPrecios` apagado se deja el precio de venta como está y se
   * actualiza todo lo demás. El coste sí se escribe igualmente: no es lo que ve
   * el cliente, es contra lo que se mide el margen, y dejarlo viejo haría que
   * los informes de rentabilidad hablaran de un coste que ya no se paga.
   */
  private async actualizarProducto(
    proveedor: Supplier,
    productId: string,
    origen: ProductoProveedor,
    estrategia: EstrategiaPrecio,
    publicar: boolean,
    actualizarPrecios: boolean,
  ): Promise<{
    precios: { pvpr: number; margen: number; bajoMinimo: number; preciosRespetados: number };
    variantesNuevas: number;
  }> {
    const precios = { pvpr: 0, margen: 0, bajoMinimo: 0, preciosRespetados: 0 };

    const producto = await this.prisma.client.product.findUnique({
      where: { id: productId },
      select: { id: true, taxRate: true, categoryId: true, brandId: true, status: true },
    });

    // Enlace huérfano: el producto se borró y el enlace se quedó. No se puede
    // actualizar lo que no existe, y crear otro con el mismo identificador
    // chocaría con el enlace que sigue ahí.
    if (!producto) {
      throw new Error(`El producto ${productId} enlazado con el proveedor ya no existe`);
    }

    const tipoIva = Number(producto.taxRate);
    const enlaces = await this.prisma.client.supplierProduct.findMany({
      where: { supplierId: proveedor.id, productId },
    });

    const porVariante = new Map<string, VarianteProveedor>(
      origen.variants.map((v) => [v.externalId, v]),
    );

    for (const enlace of enlaces) {
      const variante = enlace.externalVariantId
        ? porVariante.get(enlace.externalVariantId)
        : origen.variants[0];

      /*
       * El proveedor ha dejado de mandar esta variante.
       *
       * Se marca retirada y se pone su stock a cero en lugar de dejarla como
       * estaba: lo que no se puede comprar no se puede vender, y una variante
       * agotada visible es un pedido que hay que devolver.
       */
      if (!variante) {
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
            nota: 'El proveedor ha retirado esta variante de su catálogo',
          });
        }
        continue;
      }

      const stock = variante.stock ?? 0;
      const calculo = precioDeImportacion(
        estrategia,
        variante.costCents,
        variante.rrpCents,
        this.reglasDePrecio(proveedor, origen, variante.costCents, tipoIva),
      );
      // Los recuentos de precio solo cuentan lo que de verdad se ha puesto: con
      // el interruptor apagado, decir «950 al PVP del proveedor» sería mentir
      // sobre precios que no se han tocado.
      if (actualizarPrecios) {
        precios[calculo.origen]++;
        if (calculo.bajoMinimo) precios.bajoMinimo++;
      }

      await this.prisma.client.supplierProduct.update({
        where: { id: enlace.id },
        data: {
          costCents: variante.costCents,
          stock,
          available: stock > 0,
          discontinued: false,
          discontinuedAt: null,
          lastCheckedAt: new Date(),
        },
      });

      if (!enlace.variantId) continue;

      const nuestra = await this.prisma.client.productVariant.findUnique({
        where: { id: enlace.variantId },
        select: { priceCents: true, costCents: true, stock: true },
      });
      if (!nuestra) continue;

      if (actualizarPrecios) {
        if (
          nuestra.priceCents !== calculo.pvpCents ||
          nuestra.costCents !== calculo.costeCompraCents
        ) {
          await this.prisma.client.productVariant.update({
            where: { id: enlace.variantId },
            data: { priceCents: calculo.pvpCents, costCents: calculo.costeCompraCents },
          });
        }

        // El histórico es lo que permite calcular el mínimo de los últimos 30
        // días, que es contra lo que la ley mide un descuento anunciado.
        await this.precios.registrarSiCambia(
          enlace.variantId,
          calculo.pvpCents,
          'importacion_masiva',
        );
      } else {
        /*
         * El precio se queda como está; el coste, no.
         *
         * El coste no lo ve nadie desde fuera: es contra lo que se mide el
         * margen en el panel y en los informes. Congelarlo junto al precio
         * dejaría la rentabilidad calculada sobre lo que costaba el mes
         * pasado, que es la clase de dato que parece bueno hasta que se cierra
         * el trimestre.
         */
        if (nuestra.costCents !== calculo.costeCompraCents) {
          await this.prisma.client.productVariant.update({
            where: { id: enlace.variantId },
            data: { costCents: calculo.costeCompraCents },
          });
        }

        // Solo cuenta como «respetado» si de verdad había diferencia: sumar
        // los que ya coincidían inflaría la cifra con precios que nadie iba a
        // cambiar de todos modos.
        if (nuestra.priceCents !== calculo.pvpCents) precios.preciosRespetados++;
      }

      if (nuestra.stock !== stock) {
        await this.inventory.ajustar(enlace.variantId, stock, 'SUPPLIER_SYNC', {
          nota: 'Existencias del catálogo del proveedor',
        });
      }
    }

    await this.completarClasificacion(proveedor.id, producto, origen, publicar);

    // Lo que el proveedor manda y todavía no está enlazado a ninguna variante
    // nuestra: colores o tallas que ha añadido después de importarlo.
    const enlazadas = new Set(enlaces.map((e) => e.externalVariantId));
    const variantesNuevas = origen.variants.filter((v) => !enlazadas.has(v.externalId)).length;

    return { precios, variantesNuevas };
  }

  /**
   * Rellena lo que le falte al producto: categoría, marca y publicación.
   *
   * Es la mitad de lo que se venía a hacer. Los productos que se importaron
   * antes de que existiera el árbol de categorías del proveedor entraron sin
   * ella, y sin categoría no aparecen al navegar la tienda: están a la venta y
   * no hay forma de llegar a ellos si no es buscándolos por su nombre exacto.
   */
  private async completarClasificacion(
    supplierId: string,
    producto: { id: string; categoryId: string | null; brandId: string | null; status: string },
    origen: ProductoProveedor,
    publicar: boolean,
  ): Promise<void> {
    const cambios: {
      categoryId?: string;
      brandId?: string;
      isAdult?: boolean;
      status?: 'ACTIVE';
      publishedAt?: Date;
    } = {};

    if (!producto.categoryId) {
      const categoryId = await this.importer.categoriaDelProveedor(supplierId, origen);
      if (categoryId) {
        cambios.categoryId = categoryId;

        // La categoría decide si el producto es +18, y de eso depende que pase
        // por la puerta de edad y que se quede fuera del feed de Google.
        const categoria = await this.prisma.client.category.findUnique({
          where: { id: categoryId },
          select: { isAdult: true },
        });
        if (categoria?.isAdult) cambios.isAdult = true;
      }
    }

    if (!producto.brandId && origen.brand) {
      const marca = await this.brands.asegurar(origen.brand);
      if (marca) cambios.brandId = marca.id;
    }

    if (publicar && producto.status === 'DRAFT') {
      cambios.status = 'ACTIVE';
      cambios.publishedAt = new Date();
    }

    if (Object.keys(cambios).length === 0) return;

    await this.prisma.client.product.update({ where: { id: producto.id }, data: cambios });
  }

  /** Las reglas de precio del proveedor, tal y como las espera el cálculo. */
  private reglasDePrecio(
    proveedor: Supplier,
    origen: ProductoProveedor,
    costeCents: number,
    tipoIva: number,
  ): ReglasDePrecio {
    return {
      margenObjetivo: Number(proveedor.defaultMarginPct),
      margenMinimo: Number(proveedor.minMarginPct),
      taxRate: tipoIva,
      envioCents: proveedor.includeShipping ? (origen.shippingCents ?? 0) : 0,
      recargoPct: Number(proveedor.purchaseSurchargePct),
      cargoFijoCents: cargoFijoAplicable(costeCents, {
        importeCents: proveedor.importFeeCents,
        umbralCents: proveedor.importFeeThresholdCents,
      }),
      terminacion: proveedor.priceEnding,
    };
  }

  private sumarPrecios(
    resumen: Resumen,
    // `preciosRespetados` es opcional porque un producto recién creado no tiene
    // ningún precio que respetar: solo lo trae la rama de actualización.
    precios: { pvpr: number; margen: number; bajoMinimo: number; preciosRespetados?: number },
  ) {
    resumen.pvpr += precios.pvpr;
    resumen.bajoMinimo += precios.bajoMinimo;
    resumen.preciosRespetados += precios.preciosRespetados ?? 0;
    resumen.margen += precios.margen;
  }

  /**
   * Mete el producto en el buscador.
   *
   * Se espera pero no se deja fallar: un Meilisearch caído no puede tirar una
   * importación de una hora, y lo que quede sin indexar lo recoge el
   * reindexado completo.
   */
  private async reindexar(productId: string): Promise<void> {
    await this.search.indexarProducto(productId).catch((error: unknown) => {
      this.logger.warn(
        `No se ha podido indexar ${productId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
}
