import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { newId, type Locale } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { agotadosAlFinal, hayStock } from '../../common/catalogo/orden-por-stock.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { minutosDeLectura, resumen, tituloSeo } from './articulos.js';

/**
 * Blog y centro de contenidos.
 *
 * Para una tienda con catálogo +18 esto es el canal de captación principal, no
 * un extra: Google Ads y Meta Ads bloquean estos productos, así que la única
 * vía de tráfico pagado queda cerrada y el orgánico pasa a sostenerlo todo.
 *
 * De ahí dos decisiones que se ven en el código:
 *
 *  · Cada artículo puede **enlazar productos**. Una guía que no lleva a
 *    ninguna ficha atrae visitas y no vende nada, que es el error clásico al
 *    montar un blog de tienda.
 *  · Un artículo despublicado responde 404 y no 200 con el contenido oculto:
 *    lo primero lo entiende Google y lo saca del índice.
 */
@Injectable()
export class BlogService {
  private readonly logger = new Logger(BlogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Listado público de artículos.
   *
   * Por la réplica de lectura: lo abre gente que no ha escrito nada, así que
   * un segundo de retraso da igual y el volumen sí importa.
   */
  async listar(locale: Locale, opciones: { categoria?: string; limite?: number } = {}) {
    const posts = await this.prisma.lectura.post.findMany({
      where: {
        status: 'PUBLISHED',
        deletedAt: null,
        // Publicado con fecha futura = programado: todavía no se enseña.
        publishedAt: { lte: new Date() },
        ...(opciones.categoria
          ? { category: { translations: { some: { locale, slug: opciones.categoria } } } }
          : {}),
        // Sin traducción a este idioma no hay nada que enseñar. Mejor que no
        // aparezca a que aparezca en otro idioma sin avisar.
        translations: { some: { locale } },
      },
      include: {
        translations: { where: { locale } },
        category: { include: { translations: { where: { locale } } } },
      },
      orderBy: { publishedAt: 'desc' },
      take: Math.min(opciones.limite ?? 20, 50),
    });

    return posts.map((p) => {
      const t = p.translations[0];
      return {
        handle: p.handle,
        slug: t?.slug ?? p.handle,
        titulo: t?.title ?? p.handle,
        resumen: resumen(t?.content ?? '', t?.excerpt),
        portada: p.coverUrl,
        publicadoEl: p.publishedAt,
        minutosDeLectura: minutosDeLectura(t?.content ?? ''),
        categoria: p.category
          ? {
              slug: p.category.translations[0]?.slug ?? p.category.handle,
              nombre: p.category.translations[0]?.name ?? p.category.handle,
            }
          : null,
      };
    });
  }

  /** Un artículo por su slug, con los productos que menciona. */
  async porSlug(slug: string, locale: Locale) {
    const traduccion = await this.prisma.lectura.postTranslation.findUnique({
      where: { locale_slug: { locale, slug } },
      include: {
        post: {
          include: {
            category: { include: { translations: { where: { locale } } } },
            author: { select: { firstName: true, lastName: true } },
            productos: {
              orderBy: { position: 'asc' },
              include: {
                product: {
                  include: {
                    translations: { where: { locale } },
                    media: { where: { deletedAt: null }, orderBy: { position: 'asc' }, take: 1 },
                    /*
                     * Todas las variantes, no solo la más barata.
                     *
                     * Con `take: 1` se sabía desde cuánto cuesta, pero no si
                     * queda alguna a la venta: un artículo que recomienda ocho
                     * productos enlazaba igual a los agotados, y el lector se
                     * encontraba la ficha con el botón apagado.
                     */
                    variants: {
                      where: { deletedAt: null, isActive: true },
                      orderBy: { priceCents: 'asc' },
                      select: { priceCents: true, stock: true, allowBackorder: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const post = traduccion?.post;

    // 404 y no 200 con el contenido escondido: es lo que hace que Google lo
    // saque del índice en lugar de seguir mostrándolo en los resultados.
    if (!post || post.deletedAt || post.status !== 'PUBLISHED') {
      throw new NotFoundException('Artículo no encontrado');
    }

    if (post.publishedAt && post.publishedAt > new Date()) {
      throw new NotFoundException('Artículo no encontrado');
    }

    return {
      handle: post.handle,
      slug: traduccion.slug,
      titulo: traduccion.title,
      contenido: traduccion.content,
      resumen: resumen(traduccion.content, traduccion.excerpt),
      portada: post.coverUrl,
      publicadoEl: post.publishedAt,
      actualizadoEl: post.updatedContentAt,
      minutosDeLectura: minutosDeLectura(traduccion.content),
      autor: post.author
        ? [post.author.firstName, post.author.lastName].filter(Boolean).join(' ')
        : null,
      seo: {
        titulo: tituloSeo(traduccion.title, traduccion.metaTitle),
        descripcion: traduccion.metaDescription ?? resumen(traduccion.content, traduccion.excerpt),
      },
      categoria: post.category
        ? {
            slug: post.category.translations[0]?.slug ?? post.category.handle,
            nombre: post.category.translations[0]?.name ?? post.category.handle,
          }
        : null,
      // Lo que convierte el contenido en ventas. Con lo comprable delante:
      // dentro del artículo el orden lo puso quien lo escribió, pero de nada
      // sirve encabezar la lista con algo que no se puede servir.
      productos: agotadosAlFinal(
        post.productos
          .filter((pp) => pp.product.status === 'ACTIVE' && !pp.product.deletedAt)
          .map((pp) => ({
            id: pp.product.id,
            slug: pp.product.translations[0]?.slug ?? pp.product.handle,
            nombre: pp.product.translations[0]?.name ?? pp.product.handle,
            imagen: pp.product.media[0]?.url ?? null,
            desdeCents: pp.product.variants[0]?.priceCents ?? null,
            disponible: hayStock(pp.product.variants),
          })),
        (p) => p.disponible,
      ),
    };
  }

  /** Categorías con artículos publicados, para el menú del blog. */
  async categorias(locale: Locale) {
    const categorias = await this.prisma.lectura.postCategory.findMany({
      where: { posts: { some: { status: 'PUBLISHED', deletedAt: null } } },
      include: {
        translations: { where: { locale } },
        _count: { select: { posts: { where: { status: 'PUBLISHED', deletedAt: null } } } },
      },
      orderBy: { position: 'asc' },
    });

    return categorias.map((c) => ({
      slug: c.translations[0]?.slug ?? c.handle,
      nombre: c.translations[0]?.name ?? c.handle,
      articulos: c._count.posts,
    }));
  }

  // ── Administración ────────────────────────────────────────

  async listarAdmin() {
    const posts = await this.prisma.client.post.findMany({
      where: { deletedAt: null },
      include: { translations: true, category: { include: { translations: true } } },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });

    return posts.map((p) => ({
      id: p.id,
      handle: p.handle,
      status: p.status,
      portada: p.coverUrl,
      publicadoEl: p.publishedAt,
      // Qué idiomas tiene y cuáles faltan: es lo que decide si un artículo se
      // ve o no en cada versión de la tienda.
      idiomas: p.translations.map((t) => t.locale),
      titulo: p.translations.find((t) => t.locale === 'es')?.title ?? p.handle,
      categoria: p.category?.translations.find((t) => t.locale === 'es')?.name ?? null,
    }));
  }

  async crear(
    datos: {
      handle: string;
      categoryId?: string;
      coverUrl?: string;
      translations: {
        locale: Locale;
        title: string;
        slug: string;
        excerpt?: string;
        content: string;
        metaTitle?: string;
        metaDescription?: string;
      }[];
      productIds?: string[];
    },
    ctx: ContextoActor,
  ) {
    await this.exigirSlugsLibres(datos.translations);

    const id = newId();

    await this.prisma.client.post.create({
      data: {
        id,
        handle: datos.handle,
        status: 'DRAFT',
        ...(datos.categoryId ? { categoryId: datos.categoryId } : {}),
        ...(datos.coverUrl ? { coverUrl: datos.coverUrl } : {}),
        ...(ctx.actorId ? { authorId: ctx.actorId } : {}),
        translations: {
          create: datos.translations.map((t) => ({
            id: newId(),
            locale: t.locale,
            title: t.title,
            slug: t.slug,
            excerpt: t.excerpt ?? null,
            content: t.content,
            metaTitle: t.metaTitle ?? null,
            metaDescription: t.metaDescription ?? null,
          })),
        },
        ...(datos.productIds?.length
          ? {
              productos: {
                create: datos.productIds.map((productId, i) => ({ productId, position: i })),
              },
            }
          : {}),
      },
    });

    await this.audit.registrar({
      action: 'post.create',
      resource: 'post',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { handle: datos.handle, idiomas: datos.translations.map((t) => t.locale) },
    });

    return { id, handle: datos.handle };
  }

  async actualizar(
    id: string,
    datos: {
      status?: 'DRAFT' | 'PUBLISHED';
      categoryId?: string | null;
      coverUrl?: string | null;
      translations?: {
        locale: Locale;
        title: string;
        slug: string;
        excerpt?: string;
        content: string;
        metaTitle?: string;
        metaDescription?: string;
      }[];
      productIds?: string[];
    },
    ctx: ContextoActor,
  ) {
    const antes = await this.prisma.client.post.findUnique({ where: { id } });
    if (!antes || antes.deletedAt) throw new NotFoundException('Artículo no encontrado');

    if (datos.translations) await this.exigirSlugsLibres(datos.translations, id);

    const post = await this.prisma.client.post.update({
      where: { id },
      data: {
        ...(datos.status ? { status: datos.status } : {}),
        ...(datos.categoryId !== undefined ? { categoryId: datos.categoryId } : {}),
        ...(datos.coverUrl !== undefined ? { coverUrl: datos.coverUrl } : {}),
        // La fecha de publicación se fija la primera vez y no se toca: es la
        // que ordena el blog y la que sale en los resultados de Google.
        ...(datos.status === 'PUBLISHED' && !antes.publishedAt ? { publishedAt: new Date() } : {}),
        // Solo al tocar el contenido: si se moviera al guardar cualquier cosa,
        // "actualizado" dejaría de significar nada.
        ...(datos.translations ? { updatedContentAt: new Date() } : {}),
      },
    });

    for (const t of datos.translations ?? []) {
      await this.prisma.client.postTranslation.upsert({
        where: { postId_locale: { postId: id, locale: t.locale } },
        update: {
          title: t.title,
          slug: t.slug,
          excerpt: t.excerpt ?? null,
          content: t.content,
          metaTitle: t.metaTitle ?? null,
          metaDescription: t.metaDescription ?? null,
        },
        create: {
          id: newId(),
          postId: id,
          locale: t.locale,
          title: t.title,
          slug: t.slug,
          excerpt: t.excerpt ?? null,
          content: t.content,
          metaTitle: t.metaTitle ?? null,
          metaDescription: t.metaDescription ?? null,
        },
      });
    }

    if (datos.productIds) {
      // Se reemplaza la lista entera: mantener las anteriores obligaría a un
      // endpoint aparte para quitar una, y nadie lo usaría.
      await this.prisma.client.postProduct.deleteMany({ where: { postId: id } });
      if (datos.productIds.length > 0) {
        await this.prisma.client.postProduct.createMany({
          data: datos.productIds.map((productId, i) => ({ postId: id, productId, position: i })),
        });
      }
    }

    await this.audit.registrar({
      action: 'post.update',
      resource: 'post',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { status: antes.status },
      after: { status: post.status },
    });

    return post;
  }

  async archivar(id: string, ctx: ContextoActor): Promise<void> {
    await this.prisma.client.post.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DRAFT' },
    });

    await this.audit.registrar({
      action: 'post.delete',
      resource: 'post',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
    });
  }

  /**
   * Ningún slug repetido dentro del mismo idioma.
   *
   * Dos artículos con la misma dirección hacen que uno de los dos sea
   * inalcanzable, y el índice único lo rechazaría con un error de base de
   * datos que no dice cuál es el problema.
   */
  private async exigirSlugsLibres(
    traducciones: { locale: string; slug: string }[],
    excluir?: string,
  ): Promise<void> {
    for (const t of traducciones) {
      const ocupado = await this.prisma.client.postTranslation.findFirst({
        where: {
          locale: t.locale,
          slug: t.slug,
          ...(excluir ? { NOT: { postId: excluir } } : {}),
        },
        select: { postId: true },
      });

      if (ocupado) {
        throw new BadRequestException(
          `Ya hay otro artículo en "${t.locale}" con el slug "${t.slug}"`,
        );
      }
    }
  }
}
