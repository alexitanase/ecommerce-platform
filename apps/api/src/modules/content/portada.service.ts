import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@ecom/db';
import {
  bloquesPorDefecto,
  bloquesPortadaSchema,
  newId,
  textoDe,
  type BloquePortada,
  type Locale,
} from '@ecom/shared';
import { traduccionPreferida } from '../../common/contenido/traduccion.js';
import { categoriasConProductoEnLaRama } from '../catalog/ramas.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../cache/cache.service.js';
import { AuditService } from '../audit/audit.service.js';
import { agotadosAlFinal, hayStock } from '../../common/catalogo/orden-por-stock.js';
import type { ContextoActor } from '../roles/roles.service.js';

/**
 * Portada configurable por bloques.
 *
 * La portada es la página más visitada y la que más cambia: campañas, novedades
 * de temporada, un banner de rebajas que dura una semana. Si cada cambio exige
 * tocar código y desplegar, no se hace, y la portada se queda con el mismo hero
 * todo el año.
 *
 * Los productos de cada bloque se resuelven aquí, en el servidor, y no en la
 * tienda: así la portada es **una** petición en vez de una por bloque, y se
 * cachea entera.
 *
 * Los listados salen de la base de datos y no del buscador a propósito. Con
 * Meilisearch caído, una portada vacía parece una tienda cerrada; con esto,
 * sigue vendiendo aunque el buscador esté de baja.
 */

/** Producto tal y como lo pinta la tarjeta de la tienda. */
export interface ProductoResumen {
  id: string;
  name: string;
  slug: string;
  imagen: string | null;
  priceCents: number;
  compareAtCents: number | null;
  disponible: boolean;
  valoracion: number;
  numeroResenas: number;
}

export interface CategoriaResumen {
  id: string;
  name: string;
  slug: string;
  imagen: string | null;
}

const AJUSTE = { namespace: 'home', key: 'blocks' };

/**
 * Qué cuenta como «se puede comprar» dentro de una consulta a la base.
 *
 * Es la misma regla que `hayStock`, escrita como filtro de Prisma porque aquí
 * hay que aplicarla ANTES de traer las filas: en un catálogo de miles de
 * productos, traerlos todos para quedarse con ocho no es una opción.
 */
const VARIANTE_VENDIBLE: Prisma.ProductVariantWhereInput = {
  deletedAt: null,
  OR: [{ stock: { gt: 0 } }, { allowBackorder: true }],
};

@Injectable()
export class PortadaService {
  private readonly logger = new Logger(PortadaService.name);

  private static readonly ESPACIO = 'portada';
  /** Cinco minutos: lo que tarda en verse un cambio del admin en la tienda. */
  private static readonly TTL = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
  ) {}

  // ── Configuración (admin) ─────────────────────────────────

  /**
   * Bloques configurados, o los de fábrica si no hay nada guardado.
   *
   * Si lo guardado no valida —un despliegue que cambió el esquema, una edición
   * a mano en la base de datos— se devuelven los de fábrica y se avisa en el
   * log, en vez de dejar la portada rota: es preferible una portada genérica a
   * un error 500 en la página de entrada de la tienda.
   */
  async bloques(): Promise<BloquePortada[]> {
    const ajuste = await this.prisma.client.setting.findUnique({
      where: { namespace_key: AJUSTE },
      select: { value: true },
    });

    if (!ajuste) return bloquesPorDefecto();

    const validados = bloquesPortadaSchema.safeParse(ajuste.value);

    if (!validados.success) {
      this.logger.error(
        `Los bloques de la portada guardados no son válidos, se usan los de fábrica: ${validados.error.message}`,
      );
      return bloquesPorDefecto();
    }

    return validados.data;
  }

  async guardar(bloques: BloquePortada[], ctx: ContextoActor): Promise<BloquePortada[]> {
    const antes = await this.bloques();

    await this.prisma.client.setting.upsert({
      where: { namespace_key: AJUSTE },
      update: { value: bloques, updatedBy: ctx.actorId ?? null },
      create: {
        id: newId(),
        ...AJUSTE,
        value: bloques,
        // La tienda no lee el ajuste directamente: pide la portada ya resuelta,
        // que además filtra los productos +18.
        isPublic: false,
        updatedBy: ctx.actorId ?? null,
      },
    });

    await this.cache.invalidarEspacio(PortadaService.ESPACIO);

    await this.audit.registrar({
      action: 'home.blocks.update',
      resource: 'setting',
      resourceId: `${AJUSTE.namespace}.${AJUSTE.key}`,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { bloques: antes.map((b) => `${b.tipo}:${b.id}`) },
      after: { bloques: bloques.map((b) => `${b.tipo}:${b.id}`) },
    });

    return bloques;
  }

  // ── Portada resuelta (tienda) ─────────────────────────────

  /**
   * La portada lista para pintar, en un idioma.
   *
   * Nunca incluye productos +18, ni siquiera para quien ya ha verificado su
   * edad: la portada es la primera pantalla de la tienda, se sirve cacheada e
   * igual para todos, y enseñar ahí ese catálogo es justo lo que la
   * verificación de edad existe para impedir. Se llega a él por su categoría.
   */
  /**
   * La portada de un idioma.
   *
   * `incluirAdulto` va en la CLAVE de caché, no solo en la consulta. Sin eso,
   * la primera visita decide lo que ven las siguientes cinco minutos: o se le
   * sirve catálogo restringido a quien no ha verificado su edad, o se le
   * esconde a quien sí. Son dos portadas distintas y se guardan como tales.
   */
  async portada(locale: Locale, incluirAdulto = false) {
    const clave = `${locale}:${incluirAdulto ? 'adulto' : 'apto'}`;

    return this.cache.recordar(PortadaService.ESPACIO, clave, PortadaService.TTL, async () => {
      const bloques = (await this.bloques()).filter((b) => b.visible);
      const resueltos = [];

      for (const bloque of bloques) {
        resueltos.push(await this.resolver(bloque, locale, incluirAdulto));
      }

      return { bloques: resueltos };
    });
  }

  private async resolver(bloque: BloquePortada, locale: Locale, incluirAdulto = false) {
    const t = (v: Parameters<typeof textoDe>[0]) => textoDe(v, locale);

    switch (bloque.tipo) {
      case 'hero':
        return {
          id: bloque.id,
          tipo: bloque.tipo,
          titulo: t(bloque.titulo),
          subtitulo: t(bloque.subtitulo),
          textoBoton: t(bloque.textoBoton),
          enlaceBoton: bloque.enlaceBoton ?? null,
          imagen: bloque.imagen ?? null,
          oscurecer: bloque.oscurecer,
        };

      case 'banner':
        return {
          id: bloque.id,
          tipo: bloque.tipo,
          titulo: t(bloque.titulo),
          texto: t(bloque.texto),
          textoBoton: t(bloque.textoBoton),
          enlaceBoton: bloque.enlaceBoton ?? null,
          imagen: bloque.imagen ?? null,
        };

      case 'destacados':
        return {
          id: bloque.id,
          tipo: bloque.tipo,
          titulo: t(bloque.titulo),
          productos: await this.productos(bloque, locale, incluirAdulto),
        };

      case 'colecciones':
        return {
          id: bloque.id,
          tipo: bloque.tipo,
          titulo: t(bloque.titulo),
          categorias: await this.categorias(bloque.categoryIds, locale),
        };

      case 'ventajas':
        return {
          id: bloque.id,
          tipo: bloque.tipo,
          ventajas: bloque.ventajas.map((v) => ({ titulo: t(v.titulo), texto: t(v.texto) })),
        };

      case 'testimonios':
        return {
          id: bloque.id,
          tipo: bloque.tipo,
          titulo: t(bloque.titulo),
          testimonios: bloque.testimonios.map((x) => ({ texto: t(x.texto), autor: x.autor })),
        };
    }
  }

  /**
   * Categorías destacadas; sin lista, las de primer nivel.
   *
   * **Las que no tienen nada dentro no salen.** Es la misma regla que ya sigue
   * el menú de navegación, y por el mismo motivo: una categoría vacía en la
   * portada es un callejón sin salida —se pulsa, sale «no hay productos» y la
   * siguiente vez ya no se pulsa ninguna—. Y vaciarse es lo normal, no la
   * excepción: el árbol del proveedor se crea entero de una vez (311 ramas en
   * el de Dreamlove) mucho antes de que haya un producto publicado en cada una.
   *
   * Se mira la RAMA, no la categoría: los productos cuelgan de las hojas, así
   * que una raíz con tres subcategorías llenas no tiene ninguno propio y se
   * ocultaría sola.
   */
  private async categorias(ids: string[], locale: Locale): Promise<CategoriaResumen[]> {
    /*
     * Tenga algo dentro, la haya elegido quien la haya elegido.
     *
     * Antes esto solo se aplicaba a la selección automática: si alguien escogía
     * las categorías a mano desde el panel, se respetaba su lista tal cual. El
     * razonamiento era «si la ha elegido a propósito, será por algo». En
     * producción salió al revés: la portada enlazaba nueve categorías y CINCO
     * estaban vacías —las del catálogo inicial, que se quedaron sin nada cuando
     * se importó el de Dreamlove bajo otras ramas—. El cliente pulsaba
     * «Vibradores» y llegaba a un listado sin un solo producto.
     *
     * Es la misma regla que el menú de navegación ya aplicaba sin excepciones,
     * y la incoherencia entre los dos es justo lo que produjo el fallo.
     */
    const conProductos = await this.categoriasConProductosEnLaRama();

    /*
     * Se traen TODAS y se recortan después, no al revés.
     *
     * Antes la consulta pedía 60 y de esas se filtraban las que tenían algo
     * dentro. Con 318 categorías importadas, casi todas ordenadas con la misma
     * posición, esas 60 eran las que quisiera devolver Postgres: las raíces con
     * producto se quedaban fuera de la ventana y la portada acababa enseñando
     * cuatro hojas sueltas —o ninguna— en vez de las secciones grandes. El tope
     * tiene que ir DESPUÉS del filtro, o no es un tope, es una lotería.
     *
     * Traerlas todas no es caro: son unos cientos de filas con su traducción, y
     * el bloque entero se sirve desde la caché de la portada.
     *
     * Sin lista, solo las de primer nivel. Es lo que dice «Explora por
     * categoría»: mezclar «Moda» con «Calzado», que está dentro, enseña dos
     * puertas a lo mismo y deja fuera otra sección entera.
     */
    const categorias = (
      await this.prisma.client.category.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          ...(ids.length > 0 ? { id: { in: ids } } : { parentId: null }),
        },
        // Todas las traducciones, no solo la del idioma pedido: una categoría
        // sin traducir salía con su `handle` por nombre y por enlace.
        include: { translations: true },
        orderBy: { position: 'asc' },
      })
    )
      .filter((c) => conProductos.has(c.id))
      .slice(0, 12);

    const resumen = categorias.flatMap((c) => {
      const t = traduccionPreferida(c.translations, locale);
      // Sin nombre en ningún idioma no hay nada que enseñar ni a dónde
      // enlazar. Es una categoría a medio crear.
      if (!t) return [];

      return {
        id: c.id,
        name: t.name,
        slug: t.slug,
        // La que suba el panel manda; si no hay, la que se calcula sola a partir
        // de un producto de la rama. Sin la segunda, este bloque salía con doce
        // rectángulos grises: nadie va a subir una foto por cada categoría.
        imagen: c.imageUrl ?? c.coverUrl,
      };
    });

    // Con lista explícita se respeta el orden que puso el admin: `in` devuelve
    // lo que quiere la base de datos, no lo que se pidió.
    if (ids.length === 0) return resumen;
    return ids.map((id) => resumen.find((c) => c.id === id)).filter((c) => c !== undefined);
  }

  /**
   * Las categorías que tienen algo dentro, ellas o cualquiera de sus hijas.
   *
   * Se mira la RAMA y no los productos propios, y esa es toda la gracia: los
   * productos cuelgan de la hoja más concreta, así que «Juguetes Sexuales XXX»
   * tiene 4.065 artículos por debajo y CERO suyos. Filtrando por producto
   * directo se esconderían justo las categorías grandes —las que interesa
   * enseñar— y quedarían las hojas sueltas.
   *
   * Dos consultas y ninguna recursión: se piden las rutas de las categorías con
   * producto publicado y se comprueba cuáles son prefijo de alguna. Es lo que
   * permite la ruta materializada, y evita tanto el `count` por categoría como
   * traerse el árbol entero para sumarlo en memoria.
   */
  private async categoriasConProductosEnLaRama(): Promise<Set<string>> {
    const [todas, conProducto] = await Promise.all([
      this.prisma.client.category.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, path: true },
      }),
      this.prisma.client.category.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          products: { some: { status: 'ACTIVE', deletedAt: null } },
        },
        select: { path: true },
      }),
    ]);

    return categoriasConProductoEnLaRama(
      todas,
      conProducto.map((c) => c.path),
    );
  }

  private async productos(
    bloque: Extract<BloquePortada, { tipo: 'destacados' }>,
    locale: Locale,
    incluirAdulto = false,
  ): Promise<ProductoResumen[]> {
    // El catálogo +18 solo entra si quien mira ha declarado su edad. Estaba
    // fijo a `false`, así que no aparecía nunca: con una tienda cuyo catálogo
    // entero es restringido, eso dejaba la portada vacía para todo el mundo.
    const base = {
      status: 'ACTIVE' as const,
      deletedAt: null,
      ...(incluirAdulto ? {} : { isAdult: false }),
    };

    const seleccion = {
      id: true,
      handle: true,
      // Las tres traducciones, no solo la del idioma pedido: un catálogo
      // importado no viene traducido, y hasta ahora el producto sin traducir se
      // enseñaba con su identificador interno por nombre y por enlace.
      translations: { select: { locale: true, name: true, slug: true } },
      media: { orderBy: { position: 'asc' as const }, take: 1, select: { url: true } },
      variants: {
        where: { deletedAt: null },
        orderBy: [{ isDefault: 'desc' as const }, { position: 'asc' as const }],
        select: { priceCents: true, compareAtCents: true, stock: true, allowBackorder: true },
      },
    };

    if (bloque.origen === 'manual') {
      if (bloque.productIds.length === 0) return [];

      const productos = await this.prisma.client.product.findMany({
        where: { ...base, id: { in: bloque.productIds } },
        select: seleccion,
      });

      // En el orden que los colocó el admin, que para eso los eligió a mano,
      // pero con lo agotado al final: un escaparate hecho a mano en el que la
      // primera tarjeta no se puede comprar es peor que uno con un hueco menos.
      const porId = new Map(productos.map((p) => [p.id, p]));
      return this.conValoracion(
        agotadosAlFinal(
          bloque.productIds.map((id) => porId.get(id)).filter((p) => p !== undefined),
          (p) => hayStock(p.variants),
        ),
        locale,
      );
    }

    if (bloque.origen === 'valoracion') {
      // Se ordena por nota media de las reseñas publicadas, así que primero
      // hay que saber cuál es: no está desnormalizada en el producto.
      const medias = await this.prisma.client.review.groupBy({
        by: ['productId'],
        where: { status: 'APPROVED' },
        _avg: { rating: true },
        _count: { rating: true },
        orderBy: { _avg: { rating: 'desc' } },
        take: bloque.limite * 3,
      });

      const productos = await this.prisma.client.product.findMany({
        where: { ...base, id: { in: medias.map((m) => m.productId) } },
        select: seleccion,
      });

      const orden = new Map(medias.map((m, i) => [m.productId, i]));
      const ordenados = productos.sort((a, b) => (orden.get(a.id) ?? 0) - (orden.get(b.id) ?? 0));

      /*
       * Se ordena por disponibilidad ANTES de recortar al límite.
       *
       * Al revés —recortar y después reordenar— el bloque se queda con los
       * ocho mejor valorados aunque estén todos agotados, y lo único que se
       * consigue es barajarlos entre sí. Se pide el triple de candidatos justo
       * para esto.
       */
      return this.conValoracion(
        agotadosAlFinal(ordenados, (p) => hayStock(p.variants)).slice(0, bloque.limite),
        locale,
      );
    }

    const deLaCategoria =
      bloque.origen === 'categoria' && bloque.categoryId ? { categoryId: bloque.categoryId } : {};

    /*
     * Dos consultas: primero lo que se puede comprar, y solo si sobran huecos
     * se completa con lo agotado.
     *
     * Es lo que hace que un bloque de novedades no se llene de productos que
     * el proveedor ha dejado sin stock esta semana —que son, precisamente, los
     * últimos publicados—. Ordenar después no valdría: lo disponible ni
     * siquiera habría entrado en la consulta.
     */
    const disponibles = await this.prisma.client.product.findMany({
      where: { ...base, ...deLaCategoria, variants: { some: VARIANTE_VENDIBLE } },
      select: seleccion,
      orderBy: { publishedAt: 'desc' },
      take: bloque.limite,
    });

    if (disponibles.length >= bloque.limite) return this.conValoracion(disponibles, locale);

    const agotados = await this.prisma.client.product.findMany({
      where: { ...base, ...deLaCategoria, NOT: { variants: { some: VARIANTE_VENDIBLE } } },
      select: seleccion,
      orderBy: { publishedAt: 'desc' },
      take: bloque.limite - disponibles.length,
    });

    return this.conValoracion([...disponibles, ...agotados], locale);
  }

  /** Añade la nota media y el número de reseñas publicadas. */
  private async conValoracion(
    productos: {
      id: string;
      handle: string;
      translations: { locale: string; name: string; slug: string }[];
      media: { url: string }[];
      variants: {
        priceCents: number;
        compareAtCents: number | null;
        stock: number;
        allowBackorder: boolean;
      }[];
    }[],
    locale: Locale,
  ): Promise<ProductoResumen[]> {
    if (productos.length === 0) return [];

    const valoraciones = await this.prisma.client.review.groupBy({
      by: ['productId'],
      where: { status: 'APPROVED', productId: { in: productos.map((p) => p.id) } },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const porProducto = new Map(valoraciones.map((v) => [v.productId, v]));

    /*
     * Un producto sin NINGUNA traducción no se enseña.
     *
     * No tiene nombre que poner en la tarjeta ni slug al que enlazar, así que
     * lo único que se puede hacer con él es lo que se hacía: pintar su
     * identificador interno y mandar al cliente a un 404. Es un producto a
     * medio importar, y el sitio de eso es el panel, no la portada.
     */
    return productos.flatMap((p) => {
      const variante = p.variants[0];
      const valoracion = porProducto.get(p.id);
      const t = traduccionPreferida(p.translations, locale);

      if (!t) {
        this.logger.warn(
          `El producto ${p.handle} no tiene ninguna traducción: se deja fuera de la portada.`,
        );
        return [];
      }

      return {
        id: p.id,
        name: t.name,
        slug: t.slug,
        imagen: p.media[0]?.url ?? null,
        priceCents: variante?.priceCents ?? 0,
        compareAtCents: variante?.compareAtCents ?? null,
        disponible: p.variants.some((v) => v.stock > 0 || v.allowBackorder),
        // Con un decimal: media de 4,25 se enseña como 4,3 estrellas y no como
        // un número con seis decimales debajo de la tarjeta.
        valoracion: Math.round((valoracion?._avg.rating ?? 0) * 10) / 10,
        numeroResenas: valoracion?._count.rating ?? 0,
      };
    });
  }
}
