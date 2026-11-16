import { Injectable } from '@nestjs/common';
import { newId, type Locale } from '@ecom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { agotadosAlFinal, hayStock } from '../../../common/catalogo/orden-por-stock.js';
import { traduccionPreferida } from '../../../common/contenido/traduccion.js';

/**
 * Lista de deseos.
 *
 * Guarda **productos**, no variantes: quien guarda unas botas las guarda, no
 * "las botas del 42 en negro". La talla se elige al comprar, y con la variante
 * la lista se quedaría rota en cuanto esa combinación concreta se agota.
 *
 * Solo existe para quien tiene cuenta. El invitado la lleva en su navegador,
 * y al identificarse las dos se funden: nadie pierde lo que había guardado por
 * el hecho de entrar.
 */
@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  /** Los productos guardados, listos para pintar como tarjetas. */
  async listar(userId: string, locale: Locale) {
    const items = await this.prisma.client.wishlistItem.findMany({
      where: { userId, product: { status: 'ACTIVE', deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          select: {
            id: true,
            handle: true,
            translations: { select: { locale: true, name: true, slug: true } },
            media: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
            variants: {
              where: { deletedAt: null },
              orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
              select: { priceCents: true, compareAtCents: true, stock: true, allowBackorder: true },
            },
          },
        },
      },
    });

    // Sin traducción en ningún idioma no hay nombre ni slug: enseñarlo sería
    // una tarjeta con el identificador interno que lleva a un 404.
    const guardados = items.flatMap(({ product: p, createdAt }) => {
      const variante = p.variants[0];
      const t = traduccionPreferida(p.translations, locale);

      if (!t) return [];

      return {
        id: p.id,
        name: t.name,
        slug: t.slug,
        imagen: p.media[0]?.url ?? null,
        priceCents: variante?.priceCents ?? 0,
        compareAtCents: variante?.compareAtCents ?? null,
        // Que un deseo se haya quedado sin stock es justo lo que hay que
        // enseñar: es el motivo por el que se guardó y no se compró.
        disponible: hayStock(p.variants),
        guardadoEn: createdAt,
      };
    });

    // Lo comprable primero, sin perder el orden en que se guardó cada cosa.
    // La lista de deseos es de donde salen las compras aplazadas: enterrar
    // arriba lo que no se puede servir es esconder justo lo que sí.
    return agotadosAlFinal(guardados, (p) => p.disponible);
  }

  /**
   * Los mismos datos, para una lista de identificadores sueltos.
   *
   * Lo necesita el invitado: su lista vive en el navegador y en el servidor no
   * hay nada guardado, pero los nombres, precios y fotos hay que sacarlos de
   * algún sitio. También sirve para el carrusel de "lo que has visto", donde
   * los precios guardados en el navegador pueden estar desfasados.
   */
  async resumenDe(ids: string[], locale: Locale, incluirAdulto = false) {
    if (ids.length === 0) return [];

    const productos = await this.prisma.client.product.findMany({
      where: {
        id: { in: ids.slice(0, 60) },
        status: 'ACTIVE',
        deletedAt: null,
        // Con el filtro fijo a `false`, quien guardaba un producto +18 en su
        // lista de deseos lo veía desaparecer al volver: la lista tenía el
        // identificador guardado pero el resumen no devolvía nada, así que
        // parecía que se hubiera borrado solo.
        ...(incluirAdulto ? {} : { isAdult: false }),
      },
      select: {
        id: true,
        handle: true,
        translations: { select: { locale: true, name: true, slug: true } },
        media: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
        variants: {
          where: { deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
          select: { priceCents: true, compareAtCents: true, stock: true, allowBackorder: true },
        },
      },
    });

    const resumen = productos.flatMap((p) => {
      const t = traduccionPreferida(p.translations, locale);
      if (!t) return [];

      return {
        id: p.id,
        name: t.name,
        slug: t.slug,
        imagen: p.media[0]?.url ?? null,
        priceCents: p.variants[0]?.priceCents ?? 0,
        compareAtCents: p.variants[0]?.compareAtCents ?? null,
        disponible: hayStock(p.variants),
      };
    });

    // En el orden pedido —es el que eligió el cliente al guardarlos, y el que
    // devuelve la base de datos no significa nada para él— y con lo agotado al
    // final, igual que en el resto de la tienda.
    return agotadosAlFinal(
      ids.map((id) => resumen.find((p) => p.id === id)).filter((p) => p !== undefined),
      (p) => p.disponible,
    );
  }

  /** Solo los identificadores, para pintar el corazón en los listados. */
  async ids(userId: string): Promise<string[]> {
    const items = await this.prisma.client.wishlistItem.findMany({
      where: { userId },
      select: { productId: true },
    });

    return items.map((i) => i.productId);
  }

  async anadir(userId: string, productId: string): Promise<void> {
    // Sin error si ya estaba: pulsar dos veces el corazón desde dos pestañas
    // no es un fallo que el cliente tenga que ver.
    await this.prisma.client.wishlistItem.createMany({
      data: [{ id: newId(), userId, productId }],
      skipDuplicates: true,
    });
  }

  async quitar(userId: string, productId: string): Promise<void> {
    await this.prisma.client.wishlistItem.deleteMany({ where: { userId, productId } });
  }

  /**
   * Funde la lista del navegador con la de la cuenta al iniciar sesión.
   *
   * Se suma, nunca se sustituye: quien guardó cosas sin cuenta y luego entra
   * espera encontrarlas todas, no que una lista pise a la otra.
   */
  async fusionar(userId: string, productIds: string[]): Promise<string[]> {
    if (productIds.length > 0) {
      // Se filtran contra el catálogo: la lista viene del navegador y podría
      // traer identificadores inventados o de productos ya retirados.
      const existentes = await this.prisma.client.product.findMany({
        where: { id: { in: productIds }, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });

      await this.prisma.client.wishlistItem.createMany({
        data: existentes.map((p) => ({ id: newId(), userId, productId: p.id })),
        skipDuplicates: true,
      });
    }

    return this.ids(userId);
  }
}
