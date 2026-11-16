import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ProductoProveedor } from '@ecom/suppliers';
import type { Supplier } from '@ecom/db';
import { newId, type Locale } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TraduccionService } from '../translation/traduccion.service.js';
import { PricingService } from '../catalog/services/pricing.service.js';
import { SearchService } from '../search/search.service.js';
import { ImagesService, type ImagenProcesada } from '../storage/images.service.js';
import { resumen, sanearHtml } from '../../common/contenido/html-descripcion.js';
import { cargoFijoAplicable } from '../catalog/services/margen.js';
import { BrandsService } from '../catalog/services/brands.service.js';
import { SuppliersService } from './suppliers.service.js';
import {
  precioDeImportacion,
  type EstrategiaPrecio,
  type ReglasDePrecio,
} from './precio-de-importacion.js';
import type { ContextoActor } from '../roles/roles.service.js';

/**
 * Tipo de IVA con el que nacen los productos importados cuando nadie dice otro.
 *
 * Tiene que ser el MISMO que se guarda en el producto y el que se usa para
 * calcular su precio. Cuando eran dos números sueltos —uno en el `create` y
 * ninguno en el motor de precios— el PVP salía calculado sin IVA y el producto
 * se guardaba con el 21 %: el margen que prometía la pantalla de importación no
 * era el que quedaba después.
 */
const TIPO_IVA_POR_DEFECTO = 21;

/**
 * El IVA del artículo, con el general como red de seguridad.
 *
 * Dejó de ser una constante cuando entró el primer proveedor que lo publica:
 * de los 12.913 artículos de Dreamlove, 329 van al 4 % y 197 al 10 %. Cobrarles
 * el 21 % es cobrar de más al cliente y declarar de más en el trimestre; y al
 * revés, dar por reducido lo que va al general se paga de nuestro bolsillo.
 *
 * Se acota a los tipos que existen en España porque este valor lo publica un
 * tercero: un XML con `vat` a 0 por una errata suya se convertiría, sin este
 * filtro, en un catálogo entero vendido sin IVA.
 */
function tipoDeIva(declarado: number | undefined): number {
  // El 0 no está: un artículo exento es rarísimo en este catálogo —hay uno— y
  // un cero es mucho más probable que sea un campo sin rellenar. Ante la duda,
  // el general: se corrige a mano en la ficha si de verdad va exento.
  const validos = [4, 10, 21];
  return declarado !== undefined && validos.includes(declarado) ? declarado : TIPO_IVA_POR_DEFECTO;
}

/** Las reglas del cargo fijo de un proveedor, en la forma que espera el cálculo. */
const cargoDe = (p: { importFeeCents: number; importFeeThresholdCents: number }) => ({
  importeCents: p.importFeeCents,
  umbralCents: p.importFeeThresholdCents,
});

/**
 * Cómo se quiere que entre un producto del proveedor.
 *
 * Existe como tipo con nombre desde que hay dos formas de importar: la de uno
 * en uno desde el buscador, donde alguien elige cada cosa, y la masiva, que
 * sube el catálogo entero y necesita decir «al PVP del proveedor, publicado y
 * sin traducir» sin repetir la lógica de creación en otro sitio.
 */
export interface OpcionesImportacion {
  categoryId?: string;
  brandId?: string;
  margenPersonalizado?: number;
  descargarImagenes?: boolean;
  locale?: Locale;
  /** De dónde sale el PVP. Por defecto, el margen configurado del proveedor. */
  precio?: EstrategiaPrecio;
  /**
   * Con qué estado nace. Por defecto borrador.
   *
   * Publicar de una en una no tiene sentido —la ficha del proveedor necesita
   * repaso—, pero con 950 productos de golpe sí: repasarlos uno a uno antes de
   * publicar es trabajo de semanas, y mientras tanto la tienda está vacía.
   */
  estado?: 'DRAFT' | 'ACTIVE';
  /** Traducir la ficha al terminar. Por defecto sí. */
  traducir?: boolean;
  /** Anotar en auditoría. La masiva lo apaga y anota una sola línea al final. */
  auditar?: boolean;
}

export interface PrevisualizacionImportacion {
  externalId: string;
  titulo: string;
  costeCents: number;
  envioCents: number;
  /** Lo que cuesta comprarlo de verdad: artículo, porte y recargo. */
  costeCompraCents: number;
  pvpPropuestoCents: number;
  margenReal: number;
  aviso?: string;
  variantes: number;
  imagenes: number;
  yaImportado: boolean;
}

/**
 * Importación de productos del proveedor al catálogo propio.
 *
 * Se importan en borrador a propósito: la ficha que llega del proveedor trae
 * título en inglés macarrónico, descripción con HTML roto y fotos con marcas de
 * agua. Publicarla automáticamente llenaría la tienda de productos que ahuyentan
 * al cliente. El flujo correcto es importar, revisar y publicar.
 */
@Injectable()
export class SupplierImportService {
  private readonly logger = new Logger(SupplierImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly suppliers: SuppliersService,
    private readonly pricing: PricingService,
    private readonly images: ImagesService,
    private readonly search: SearchService,
    private readonly audit: AuditService,
    private readonly traduccion: TraduccionService,
    private readonly brands: BrandsService,
  ) {}

  /** Busca en el catálogo del proveedor, sin importar nada todavía. */
  async buscar(
    supplierId: string,
    parametros: { q?: string; pagina?: number; porPagina?: number; orden?: string },
  ) {
    const adaptador = await this.suppliers.adaptador(supplierId);

    if (!adaptador.capacidades.buscarCatalogo) {
      throw new BadRequestException(`${adaptador.nombre} no permite buscar en su catálogo por API`);
    }

    const resultado = await adaptador.buscar({
      q: parametros.q ?? '',
      pagina: parametros.pagina ?? 1,
      porPagina: parametros.porPagina ?? 20,
      countryCode: 'ES',
      orden: parametros.orden as 'relevancia' | 'precio_asc' | 'precio_desc' | 'ventas' | undefined,
    });

    const proveedor = await this.prisma.client.supplier.findUniqueOrThrow({
      where: { id: supplierId },
    });

    // Se marca lo ya importado para que el operador no lo duplique sin querer.
    const yaImportados = await this.prisma.client.supplierProduct.findMany({
      where: {
        supplierId,
        externalProductId: { in: resultado.items.map((i) => i.externalId) },
      },
      select: { externalProductId: true },
    });
    const importados = new Set(yaImportados.map((i) => i.externalProductId));

    const previsualizaciones: PrevisualizacionImportacion[] = resultado.items.map((item) => {
      // El mismo cálculo que aplicará la importación, no uno parecido: la
      // pantalla enseñaba un PVP por margen y después se importaba al precio
      // del proveedor, así que el número que se usaba para decidir no era el
      // que quedaba.
      const calculo = precioDeImportacion(
        'pvpr',
        item.costCents,
        item.rrpCents,
        this.reglasDePrecio(proveedor, item.shippingCents ?? 0, item.costCents, item.taxRatePct),
      );

      return {
        externalId: item.externalId,
        titulo: item.title,
        costeCents: item.costCents,
        envioCents: item.shippingCents ?? 0,
        costeCompraCents: calculo.costeCompraCents,
        pvpPropuestoCents: calculo.pvpCents,
        margenReal: calculo.margenReal,
        ...(calculo.aviso ? { aviso: calculo.aviso } : {}),
        variantes: item.variants.length,
        imagenes: item.imageUrls.length,
        yaImportado: importados.has(item.externalId),
      };
    });

    return {
      items: previsualizaciones,
      total: resultado.total,
      pagina: resultado.pagina,
      hayMas: resultado.hayMas,
    };
  }

  /**
   * Ficha suelta a partir de su identificador o de la URL del producto.
   *
   * Es la alternativa a buscar por texto, y ahora mismo la única vía con
   * AliExpress: su búsqueda por texto exige que la aplicación esté aprobada
   * para producción, mientras que consultar una ficha concreta funciona desde
   * el primer día. También es como se trabaja de verdad en dropshipping —se
   * encuentra el producto navegando por su web y se copia el enlace— así que
   * conviene aunque algún día se habilite la búsqueda.
   */
  async previsualizar(supplierId: string, referencia: string) {
    const externalId = extraerIdentificador(referencia);
    if (!externalId) {
      throw new BadRequestException(
        'No se reconoce el identificador. Pega el número del producto o su URL completa.',
      );
    }

    const adaptador = await this.suppliers.adaptador(supplierId);
    const producto = await adaptador.obtenerProducto(externalId, 'ES');

    if (!producto) {
      /*
       * «No existe» es lo que parece, pero no es lo que sabemos.
       *
       * La API de dropshipping solo sirve los productos que el vendedor ha
       * puesto en ESE catálogo, que es un subconjunto pequeño de lo que se ve
       * navegando por su web. Un producto perfectamente real y a la venta
       * responde vacío aquí, y decir «no existe» manda a buscar un error de
       * escritura que no hay.
       */
      throw new NotFoundException(
        `${adaptador.nombre} no ha devuelto ninguna ficha para "${externalId}". ` +
          'Suele significar que ese producto no está en su catálogo de dropshipping —que es ' +
          'bastante más pequeño que su tienda— o que la aplicación aún no está aprobada para ' +
          'producción. Prueba con otro producto: los que sí están suelen indicarlo en su ficha.',
      );
    }

    const proveedor = await this.prisma.client.supplier.findUniqueOrThrow({
      where: { id: supplierId },
    });

    const yaImportado = await this.prisma.client.supplierProduct.findFirst({
      where: { supplierId, externalProductId: producto.externalId },
      select: { productId: true },
    });

    const calculo = precioDeImportacion(
      'pvpr',
      producto.costCents,
      producto.rrpCents,
      this.reglasDePrecio(
        proveedor,
        producto.shippingCents ?? 0,
        producto.costCents,
        producto.taxRatePct,
      ),
    );

    return {
      externalId: producto.externalId,
      titulo: producto.title,
      costeCents: producto.costCents,
      envioCents: producto.shippingCents ?? 0,
      costeCompraCents: calculo.costeCompraCents,
      pvpPropuestoCents: calculo.pvpCents,
      margenReal: calculo.margenReal,
      ...(calculo.aviso ? { aviso: calculo.aviso } : {}),
      variantes: producto.variants.length,
      imagenes: producto.imageUrls.length,
      yaImportado: yaImportado !== null,
      ...(yaImportado ? { productId: yaImportado.productId } : {}),
    };
  }

  /**
   * Importa un producto del proveedor.
   *
   * Todo va en una transacción: un producto con enlace al proveedor pero sin
   * variantes, o al revés, deja el catálogo en un estado que ni se puede vender
   * ni se puede sincronizar.
   */
  async importar(
    supplierId: string,
    externalId: string,
    opciones: OpcionesImportacion,
    ctx: ContextoActor,
  ) {
    const proveedor = await this.prisma.client.supplier.findUniqueOrThrow({
      where: { id: supplierId },
    });

    const yaExiste = await this.prisma.client.supplierProduct.findFirst({
      where: { supplierId, externalProductId: externalId },
    });
    if (yaExiste) {
      throw new BadRequestException('Este producto ya está importado de este proveedor');
    }

    const adaptador = await this.suppliers.adaptador(supplierId);
    const origen = await adaptador.obtenerProducto(externalId, 'ES');

    if (!origen) {
      throw new BadRequestException('El proveedor no encuentra ese producto');
    }

    return this.crearDesdeOrigen(proveedor, origen, opciones, ctx);
  }

  /**
   * Crea el producto a partir de una ficha que ya se ha pedido al proveedor.
   *
   * Es el cuerpo de `importar` sacado aparte para que la importación masiva lo
   * reutilice tal cual. Recibe la ficha y el proveedor ya resueltos porque el
   * masivo recorre mil familias: volver a leer la fila del proveedor en cada
   * una serían mil consultas para el mismo resultado.
   *
   * El identificador con el que se enlaza es el que devuelve el proveedor
   * (`origen.externalId`) y no el que se tecleó. Importa: en Dreamlove se puede
   * buscar por EAN o por código de caja, y guardar ese texto como identificador
   * dejaría un enlace que la sincronización no sabría consultar después.
   */
  async crearDesdeOrigen(
    proveedor: Supplier,
    origen: ProductoProveedor,
    opciones: OpcionesImportacion,
    ctx: ContextoActor,
  ) {
    const supplierId = proveedor.id;
    const externalId = origen.externalId;

    const margen = opciones.margenPersonalizado ?? Number(proveedor.defaultMarginPct);
    const locale: Locale = opciones.locale ?? 'es';
    // Se calcula una vez y se usa en el producto y en el precio de cada
    // variante: son el mismo número por definición, y separarlos fue lo que ya
    // dejó una vez el PVP calculado con un IVA y el producto guardado con otro.
    const tipoIva = tipoDeIva(origen.taxRatePct);

    /*
     * La marca del proveedor, creada si hace falta.
     *
     * Dreamlove manda el fabricante de cada artículo y hasta ahora se tiraba.
     * Se resuelve ANTES de la transacción porque puede crear una fila: dejarlo
     * dentro alargaría la transacción del producto por algo que no tiene por
     * qué deshacerse si el producto falla —la marca es buena igualmente—.
     *
     * Que el proveedor no la diga no es un error: hay artículos sin marca y se
     * importan igual, simplemente sin ella.
     */
    const marca = origen.brand ? await this.brands.asegurar(origen.brand) : null;

    /*
     * Y su categoría, la que el proveedor ya le da.
     *
     * Se busca por la ruta del proveedor contra el árbol que se creó desde la
     * pantalla de proveedores. Si esa rama todavía no se ha creado, el
     * producto entra sin categoría igual que antes: es preferible a colgarlo
     * de una que no le toca.
     *
     * La del importador manda: si alguien eligió una a mano, es porque la del
     * fichero no valía para esta tienda.
     */
    const categoriaId =
      opciones.categoryId ?? (await this.categoriaDelProveedor(supplierId, origen));

    /*
     * Si la categoría es +18, el producto también.
     *
     * Se hereda y no se pregunta porque es lo que decide si el producto se
     * manda al feed de Google, si sale en la portada y si lo ve alguien que no
     * ha declarado su edad. Importando de uno en uno se podía marcar después en
     * la ficha; subiendo el catálogo entero, «después» no llega nunca y se
     * publicarían cientos de productos para adultos sin la puerta delante.
     */
    const categoria = categoriaId
      ? await this.prisma.client.category.findUnique({
          where: { id: categoriaId },
          select: { isAdult: true },
        })
      : null;

    const estado = opciones.estado ?? 'DRAFT';
    /*
     * Manda el precio del proveedor siempre que lo publique.
     *
     * Por defecto y no solo en la importación masiva: si la regla es que el
     * PVP lo pone el proveedor, no puede depender de por qué pantalla se haya
     * entrado. Quien no publica PVP —AliExpress— cae solo al cálculo por
     * margen, porque no hay otra cosa de la que tirar.
     */
    const estrategia: EstrategiaPrecio = opciones.precio ?? 'pvpr';

    const productId = newId();
    const handle = this.generarHandle(origen.title, externalId);

    /** Cuántas variantes ha puesto cada camino de precio. Se devuelve al final. */
    const precios = { pvpr: 0, margen: 0, bajoMinimo: 0 };
    const avisos: string[] = [];

    const resultado = await this.prisma.client.$transaction(async (tx) => {
      await tx.product.create({
        data: {
          id: productId,
          handle,
          // Por defecto en borrador: la ficha del proveedor necesita repaso.
          // La importación masiva pide lo contrario, y es la decisión correcta
          // ahí: una tienda con 950 borradores no vende nada.
          status: estado,
          ...(estado === 'ACTIVE' ? { publishedAt: new Date() } : {}),
          isAdult: categoria?.isAdult ?? false,
          categoryId: categoriaId,
          // La que se elija en el importador manda sobre la del proveedor: si
          // alguien la ha corregido a mano al importar, es porque la del
          // fichero no valía.
          brandId: opciones.brandId ?? marca?.id ?? null,
          // El que declare el proveedor: el precio de las variantes se calcula
          // con este mismo número, y si los dos no coinciden el margen que
          // prometió la pantalla de importación no es el que queda después.
          taxRate: tipoIva,
          translations: {
            create: {
              id: newId(),
              locale,
              name: origen.title.slice(0, 200),
              slug: handle,
              /*
               * La descripción del proveedor viene en HTML.
               *
               * La corta se usa en listados y metaetiquetas, donde el HTML no se
               * pinta sino que se escapa: se guardaba recortando la larga a 500
               * caracteres y el cliente leía «<p>Auriculares…» con las etiquetas
               * a la vista, cortadas a mitad. Ahora se aplana a texto y se cierra
               * en frase entera.
               *
               * La larga conserva el HTML porque es lo que da a la ficha las
               * listas y las tablas de medidas, pero saneado: lo escribe un
               * vendedor de AliExpress y la tienda lo pinta tal cual.
               */
              shortDescription: resumen(origen.description),
              description: sanearHtml(origen.description),
            },
          },
        },
      });

      // Sin variantes declaradas se crea una única, para que el producto sea
      // vendible desde el primer momento.
      const variantesOrigen =
        origen.variants.length > 0
          ? origen.variants
          : [
              {
                externalId: origen.externalId,
                costCents: origen.costCents,
                ...(origen.rrpCents !== undefined ? { rrpCents: origen.rrpCents } : {}),
                stock: origen.stock ?? 0,
                options: {},
              },
            ];

      // Opciones declaradas por las variantes (color, talla…).
      const clavesOpcion = [...new Set(variantesOrigen.flatMap((v) => Object.keys(v.options)))];
      const idsValor = new Map<string, string>();

      for (const [i, clave] of clavesOpcion.entries()) {
        const optionId = newId();
        await tx.productOption.create({
          data: {
            id: optionId,
            productId,
            key: this.normalizarClave(clave),
            position: i,
            translations: { create: { id: newId(), locale, name: this.capitalizar(clave) } },
          },
        });

        const valores = [...new Set(variantesOrigen.map((v) => v.options[clave]).filter(Boolean))];
        for (const [j, valor] of valores.entries()) {
          const valueId = newId();
          await tx.productOptionValue.create({
            data: { id: valueId, optionId, value: String(valor), position: j },
          });
          idsValor.set(`${clave}:${String(valor)}`, valueId);
        }
      }

      const enlacesCreados: string[] = [];
      const imagenesDeVariante: { variantId: string; url: string }[] = [];

      for (const [i, v] of variantesOrigen.entries()) {
        /*
         * El precio de ESTA variante, con su propio PVP recomendado.
         *
         * El del producto no sirve: dentro de una familia de colores los
         * precios se separan hasta el triple, y aplicar el del cabeza a todas
         * anuncia uno y cobra otro.
         */
        const calculo = precioDeImportacion(estrategia, v.costCents, v.rrpCents, {
          ...this.reglasDePrecio(proveedor, origen.shippingCents ?? 0, v.costCents, tipoIva),
          // El margen personalizado que se haya pedido al importar manda sobre
          // el del proveedor, y solo se usa cuando el precio lo ponemos
          // nosotros: con PVPR publicado no pinta nada.
          margenObjetivo: margen,
        });

        precios[calculo.origen]++;
        if (calculo.bajoMinimo) precios.bajoMinimo++;
        if (calculo.aviso) avisos.push(calculo.aviso);

        const variantId = newId();
        // Lo que cuesta comprarlo de verdad, recargo del proveedor incluido:
        // es el número contra el que se mide el margen en toda la aplicación.
        const costeTotal = calculo.costeCompraCents;

        await tx.productVariant.create({
          data: {
            id: variantId,
            productId,
            sku: `${proveedor.key.toUpperCase().slice(0, 3)}-${externalId}-${i + 1}`.slice(0, 60),
            priceCents: calculo.pvpCents,
            costCents: costeTotal,
            stock: v.stock ?? 0,
            weightGrams: v.weightGrams ?? null,
            position: i,
            isDefault: i === 0,
          },
        });

        // Punto de partida del histórico de precios. Sin él, la variante no
        // tendría referencia con la que calcular el mínimo de los 30 días y
        // nunca podría anunciarse rebajada.
        await tx.priceHistory.create({
          data: {
            id: newId(),
            variantId,
            priceCents: calculo.pvpCents,
            source: 'importacion',
          },
        });

        for (const [clave, valor] of Object.entries(v.options)) {
          const optionValueId = idsValor.get(`${clave}:${valor}`);
          if (optionValueId) {
            await tx.variantOptionValue.create({ data: { variantId, optionValueId } });
          }
        }

        const enlaceId = newId();
        await tx.supplierProduct.create({
          data: {
            id: enlaceId,
            supplierId,
            productId,
            variantId,
            externalProductId: externalId,
            externalVariantId: v.externalId,
            costCents: v.costCents,
            shippingCents: origen.shippingCents ?? 0,
            stock: v.stock ?? 0,
            available: (v.stock ?? 0) > 0,
            leadTimeMinDays: origen.leadTimeDays?.min ?? null,
            leadTimeMaxDays: origen.leadTimeDays?.max ?? null,
            lastCheckedAt: new Date(),
            metadata: (origen.metadata ?? {}) as never,
          },
        });
        enlacesCreados.push(enlaceId);

        // La foto de la variante se anota para bajarla después: dentro de la
        // transacción no se descarga nada.
        if (v.imageUrl) imagenesDeVariante.push({ variantId, url: v.imageUrl });
      }

      return {
        productId,
        variantes: variantesOrigen.length,
        enlaces: enlacesCreados.length,
        imagenesDeVariante,
      };
    });

    // Las imágenes se descargan FUERA de la transacción: bajar diez fotos de un
    // servidor lento mantendría la transacción abierta varios segundos,
    // bloqueando filas y agotando el pool de conexiones.
    let imagenesImportadas = 0;
    if (opciones.descargarImagenes !== false) {
      imagenesImportadas = await this.importarImagenes(
        productId,
        origen,
        resultado.imagenesDeVariante,
      );
    }

    // La masiva no audita producto a producto: novecientas líneas de auditoría
    // por una sola pulsación tapan el registro entero. Anota una al final.
    if (opciones.auditar !== false) {
      await this.audit.registrar({
        action: 'supplier.import_product',
        resource: 'product',
        resourceId: productId,
        actorId: ctx.actorId,
        actorIp: ctx.actorIp,
        after: {
          proveedor: proveedor.name,
          externalId,
          marca: marca?.name ?? null,
          variantes: resultado.variantes,
          imagenes: imagenesImportadas,
          margenAplicado: margen,
          precio: estrategia,
          estado,
        },
      });
    }

    /*
     * La traducción va después de la auditoría y sin bloquear: llama a un
     * servicio externo y puede tardar segundos. Lo que produce queda en la
     * cola de revisión, así que no publica nada por su cuenta y que falle solo
     * significa que la ficha se queda en el idioma del proveedor.
     *
     * La masiva la apaga: son mil llamadas a un servicio que se paga por
     * carácter, con descripciones largas, y encadenarlas multiplicaría por
     * varias horas una importación que ya es lenta por las fotos. Se lanza
     * después desde la pantalla de traducciones, que existe para eso.
     */
    const traducidas =
      opciones.traducir === false
        ? []
        : await this.traduccion.traducirProducto(productId).catch((error: unknown) => {
            this.logger.warn(
              `Producto ${productId} importado sin traducir: ${(error as Error).message}`,
            );
            return [] as Locale[];
          });

    return {
      ...resultado,
      imagenes: imagenesImportadas,
      handle,
      status: estado,
      precios,
      avisos,
      traducciones: traducidas,
    };
  }

  /**
   * Descarga las fotos del producto y las de cada variante.
   *
   * Las de variante importan más de lo que parece: en un producto de ocho
   * colores, sin ellas la ficha enseña la misma foto ocho veces y el cliente no
   * ve lo que compra. El proveedor las manda dentro de las propiedades del SKU,
   * una por valor visual.
   *
   * Se descarga cada URL **una sola vez**. Varios SKU comparten foto —cuatro
   * tallas del mismo color llevan la misma— y en un producto con cuarenta SKU la
   * diferencia es entre diez descargas y cuarenta, con su almacenamiento
   * duplicado. Los `Media` de cada variante apuntan al mismo objeto ya subido.
   */
  private async importarImagenes(
    productId: string,
    origen: ProductoProveedor,
    imagenesDeVariante: { variantId: string; url: string }[] = [],
  ): Promise<number> {
    let importadas = 0;

    /** URL del proveedor → lo que ya está subido a nuestro almacenamiento. */
    const subidas = new Map<string, ImagenProcesada>();

    const subir = async (url: string): Promise<ImagenProcesada | null> => {
      const yaEsta = subidas.get(url);
      if (yaEsta) return yaEsta;

      try {
        const buffer = await this.images.descargar(url);
        const procesada = await this.images.procesar(buffer, `productos/${productId}`);
        subidas.set(url, procesada);
        return procesada;
      } catch (error) {
        // Una imagen que falla no debe abortar la importación entera.
        this.logger.warn(
          `No se ha podido importar la imagen ${url}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      }
    };

    // Máximo ocho de galería: más imágenes no mejoran la conversión y
    // multiplican el tiempo de importación y el coste de almacenamiento. El
    // límite es de la galería, no de las variantes: la foto de una variante no
    // es decorativa, es la que dice qué se está comprando.
    for (const [i, url] of origen.imageUrls.slice(0, 8).entries()) {
      const procesada = await subir(url);
      if (!procesada) continue;

      await this.prisma.client.media.create({
        data: {
          id: newId(),
          productId,
          kind: 'IMAGE',
          storageKey: procesada.key,
          url: procesada.url,
          mimeType: 'image/webp',
          width: procesada.width,
          height: procesada.height,
          sizeBytes: procesada.sizeBytes,
          blurhash: procesada.blurhash,
          position: i,
          // Marcado como del proveedor: el estudio de IA de la Fase 4 sabrá
          // que estas son las que hay que limpiar de marcas de agua.
          source: 'supplier',
        },
      });
      importadas++;
    }

    for (const [i, { variantId, url }] of imagenesDeVariante.entries()) {
      const procesada = await subir(url);
      if (!procesada) continue;

      await this.prisma.client.media.create({
        data: {
          id: newId(),
          productId,
          variantId,
          kind: 'IMAGE',
          storageKey: procesada.key,
          url: procesada.url,
          mimeType: 'image/webp',
          width: procesada.width,
          height: procesada.height,
          sizeBytes: procesada.sizeBytes,
          blurhash: procesada.blurhash,
          // Detrás de la galería: al enseñarlas juntas, las de variante van
          // después de las de producto.
          position: 100 + i,
          source: 'supplier',
        },
      });
      importadas++;
    }

    return importadas;
  }

  /**
   * La categoría nuestra que corresponde a la que trae el artículo.
   *
   * El proveedor manda su ruta —['LOVETOYS','Vibrators']— y en
   * `supplier_categories` está anotado a qué categoría nuestra corresponde,
   * desde que se creó el árbol en la pantalla de proveedores.
   *
   * Se busca la rama exacta y, si no está creada, se sube por sus padres: es
   * mejor dejar el producto en «Lovetoys» que sin categoría, porque sin ella
   * no aparece al navegar la tienda y hay que acordarse de ponérsela a mano.
   */
  /**
   * Las reglas de precio del proveedor, tal y como las espera el cálculo.
   *
   * En un sitio y no repetidas en cada pantalla: el importador, la
   * previsualización y la creación tienen que aplicar exactamente las mismas,
   * o el PVP que se enseña antes de importar no es el que queda después.
   */
  private reglasDePrecio(
    proveedor: Supplier,
    envioCents: number,
    costeCents: number,
    ivaDeclarado: number | undefined,
  ): ReglasDePrecio {
    return {
      margenObjetivo: Number(proveedor.defaultMarginPct),
      margenMinimo: Number(proveedor.minMarginPct),
      taxRate: tipoDeIva(ivaDeclarado),
      envioCents: proveedor.includeShipping ? envioCents : 0,
      recargoPct: Number(proveedor.purchaseSurchargePct),
      cargoFijoCents: cargoFijoAplicable(costeCents, cargoDe(proveedor)),
      terminacion: proveedor.priceEnding,
    };
  }

  async categoriaDelProveedor(
    supplierId: string,
    origen: { categoryPath?: string[] | null },
  ): Promise<string | null> {
    const ruta = origen.categoryPath ?? [];
    if (ruta.length === 0) return null;

    // De la más específica a la más general: ['a','b','c'] → 'a|b|c', 'a|b', 'a'.
    const candidatas = ruta.map((_, i) => ruta.slice(0, ruta.length - i).join('|'));

    const filas = await this.prisma.client.supplierCategory.findMany({
      where: { supplierId, path: { in: candidatas }, categoryId: { not: null } },
      select: { path: true, categoryId: true },
    });

    const porRuta = new Map(filas.map((f) => [f.path, f.categoryId]));
    for (const candidata of candidatas) {
      const id = porRuta.get(candidata);
      if (id) return id;
    }

    return null;
  }

  private generarHandle(titulo: string, externalId: string): string {
    const base = titulo
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '');

    // Se añade el id externo para garantizar unicidad: dos productos del
    // proveedor pueden llamarse igual.
    return `${base || 'producto'}-${externalId.toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(
      0,
      110,
    );
  }

  private normalizarClave(clave: string): string {
    return (
      clave
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'opcion'
    );
  }

  private capitalizar(texto: string): string {
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }
}

/**
 * Saca el identificador del producto de lo que sea que hayan pegado.
 *
 * Se acepta la URL entera porque es lo que se copia de la barra del navegador,
 * y obligar a extraer el número a mano invita a equivocarse. Las direcciones de
 * AliExpress llevan el identificador en `/item/<id>.html`, con variantes por
 * país (`es.aliexpress.com`, `www.aliexpress.us`…) y con la cola de parámetros
 * de seguimiento que añaden al compartir.
 */
export function extraerIdentificador(referencia: string): string | null {
  const limpio = referencia.trim();
  if (!limpio) return null;

  // Ya es un identificador: solo dígitos, o el formato del proveedor simulado.
  if (/^[A-Za-z0-9_-]{3,40}$/.test(limpio) && !limpio.includes('/')) return limpio;

  const enRuta = /\/item\/(?:[a-z-]+\/)?(\d{6,})/i.exec(limpio);
  if (enRuta?.[1]) return enRuta[1];

  // Último recurso: la secuencia larga de dígitos más probable de la cadena.
  const suelto = /(\d{10,})/.exec(limpio);
  return suelto?.[1] ?? null;
}
