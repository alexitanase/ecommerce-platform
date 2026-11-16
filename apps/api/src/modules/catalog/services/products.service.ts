import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { extractBase, newId, type Locale } from '@ecom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { aTextoPlano, sanearHtml } from '../../../common/contenido/html-descripcion.js';
import { traduccionPreferida } from '../../../common/contenido/traduccion.js';
import {
  puedePublicarse,
  resumirProblemas,
  bloqueosInsalvables,
  revisarFicha,
  type Problema,
} from './fidelidad-ficha.js';
import { fichaPublica } from './ficha-publica.js';
import { cargoFijoAplicable, costeDeCompra, margenDeVenta } from './margen.js';
import { AuditService } from '../../audit/audit.service.js';
import { SearchService } from '../../search/search.service.js';
import { CacheService } from '../../cache/cache.service.js';
import { PriceHistoryService } from './price-history.service.js';
import { PricingService } from './pricing.service.js';
import { StorefrontCacheService } from '../../cache/storefront-cache.service.js';
import type { ContextoActor } from '../../roles/roles.service.js';
import type {
  CrearProductoDto,
  ActualizarProductoDto,
  ActualizarVarianteDto,
} from '../dto/products.dto.js';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly search: SearchService,
    private readonly cache: CacheService,
    private readonly storefront: StorefrontCacheService,
    private readonly precios: PriceHistoryService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Reindexa sin bloquear la respuesta.
   *
   * Si Meilisearch está caído o lento, guardar un producto no puede fallar por
   * ello: se registra el error y el reindexado completo lo recuperará después.
   */
  /**
   * Espacio de caché del catálogo público.
   *
   * Los precios y el stock los mueven los workers de sincronización sin que
   * nadie edite nada en el admin, así que el TTL es corto a propósito: cinco
   * minutos de desfase en un precio son aceptables, una hora no.
   */
  private static readonly ESPACIO = 'producto';
  private static readonly TTL = 300;
  /** El slug de un producto casi nunca cambia; su ficha, en cambio, sí. */
  private static readonly TTL_SLUG = 3600;

  /**
   * Tira la ficha cacheada de un producto.
   *
   * Va junto al reindexado porque son exactamente los mismos momentos: si algo
   * cambia lo bastante como para reindexar, la ficha guardada ya no vale.
   */
  private invalidarProducto(productId: string): void {
    void this.cache.invalidarEspacio(ProductsService.ESPACIO).catch(() => {
      // Si Redis no responde, el TTL corto limita el daño a unos minutos.
    });
    this.reindexarEnSegundoPlano(productId);
    this.purgarTiendaEnSegundoPlano(productId);
  }

  /**
   * Avisa a la tienda para que descarte las páginas de este producto.
   *
   * Sin esto, un cambio de precio tarda hasta diez minutos en verse: el tiempo
   * del `revalidate` de la ficha. Va en segundo plano porque la tienda no puede
   * retener —ni hacer fallar— una operación del admin.
   */
  private purgarTiendaEnSegundoPlano(productId: string): void {
    void (async () => {
      const slugs = await this.prisma.client.productTranslation.findMany({
        where: { productId },
        select: { slug: true },
      });
      await this.storefront.purgarProducto(slugs.map((s) => s.slug));
    })().catch(() => {
      // El revalidate de cada página sigue siendo la red de seguridad.
    });
  }

  private reindexarEnSegundoPlano(productId: string): void {
    void this.search.indexarProducto(productId).catch((error: unknown) => {
      this.logger.error(
        `No se ha podido indexar el producto ${productId}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    });
  }

  // ── Lectura pública (tienda) ──────────────────────────────

  /**
   * Ficha de producto para la tienda, resuelta por su slug en un idioma.
   * Solo devuelve productos publicados: un borrador accesible por URL directa
   * es una filtración de precios y novedades antes de tiempo.
   */
  async porSlugPublico(slug: string, locale: Locale, permitirAdulto = false) {
    // La correspondencia slug → id solo cambia cuando se edita el slug de un
    // producto, así que aguanta mucho más que la ficha. Sin cachearla, cada
    // visita gasta una consulta aunque la ficha ya esté en caché.
    const productId = await this.cache.recordar(
      ProductsService.ESPACIO,
      `slug:${locale}:${slug}`,
      ProductsService.TTL_SLUG,
      async () => {
        // Por la réplica de lectura: lo consulta un visitante, no quien acaba
        // de editar el producto, así que un segundo de retraso da igual. Es la
        // consulta más repetida de toda la tienda.
        const propia = await this.prisma.lectura.productTranslation.findUnique({
          where: { locale_slug: { locale, slug } },
          select: { productId: true },
        });
        if (propia) return propia.productId;

        /*
         * El mismo slug en cualquier otro idioma, o el `handle` del producto.
         *
         * Es la misma cortesía que ya hacen las categorías, y aquí además tapa
         * un agujero real: un catálogo importado no viene traducido a los tres
         * idiomas, así que la tienda en inglés enlazaba fichas con el slug
         * español —o directamente con el `handle`— y quien pulsaba se comía un
         * 404. Los listados ya no generan esos enlaces, pero siguen vivos en
         * Google, en los favoritos y en los enlaces que la gente se ha
         * compartido, y ninguno de esos se puede arreglar desde aquí.
         *
         * La ficha se sirve después en el idioma que se pidió, con el respaldo
         * de siempre: se llega al producto correcto aunque el enlace viniera en
         * otra lengua.
         */
        const ajena = await this.prisma.lectura.productTranslation.findFirst({
          where: { slug },
          select: { productId: true },
        });
        if (ajena) return ajena.productId;

        const porHandle = await this.prisma.lectura.product.findUnique({
          where: { handle: slug },
          select: { id: true },
        });

        return porHandle?.id ?? null;
      },
    );

    if (!productId) throw new NotFoundException('Producto no encontrado');

    // La consulta de detalle son ocho relaciones anidadas y es la más pedida de
    // toda la tienda. Cachearla aquí, y no dentro de detalleCompleto, deja el
    // admin siempre con datos frescos: quien acaba de editar un producto tiene
    // que ver su cambio, no una copia de hace cinco minutos.
    const producto = await this.cache.recordar(
      ProductsService.ESPACIO,
      `${productId}:${locale}`,
      ProductsService.TTL,
      () => this.detalleCompleto(productId, locale),
    );

    if (producto.status !== 'ACTIVE' || producto.deletedAt) {
      throw new NotFoundException('Producto no encontrado');
    }
    if (producto.isAdult && !permitirAdulto) {
      // 403 y no 404 a propósito. Con 404 el visitante no tendría forma de
      // saber que solo le falta verificar la edad, y no habría manera de
      // llegar nunca al catálogo +18 por enlace directo.
      //
      // Lo único que revela es que en esa URL hay un producto restringido, que
      // es justo lo que necesita saber para decidir si continúa. En los
      // LISTADOS y en la búsqueda siguen sin aparecer.
      throw new ForbiddenException({
        statusCode: 403,
        error: 'AgeVerificationRequired',
        message: 'Este producto pertenece a una categoría para mayores de 18 años.',
      });
    }

    /*
     * Se proyecta DESPUÉS de la caché y no antes.
     *
     * La caché guarda la ficha completa, que es la que también usa el panel: si
     * se guardara ya recortada, el panel dejaría de ver el coste y el margen.
     * Recortar aquí cuesta un recorrido de listas por visita y es lo que impide
     * que el coste del proveedor salga a internet.
     */
    return fichaPublica(producto);
  }

  /**
   * Nombre, texto y foto de un producto, para la vista previa de un enlace.
   *
   * Sin comprobación de edad **a propósito**: quien pide esto es el robot de
   * WhatsApp o de Telegram, que no tiene forma de verificar nada, y sin esta
   * puerta trasera la tarjeta del enlace compartido sale vacía para todo el
   * catálogo. Lo que devuelve es exactamente lo que quien comparte quiere que se
   * vea; comprar sigue exigiendo pasar por la puerta.
   *
   * Acepta el slug de cualquier idioma y el `handle`, igual que la ficha: los
   * enlaces compartidos sobreviven años y no todos traen el slug del idioma que
   * se está pidiendo.
   */
  async vistaPreviaPublica(slug: string, locale: Locale) {
    const traduccion =
      (await this.prisma.lectura.productTranslation.findUnique({
        where: { locale_slug: { locale, slug } },
        select: { productId: true },
      })) ??
      (await this.prisma.lectura.productTranslation.findFirst({
        where: { slug },
        select: { productId: true },
      }));

    const productId =
      traduccion?.productId ??
      (
        await this.prisma.lectura.product.findUnique({
          where: { handle: slug },
          select: { id: true },
        })
      )?.id;

    if (!productId) throw new NotFoundException('Producto no encontrado');

    const producto = await this.prisma.lectura.product.findFirst({
      // Solo lo publicado: un borrador no se comparte, y su nombre y su foto
      // son justo lo que no debe salir antes de tiempo.
      where: { id: productId, status: 'ACTIVE', deletedAt: null },
      select: {
        handle: true,
        translations: {
          select: { locale: true, name: true, shortDescription: true, metaDescription: true },
        },
        media: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
          take: 1,
          select: { url: true, width: true, height: true, alt: true },
        },
      },
    });

    if (!producto) throw new NotFoundException('Producto no encontrado');

    const t = traduccionPreferida(producto.translations, locale);
    if (!t) throw new NotFoundException('Producto no encontrado');

    const foto = producto.media[0];

    return {
      name: t.name,
      // La meta descripción manda si la hay: está escrita justo para esto.
      descripcion: t.metaDescription ?? t.shortDescription ?? null,
      imagen: foto
        ? {
            url: foto.url,
            width: foto.width,
            height: foto.height,
            alt: (foto.alt as Record<string, string> | null)?.[locale] ?? t.name,
          }
        : null,
    };
  }

  async detalleCompleto(productId: string, locale: Locale) {
    const producto = await this.prisma.client.product.findUnique({
      where: { id: productId },
      include: {
        translations: true,
        category: { include: { translations: true } },
        brand: true,
        media: { where: { deletedAt: null }, orderBy: { position: 'asc' } },
        options: {
          orderBy: { position: 'asc' },
          include: {
            translations: true,
            values: { orderBy: { position: 'asc' } },
          },
        },
        variants: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
          include: {
            optionValues: { include: { optionValue: true } },
            media: { where: { deletedAt: null }, orderBy: { position: 'asc' } },
          },
        },
        attributes: { include: { attribute: true } },
      },
    });

    if (!producto) throw new NotFoundException('Producto no encontrado');

    // Descuento anunciable según la directiva Ómnibus: el precio tachado no lo
    // decide quien edita el producto, lo decide el histórico de los últimos 30
    // días. Se calcula aquí para que la tienda no pueda enseñar otra cosa.
    const descuentos = await this.precios.descuentosDe(
      producto.variants.map((v) => ({ id: v.id, priceCents: v.priceCents })),
    );

    /*
     * De dónde sale este producto.
     *
     * Es la mitad de la información que hace falta para decidir un precio y no
     * estaba en ninguna pantalla: cuánto cuesta en el proveedor, cuánto cobra
     * de envío, si le queda stock allí, si lo ha descatalogado y cuándo se
     * comprobó por última vez. Sin esto, quien pone el PVP lo hace a ciegas y
     * quien ve un producto agotado no sabe si es culpa nuestra o del proveedor.
     */
    const enlaces = await this.prisma.client.supplierProduct.findMany({
      where: { productId },
      include: {
        supplier: {
          select: {
            id: true,
            key: true,
            name: true,
            isActive: true,
            purchaseSurchargePct: true,
            importFeeCents: true,
            importFeeThresholdCents: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const porVariante = new Map(producto.variants.map((v) => [v.id, v]));

    return {
      ...producto,
      variants: producto.variants.map((v) => {
        const d = descuentos.get(v.id);
        return {
          ...v,
          // Se sustituye el compareAtCents guardado por el que la ley permite.
          compareAtCents: d?.anunciable ? d.referenciaCents : null,
          /*
           * El precio tachado tal como lo dejó quien gestiona la tienda.
           *
           * Hace falta porque este método lo comparten la tienda y el panel, y
           * cada uno necesita un número distinto: la tienda, el que la ley
           * permite anunciar; el panel, el que hay guardado, porque es el que
           * está editando.
           *
           * Sin esto el editor era imposible de usar y parecía roto: guardabas
           * 49,99 €, se guardaba de verdad, y el campo volvía vacío —porque hoy
           * no había descuento anunciable— así que parecía que no se guardaba.
           * Nadie podía deducir que el campo que leía no era el que escribía.
           *
           * No sale en `fichaPublica`, que proyecta por lista blanca: al
           * visitante solo le llega el precio tachado legal.
           */
          compareAtGuardadoCents: v.compareAtCents,
          descuentoPorcentaje: d?.porcentaje ?? null,
        };
      }),
      proveedores: enlaces.map((e) => {
        const variante = e.variantId ? porVariante.get(e.variantId) : undefined;
        /*
         * Coste real: el artículo, su porte y el recargo que el proveedor añade
         * al pagar y su API no menciona.
         *
         * Los tres sumandos han faltado alguna vez y los tres cuestan dinero.
         * El último es el que vendió un producto a pérdida: AliExpress cotizaba
         * 13,99 € y cobró 16,89 € por unos cargos de importación que no salen
         * en ninguna consulta de producto.
         */
        const costeTotal = costeDeCompra(
          {
            costCents: e.costCents,
            envioCents: e.shippingCents,
            cargoFijoCents: cargoFijoAplicable(e.costCents, {
              importeCents: e.supplier.importFeeCents,
              umbralCents: e.supplier.importFeeThresholdCents,
            }),
          },
          Number(e.supplier.purchaseSurchargePct),
        );

        return {
          id: e.id,
          supplierId: e.supplierId,
          supplierKey: e.supplier.key,
          supplierNombre: e.supplier.name,
          supplierActivo: e.supplier.isActive,
          externalProductId: e.externalProductId,
          externalVariantId: e.externalVariantId,
          variantId: e.variantId,
          variantSku: variante?.sku ?? null,
          costCents: e.costCents,
          shippingCents: e.shippingCents,
          costeTotalCents: costeTotal,
          currency: e.currency,
          stock: e.stock,
          available: e.available,
          discontinued: e.discontinued,
          discontinuedAt: e.discontinuedAt,
          leadTimeMinDays: e.leadTimeMinDays,
          leadTimeMaxDays: e.leadTimeMaxDays,
          lastCheckedAt: e.lastCheckedAt,
          /**
           * Lo que se ingresa frente a lo que cuesta, en puntos porcentuales.
           *
           * Sobre la base imponible, no sobre el precio de escaparate: el IVA
           * que va dentro del PVP no es ingreso. Ver `margen.ts`.
           */
          margenPorcentaje:
            variante && variante.priceCents > 0
              ? margenDeVenta(variante.priceCents, costeTotal, Number(producto.taxRate)).porcentaje
              : null,
        };
      }),
      locale,
    };
  }

  // ── Listado (admin) ───────────────────────────────────────

  async listar(filtros: {
    locale: Locale;
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    categoryId?: string;
    busqueda?: string;
    ids?: string[];
    sinStock?: boolean;
    limite?: number;
    cursor?: string;
  }) {
    const limite = Math.min(filtros.limite ?? 30, 100);

    /*
     * Archivar es un borrado blando: marca `deletedAt` para que los pedidos que
     * referencian el producto sigan teniendo sentido. El listado excluía siempre
     * lo borrado, así que pedir los archivados no devolvía NADA y desde el panel
     * no había forma de ver —ni de recuperar— lo que se había eliminado.
     *
     * Solo se incluyen cuando se piden expresamente: en la vista normal un
     * producto retirado no debe estorbar.
     */
    const soloArchivados = filtros.status === 'ARCHIVED';

    const productos = await this.prisma.client.product.findMany({
      where: {
        ...(soloArchivados ? {} : { deletedAt: null }),
        ...(filtros.status ? { status: filtros.status } : {}),
        ...(filtros.categoryId ? { categoryId: filtros.categoryId } : {}),
        ...(filtros.ids && filtros.ids.length > 0 ? { id: { in: filtros.ids } } : {}),
        ...(filtros.busqueda
          ? {
              translations: {
                some: { name: { contains: filtros.busqueda, mode: 'insensitive' as const } },
              },
            }
          : {}),
        ...(filtros.sinStock ? { variants: { every: { stock: { lte: 0 } } } } : {}),
      },
      include: {
        translations: { where: { locale: filtros.locale } },
        media: { where: { deletedAt: null }, orderBy: { position: 'asc' }, take: 1 },
        variants: {
          where: { deletedAt: null },
          select: { id: true, sku: true, priceCents: true, stock: true, costCents: true },
        },
        category: { include: { translations: { where: { locale: filtros.locale } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limite + 1,
      ...(filtros.cursor ? { cursor: { id: filtros.cursor }, skip: 1 } : {}),
    });

    const hayMas = productos.length > limite;
    const visibles = hayMas ? productos.slice(0, limite) : productos;

    /*
     * El coste de compra REAL, el del proveedor.
     *
     * El `costCents` de la variante es una copia que puede haberse quedado
     * atrás, y no incluye lo que el proveedor cobra de envío. Con esos dos
     * defectos el margen del listado sale optimista justo en los productos
     * baratos, que es donde el porte pesa más y donde es más fácil estar
     * vendiendo a pérdida sin verlo.
     *
     * Una consulta más para toda la página, no una por fila.
     */
    const enlaces = await this.prisma.client.supplierProduct.findMany({
      where: { productId: { in: visibles.map((p) => p.id) } },
      select: {
        productId: true,
        variantId: true,
        costCents: true,
        shippingCents: true,
        supplier: {
          select: {
            purchaseSurchargePct: true,
            importFeeCents: true,
            importFeeThresholdCents: true,
          },
        },
      },
    });

    // Recargo y cargo fijo incluidos: es lo que se paga de verdad. Ver `margen.ts`.
    const compra = (e: (typeof enlaces)[number]) =>
      costeDeCompra(
        {
          costCents: e.costCents,
          envioCents: e.shippingCents,
          cargoFijoCents: cargoFijoAplicable(e.costCents, {
            importeCents: e.supplier.importFeeCents,
            umbralCents: e.supplier.importFeeThresholdCents,
          }),
        },
        Number(e.supplier.purchaseSurchargePct),
      );

    const costeDeVariante = new Map(
      enlaces.filter((e) => e.variantId).map((e) => [e.variantId!, compra(e)]),
    );
    const costeDeProducto = new Map<string, number>();
    for (const e of enlaces) {
      if (!costeDeProducto.has(e.productId)) {
        costeDeProducto.set(e.productId, compra(e));
      }
    }

    const items = visibles.map((p) => {
      const precios = p.variants.map((v) => v.priceCents);
      const costes = p.variants.map(
        (v) => costeDeVariante.get(v.id) ?? costeDeProducto.get(p.id) ?? v.costCents ?? 0,
      );
      // El ingreso es la suma de las BASES, no la de los PVP: el IVA que va
      // dentro del precio se le debe a Hacienda y contarlo como ingreso infla
      // el margen unos veinte puntos. Ver `margen.ts`.
      const ingreso = precios.reduce((a, b) => a + extractBase(b, Number(p.taxRate)), 0);
      const coste = costes.reduce((a, b) => a + b, 0);
      const conCoste = costes.filter((c) => c > 0);

      return {
        id: p.id,
        handle: p.handle,
        status: p.status,
        isAdult: p.isAdult,
        name: p.translations[0]?.name ?? p.handle,
        imagen: p.media[0]?.url ?? null,
        categoria: p.category?.translations[0]?.name ?? null,
        variantes: p.variants.length,
        stockTotal: p.variants.reduce((a, v) => a + v.stock, 0),
        precioDesde: precios.length > 0 ? Math.min(...precios) : null,
        precioHasta: precios.length > 0 ? Math.max(...precios) : null,
        /** Lo que cuesta comprarlo, envío del proveedor incluido. */
        costeDesde: conCoste.length > 0 ? Math.min(...conCoste) : null,
        // Margen medio sobre PVP, para detectar de un vistazo productos que
        // se están vendiendo por debajo del margen objetivo.
        margenMedio: ingreso > 0 ? Math.round(((ingreso - coste) / ingreso) * 100) : null,
        actualizado: p.updatedAt,
      };
    });

    return { items, nextCursor: hayMas ? (items.at(-1)?.id ?? null) : null };
  }

  // ── Escritura ─────────────────────────────────────────────

  async crear(dto: CrearProductoDto, ctx: ContextoActor) {
    await this.exigirHandleLibre(dto.handle);
    await this.exigirSlugsLibres(dto.translations);

    const skus = dto.variants.map((v) => v.sku);
    if (new Set(skus).size !== skus.length) {
      throw new BadRequestException('Hay SKUs repetidos entre las variantes');
    }
    const skusOcupados = await this.prisma.client.productVariant.findMany({
      where: { sku: { in: skus } },
      select: { sku: true },
    });
    if (skusOcupados.length > 0) {
      throw new BadRequestException(
        `Estos SKU ya existen: ${skusOcupados.map((s) => s.sku).join(', ')}`,
      );
    }

    const productId = newId();

    // Todo en una transacción: un producto a medio crear —con opciones pero
    // sin variantes— rompería la ficha y no habría forma de arreglarlo desde el admin.
    const producto = await this.prisma.client.$transaction(async (tx) => {
      await tx.product.create({
        data: {
          id: productId,
          handle: dto.handle,
          status: dto.status ?? 'DRAFT',
          categoryId: dto.categoryId ?? null,
          brandId: dto.brandId ?? null,
          taxRate: dto.taxRate ?? 21,
          isAdult: dto.isAdult ?? false,
          requiresShipping: dto.requiresShipping ?? true,
          publishedAt: dto.status === 'ACTIVE' ? new Date() : null,
          translations: {
            create: dto.translations.map((t) => ({
              id: newId(),
              locale: t.locale,
              name: t.name,
              slug: t.slug,
              // Texto plano en la corta y HTML saneado en la larga: lo que
              // llega del editor del panel es tan de fiar como lo que llega del
              // proveedor, así que se limpia en el mismo sitio para las dos vías.
              shortDescription: aTextoPlano(t.shortDescription),
              description: sanearHtml(t.description),
              metaTitle: t.metaTitle ?? null,
              metaDescription: t.metaDescription ?? null,
            })),
          },
        },
      });

      // Opciones y sus valores; se guarda el mapa valor→id para enlazar variantes.
      const idsDeValor = new Map<string, string>();

      for (const [i, opcion] of (dto.options ?? []).entries()) {
        const optionId = newId();
        await tx.productOption.create({
          data: {
            id: optionId,
            productId,
            key: opcion.key,
            position: i,
            translations: {
              create: opcion.labels.map((l) => ({
                id: newId(),
                locale: l.locale,
                name: l.name,
              })),
            },
          },
        });

        for (const [j, valor] of opcion.values.entries()) {
          const valueId = newId();
          await tx.productOptionValue.create({
            data: {
              id: valueId,
              optionId,
              value: valor.value,
              labels: valor.labels ?? undefined,
              hexColor: valor.hexColor ?? null,
              position: j,
            },
          });
          idsDeValor.set(`${opcion.key}:${valor.value}`, valueId);
        }
      }

      for (const [i, v] of dto.variants.entries()) {
        const variantId = newId();
        await tx.productVariant.create({
          data: {
            id: variantId,
            productId,
            sku: v.sku,
            barcode: v.barcode ?? null,
            priceCents: v.priceCents,
            compareAtCents: v.compareAtCents ?? null,
            costCents: v.costCents ?? null,
            weightGrams: v.weightGrams ?? null,
            stock: v.stock ?? 0,
            lowStockAlert: v.lowStockAlert ?? 5,
            allowBackorder: v.allowBackorder ?? false,
            position: i,
            isDefault: i === 0,
          },
        });

        for (const [clave, valor] of Object.entries(v.options ?? {})) {
          const optionValueId = idsDeValor.get(`${clave}:${valor}`);
          if (!optionValueId) {
            throw new BadRequestException(
              `La variante ${v.sku} referencia la opción "${clave}: ${valor}", que no está declarada`,
            );
          }
          await tx.variantOptionValue.create({ data: { variantId, optionValueId } });
        }

        if ((v.stock ?? 0) > 0) {
          await tx.stockMovement.create({
            data: {
              id: newId(),
              variantId,
              delta: v.stock ?? 0,
              stockAfter: v.stock ?? 0,
              reason: 'MANUAL',
              note: 'Stock inicial al crear el producto',
              actorId: ctx.actorId,
            },
          });
        }
      }

      return tx.product.findUniqueOrThrow({
        where: { id: productId },
        include: { translations: true, variants: true },
      });
    });

    await this.audit.registrar({
      action: 'product.create',
      resource: 'product',
      resourceId: productId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { handle: dto.handle, variantes: dto.variants.length, status: dto.status },
    });

    this.invalidarProducto(productId);
    return producto;
  }

  async actualizar(productId: string, dto: ActualizarProductoDto, ctx: ContextoActor) {
    const antes = await this.prisma.client.product.findUnique({
      where: { id: productId },
      include: { translations: true },
    });
    if (!antes || antes.deletedAt) throw new NotFoundException('Producto no encontrado');

    if (dto.translations) {
      await this.exigirSlugsLibres(dto.translations, productId);
    }

    // Al pasar a la venta, y no antes: una ficha incompleta en borrador no
    // hace daño; publicada incumple el art. 97 del TRLGDCU y el fallo solo se
    // ve cuando reclama un cliente.
    let omitidos: Problema[] = [];
    if (dto.status === 'ACTIVE' && antes.status !== 'ACTIVE') {
      omitidos = await this.exigirFichaCompleta(productId, dto);
    }

    const producto = await this.prisma.client.product.update({
      where: { id: productId },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.brandId !== undefined ? { brandId: dto.brandId } : {}),
        ...(dto.taxRate !== undefined ? { taxRate: dto.taxRate } : {}),
        ...(dto.isAdult !== undefined ? { isAdult: dto.isAdult } : {}),
        // La fecha de publicación se fija la primera vez y no se toca después:
        // es la que ordena las novedades en la tienda.
        ...(dto.status === 'ACTIVE' && !antes.publishedAt ? { publishedAt: new Date() } : {}),
      },
      include: { translations: true },
    });

    for (const t of dto.translations ?? []) {
      await this.prisma.client.productTranslation.upsert({
        where: { productId_locale: { productId, locale: t.locale } },
        update: {
          name: t.name,
          slug: t.slug,
          shortDescription: aTextoPlano(t.shortDescription),
          description: sanearHtml(t.description),
          metaTitle: t.metaTitle ?? null,
          metaDescription: t.metaDescription ?? null,
        },
        create: {
          id: newId(),
          productId,
          locale: t.locale,
          name: t.name,
          slug: t.slug,
          shortDescription: aTextoPlano(t.shortDescription),
          description: sanearHtml(t.description),
          metaTitle: t.metaTitle ?? null,
          metaDescription: t.metaDescription ?? null,
        },
      });
    }

    await this.audit.registrar({
      action: 'product.update',
      resource: 'product',
      resourceId: productId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { status: antes.status, isAdult: antes.isAdult },
      after: { status: producto.status, isAdult: producto.isAdult },
    });

    /*
     * Publicar con la ficha incompleta se anota aparte.
     *
     * No es lo mismo que un cambio de estado normal y no debe perderse entre
     * ellos: si mañana llega una reclamación por un plazo de entrega que no se
     * informó, esto es lo que dice quién decidió publicar así, cuándo, y qué
     * avisos tenía delante en ese momento.
     */
    if (omitidos.length > 0) {
      await this.audit.registrar({
        action: 'product.publish_forced',
        resource: 'product',
        resourceId: productId,
        actorId: ctx.actorId,
        actorIp: ctx.actorIp,
        metadata: {
          omitidos: omitidos.map((o) => ({
            codigo: o.codigo,
            ...(o.locale ? { locale: o.locale } : {}),
            mensaje: o.mensaje,
          })),
        },
      });

      this.logger.warn(
        `Producto ${productId} publicado con ${String(omitidos.length)} avisos sin resolver: ` +
          omitidos.map((o) => o.codigo).join(', '),
      );
    }

    this.invalidarProducto(productId);
    return producto;
  }

  /**
   * Archiva el producto en lugar de borrarlo.
   *
   * Un producto borrado dejaría sin referencia las líneas de pedidos ya
   * realizados, y el cliente vería "producto no disponible" en su historial
   * de compras y en su factura.
   */
  /**
   * Cambia una variante: precio, coste, SKU, peso o alertas.
   *
   * No estaba, y era el hueco más caro del catálogo: se podía crear un producto
   * con su precio y no volver a tocarlo nunca. En dropshipping el precio es la
   * palanca principal —el proveedor sube el suyo, cambia la competencia, se
   * lanza una promoción— y sin esto había que borrar el producto y volver a
   * importarlo, perdiendo su histórico y su URL.
   *
   * Un cambio de precio anota el histórico. De ahí sale el precio más bajo de
   * los últimos 30 días, que es lo único que se puede anunciar legalmente como
   * precio anterior en una rebaja.
   */
  async actualizarVariante(variantId: string, dto: ActualizarVarianteDto, ctx: ContextoActor) {
    const antes = await this.prisma.client.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        sku: true,
        priceCents: true,
        compareAtCents: true,
        costCents: true,
        deletedAt: true,
        product: { select: { id: true, status: true } },
      },
    });

    if (!antes || antes.deletedAt) throw new NotFoundException('Variante no encontrada');

    // El SKU identifica la variante en los pedidos y en el proveedor: repetido
    // haría que dos productos distintos se confundieran al sincronizar.
    if (dto.sku !== undefined && dto.sku !== antes.sku) {
      const ocupado = await this.prisma.client.productVariant.findFirst({
        where: { sku: dto.sku, deletedAt: null, NOT: { id: variantId } },
        select: { id: true },
      });
      if (ocupado) throw new BadRequestException(`Ya hay otra variante con el SKU "${dto.sku}"`);
    }

    const precioFinal = dto.priceCents ?? antes.priceCents;
    const comparativoFinal =
      dto.compareAtCents !== undefined ? dto.compareAtCents : antes.compareAtCents;

    // Un precio tachado menor que el real no confunde: engaña, y anunciarlo así
    // es una práctica comercial desleal.
    if (comparativoFinal !== null && comparativoFinal <= precioFinal) {
      throw new BadRequestException(
        'El precio comparativo (tachado) tiene que ser mayor que el precio de venta',
      );
    }

    // Publicado y a cero euros significa regalarlo con el envío pagado.
    if (antes.product.status === 'ACTIVE' && precioFinal === 0) {
      throw new BadRequestException(
        'No se puede dejar a cero el precio de una variante de un producto publicado',
      );
    }

    const variante = await this.prisma.client.productVariant.update({
      where: { id: variantId },
      data: {
        ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
        ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
        ...(dto.priceCents !== undefined ? { priceCents: dto.priceCents } : {}),
        ...(dto.compareAtCents !== undefined ? { compareAtCents: dto.compareAtCents } : {}),
        ...(dto.costCents !== undefined ? { costCents: dto.costCents } : {}),
        ...(dto.weightGrams !== undefined ? { weightGrams: dto.weightGrams } : {}),
        ...(dto.lowStockAlert !== undefined ? { lowStockAlert: dto.lowStockAlert } : {}),
        ...(dto.allowBackorder !== undefined ? { allowBackorder: dto.allowBackorder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    if (dto.priceCents !== undefined && dto.priceCents !== antes.priceCents) {
      await this.precios.registrarSiCambia(variantId, dto.priceCents, 'manual');
    }

    await this.audit.registrar({
      action: 'product.variant_update',
      resource: 'product',
      resourceId: antes.product.id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      /*
       * El precio queda en la auditoría porque es lo primero que se mira cuando
       * un pedido no cuadra con lo que el cliente dice haber visto.
       *
       * El **tachado** también, y faltaba. Es precisamente el dato que se
       * reclama —«ponía un 20 % de descuento»— y sin él no había forma de
       * reconstruir qué se anunciaba: al investigar por qué se borraba, el
       * registro decía que la variante se había actualizado sin decir a qué.
       */
      before: {
        sku: antes.sku,
        priceCents: antes.priceCents,
        compareAtCents: antes.compareAtCents,
        costCents: antes.costCents,
      },
      after: {
        sku: variante.sku,
        priceCents: variante.priceCents,
        compareAtCents: variante.compareAtCents,
        costCents: variante.costCents,
      },
    });

    this.invalidarProducto(antes.product.id);
    return variante;
  }

  async archivar(productId: string, ctx: ContextoActor): Promise<void> {
    const producto = await this.prisma.client.product.findUnique({ where: { id: productId } });
    if (!producto || producto.deletedAt) throw new NotFoundException('Producto no encontrado');

    await this.prisma.client.product.update({
      where: { id: productId },
      data: { status: 'ARCHIVED', deletedAt: new Date() },
    });

    // Un producto archivado tiene que desaparecer de la tienda ya, no cuando
    // caduque la caché: seguiría siendo comprable durante minutos.
    this.invalidarProducto(productId);

    await this.audit.registrar({
      action: 'product.archive',
      resource: 'product',
      resourceId: productId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { status: producto.status },
    });

    // Un producto archivado debe desaparecer del buscador de inmediato.
    await this.search.eliminarDelIndice(productId);
  }

  /**
   * Devuelve al catálogo un producto archivado.
   *
   * Vuelve como BORRADOR y no a su estado anterior: mientras estaba fuera, el
   * proveedor puede haberlo descatalogado o cambiado de precio. Republicarlo sin
   * mirar sería poner a la venta algo que quizá ya no se puede servir, así que
   * pasa otra vez por la revisión de la ficha.
   */
  async restaurar(productId: string, ctx: ContextoActor): Promise<void> {
    const producto = await this.prisma.client.product.findUnique({ where: { id: productId } });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    if (!producto.deletedAt) {
      throw new BadRequestException('Este producto no está archivado.');
    }

    await this.prisma.client.product.update({
      where: { id: productId },
      data: { status: 'DRAFT', deletedAt: null, publishedAt: null },
    });

    await this.audit.registrar({
      action: 'product.restore',
      resource: 'product',
      resourceId: productId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { status: producto.status, deletedAt: producto.deletedAt },
      after: { status: 'DRAFT' },
    });

    // No se reindexa: vuelve como borrador y el índice solo lleva lo publicado.
    // Reindexarlo aquí lo haría buscable en la tienda sin estar a la venta.
    this.invalidarProducto(productId);
  }

  // ── Internos ──────────────────────────────────────────────

  private async exigirHandleLibre(handle: string): Promise<void> {
    const existe = await this.prisma.client.product.findUnique({ where: { handle } });
    if (existe) throw new BadRequestException(`Ya existe un producto con el handle "${handle}"`);
  }

  /**
   * Revisa la ficha tal y como quedaría publicada.
   *
   * Se pasan también los cambios que vienen en la misma petición: sin ellos,
   * rellenar la descripción y publicar en un solo paso se rechazaría por una
   * descripción que el propio guardado estaba añadiendo.
   */
  async revisarFidelidad(productId: string, dto?: ActualizarProductoDto): Promise<Problema[]> {
    const producto = await this.prisma.client.product.findUnique({
      where: { id: productId },
      include: {
        translations: true,
        media: { select: { id: true } },
        variants: { where: { deletedAt: null } },
      },
    });

    if (!producto) throw new NotFoundException('Producto no encontrado');

    // `SupplierProduct` guarda el producto como clave suelta, sin relación
    // declarada en el esquema: hay que buscarlo aparte.
    const enlaces = await this.prisma.client.supplierProduct.findMany({
      where: { productId },
      select: { variantId: true, leadTimeMaxDays: true },
    });

    const traducciones = [...producto.translations];
    for (const t of dto?.translations ?? []) {
      const i = traducciones.findIndex((x) => x.locale === t.locale);
      const fusionada = { ...(traducciones[i] ?? {}), ...t } as (typeof traducciones)[number];
      if (i >= 0) traducciones[i] = fusionada;
      else traducciones.push(fusionada);
    }

    // El plazo lo pone el proveedor, no el producto: se busca el del enlace de
    // cada variante y, si no lo hay, el de cualquiera del mismo producto.
    const plazoDe = (variantId: string): number | null =>
      enlaces.find((l) => l.variantId === variantId)?.leadTimeMaxDays ??
      enlaces.find((l) => l.leadTimeMaxDays !== null)?.leadTimeMaxDays ??
      null;

    // Que exista histórico es lo que permite anunciar una rebaja: sin él no se
    // puede acreditar el precio más bajo de los últimos 30 días.
    const historico = await this.prisma.client.priceHistory.count({
      where: { variantId: { in: producto.variants.map((v) => v.id) } },
    });

    return revisarFicha({
      isAdult: dto?.isAdult ?? producto.isAdult,
      requiresShipping: producto.requiresShipping,
      traducciones: traducciones.map((t) => ({
        locale: t.locale,
        name: t.name ?? null,
        shortDescription: t.shortDescription ?? null,
        description: t.description ?? null,
      })),
      variantes: producto.variants.map((v) => ({
        sku: v.sku,
        priceCents: v.priceCents,
        compareAtCents: v.compareAtCents,
        weightGrams: v.weightGrams,
        stock: v.stock,
        allowBackorder: v.allowBackorder,
        leadTimeMaxDays: plazoDe(v.id),
      })),
      imagenes: producto.media.length,
      tieneReferenciaOmnibus: historico > 0,
    });
  }

  /**
   * Recalcula el PVP de todas las variantes a partir de un margen objetivo.
   *
   * El margen se calcula sobre el coste REAL: lo que cuesta en el proveedor MÁS
   * lo que cobra de envío. Hacerlo sobre el precio del artículo a secas infla
   * el margen justo en los productos baratos, que es donde el porte pesa más y
   * donde es más fácil acabar vendiendo a pérdida sin enterarse.
   *
   * Si no hay coste del proveedor se usa el que tenga la variante; y si no hay
   * ninguno, esa variante se deja como está en lugar de inventar un precio.
   *
   * @param simular  devuelve lo que pasaría sin tocar nada. La ficha lo usa
   *                 para enseñar el precio resultante mientras se mueve el
   *                 porcentaje, que es la única forma de elegirlo con criterio.
   */
  async aplicarMargen(
    productId: string,
    margenObjetivo: number,
    ctx: { actorId?: string; actorIp?: string },
    simular = false,
  ) {
    const producto = await this.prisma.client.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: { variants: { where: { deletedAt: null }, orderBy: { position: 'asc' } } },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    const enlaces = await this.prisma.client.supplierProduct.findMany({
      where: { productId },
      include: {
        supplier: {
          select: {
            minMarginPct: true,
            purchaseSurchargePct: true,
            importFeeCents: true,
            importFeeThresholdCents: true,
          },
        },
      },
    });

    const filas = producto.variants.map((v) => {
      const enlace = enlaces.find((e) => e.variantId === v.id) ?? enlaces[0];
      const costeCents = enlace ? enlace.costCents : (v.costCents ?? 0);
      const envioCents = enlace?.shippingCents ?? 0;

      if (costeCents <= 0) {
        return {
          variantId: v.id,
          sku: v.sku,
          costeCents,
          envioCents,
          precioAntes: v.priceCents,
          precioNuevo: v.priceCents,
          margenReal: null as number | null,
          aviso: 'Sin coste conocido: no se puede calcular un precio con margen.',
        };
      }

      const calculo = this.pricing.calcularPvp({
        costeCents,
        envioCents,
        margenObjetivo,
        // El tipo del producto, para que el margen se mida sobre la base y no
        // sobre el precio con IVA.
        taxRate: Number(producto.taxRate),
        ...(enlace
          ? {
              recargoPct: Number(enlace.supplier.purchaseSurchargePct),
              cargoFijoCents: cargoFijoAplicable(costeCents, {
                importeCents: enlace.supplier.importFeeCents,
                umbralCents: enlace.supplier.importFeeThresholdCents,
              }),
              margenMinimo: Number(enlace.supplier.minMarginPct),
            }
          : {}),
      });

      return {
        variantId: v.id,
        sku: v.sku,
        costeCents,
        envioCents,
        precioAntes: v.priceCents,
        precioNuevo: calculo.pvpCents,
        margenReal: calculo.margenReal,
        ...(calculo.aviso ? { aviso: calculo.aviso } : {}),
      };
    });

    if (simular) return { margenObjetivo, simulado: true, variantes: filas };

    // El precio no se toca con un `update` suelto: pasa por el mismo camino que
    // la edición manual para que quede anotado en el histórico. De ahí sale el
    // precio más bajo de los últimos 30 días, que es el único que la ley
    // permite anunciar como precio anterior.
    for (const fila of filas) {
      if (fila.precioNuevo === fila.precioAntes || fila.margenReal === null) continue;
      await this.actualizarVariante(fila.variantId, { priceCents: fila.precioNuevo }, ctx);
    }

    await this.audit.registrar({
      action: 'product.margin_applied',
      resource: 'product',
      resourceId: productId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: {
        margenObjetivo,
        variantes: filas.filter((f) => f.precioNuevo !== f.precioAntes).length,
      },
    });

    this.invalidarProducto(productId);
    return { margenObjetivo, simulado: false, variantes: filas };
  }

  /**
   * Fija a mano el plazo de entrega de un producto.
   *
   * El plazo lo trae la sincronización con el proveedor, pero no siempre viene:
   * AliExpress lo omite en bastantes fichas. Sin él no se puede publicar sin
   * saltarse un aviso, y hasta ahora no había forma de ponerlo desde el panel
   * —el dato vive en el enlace con el proveedor, no en la variante— así que el
   * aviso era irresoluble por diseño.
   *
   * Se aplica a TODOS los enlaces del producto: el plazo es del envío, no de la
   * talla, y en dropshipping todas las variantes salen del mismo sitio.
   */
  async fijarPlazoEntrega(
    productId: string,
    dias: number,
    ctx: { actorId?: string; actorIp?: string },
  ): Promise<{ variantes: number; dias: number }> {
    const producto = await this.prisma.client.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    const { count } = await this.prisma.client.supplierProduct.updateMany({
      where: { productId },
      data: { leadTimeMaxDays: dias },
    });

    if (count === 0) {
      throw new BadRequestException(
        'Este producto no está enlazado con ningún proveedor, así que no tiene plazo de entrega que fijar.',
      );
    }

    await this.audit.registrar({
      action: 'product.lead_time_set',
      resource: 'product',
      resourceId: productId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { leadTimeMaxDays: dias, enlaces: count },
    });

    this.invalidarProducto(productId);
    return { variantes: count, dias };
  }

  /**
   * Comprueba la ficha antes de publicar.
   *
   * No es un portero absoluto: quien lleva la tienda puede decidir publicar con
   * la ficha incompleta —le faltará el catalán, o el peso exacto— y esa
   * decisión es suya. Lo que hace este método es que sea una decisión
   * **consciente y registrada**, no un descuido: hay que pedirlo expresamente,
   * y lo que se salta queda anotado en la auditoría.
   *
   * Dos cosas siguen sin poder saltarse, y no por criterio nuestro: un precio
   * a cero regala el producto, y un descuento sin histórico que lo respalde es
   * una infracción con sanción, no un riesgo asumible.
   *
   * @returns los problemas que se han saltado, para poder registrarlos.
   */
  private async exigirFichaCompleta(
    productId: string,
    dto: ActualizarProductoDto,
  ): Promise<Problema[]> {
    const problemas = await this.revisarFidelidad(productId, dto);

    if (puedePublicarse(problemas)) return [];

    const bloqueos = problemas.filter((p) => p.gravedad === 'BLOQUEA');
    const insalvables = bloqueosInsalvables(problemas);

    if (insalvables.length > 0) {
      throw new BadRequestException({
        message:
          'No se puede publicar, y esto no se puede omitir: ' +
          insalvables.map((p) => p.mensaje).join(' '),
        detalles: insalvables,
      });
    }

    if (!dto.publicarConAvisos) {
      throw new BadRequestException({
        message: `No se puede publicar: ${resumirProblemas(problemas)}`,
        // Va como `detalles` porque es el campo que el filtro de excepciones
        // deja pasar: cualquier otro nombre se perdería por el camino y el
        // panel solo recibiría el texto.
        detalles: bloqueos,
        // Le dice al panel que puede ofrecer «publicar de todas formas»: sin
        // esto tendría que deducirlo de los códigos y acabaría ofreciéndolo
        // también cuando no se puede.
        omitible: true,
      });
    }

    return bloqueos;
  }

  private async exigirSlugsLibres(
    traducciones: { locale: string; slug: string }[],
    excluyendoProductId?: string,
  ): Promise<void> {
    for (const t of traducciones) {
      const existe = await this.prisma.client.productTranslation.findUnique({
        where: { locale_slug: { locale: t.locale, slug: t.slug } },
        select: { productId: true },
      });
      if (existe && existe.productId !== excluyendoProductId) {
        throw new BadRequestException(
          `El slug "${t.slug}" ya está en uso en el idioma ${t.locale}`,
        );
      }
    }
  }
}
