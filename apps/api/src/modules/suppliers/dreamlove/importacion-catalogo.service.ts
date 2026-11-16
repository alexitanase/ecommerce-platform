import { unlink } from 'node:fs/promises';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@ecom/db';
import { recorrerCatalogoDreamlove, type ArticuloDreamlove } from '@ecom/suppliers';
import { newId } from '@ecom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { SupplierSyncService } from '../sync.service.js';
import { normalizar } from './catalogo.service.js';
import { abrirCatalogo, type CatalogoAbierto } from './abrir-catalogo.js';

/**
 * Cuántos artículos se escriben por sentencia.
 *
 * Con uno por sentencia, procesar el catálogo son 12.913 idas y venidas a
 * Postgres y varios minutos de reloj. En bloques la diferencia es de dos
 * órdenes de magnitud. El tope lo pone el límite de 65.535 parámetros por
 * sentencia de Postgres: a 38 columnas por fila, 300 filas son 11.400
 * parámetros, con sitio de sobra por si el modelo crece.
 */
const TAMANO_BLOQUE = 300;

/** Una importación que lleva más de esto parada se da por muerta. */
const MINUTOS_PARA_DAR_POR_MUERTA = 30;

export interface ResultadoImportacionCatalogo {
  importId: string;
  leidos: number;
  creados: number;
  actualizados: number;
  retirados: number;
  descartados: number;
  erroresXml: number;
  cambiosPrecio: number;
  cambiosStock: number;
  /** Cuántas ramas distintas trae su árbol de categorías. */
  categorias: number;
  duracionMs: number;
}

/**
 * Procesa el catálogo que manda un proveedor sin API.
 *
 * Dreamlove no tiene endpoints: manda un XML de unos 340 MB con sus 12.913
 * artículos y hay que quedarse con una copia propia para poder buscar,
 * importar y sincronizar. Esto es lo que convierte ese fichero en filas.
 *
 * Va en segundo plano y no dentro de la petición HTTP a propósito: entre subir
 * el fichero y escribirlo entero pasan decenas de segundos, más de lo que
 * aguanta cualquier proxy por delante. La pantalla recibe el identificador de
 * la importación y consulta cómo va.
 */
@Injectable()
export class ImportacionCatalogoService {
  private readonly logger = new Logger(ImportacionCatalogoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sync: SupplierSyncService,
  ) {}

  /**
   * Registra la importación y la lanza sin esperarla.
   *
   * Devuelve en cuanto la fila existe: a partir de ahí el panel puede
   * enseñarla y refrescar su estado. El fichero temporal se borra pase lo que
   * pase, también si el procesado revienta a medias.
   */
  async lanzar(
    supplierId: string,
    fichero: { ruta: string; nombre: string; tamanoBytes: number },
    ctx: { actorId?: string; actorIp?: string } = {},
  ): Promise<{ importId: string }> {
    await this.exigirQueNoHayaOtraEnCurso(supplierId, fichero.ruta);

    const importId = newId();
    await this.prisma.client.supplierCatalogImport.create({
      data: {
        id: importId,
        supplierId,
        fileName: fichero.nombre,
        fileSizeBytes: BigInt(fichero.tamanoBytes),
        ...(ctx.actorId ? { uploadedBy: ctx.actorId } : {}),
      },
    });

    await this.audit.registrar({
      action: 'supplier.catalog_upload',
      resource: 'supplier',
      resourceId: supplierId,
      ...(ctx.actorId ? { actorId: ctx.actorId } : {}),
      ...(ctx.actorIp ? { actorIp: ctx.actorIp } : {}),
      after: { importId, fichero: fichero.nombre, bytes: fichero.tamanoBytes },
    });

    void this.procesar(supplierId, importId, fichero).catch((error: unknown) => {
      this.logger.error(
        `Importación ${importId} fallida: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    return { importId };
  }

  /**
   * Dos importaciones a la vez dejarían el catálogo mezclado.
   *
   * La segunda marcaría como retirado lo que la primera aún no ha escrito, y
   * despublicaríamos medio catálogo por haber pulsado el botón dos veces.
   */
  private async exigirQueNoHayaOtraEnCurso(supplierId: string, ruta: string): Promise<void> {
    const enCurso = await this.prisma.client.supplierCatalogImport.findFirst({
      where: {
        supplierId,
        status: 'RUNNING',
        startedAt: { gt: new Date(Date.now() - MINUTOS_PARA_DAR_POR_MUERTA * 60_000) },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (enCurso) {
      // El fichero recién subido ya no vale para nada: si no se borra aquí, se
      // queda ocupando disco hasta que alguien lo vea.
      await unlink(ruta).catch(() => undefined);
      throw new BadRequestException(
        'Ya hay un catálogo procesándose para este proveedor. Espera a que termine.',
      );
    }
  }

  private async procesar(
    supplierId: string,
    importId: string,
    fichero: { ruta: string; nombre: string },
  ): Promise<void> {
    const inicio = Date.now();
    // La marca de agua de esta pasada: lo que no se toque antes de terminar es
    // lo que el proveedor ha dejado de mandar.
    const comienzo = new Date();

    const resultado: ResultadoImportacionCatalogo = {
      importId,
      leidos: 0,
      creados: 0,
      actualizados: 0,
      retirados: 0,
      descartados: 0,
      erroresXml: 0,
      cambiosPrecio: 0,
      cambiosStock: 0,
      categorias: 0,
      duracionMs: 0,
    };

    /*
     * Se declara fuera y se abre DENTRO del `try`.
     *
     * Abrirlo fuera es lo que sale solo al escribirlo, y deja un agujero: un
     * ZIP que no lleva ningún catálogo dentro lanza aquí mismo, el `catch` de
     * abajo no llega a ejecutarse y la importación se queda en curso para
     * siempre. Con eso, el panel enseña un procesado eterno y —peor— la
     * comprobación de «ya hay uno en marcha» bloquea el siguiente intento
     * durante media hora.
     */
    let catalogo: CatalogoAbierto | null = null;

    try {
      /*
       * Lo que llega puede ser el XML suelto, comprimido con gzip o —lo
       * habitual con Dreamlove— dentro de un ZIP. Los tres acaban en la misma
       * secuencia de trozos, así que a partir de esta línea el resto de la
       * importación no sabe ni tiene por qué saber en qué venía envuelto.
       */
      catalogo = await abrirCatalogo(fichero.ruta);

      if (catalogo.entrada) {
        this.logger.log(`Del ZIP ${fichero.nombre} se lee «${catalogo.entrada}»`);
      }

      let bloque: ArticuloDreamlove[] = [];

      /*
       * El árbol de categorías del proveedor, que se va armando de paso.
       *
       * Se acumula en memoria en vez de escribirlo con cada artículo porque
       * son 311 ramas para 12.913 artículos: escribirlas al vuelo serían miles
       * de UPDATE para acabar en las mismas 311 filas. Ocupa unos kilobytes.
       */
      const categorias = new Map<string, { nombre: string; articulos: number }>();

      const resumen = await recorrerCatalogoDreamlove(catalogo.contenido, async (articulo) => {
        this.anotarCategorias(articulo, categorias);

        bloque.push(articulo);
        if (bloque.length >= TAMANO_BLOQUE) {
          await this.escribirBloque(supplierId, bloque, resultado);
          bloque = [];
        }
      });

      if (bloque.length > 0) await this.escribirBloque(supplierId, bloque, resultado);

      resultado.categorias = await this.guardarCategorias(supplierId, categorias);

      resultado.leidos = resumen.articulos;
      resultado.descartados = resumen.descartados;
      resultado.erroresXml = resumen.erroresXml;

      // Solo después de leer el fichero ENTERO se dan bajas. Hacerlo por el
      // camino significaría que un fallo a mitad deja retirado medio catálogo.
      resultado.retirados = await this.marcarLosQueYaNoVienen(supplierId, comienzo);

      resultado.duracionMs = Date.now() - inicio;

      await this.prisma.client.supplierCatalogImport.update({
        where: { id: importId },
        data: {
          status: 'COMPLETED',
          // Con un ZIP se anota también QUÉ se ha leído de dentro. Si trae más
          // de un fichero, saber cuál se cogió es la diferencia entre entender
          // un recuento raro y volver a descargarlo para mirarlo a mano.
          ...(catalogo.entrada ? { fileName: `${fichero.nombre} › ${catalogo.entrada}` } : {}),
          itemsRead: resultado.leidos,
          itemsCreated: resultado.creados,
          itemsUpdated: resultado.actualizados,
          itemsRemoved: resultado.retirados,
          itemsDiscarded: resultado.descartados,
          xmlErrors: resultado.erroresXml,
          priceChanges: resultado.cambiosPrecio,
          stockChanges: resultado.cambiosStock,
          finishedAt: new Date(),
          durationMs: resultado.duracionMs,
        },
      });

      this.logger.log(
        `Catálogo de ${fichero.nombre}: ${resultado.leidos} artículos ` +
          `(${resultado.creados} nuevos, ${resultado.actualizados} cambiados, ` +
          `${resultado.retirados} retirados) en ${Math.round(resultado.duracionMs / 1000)}s`,
      );

      await this.refrescarLoQueYaVendemos(supplierId, importId);
    } catch (error) {
      await this.prisma.client.supplierCatalogImport.update({
        where: { id: importId },
        data: {
          status: 'FAILED',
          errorDetail: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          finishedAt: new Date(),
          durationMs: Date.now() - inicio,
          itemsRead: resultado.leidos,
          itemsCreated: resultado.creados,
          itemsUpdated: resultado.actualizados,
        },
      });
      throw error;
    } finally {
      // El ZIP se cierra pase lo que pase: si no, el descriptor del fichero
      // queda abierto y el temporal no se puede borrar en Windows ni se libera
      // el espacio en Linux hasta que muera el proceso.
      catalogo?.cerrar();
      await unlink(fichero.ruta).catch(() => undefined);
    }
  }

  /**
   * Apunta las categorías que declara un artículo.
   *
   * Cada uno trae su rama entera —`LOVETOYS`, `LOVETOYS|Vibrators`,
   * `LOVETOYS|Vibrators|Realistic Vibrators`— con el nombre en español de cada
   * escalón, así que recorriendo el catálogo se levanta el árbol completo sin
   * una segunda pasada.
   *
   * El recuento solo suma la principal. Es la que decide dónde acabaría el
   * producto si se importara, y contar también las de paso pondría los 5.391
   * artículos de LOVETOYS en la raíz y haría creer que ahí hay algo que no
   * está en sus hijas.
   */
  private anotarCategorias(
    articulo: ArticuloDreamlove,
    acumulado: Map<string, { nombre: string; articulos: number }>,
  ): void {
    const principal = articulo.categoria.join('|');

    for (const categoria of articulo.categorias) {
      const ruta = categoria.ruta.join('|');
      const previo = acumulado.get(ruta);

      if (previo) {
        // El nombre no se pisa: el primero que llega vale, y todos los
        // artículos de una misma rama traen el mismo.
        if (ruta === principal) previo.articulos++;
      } else {
        acumulado.set(ruta, {
          nombre: categoria.nombreEs,
          articulos: ruta === principal ? 1 : 0,
        });
      }
    }
  }

  /**
   * Guarda el árbol del proveedor.
   *
   * Se reescribe entero en cada catálogo —nombres y recuentos— porque el
   * proveedor puede renombrar una rama o vaciarla, y un recuento viejo es
   * peor que ninguno: se decide sobre él qué merece la pena importar.
   *
   * Lo que NO se toca es `categoryId`: es el vínculo con nuestra categoría y
   * borrarlo dejaría sin asignar todo lo que se importara después.
   */
  private async guardarCategorias(
    supplierId: string,
    categorias: Map<string, { nombre: string; articulos: number }>,
  ): Promise<number> {
    if (categorias.size === 0) return 0;

    for (const [ruta, datos] of categorias) {
      const comun = {
        name: datos.nombre.slice(0, 200),
        depth: ruta.split('|').length,
        itemCount: datos.articulos,
      };

      await this.prisma.client.supplierCategory.upsert({
        where: { supplierId_path: { supplierId, path: ruta } },
        create: { id: newId(), supplierId, path: ruta, ...comun },
        update: comun,
      });
    }

    return categorias.size;
  }

  /**
   * Escribe un bloque de artículos: los nuevos entran, los conocidos se
   * actualizan.
   *
   * Antes de escribir se lee lo que había para poder contar qué ha cambiado de
   * precio y de stock. Ese recuento es lo que se enseña después de cada
   * catálogo, y es lo que permite responder a «¿por qué han subido treinta
   * precios esta mañana?» sin comparar dos ficheros de 340 MB a mano.
   */
  private async escribirBloque(
    supplierId: string,
    articulos: ArticuloDreamlove[],
    resultado: ResultadoImportacionCatalogo,
  ): Promise<void> {
    const anteriores = new Map(
      (
        await this.prisma.client.supplierCatalogItem.findMany({
          where: { supplierId, externalId: { in: articulos.map((a) => a.externalId) } },
          select: { externalId: true, costCents: true, stock: true },
        })
      ).map((f) => [f.externalId, f]),
    );

    for (const articulo of articulos) {
      const antes = anteriores.get(articulo.externalId);
      if (!antes) {
        resultado.creados++;
        continue;
      }

      resultado.actualizados++;
      if (antes.costCents !== articulo.costeCents) resultado.cambiosPrecio++;
      if (antes.stock !== articulo.stock) resultado.cambiosStock++;
    }

    const ahora = new Date();

    const filas = articulos.map(
      (a) => Prisma.sql`(
        ${newId()}, ${supplierId}, ${a.externalId}, ${a.codigo}, ${a.grupoId}, ${a.claveGrupo},
        ${a.titulo}, ${a.tituloGrupo}, ${a.descripcion}, ${a.descripcionHtml}, ${a.marca},
        ${a.marcaRaiz},
        ${a.costeCents}, ${a.pvpRecomendadoCents}, ${a.ivaPct}::decimal, ${a.moneda},
        ${a.stock}, ${a.disponible},
        ${JSON.stringify(a.imagenes)}::jsonb, ${JSON.stringify(a.categoria)}::jsonb,
        ${a.categoriaEs}, ${a.eans}::text[], ${a.pesoGramos},
        ${JSON.stringify(a.opciones)}::jsonb, ${a.minUnidades}, ${a.maxUnidades},
        ${a.plazoDias?.min ?? null}, ${a.plazoDias?.max ?? null}, ${a.urlProveedor},
        ${a.enOferta}, ${a.esNovedad}, ${a.liquidacion},
        ${textoBuscable(a)}, ${a.actualizadoEn}, ${ahora}, ${ahora}, false, ${ahora}, ${ahora}
      )`,
    );

    await this.prisma.client.$executeRaw`
      INSERT INTO "supplier_catalog_items" (
        "id", "supplierId", "externalId", "code", "groupId", "groupKey",
        "title", "groupTitle", "shortDescription", "descriptionHtml", "brand",
        "brandRoot",
        "costCents", "rrpCents", "vatPct", "currency",
        "stock", "available",
        "imageUrls", "categoryPath",
        "categoryName", "eans", "weightGrams",
        "options", "minUnits", "maxUnits",
        "leadTimeMinDays", "leadTimeMaxDays", "supplierUrl",
        "onSale", "isNew", "clearance",
        "searchText", "supplierUpdatedAt", "firstSeenAt", "lastSeenAt", "removed",
        "createdAt", "updatedAt"
      )
      VALUES ${Prisma.join(filas, ',')}
      ON CONFLICT ("supplierId", "externalId") DO UPDATE SET
        "code" = EXCLUDED."code",
        "groupId" = EXCLUDED."groupId",
        "groupKey" = EXCLUDED."groupKey",
        "title" = EXCLUDED."title",
        "groupTitle" = EXCLUDED."groupTitle",
        "shortDescription" = EXCLUDED."shortDescription",
        "descriptionHtml" = EXCLUDED."descriptionHtml",
        "brand" = EXCLUDED."brand",
        "brandRoot" = EXCLUDED."brandRoot",
        "costCents" = EXCLUDED."costCents",
        "rrpCents" = EXCLUDED."rrpCents",
        "vatPct" = EXCLUDED."vatPct",
        "currency" = EXCLUDED."currency",
        "stock" = EXCLUDED."stock",
        "available" = EXCLUDED."available",
        "imageUrls" = EXCLUDED."imageUrls",
        "categoryPath" = EXCLUDED."categoryPath",
        "categoryName" = EXCLUDED."categoryName",
        "eans" = EXCLUDED."eans",
        "weightGrams" = EXCLUDED."weightGrams",
        "options" = EXCLUDED."options",
        "minUnits" = EXCLUDED."minUnits",
        "maxUnits" = EXCLUDED."maxUnits",
        "leadTimeMinDays" = EXCLUDED."leadTimeMinDays",
        "leadTimeMaxDays" = EXCLUDED."leadTimeMaxDays",
        "supplierUrl" = EXCLUDED."supplierUrl",
        "onSale" = EXCLUDED."onSale",
        "isNew" = EXCLUDED."isNew",
        "clearance" = EXCLUDED."clearance",
        "searchText" = EXCLUDED."searchText",
        "supplierUpdatedAt" = EXCLUDED."supplierUpdatedAt",
        "lastSeenAt" = EXCLUDED."lastSeenAt",
        -- Un artículo que vuelve al catálogo deja de estar retirado: los
        -- proveedores reponen referencias que habían quitado.
        "removed" = false,
        "updatedAt" = EXCLUDED."updatedAt"
    `;
  }

  /**
   * Marca lo que ya no viene en el catálogo.
   *
   * No se borra: el artículo puede estar importado y vendiéndose, y borrarlo
   * dejaría la ficha sin saber de dónde salió. Se marca, y la sincronización
   * es la que despublica lo que ya no se puede servir.
   */
  private async marcarLosQueYaNoVienen(supplierId: string, comienzo: Date): Promise<number> {
    const { count } = await this.prisma.client.supplierCatalogItem.updateMany({
      where: { supplierId, removed: false, lastSeenAt: { lt: comienzo } },
      data: { removed: true },
    });

    return count;
  }

  /**
   * Pone al día los productos que ya vendemos de este proveedor.
   *
   * El catálogo nuevo trae precios y stocks distintos, y hasta que no se
   * trasladan a nuestros productos la tienda sigue vendiendo con los de ayer.
   * Se reutiliza la sincronización de siempre: ahora lee del catálogo recién
   * procesado, así que hace exactamente lo que tiene que hacer —recalcular
   * PVP, anotar el histórico de precios y despublicar lo retirado— sin
   * duplicar nada.
   *
   * Un fallo aquí no invalida la importación: el catálogo ya está guardado y
   * la sincronización se puede volver a lanzar desde el panel.
   */
  private async refrescarLoQueYaVendemos(supplierId: string, importId: string): Promise<void> {
    try {
      const sincronizacion = await this.sync.sincronizar(supplierId, { tipo: 'completa' });

      await this.prisma.client.supplierCatalogImport.update({
        where: { id: importId },
        data: { linkedRefreshed: sincronizacion.comprobados },
      });
    } catch (error) {
      this.logger.warn(
        `Catálogo procesado, pero la sincronización posterior ha fallado: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Historial de importaciones para la ficha del proveedor. */
  async historial(supplierId: string, limite = 10) {
    const filas = await this.prisma.client.supplierCatalogImport.findMany({
      where: { supplierId },
      orderBy: { startedAt: 'desc' },
      take: limite,
    });

    return filas.map((f) => ({
      ...f,
      // BigInt no sobrevive a JSON.stringify: sin convertirlo, la respuesta
      // entera revienta con "Do not know how to serialize a BigInt".
      fileSizeBytes: Number(f.fileSizeBytes),
    }));
  }

  /** Estado del catálogo guardado, para saber con qué se está trabajando. */
  async estado(supplierId: string) {
    const [total, disponibles, retirados, ultima] = await Promise.all([
      this.prisma.client.supplierCatalogItem.count({ where: { supplierId } }),
      this.prisma.client.supplierCatalogItem.count({
        where: { supplierId, removed: false, available: true },
      }),
      this.prisma.client.supplierCatalogItem.count({ where: { supplierId, removed: true } }),
      this.prisma.client.supplierCatalogImport.findFirst({
        where: { supplierId, status: 'COMPLETED' },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, finishedAt: true, fileName: true, itemsRead: true },
      }),
    ]);

    const familias = await this.prisma.client.supplierCatalogItem.findMany({
      where: { supplierId, removed: false },
      distinct: ['groupKey'],
      select: { groupKey: true },
    });

    return {
      articulos: total,
      // Lo que de verdad se puede importar y vender hoy.
      disponibles,
      retirados,
      // Cuántos productos serían en la tienda, ya agrupados los colores.
      productos: familias.length,
      ultimaImportacion: ultima,
    };
  }
}

/**
 * El texto contra el que busca el importador.
 *
 * Se calcula al guardar y no al consultar: normalizar en cada búsqueda
 * impediría usar el índice y obligaría a recorrer las 12.913 filas cada vez.
 * Junta lo que una persona teclearía —el nombre, la marca, el código, el
 * EAN— porque no hay forma de saber cuál de ellos recuerda.
 */
function textoBuscable(a: ArticuloDreamlove): string {
  return normalizar(
    // La marca raíz entra en la búsqueda: buscando «pretty love» hay que
    // encontrar también sus gamas, cuyo nombre de hoja no la contiene.
    [a.titulo, a.tituloGrupo, a.marca, a.marcaRaiz, a.codigo, a.categoriaEs, ...a.eans]
      .filter(Boolean)
      .join(' '),
  );
}
