import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { newId, type Locale } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../cache/cache.service.js';
import { StorefrontCacheService } from '../cache/storefront-cache.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContextoActor } from '../roles/roles.service.js';

/**
 * Páginas de contenido.
 *
 * Las legales obligatorias en España se marcan como del sistema y no se pueden
 * eliminar: una tienda sin aviso legal, privacidad y condiciones de venta
 * accesibles incumple la LSSI y el RGPD, y es de lo primero que mira una
 * inspección.
 */
@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly storefront: StorefrontCacheService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Descarta lo cacheado de una página en la tienda y en el menú.
   *
   * La tienda sirve las páginas con ISR de una hora: sin esto, corregir un dato
   * fiscal del aviso legal se vería cuando le tocara, no al guardar. Y el menú
   * se resuelve contra el título y el slug de la página, así que renombrarla o
   * despublicarla también lo cambia —y ese va cacheado aparte, en Redis—.
   */
  private async purgar(slugs: string[]): Promise<void> {
    await this.cache.invalidarEspacio('menu');
    await this.storefront.purgar(['contenido', 'menu', ...slugs.map((s) => `pagina-${s}`)]);
  }

  /** Página publicada, por su slug traducido. */
  async porSlug(locale: Locale, slug: string) {
    const traduccion = await this.prisma.client.pageTranslation.findUnique({
      where: { locale_slug: { locale, slug } },
      include: { page: true },
    });

    if (!traduccion || traduccion.page.status !== 'PUBLISHED' || traduccion.page.deletedAt) {
      throw new NotFoundException('Página no encontrada');
    }

    return {
      slug: traduccion.slug,
      title: traduccion.title,
      content: traduccion.content,
      metaTitle: traduccion.metaTitle,
      metaDescription: traduccion.metaDescription,
      updatedAt: traduccion.page.updatedAt,
    };
  }

  /** Páginas publicadas, para el menú del pie. */
  async publicas(locale: Locale) {
    const paginas = await this.prisma.client.page.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      orderBy: { position: 'asc' },
      include: { translations: { where: { locale } } },
    });

    return paginas
      .filter((p) => p.translations.length > 0)
      .map((p) => ({
        handle: p.handle,
        slug: p.translations[0]?.slug ?? p.handle,
        title: p.translations[0]?.title ?? p.handle,
      }));
  }

  async listar() {
    const paginas = await this.prisma.client.page.findMany({
      where: { deletedAt: null },
      orderBy: [{ isSystem: 'desc' }, { position: 'asc' }],
      include: { translations: true },
    });

    return paginas.map((p) => ({
      id: p.id,
      handle: p.handle,
      status: p.status,
      isSystem: p.isSystem,
      // Qué idiomas tienen contenido y cuáles faltan: sin esto, una página
      // puede quedarse sin traducir sin que nadie se entere.
      idiomas: p.translations.map((t) => t.locale),
      /*
       * El título en cada idioma.
       *
       * Lo pide el editor del menú, que tiene que ofrecer las páginas por su
       * nombre: en una lista de `handle`s —«aviso-legal», «envios»— hay que
       * adivinar cuál es cuál, y las traducciones ya están cargadas aquí.
       */
      titulos: Object.fromEntries(p.translations.map((t) => [t.locale, t.title])),
      faltan: ['es', 'ca', 'en'].filter((l) => !p.translations.some((t) => t.locale === l)),
      updatedAt: p.updatedAt,
    }));
  }

  async detalle(pageId: string) {
    const pagina = await this.prisma.client.page.findUnique({
      where: { id: pageId },
      include: { translations: true },
    });
    if (!pagina || pagina.deletedAt) throw new NotFoundException('Página no encontrada');
    return pagina;
  }

  async guardar(
    datos: {
      id?: string;
      handle: string;
      status?: 'DRAFT' | 'PUBLISHED';
      translations: {
        locale: Locale;
        title: string;
        slug: string;
        content: string;
        metaTitle?: string;
        metaDescription?: string;
      }[];
    },
    ctx: ContextoActor,
  ) {
    // Publicar sin contenido dejaría una página en blanco accesible desde el
    // pie: peor que no tenerla, porque parece que la tienda está rota.
    if (datos.status === 'PUBLISHED') {
      const vacias = datos.translations.filter((t) => t.content.trim().length < 20);
      if (vacias.length > 0) {
        throw new BadRequestException(
          `No se puede publicar con contenido vacío en: ${vacias.map((v) => v.locale).join(', ')}`,
        );
      }
    }

    const pageId = datos.id ?? newId();
    const existe = datos.id
      ? await this.prisma.client.page.findUnique({
          where: { id: datos.id },
          include: { translations: { select: { slug: true } } },
        })
      : null;

    if (existe) {
      await this.prisma.client.page.update({
        where: { id: pageId },
        data: {
          status: datos.status ?? existe.status,
          ...(datos.status === 'PUBLISHED' && !existe.publishedAt
            ? { publishedAt: new Date() }
            : {}),
        },
      });
    } else {
      await this.prisma.client.page.create({
        data: {
          id: pageId,
          handle: datos.handle,
          status: datos.status ?? 'DRAFT',
          ...(datos.status === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
        },
      });
    }

    for (const t of datos.translations) {
      await this.prisma.client.pageTranslation.upsert({
        where: { pageId_locale: { pageId, locale: t.locale } },
        update: {
          title: t.title,
          slug: t.slug,
          content: t.content,
          metaTitle: t.metaTitle ?? null,
          metaDescription: t.metaDescription ?? null,
        },
        create: {
          id: newId(),
          pageId,
          locale: t.locale,
          title: t.title,
          slug: t.slug,
          content: t.content,
          metaTitle: t.metaTitle ?? null,
          metaDescription: t.metaDescription ?? null,
        },
      });
    }

    // También los slugs de antes: al renombrar «/privacidad» a «/privacidad-2024»
    // la dirección vieja se queda cacheada en la tienda sirviendo el texto
    // anterior, que es justo el que se quería corregir.
    await this.purgar([
      ...new Set([
        ...(existe?.translations ?? []).map((t) => t.slug),
        ...datos.translations.map((t) => t.slug),
      ]),
    ]);

    await this.audit.registrar({
      action: existe ? 'page.update' : 'page.create',
      resource: 'page',
      resourceId: pageId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: {
        handle: datos.handle,
        status: datos.status,
        idiomas: datos.translations.map((t) => t.locale),
      },
    });

    return this.detalle(pageId);
  }

  async eliminar(pageId: string, ctx: ContextoActor): Promise<void> {
    const pagina = await this.detalle(pageId);

    if (pagina.isSystem) {
      throw new BadRequestException(
        'Esta página es obligatoria por ley y no se puede eliminar. Edítala en lugar de borrarla.',
      );
    }

    await this.prisma.client.page.update({
      where: { id: pageId },
      data: { deletedAt: new Date(), status: 'DRAFT' },
    });

    await this.purgar(pagina.translations.map((t) => t.slug));

    await this.audit.registrar({
      action: 'page.delete',
      resource: 'page',
      resourceId: pageId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { handle: pagina.handle },
    });
  }
}
