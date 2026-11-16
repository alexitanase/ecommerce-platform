import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Meilisearch, type Index } from 'meilisearch';
import type { Prisma } from '@ecom/db';
import { LOCALES, type Locale } from '@ecom/shared';
import { hayStock } from '../../common/catalogo/orden-por-stock.js';
import { IntegracionesService } from '../integrations/integraciones.service.js';
import { ajusteTexto } from '../integrations/valores.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

/** Documento tal y como se indexa. Plano a propósito: Meilisearch filtra mejor. */
export interface DocumentoProducto {
  id: string;
  handle: string;
  name: string;
  slug: string;
  shortDescription: string;
  description: string;
  brand: string | null;
  categoryId: string | null;
  categoryPath: string[];
  categoryName: string | null;
  priceCents: number;
  compareAtCents: number | null;
  /**
   * Está rebajado, y cuánto.
   *
   * Van al índice y no se calculan al buscar porque «tiene descuento» es una
   * comparación entre dos campos —el precio contra el precio anterior— y
   * Meilisearch no sabe filtrar por eso: solo compara un campo con un valor.
   * Sin esto no hay forma de pedirle «solo lo rebajado», que es toda la página
   * de ofertas.
   */
  enOferta: boolean;
  /** Porcentaje entero de rebaja. 0 si no la hay. */
  descuento: number;
  currency: string;
  stock: number;
  disponible: boolean;
  /**
   * Lo mismo que `disponible`, en número, porque es por lo que se ordena.
   *
   * Meilisearch solo ordena por números y por texto: un booleano en
   * `sortableAttributes` no da error, simplemente no ordena. Se guardan los dos
   * campos porque cada uno sirve para una cosa —el booleano se filtra y hace de
   * faceta, el número ordena— y calcularlos aquí cuesta cero.
   */
  ordenDisponible: 1 | 0;
  isAdult: boolean;
  imagen: string | null;
  atributos: Record<string, string | number | boolean | string[]>;
  valoracion: number;
  numeroResenas: number;
  ventas: number;
  publicadoEn: number;
  /**
   * Con qué versión de este documento se indexó.
   *
   * Es lo que permite preguntarle al índice —y no adivinar— si lo que tiene
   * guardado es de antes de un cambio de forma. Ver `ESQUEMA_DOCUMENTO`.
   */
  esquema: number;
}

/**
 * El nombre del índice de un idioma.
 *
 * Lleva prefijo por una razón concreta: **las pruebas de integración compartían
 * buscador con el entorno de desarrollo.** Postgres y Redis ya iban aparte —base
 * `ecom_test` y base 1 de Redis—, pero Meilisearch no, y los índices se llamaban
 * igual en los dos sitios. Así que cada tanda de pruebas dejaba sus productos
 * dentro del buscador de desarrollo: la tienda los listaba, la ficha los buscaba
 * en Postgres, no estaban, y salía un 404. Once productos en el listado, nueve
 * rotos.
 *
 * El prefijo se lee en cada llamada y no una vez al cargar el módulo, y eso
 * también tiene su motivo: `test/entorno.ts` importa `AppModule` arriba del
 * fichero, así que este módulo ya está cargado cuando las pruebas ajustan su
 * entorno. Leído al cargar, el prefijo llegaría siempre tarde y vacío.
 */
const indice = (locale: Locale) =>
  `${process.env['MEILI_PREFIJO_INDICE'] ?? ''}productos_${locale}`;

/**
 * Lo que hay que traerse de un producto para poder armar su documento.
 *
 * Fuera de la consulta, y una sola vez, porque lo comparten el reindexado de un
 * producto y el del catálogo entero: con un `include` en cada sitio, añadir un
 * campo al documento arreglaría un camino y dejaría el otro indexándolo vacío
 * sin dar ningún error.
 */
const PARA_INDEXAR = {
  translations: true,
  brand: true,
  category: { include: { translations: true } },
  media: { where: { deletedAt: null }, orderBy: { position: 'asc' }, take: 1 },
  variants: { where: { deletedAt: null, isActive: true } },
  attributes: { include: { attribute: true } },
  reviews: { where: { status: 'APPROVED' }, select: { rating: true } },
} satisfies Prisma.ProductInclude;

type ProductoParaIndexar = Prisma.ProductGetPayload<{ include: typeof PARA_INDEXAR }>;

/**
 * Cuántos productos se leen —y se envían— de una vez al reindexar.
 *
 * Doscientos es el punto en el que ni la lectura con todas sus relaciones pesa
 * en la memoria del proceso ni el envío es un cuerpo desmesurado para el
 * buscador. Lo que no puede volver a pasar es un documento por petición.
 */
const TAMANO_LOTE = 200;

/**
 * La forma que tienen los documentos hoy. **Súbelo al cambiar `DocumentoProducto`.**
 *
 * Es lo único que hay que tocar para que el catálogo se reconstruya solo en el
 * siguiente despliegue: al arrancar se le pregunta al índice cuántos documentos
 * tiene con una versión anterior —o sin versión— y, si hay alguno, se rehace.
 *
 * Se lleva un número en el documento en vez de mirar campo por campo porque la
 * pregunta que importa es «¿queda algo por migrar?», y esa el índice sabe
 * responderla exacta. Mirando una muestra de documentos no: la primera vez que
 * se intentó, una reconstrucción que se había quedado a medias tenía los
 * primeros documentos ya reescritos, la muestra salía limpia y el resto del
 * catálogo se quedaba sin migrar para siempre.
 */
const ESQUEMA_DOCUMENTO = 1;

/** Mientras uno reconstruye, los demás no. Ver `reconstruirSiHaceFalta`. */
const CERROJO_REINDEXADO = 'buscador:reindexado';

/**
 * Un valor dentro de un filtro de Meilisearch, sin poder salirse de sus comillas.
 *
 * Los filtros se construyen concatenando texto, así que una marca que lleve
 * comillas —o alguien que las escriba en la URL— cerraría la cadena y el resto
 * se interpretaría como sintaxis del filtro. No es una inyección con la que se
 * pueda leer nada ajeno, pero sí una búsqueda que revienta con un 500 en lugar
 * de no encontrar resultados.
 */
const escaparValor = (valor: string): string => valor.replace(/["\\]/g, (c) => `\\${c}`);

/**
 * Buscador del catálogo.
 *
 * Un índice por idioma en lugar de uno común con campos multiidioma: así cada
 * uno tiene sus propios sinónimos y palabras vacías, y una búsqueda en catalán
 * no compite con documentos en inglés que enturbian el ranking.
 */
@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);

  private clienteActual: Meilisearch | null = null;
  private huella = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly integraciones: IntegracionesService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Cliente del buscador, o `null` si no está configurado.
   *
   * Devuelve `null` en vez de lanzar porque el buscador es prescindible: sin
   * él la tienda sigue vendiendo —los listados y la portada salen de la base de
   * datos— y lo único que se pierde es la búsqueda por texto. Tumbar la ficha
   * de producto porque Meilisearch no está puesto sería desproporcionado.
   */
  private async cliente(): Promise<Meilisearch | null> {
    const config = await this.integraciones.configuracion('meilisearch');
    if (!config?.operativa) return null;

    const host = ajusteTexto(config, 'host');
    const apiKey = config.credenciales['masterKey'] ?? '';
    const huella = `${host}|${apiKey}`;

    if (!this.clienteActual || this.huella !== huella) {
      this.clienteActual = new Meilisearch({ host, apiKey });
      this.huella = huella;
    }

    return this.clienteActual;
  }

  async onModuleInit(): Promise<void> {
    try {
      if (!(await this.cliente())) {
        this.logger.warn(
          'Buscador sin configurar: la tienda funcionará sin búsqueda por texto. ' +
            'Se activa en Ajustes → Integraciones.',
        );
        return;
      }

      await this.configurarIndices();
    } catch (error) {
      // El buscador no debe impedir que arranque la API: sin él la tienda
      // sigue funcionando con el listado por categorías.
      this.logger.error(
        `No se han podido configurar los índices de búsqueda: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async configurarIndices(): Promise<void> {
    const cliente = await this.cliente();
    if (!cliente) return;

    /*
     * Qué índices hay ya, preguntado una vez.
     *
     * Antes se llamaba a `createIndex` a ciegas y se tragaba el fallo. Pero lo
     * que devuelve ese `catch` es el error de la petición, y la creación no es
     * una petición: es una tarea que el servidor procesa después. Así que la
     * petición salía bien, la tarea fallaba con «Index already exists» y
     * Meilisearch escribía un ERROR en su registro en cada arranque. Ninguna
     * consecuencia, salvo la peor para un registro: acostumbrarse a ver un
     * error rojo que no significa nada, y no ver el que sí.
     *
     * Si no se puede preguntar, se sigue como si no hubiera ninguno: se intenta
     * crear y, como mucho, se vuelve al ruido de antes.
     */
    const existentes = new Set(
      await cliente
        .getRawIndexes({ limit: 100 })
        .then((r) => r.results.map((i) => i.uid))
        .catch(() => [] as string[]),
    );

    for (const locale of LOCALES) {
      const nombre = indice(locale);
      // Se espera la tarea: los ajustes de aquí abajo van al índice, y si
      // todavía no existe no hay nada que ajustar.
      if (!existentes.has(nombre)) {
        await cliente.createIndex(nombre, { primaryKey: 'id' }).waitTask();
      }
      const idx = cliente.index(nombre);

      await idx.updateSettings({
        // El orden importa: lo que aparece antes pesa más en la relevancia.
        searchableAttributes: ['name', 'brand', 'categoryName', 'shortDescription', 'description'],
        // Todo lo que se use como faceta tiene que estar aquí, no solo lo que
        // se filtre: Meilisearch calcula las facetas sobre atributos filtrables.
        filterableAttributes: [
          'categoryId',
          'categoryPath',
          'categoryName',
          'brand',
          'priceCents',
          'disponible',
          'isAdult',
          'valoracion',
          'atributos',
          'enOferta',
          // Filtrable no para buscar con él, sino para poder preguntar cuántos
          // documentos vienen de una forma anterior. Ver `ESQUEMA_DOCUMENTO`.
          'esquema',
        ],
        sortableAttributes: [
          'ordenDisponible',
          'priceCents',
          'valoracion',
          'ventas',
          'publicadoEn',
          'descuento',
        ],
        /*
         * `sort` va PRIMERA, y esa es la línea que pone lo agotado al final.
         *
         * Las reglas se aplican como desempates encadenados: la primera manda,
         * y las siguientes solo deciden entre los que empatan en ella. Con
         * `sort` en quinto lugar —que es el orden que trae Meilisearch de
         * fábrica— la relevancia del texto decidía antes que cualquier
         * ordenación, así que un producto agotado que casaba mejor con lo
         * buscado salía por delante de uno disponible. Subiéndola, toda
         * consulta que pida ordenar por disponibilidad agrupa primero por eso
         * y **después** ordena por relevancia dentro de cada grupo: se sigue
         * buscando igual de bien, pero lo que no se puede comprar queda detrás.
         *
         * En los listados sin texto —una categoría, la portada— no cambia
         * nada respecto a antes, porque ahí todos los documentos empatan en
         * las reglas de relevancia.
         *
         * Y al final, las ventas: entre dos igual de buenos, el que más se
         * vende es el que más probablemente busca el siguiente cliente.
         */
        rankingRules: [
          'sort',
          'words',
          'typo',
          'proximity',
          'attribute',
          'exactness',
          'ventas:desc',
        ],
        typoTolerance: {
          enabled: true,
          minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
        },
        pagination: { maxTotalHits: 5000 },
        faceting: { maxValuesPerFacet: 200 },
      });

      await this.aplicarSinonimos(idx, locale);
    }

    this.logger.log(`Índices de búsqueda listos: ${LOCALES.map(indice).join(', ')}`);

    await this.reconstruirSiHaceFalta(cliente);
  }

  /**
   * Rehace el catálogo si lo indexado viene de una forma anterior del documento.
   *
   * **Se le pregunta al índice, con un filtro, cuántos documentos tienen una
   * versión de esquema vieja o ninguna.** Es una cuenta exacta, no una muestra:
   * una reconstrucción que se quede a medias deja el resto sin migrar, y hace
   * falta que el arranque siguiente lo vea y lo termine.
   *
   * **Y un índice vacío también reconstruye**, que es lo que faltaba. Antes no:
   * cero documentos con esquema viejo son cero pendientes, así que se daba por
   * bueno. El caso que eso deja sin cubrir es el peor de todos —perder el volumen
   * del buscador, o estrenar uno— porque entonces la tienda no da un error: da un
   * catálogo VACÍO, en silencio, hasta que alguien se acuerde de lanzar el
   * reindexado a mano. Se distingue del vacío legítimo preguntándole a la base si
   * hay algo que indexar.
   */
  private async reconstruirSiHaceFalta(cliente: Meilisearch): Promise<void> {
    let pendientes = 0;
    let algunoVacio = false;

    for (const locale of LOCALES) {
      const idx = cliente.index(indice(locale));

      const cuenta = await idx
        .search('', {
          filter: `esquema NOT EXISTS OR esquema < ${ESQUEMA_DOCUMENTO}`,
          // Con `hitsPerPage` el total es exacto; `estimatedTotalHits` es una
          // estimación, y aquí se decide si reindexar un catálogo entero.
          hitsPerPage: 1,
          page: 1,
        })
        .then((r) => r.totalHits ?? 0)
        .catch((error: unknown) => {
          // Y se dice. Tragarse este error en silencio sería no reconstruir
          // nunca sin que nadie se entere: justo el fallo mudo que este
          // mecanismo existe para evitar.
          this.logger.warn(
            `No se ha podido comprobar si ${indice(locale)} está al día: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return 0;
        });

      pendientes += cuenta;

      // El -1 del fallo no cuenta como vacío: no saber cuántos hay no es lo
      // mismo que saber que no hay ninguno, y confundirlos reindexaría el
      // catálogo entero en cada arranque cada vez que el buscador tosa.
      const total = await idx
        .getStats()
        .then((s) => s.numberOfDocuments)
        .catch(() => -1);

      if (total === 0) algunoVacio = true;
    }

    /*
     * Se pregunta a la base solo si hay algún índice vacío.
     *
     * Y se cuentan los productos **con alguna traducción**, que son los que de
     * verdad generan documento. Contar los activos a secas dejaría un catálogo
     * de productos sin traducir reconstruyéndose en cada arranque para no
     * escribir nada: un bucle silencioso que solo se ve en la factura del
     * servidor.
     */
    const indexables = algunoVacio
      ? await this.prisma.client.product.count({
          where: { status: 'ACTIVE', deletedAt: null, translations: { some: {} } },
        })
      : 0;

    const vacioIndebido = algunoVacio && indexables > 0;

    if (pendientes === 0 && !vacioIndebido) return;

    /*
     * Uno cada vez, y no uno por proceso.
     *
     * Este servicio se carga en la API y en los workers, y durante un despliegue
     * conviven dos réplicas de la API: sin el cerrojo, un arranque puede lanzar
     * tres reconstrucciones simultáneas del catálogo entero contra el mismo
     * buscador. El cerrojo caduca solo para que un proceso que se muera a mitad
     * no lo deje cerrado para siempre.
     */
    const tomado = await this.redis.client
      .set(CERROJO_REINDEXADO, '1', 'EX', 7200, 'NX')
      .catch(() => null);

    if (!tomado) {
      this.logger.log(`Otro proceso ya está reconstruyendo el índice (${pendientes} pendientes).`);
      return;
    }

    // En segundo plano: son miles de productos y la API tiene que responder
    // mientras tanto. Lo que se sirva antes de que termine sale con el orden
    // de siempre, que es exactamente lo que había hasta ahora.
    this.logger.log(
      vacioIndebido
        ? `El buscador está vacío y hay ${indexables} productos que indexar: reconstruyéndolo por detrás.`
        : `El índice viene de una versión anterior (${pendientes} documentos): reconstruyéndolo por detrás.`,
    );

    void this.reindexarTodo()
      .catch((error: unknown) => {
        this.logger.error(
          `No se ha podido reconstruir el índice: ${
            error instanceof Error ? error.message : String(error)
          }. Se puede lanzar a mano desde POST /search/reindex.`,
        );
      })
      .finally(() => {
        void this.redis.client.del(CERROJO_REINDEXADO).catch(() => null);
      });
  }

  /**
   * Sinónimos habituales por idioma. Sin esto, quien busca "movil" no encuentra
   * los productos titulados "teléfono" y se va sin comprar.
   */
  private async aplicarSinonimos(idx: Index, locale: Locale): Promise<void> {
    const porIdioma: Record<Locale, Record<string, string[]>> = {
      es: {
        movil: ['móvil', 'teléfono', 'telefono', 'smartphone', 'celular'],
        auriculares: ['cascos', 'audífonos', 'headphones'],
        zapatillas: ['deportivas', 'sneakers', 'tenis'],
        ordenador: ['computadora', 'pc', 'portátil', 'laptop'],
        camiseta: ['playera', 'remera', 't-shirt'],
      },
      ca: {
        mobil: ['mòbil', 'telèfon', 'telefon', 'smartphone'],
        auriculars: ['cascos', 'headphones'],
        sabatilles: ['esportives', 'sneakers'],
        ordinador: ['pc', 'portàtil', 'laptop'],
        samarreta: ['t-shirt', 'camiseta'],
      },
      en: {
        phone: ['mobile', 'smartphone', 'cellphone'],
        headphones: ['earphones', 'earbuds'],
        sneakers: ['trainers', 'running shoes'],
        laptop: ['notebook', 'computer'],
      },
    };

    await idx.updateSynonyms(porIdioma[locale]);
  }

  // ── Indexación ────────────────────────────────────────────

  /**
   * Los productos con todo lo que hace falta para armar su documento.
   *
   * En un solo sitio y por lista de ids porque lo usan los dos caminos —un
   * producto que acaba de cambiar y el reindexado completo—, y si cada uno
   * llevara su propio `include`, al añadir un campo al documento se arreglaría
   * uno y el otro seguiría indexándolo vacío sin dar ningún error.
   */
  private productosParaIndexar(ids: string[]): Promise<ProductoParaIndexar[]> {
    return this.prisma.client.product.findMany({
      where: { id: { in: ids } },
      include: PARA_INDEXAR,
    });
  }

  /** Reindexa un producto en los tres idiomas. */
  async indexarProducto(productId: string): Promise<void> {
    const [producto] = await this.productosParaIndexar([productId]);

    // Lo que no está publicado no debe aparecer en el buscador: retirarlo del
    // índice es tan importante como añadirlo.
    if (!producto || producto.status !== 'ACTIVE' || producto.deletedAt) {
      await this.eliminarDelIndice(productId);
      return;
    }

    const cliente = await this.cliente();
    if (!cliente) return;

    for (const [locale, documento] of this.documentosDe(producto)) {
      await cliente.index(indice(locale)).addDocuments([documento]);
    }
  }

  /**
   * El documento de un producto en cada idioma.
   *
   * Separado de quien lo envía para que el reindexado completo pueda juntar los
   * de muchos productos y mandarlos de una vez. Ver `reindexarTodo`.
   */
  private documentosDe(producto: ProductoParaIndexar): [Locale, DocumentoProducto][] {
    const precios = producto.variants.map((v) => v.priceCents);
    const precio = precios.length > 0 ? Math.min(...precios) : 0;
    /*
     * El precio anterior de la variante MÁS BARATA, no el primero que haya.
     *
     * La tarjeta enseña «desde X», así que el descuento tiene que ser el de esa
     * misma variante. Cogiendo el primero con `compareAtCents`, un producto con
     * la talla grande rebajada anunciaba un 40 % que no se aplicaba a lo que
     * costaba el artículo en pantalla.
     */
    const masBarata = producto.variants.filter((v) => v.priceCents === precio);
    const anterior = masBarata.find((v) => v.compareAtCents && v.compareAtCents > v.priceCents);
    const compareAtCents = anterior?.compareAtCents ?? null;
    const descuento =
      compareAtCents && compareAtCents > precio
        ? Math.round(((compareAtCents - precio) / compareAtCents) * 100)
        : 0;
    const stockTotal = producto.variants.reduce((a, v) => a + v.stock, 0);
    const disponible = hayStock(producto.variants);
    const valoraciones = producto.reviews.map((r) => r.rating);

    const atributos: Record<string, string | number | boolean | string[]> = {};
    for (const pa of producto.attributes) {
      atributos[pa.attribute.key] = pa.value as string | number | boolean | string[];
    }

    const documentos: [Locale, DocumentoProducto][] = [];

    for (const locale of LOCALES) {
      const t = producto.translations.find((x) => x.locale === locale) ?? producto.translations[0];
      if (!t) continue;

      const documento: DocumentoProducto = {
        id: producto.id,
        handle: producto.handle,
        name: t.name,
        slug: t.slug,
        shortDescription: t.shortDescription ?? '',
        // Se guarda el texto plano: las etiquetas HTML ensuciarían los extractos
        // y harían que "div" o "strong" contaran como palabras buscables.
        description: (t.description ?? '').replace(/<[^>]*>/g, ' ').slice(0, 5000),
        brand: producto.brand?.name ?? null,
        categoryId: producto.categoryId,
        categoryPath: producto.category?.path.split('/').filter(Boolean) ?? [],
        categoryName:
          producto.category?.translations.find((x) => x.locale === locale)?.name ?? null,
        priceCents: precio,
        compareAtCents,
        // Rebaja de verdad: un `compareAtCents` por debajo del precio actual no
        // es una oferta, es un dato mal importado, y anunciarlo como tal es
        // publicidad engañosa.
        enOferta: descuento > 0,
        descuento,
        currency: producto.variants[0]?.currency ?? 'EUR',
        stock: stockTotal,
        disponible,
        ordenDisponible: disponible ? 1 : 0,
        isAdult: producto.isAdult,
        imagen: producto.media[0]?.url ?? null,
        atributos,
        valoracion:
          valoraciones.length > 0
            ? Math.round((valoraciones.reduce((a, b) => a + b, 0) / valoraciones.length) * 10) / 10
            : 0,
        numeroResenas: valoraciones.length,
        ventas: 0,
        publicadoEn: producto.publishedAt?.getTime() ?? producto.createdAt.getTime(),
        esquema: ESQUEMA_DOCUMENTO,
      };

      documentos.push([locale, documento]);
    }

    return documentos;
  }

  async eliminarDelIndice(productId: string): Promise<void> {
    const cliente = await this.cliente();
    if (!cliente) return;

    for (const locale of LOCALES) {
      await cliente
        .index(indice(locale))
        .deleteDocument(productId)
        .catch(() => undefined);
    }
  }

  /**
   * Reindexado completo, para el arranque o tras un cambio de esquema.
   *
   * **Un envío por lote y por idioma, y se espera a que Meilisearch lo termine
   * antes de mandar el siguiente.** Esto no es una optimización: es lo que
   * impide que el reindexado tumbe el buscador.
   *
   * Antes se reutilizaba `indexarProducto` para cada producto, o sea una
   * petición HTTP por producto y por idioma: con el catálogo de la tienda son
   * unas treinta y cinco mil, encoladas tan rápido como las aceptara el
   * servidor. Cada una es una tarea que Meilisearch guarda y procesa por su
   * cuenta, así que la cola crecía sin freno, la memoria con ella y el
   * contenedor —que tiene su límite— moría de golpe a mitad del reindexado,
   * sin poder ni escribir el error. El síntoma era «no se ha podido
   * reconstruir el índice» y una tienda con el buscador reiniciándose.
   *
   * Esperando cada lote, en el servidor nunca hay más de una tarea pendiente y
   * el ritmo lo marca él, no nosotros. Tarda algo más de reloj, y da igual:
   * corre por detrás mientras la tienda vende con el índice anterior.
   */
  async reindexarTodo(): Promise<{ indexados: number; retirados: number }> {
    const cliente = await this.cliente();
    if (!cliente) return { indexados: 0, retirados: 0 };

    const productos = await this.prisma.client.product.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });

    let indexados = 0;

    /*
     * Lo que se ha escrito, por idioma, para poder saber después qué sobra.
     *
     * Va por idioma y no en una sola lista porque un producto no tiene por qué
     * estar en los tres índices: si se queda sin ninguna traducción deja de
     * generar documento, y entonces lo que hay que retirar del índice inglés no
     * es lo mismo que lo que hay que retirar del español.
     */
    const escritos = new Map<Locale, Set<string>>(LOCALES.map((l) => [l, new Set<string>()]));

    for (let i = 0; i < productos.length; i += TAMANO_LOTE) {
      const ids = productos.slice(i, i + TAMANO_LOTE).map((p) => p.id);
      // Por lotes también al leer: cargar el catálogo entero con sus variantes,
      // sus medios y sus reseñas de golpe agota la memoria del proceso.
      const cargados = await this.productosParaIndexar(ids);

      const porIdioma = new Map<Locale, DocumentoProducto[]>();
      for (const producto of cargados) {
        for (const [locale, documento] of this.documentosDe(producto)) {
          const lista = porIdioma.get(locale);
          if (lista) lista.push(documento);
          else porIdioma.set(locale, [documento]);
          escritos.get(locale)?.add(documento.id);
        }
      }

      for (const [locale, documentos] of porIdioma) {
        await cliente
          .index(indice(locale))
          .addDocuments(documentos)
          // El plazo es por lote, no para todo el reindexado. Generoso porque
          // un lote puede coincidir con otra tarea ya en marcha; si se agota de
          // verdad, es que el buscador no está bien y hay que enterarse.
          .waitTask({ timeout: 120_000, interval: 200 });
      }

      indexados += cargados.length;
    }

    const retirados = await this.retirarHuerfanos(cliente, escritos);

    this.logger.log(
      `Reindexados ${indexados} productos` + (retirados > 0 ? `, retirados ${retirados}` : ''),
    );
    return { indexados, retirados };
  }

  /**
   * Quita del índice lo que ya no está en el catálogo.
   *
   * **Es la mitad que faltaba del reindexado, y su ausencia se veía desde la
   * tienda.** `addDocuments` solo añade y pisa: un producto borrado, despublicado
   * o creado por una prueba se quedaba indexado para siempre, así que el listado
   * lo seguía enseñando y al pulsarlo salía un 404. En un catálogo de verdad eso
   * no es un resto: es la mitad del tráfico de una campaña acabando en una página
   * que no existe. En este entorno había nueve de once.
   *
   * Se hace **al final y por diferencia**, en lugar de vaciar el índice antes de
   * reconstruirlo: vaciarlo dejaría la tienda sin catálogo durante todo el
   * reindexado —minutos, con miles de productos—, y el reindexado existe
   * precisamente para poder rehacerlo sin que se note.
   *
   * Antes de borrar nada se vuelve a preguntar a la base. Entre que empieza el
   * reindexado y termina puede publicarse un producto: ese ya se habrá indexado
   * él solo, no estará en la lista de escritos, y sin esta comprobación el
   * reindexado lo borraría justo después de publicarlo.
   */
  private async retirarHuerfanos(
    cliente: Meilisearch,
    escritos: Map<Locale, Set<string>>,
  ): Promise<number> {
    let retirados = 0;

    for (const locale of LOCALES) {
      const nombre = indice(locale);
      const enElIndice = await this.idsIndexados(cliente, nombre);
      const puestos = escritos.get(locale) ?? new Set<string>();

      const sospechosos = [...enElIndice].filter((id) => !puestos.has(id));
      if (sospechosos.length === 0) continue;

      const sobran: string[] = [];
      for (let i = 0; i < sospechosos.length; i += TAMANO_LOTE) {
        const trozo = sospechosos.slice(i, i + TAMANO_LOTE);
        const vivos = await this.prisma.client.product.findMany({
          where: { id: { in: trozo }, status: 'ACTIVE', deletedAt: null },
          select: { id: true },
        });
        const vivosIds = new Set(vivos.map((p) => p.id));
        sobran.push(...trozo.filter((id) => !vivosIds.has(id)));
      }

      if (sobran.length === 0) continue;

      /*
       * También por lotes y esperando cada uno, igual que al indexar.
       *
       * La primera vez que esto se ejecute sobre un índice que lleva meses
       * acumulando restos, «lo que sobra» pueden ser decenas de miles de
       * identificadores. Mandarlos en un solo cuerpo es la misma petición
       * desmesurada que ya tumbó el buscador una vez, solo que en el otro
       * sentido.
       */
      for (let i = 0; i < sobran.length; i += TAMANO_LOTE) {
        await cliente
          .index(nombre)
          .deleteDocuments(sobran.slice(i, i + TAMANO_LOTE))
          .waitTask({ timeout: 120_000, interval: 200 });
      }

      this.logger.warn(`${nombre}: retirados ${sobran.length} documentos sin producto detrás.`);
      retirados += sobran.length;
    }

    return retirados;
  }

  /**
   * Todos los identificadores que tiene un índice.
   *
   * Paginado y pidiendo solo el `id`: lo que hace falta es la lista de claves,
   * no los documentos. Traerlos enteros para compararlos serían decenas de
   * megabytes por idioma en un catálogo grande, y se descartarían al instante.
   */
  private async idsIndexados(cliente: Meilisearch, nombre: string): Promise<Set<string>> {
    const TAMANO_PAGINA = 1000;
    const ids = new Set<string>();

    for (let offset = 0; ; offset += TAMANO_PAGINA) {
      const pagina = await cliente
        .index(nombre)
        .getDocuments<{ id: string }>({ limit: TAMANO_PAGINA, offset, fields: ['id'] });

      for (const documento of pagina.results) ids.add(documento.id);
      if (pagina.results.length < TAMANO_PAGINA) break;
    }

    return ids;
  }

  // ── Búsqueda ──────────────────────────────────────────────

  async buscar(parametros: {
    q: string;
    locale: Locale;
    categoryId?: string;
    /** Categoría por su slug traducido: es como enlazan el menú y la portada. */
    categoria?: string;
    marca?: string;
    precioMin?: number;
    precioMax?: number;
    soloDisponibles?: boolean;
    /** Solo lo rebajado: es lo que sirve la página de ofertas. */
    soloOfertas?: boolean;
    incluirAdulto?: boolean;
    orden?: 'relevancia' | 'precio_asc' | 'precio_desc' | 'novedad' | 'valoracion' | 'descuento';
    pagina?: number;
    porPagina?: number;
  }) {
    const filtros: string[] = [];

    // Los productos +18 quedan fuera salvo que se haya verificado la edad.
    if (!parametros.incluirAdulto) filtros.push('isAdult = false');
    if (parametros.marca) filtros.push(`brand = "${escaparValor(parametros.marca)}"`);
    if (parametros.soloDisponibles) filtros.push('disponible = true');
    if (parametros.soloOfertas) filtros.push('enOferta = true');
    if (parametros.precioMin !== undefined) filtros.push(`priceCents >= ${parametros.precioMin}`);
    if (parametros.precioMax !== undefined) filtros.push(`priceCents <= ${parametros.precioMax}`);

    /*
     * La categoría, venga por slug o por identificador.
     *
     * Las dos acaban en el mismo sitio a propósito. `categoryId` se filtraba
     * aparte y de forma EXACTA, así que las dos formas de entrar en la misma
     * categoría daban resultados distintos: por slug salía la rama entera y por
     * identificador solo lo que colgaba de ella misma, o sea nada en cuanto la
     * categoría tenía hijas. Es el mismo parámetro que reenvía el catálogo, así
     * que el fallo llegaba a la tienda tal cual.
     */
    const categoria = await this.categoriaDelListado(parametros, parametros.locale);

    /*
     * Una categoría incluye lo que cuelga de ella.
     *
     * Se filtra por la RUTA y no por el identificador porque cada producto
     * cuelga de su rama más concreta: con `categoryId` exacto, entrar en
     * «Lovetoys» —que tiene 5.391 artículos repartidos en sus hijas— devolvía
     * cero productos y una sección que parecía vacía.
     */
    if (categoria) filtros.push(`categoryPath = "${escaparValor(categoria.handle)}"`);

    const orden: Record<string, string[]> = {
      precio_asc: ['priceCents:asc'],
      precio_desc: ['priceCents:desc'],
      novedad: ['publicadoEn:desc'],
      valoracion: ['valoracion:desc'],
      // La rebaja más grande primero, que es como se mira una página de
      // ofertas: nadie entra en ella buscando el 5 %.
      descuento: ['descuento:desc'],
    };

    /*
     * Lo agotado, al final, mande lo que mande el resto del orden.
     *
     * Va SIEMPRE y va primero, así que lo que elija el cliente en el
     * desplegable ordena dentro de cada grupo: «precio más bajo» da lo barato
     * y disponible, después lo barato y agotado. Sin esto, ordenar por precio
     * ascendente llenaba la primera pantalla de productos sin stock, que son
     * justo los que el proveedor ha dejado de servir y nadie ha comprado.
     */
    const ordenPedido =
      parametros.orden && parametros.orden !== 'relevancia' ? parametros.orden : null;
    const sort = ['ordenDisponible:desc', ...(ordenPedido ? (orden[ordenPedido] ?? []) : [])];

    const porPagina = Math.min(parametros.porPagina ?? 24, 60);
    const pagina = Math.max(parametros.pagina ?? 1, 1);

    const cliente = await this.cliente();

    // Sin buscador configurado se devuelve vacío en vez de fallar: la tienda
    // enseña "no hemos encontrado nada" y el cliente puede seguir navegando
    // por categorías, que es mejor que una página de error.
    if (!cliente) {
      return {
        hits: [],
        total: 0,
        pagina,
        porPagina,
        facetas: {},
        categorias: [],
        ...(categoria ? { categoria } : {}),
        tiempoMs: 0,
        buscadorNoConfigurado: true,
      };
    }

    const resultado = await cliente.index(indice(parametros.locale)).search(parametros.q, {
      filter: filtros.length > 0 ? filtros.join(' AND ') : undefined,
      sort,
      limit: porPagina,
      offset: (pagina - 1) * porPagina,
      // `categoryId` además del nombre: es lo que permite devolver la lista de
      // categorías con su slug, y sin slug la barra de filtros no puede
      // enlazar a lo mismo a lo que enlaza el menú.
      facets: ['brand', 'categoryId', 'categoryName', 'disponible'],
      attributesToHighlight: ['name'],
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
    });

    // Búsquedas sin resultados: son la mejor lista de qué falta en el catálogo.
    if (resultado.hits.length === 0 && parametros.q.trim().length > 0) {
      this.logger.log(`Búsqueda sin resultados [${parametros.locale}]: "${parametros.q}"`);
    }

    return {
      hits: resultado.hits,
      total: resultado.estimatedTotalHits ?? 0,
      pagina,
      porPagina,
      facetas: resultado.facetDistribution ?? {},
      categorias: await this.categoriasDeLasFacetas(
        resultado.facetDistribution?.['categoryId'] ?? {},
        parametros.locale,
      ),
      // La categoría en la que se está, para que la página pueda titularse con
      // su nombre en vez de con «Filtros».
      ...(categoria ? { categoria } : {}),
      tiempoMs: resultado.processingTimeMs,
    };
  }

  /**
   * En qué categoría se está, se haya llegado por slug o por identificador.
   */
  private async categoriaDelListado(
    parametros: { categoria?: string; categoryId?: string },
    locale: Locale,
  ): Promise<{ id: string; handle: string; nombre: string; slug: string } | null> {
    if (parametros.categoria?.trim()) {
      return this.categoriaPorSlug(parametros.categoria, locale);
    }
    if (parametros.categoryId?.trim()) {
      return this.categoriaPorId(parametros.categoryId.trim(), locale);
    }
    return null;
  }

  /** Nombre y slug de una categoría en el idioma que se está viendo. */
  private nombrarCategoria(
    categoria: {
      id: string;
      handle: string;
      translations: { locale: string; name: string; slug: string }[];
    },
    locale: Locale,
  ): { id: string; handle: string; nombre: string; slug: string } {
    /*
     * La traducción del idioma pedido, con respaldo.
     *
     * Antes se elegía ordenando por `locale` —ascendente en español y
     * descendente en el resto—, y con los idiomas `ca`, `en` y `es` eso
     * devolvía el CATALÁN a quien navegaba en español: la página de una
     * categoría se titulaba con un nombre que no era el suyo.
     */
    const t =
      categoria.translations.find((x) => x.locale === locale) ??
      categoria.translations.find((x) => x.locale === 'es') ??
      categoria.translations[0];

    return {
      id: categoria.id,
      handle: categoria.handle,
      nombre: t?.name ?? categoria.handle,
      slug: t?.slug ?? categoria.handle,
    };
  }

  private async categoriaPorId(
    categoryId: string,
    locale: Locale,
  ): Promise<{ id: string; handle: string; nombre: string; slug: string } | null> {
    const categoria = await this.prisma.client.category.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: {
        id: true,
        handle: true,
        translations: { select: { locale: true, name: true, slug: true } },
      },
    });

    return categoria ? this.nombrarCategoria(categoria, locale) : null;
  }

  /**
   * La categoría que corresponde a un slug traducido.
   *
   * El menú y la portada enlazan con el slug del idioma —`/buscar?categoria=
   * vibradores`—, que es lo correcto de cara al cliente y al SEO, pero el
   * índice no lo conoce: guarda el `handle`, que es el mismo en los tres
   * idiomas. Esta es la traducción entre las dos cosas.
   *
   * Se acepta también el handle: los enlaces antiguos y los que alguien escriba
   * a mano siguen funcionando en vez de devolver el catálogo entero.
   */
  private async categoriaPorSlug(
    slug: string | undefined,
    locale: Locale,
  ): Promise<{ id: string; handle: string; nombre: string; slug: string } | null> {
    const buscado = slug?.trim();
    if (!buscado) return null;

    const seleccion = {
      id: true,
      handle: true,
      translations: { select: { locale: true, name: true, slug: true } },
    };

    /*
     * Primero el slug del idioma que se está viendo, en su propia consulta.
     *
     * Con las tres condiciones en un `OR` no hay forma de decir cuál gana: si
     * el slug español de una categoría coincide con el handle de otra, el
     * listado abre la que quiera Postgres. Buscando por orden, el caso normal
     * —el enlace del menú— siempre resuelve a lo mismo, y lo demás solo entra
     * cuando no hay nada mejor.
     */
    const propia = await this.prisma.client.category.findFirst({
      where: { deletedAt: null, translations: { some: { locale, slug: buscado } } },
      select: seleccion,
    });

    // Por handle, y por slug en cualquier idioma: un enlace compartido desde la
    // tienda en catalán tiene que abrir en español.
    const categoria =
      propia ??
      (await this.prisma.client.category.findFirst({
        where: {
          deletedAt: null,
          OR: [{ handle: buscado }, { translations: { some: { slug: buscado } } }],
        },
        select: seleccion,
      }));

    return categoria ? this.nombrarCategoria(categoria, locale) : null;
  }

  /**
   * Las categorías de los resultados, con su nombre y su slug.
   *
   * Meilisearch cuenta por identificador, que no se le puede enseñar a nadie.
   * Resolverlos aquí —una consulta por búsqueda, sobre como mucho un par de
   * cientos de filas— es lo que permite que la barra de filtros enlace igual
   * que el menú y que el nombre salga en el idioma que se está viendo.
   */
  private async categoriasDeLasFacetas(
    conteos: Record<string, number>,
    locale: Locale,
  ): Promise<{ id: string; slug: string; nombre: string; imagen: string | null; total: number }[]> {
    const ids = Object.keys(conteos);
    if (ids.length === 0) return [];

    const traducciones = await this.prisma.client.categoryTranslation.findMany({
      where: { categoryId: { in: ids }, locale },
      // La foto viene de la categoría, no de la traducción: es la misma en los
      // tres idiomas. Se trae en esta consulta y no en una aparte porque ya se
      // estaba leyendo la fila.
      select: {
        categoryId: true,
        name: true,
        slug: true,
        category: { select: { imageUrl: true, coverUrl: true } },
      },
    });

    return traducciones
      .map((t) => ({
        id: t.categoryId,
        slug: t.slug,
        nombre: t.name,
        imagen: t.category.imageUrl ?? t.category.coverUrl,
        total: conteos[t.categoryId] ?? 0,
      }))
      .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
  }

  /**
   * Sugerencias para el desplegable del buscador, mientras el cliente escribe.
   *
   * Respeta la verificación igual que la búsqueda completa. Estaba fijo a
   * `isAdult = false`, así que quien ya había declarado su edad escribía el
   * nombre de un producto del catálogo restringido y el desplegable le decía
   * que no existe, para después encontrarlo al pulsar intro. Dos respuestas
   * distintas a la misma pregunta.
   */
  async sugerencias(q: string, locale: Locale, limite = 6, incluirAdulto = false) {
    if (q.trim().length < 2) return { sugerencias: [] };

    const cliente = await this.cliente();
    if (!cliente) return { sugerencias: [] };

    const resultado = await cliente.index(indice(locale)).search(q, {
      limit: limite,
      filter: incluirAdulto ? 'disponible = true' : 'isAdult = false AND disponible = true',
      attributesToRetrieve: ['id', 'name', 'slug', 'imagen', 'priceCents'],
    });

    return { sugerencias: resultado.hits };
  }

  async estado(): Promise<{ disponible: boolean; indices?: Record<string, number> }> {
    try {
      const cliente = await this.cliente();
      if (!cliente) return { disponible: false };

      await cliente.health();
      const indices: Record<string, number> = {};
      for (const locale of LOCALES) {
        const stats = await cliente.index(indice(locale)).getStats();
        indices[indice(locale)] = stats.numberOfDocuments;
      }
      return { disponible: true, indices };
    } catch {
      return { disponible: false };
    }
  }
}
