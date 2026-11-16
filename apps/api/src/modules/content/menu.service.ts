import { Injectable, Logger } from '@nestjs/common';
import {
  menuNavegacionSchema,
  menuPorDefecto,
  newId,
  textoDe,
  type EnlaceMenu,
  type EnlaceResuelto,
  type Locale,
  type MenuNavegacion,
} from '@ecom/shared';
import { categoriasConProductoEnLaRama } from '../catalog/ramas.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../cache/cache.service.js';
import { StorefrontCacheService } from '../cache/storefront-cache.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContextoActor } from '../roles/roles.service.js';

/**
 * El menú de la sub-barra, configurable desde el panel.
 *
 * Los enlaces se guardan por **id** de página o de categoría, no por dirección,
 * y aquí se traducen a la ruta del idioma que toque. Es la razón de que esto sea
 * un servicio y no un ajuste que la tienda lea tal cual: el slug de una página
 * es distinto en cada idioma —«/aviso-legal» y «/avis-legal»— y además se puede
 * editar. Guardando la dirección, cambiar un título en el panel rompería el menú
 * sin que nada avisara.
 *
 * Lo que apunta a algo retirado desaparece del menú en lugar de llevar a un 404:
 * una página despublicada o una categoría desactivada dejan de salir solas.
 */

const AJUSTE = { namespace: 'nav', key: 'menu' };

/** Nombre y dirección de una página o categoría en un idioma. */
interface Traduccion {
  locale: string;
  titulo: string;
  slug: string;
}

@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);

  private static readonly ESPACIO = 'menu';
  /** Cinco minutos, como la portada: lo que tarda en verse un cambio. */
  private static readonly TTL = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly storefront: StorefrontCacheService,
    private readonly audit: AuditService,
  ) {}

  // ── Configuración (panel) ─────────────────────────────────

  /**
   * El menú configurado, o el de fábrica si no hay nada guardado.
   *
   * Si lo guardado no valida —un cambio de esquema, una edición a mano en la
   * base de datos— se devuelve el de fábrica y se avisa en el log. Es la misma
   * decisión que en la portada: mejor una navegación genérica que una tienda con
   * la cabecera rota en todas sus páginas.
   */
  async enlaces(): Promise<MenuNavegacion> {
    const ajuste = await this.prisma.client.setting.findUnique({
      where: { namespace_key: AJUSTE },
      select: { value: true },
    });

    if (!ajuste) return menuPorDefecto();

    const validado = menuNavegacionSchema.safeParse(ajuste.value);

    if (!validado.success) {
      this.logger.error(
        `El menú guardado no es válido, se usa el de fábrica: ${validado.error.message}`,
      );
      return menuPorDefecto();
    }

    return validado.data;
  }

  async guardar(enlaces: MenuNavegacion, ctx: ContextoActor): Promise<MenuNavegacion> {
    const antes = await this.enlaces();

    await this.prisma.client.setting.upsert({
      where: { namespace_key: AJUSTE },
      update: { value: enlaces, updatedBy: ctx.actorId ?? null },
      create: {
        id: newId(),
        ...AJUSTE,
        value: enlaces,
        // La tienda no lee el ajuste crudo: pide el menú ya resuelto en su
        // idioma, que además filtra lo que ya no existe.
        isPublic: false,
        updatedBy: ctx.actorId ?? null,
      },
    });

    await this.cache.invalidarEspacio(MenuService.ESPACIO);
    // La tienda cachea el menú en cada página que lo pinta —todas—, así que sin
    // purgar, un cambio del panel tardaría cinco minutos en verse.
    await this.storefront.purgar(['menu']);

    await this.audit.registrar({
      action: 'nav.menu.update',
      resource: 'setting',
      resourceId: `${AJUSTE.namespace}.${AJUSTE.key}`,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { enlaces: antes.map((e) => `${e.tipo}:${e.destino}`) },
      after: { enlaces: enlaces.map((e) => `${e.tipo}:${e.destino}`) },
    });

    return enlaces;
  }

  // ── Menú resuelto (tienda) ────────────────────────────────

  async menu(locale: Locale): Promise<{ enlaces: EnlaceResuelto[] }> {
    return this.cache.recordar(MenuService.ESPACIO, locale, MenuService.TTL, async () => {
      const configurados = (await this.enlaces()).filter((e) => e.visible);

      const [paginas, categorias] = await Promise.all([
        this.paginasDe(configurados),
        this.categoriasDe(configurados),
      ]);

      const enlaces = configurados
        .map((enlace) => this.resolver(enlace, locale, paginas, categorias))
        .filter((e): e is EnlaceResuelto => e !== null);

      return { enlaces };
    });
  }

  /**
   * Las páginas del menú, en una sola consulta.
   *
   * Solo publicadas y sin borrar: un enlace a una página que se ha despublicado
   * tiene que desaparecer del menú, no llevar a un 404 desde todas las páginas
   * de la tienda.
   */
  private async paginasDe(enlaces: EnlaceMenu[]) {
    const ids = enlaces.filter((e) => e.tipo === 'pagina').map((e) => e.destino);
    if (ids.length === 0) return new Map<string, Traduccion[]>();

    const paginas = await this.prisma.client.page.findMany({
      where: { id: { in: ids }, status: 'PUBLISHED', deletedAt: null },
      select: { id: true, translations: { select: { locale: true, title: true, slug: true } } },
    });

    return new Map(
      paginas.map((p) => [
        p.id,
        p.translations.map((t) => ({ locale: t.locale, titulo: t.title, slug: t.slug })),
      ]),
    );
  }

  /**
   * Las categorías del menú, en una sola consulta.
   *
   * Se admiten las marcadas como +18 porque aquí las elige una persona a dedo,
   * no una consulta automática: en una tienda para adultos, esconder su catálogo
   * de la navegación no protege a nadie. Lo que sigue protegido es el contenido,
   * que se sirve con la verificación de edad de siempre.
   */
  private async categoriasDe(enlaces: EnlaceMenu[]) {
    const ids = enlaces.filter((e) => e.tipo === 'categoria').map((e) => e.destino);
    if (ids.length === 0) return new Map<string, Traduccion[]>();

    const categorias = await this.prisma.client.category.findMany({
      where: { id: { in: ids }, isActive: true, deletedAt: null },
      select: {
        id: true,
        path: true,
        translations: { select: { locale: true, name: true, slug: true } },
      },
    });
    if (categorias.length === 0) return new Map<string, Traduccion[]>();

    /*
     * Las vacías no salen.
     *
     * Una categoría vacía en el menú es un callejón sin salida: se pulsa, sale
     * «no hay productos» y la siguiente vez ya no se pulsa ninguna. Y vaciarse
     * es lo normal, no la excepción: el árbol del proveedor se crea entero de
     * una vez —311 ramas en el de Dreamlove— mucho antes de que haya un
     * producto publicado en cada una.
     */
    const conProductos = categoriasConProductoEnLaRama(
      categorias,
      await this.rutasConProductoPropio(),
    );

    return new Map(
      categorias
        .filter((c) => conProductos.has(c.id))
        .map((c) => [
          c.id,
          c.translations.map((t) => ({ locale: t.locale, titulo: t.name, slug: t.slug })),
        ]),
    );
  }

  /** Rutas de las categorías con algún producto suyo a la venta. */
  private async rutasConProductoPropio(): Promise<string[]> {
    const categorias = await this.prisma.client.category.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        products: { some: { status: 'ACTIVE', deletedAt: null } },
      },
      select: { path: true },
    });

    return categorias.map((c) => c.path);
  }

  /** La traducción del idioma pedido, con respaldo al español y a lo que haya. */
  private traduccion(traducciones: Traduccion[] | undefined, locale: Locale) {
    if (!traducciones || traducciones.length === 0) return null;
    return (
      traducciones.find((t) => t.locale === locale) ??
      traducciones.find((t) => t.locale === 'es') ??
      traducciones[0] ??
      null
    );
  }

  private resolver(
    enlace: EnlaceMenu,
    locale: Locale,
    paginas: Map<string, Traduccion[]>,
    categorias: Map<string, Traduccion[]>,
  ): EnlaceResuelto | null {
    const propia = textoDe(enlace.etiqueta, locale).trim();
    const comun = { id: enlace.id, destacado: enlace.destacado };

    switch (enlace.tipo) {
      case 'pagina': {
        const t = this.traduccion(paginas.get(enlace.destino), locale);
        if (!t) return null;
        return { ...comun, etiqueta: propia || t.titulo, href: `/${t.slug}`, externo: false };
      }

      case 'categoria': {
        const t = this.traduccion(categorias.get(enlace.destino), locale);
        if (!t) return null;
        // La tienda no tiene página propia de categoría: se listan filtrando el
        // catálogo, que es a donde llevan también los bloques de la portada.
        return {
          ...comun,
          etiqueta: propia || t.titulo,
          href: `/buscar?categoria=${encodeURIComponent(t.slug)}`,
          externo: false,
        };
      }

      case 'url': {
        const externo = /^https?:\/\//i.test(enlace.destino);
        // Sin etiqueta no se pinta: el esquema ya lo exige para este tipo, y si
        // algo se colara no vale enseñar un enlace en blanco.
        if (!propia) return null;
        return { ...comun, etiqueta: propia, href: enlace.destino, externo };
      }
    }
  }
}
