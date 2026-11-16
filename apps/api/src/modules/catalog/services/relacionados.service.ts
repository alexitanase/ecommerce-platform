import { Injectable } from '@nestjs/common';
import type { Locale } from '@ecom/shared';
import { agotadosAlFinal, hayStock } from '../../../common/catalogo/orden-por-stock.js';
import { traduccionPreferida } from '../../../common/contenido/traduccion.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** La misma forma que usan la portada y las tarjetas del catálogo. */
export interface ProductoRelacionado {
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

/**
 * «También te puede interesar».
 *
 * Se buscan en la MISMA CATEGORÍA y, si no llegan, se completa con la categoría
 * padre. Los productos cuelgan de la hoja más concreta —«Vibradores de
 * silicona»— y ahí puede haber solo tres: subir un escalón da vecinos que
 * siguen teniendo que ver, en lugar de rellenar con lo primero del catálogo,
 * que es lo que hace que estos bloques se ignoren.
 *
 * No es un motor de recomendación: no mira qué ha visto ni qué ha comprado
 * nadie. Eso está en la fase de evolución y necesita histórico. Esto es lo que
 * se puede hacer bien hoy, con el catálogo que hay.
 */
@Injectable()
export class RelacionadosService {
  /** Cuántos se enseñan. Cuatro llenan una fila en escritorio y dos en móvil. */
  private static readonly CUANTOS = 4;

  constructor(private readonly prisma: PrismaService) {}

  async de(
    productId: string,
    locale: Locale,
    incluirAdulto: boolean,
  ): Promise<ProductoRelacionado[]> {
    const producto = await this.prisma.lectura.product.findUnique({
      where: { id: productId },
      select: { categoryId: true, category: { select: { parentId: true } } },
    });

    // Un producto sin categoría no tiene vecinos de los que fiarse. Antes que
    // enseñar cuatro cualesquiera, no se enseña la sección.
    if (!producto?.categoryId) return [];

    const base = {
      status: 'ACTIVE' as const,
      deletedAt: null,
      id: { not: productId },
      ...(incluirAdulto ? {} : { isAdult: false }),
    };

    const seleccion = {
      id: true,
      handle: true,
      // Todas, no solo la del idioma pedido: un producto sin traducir salía
      // con su identificador interno por nombre y enlazando a un 404.
      translations: { select: { locale: true, name: true, slug: true } },
      media: { orderBy: { position: 'asc' as const }, take: 1, select: { url: true } },
      variants: {
        where: { deletedAt: null },
        orderBy: [{ isDefault: 'desc' as const }, { position: 'asc' as const }],
        select: { priceCents: true, compareAtCents: true, stock: true, allowBackorder: true },
      },
    };

    const mismos = await this.prisma.lectura.product.findMany({
      where: { ...base, categoryId: producto.categoryId },
      select: seleccion,
      // Se piden más de los que se enseñan porque después se ordena por
      // disponibilidad: con solo cuatro, si tres están agotados la fila queda
      // con un producto comprable y tres que no.
      take: RelacionadosService.CUANTOS * 3,
      orderBy: { publishedAt: 'desc' },
    });

    const encontrados = [...mismos];

    if (encontrados.length < RelacionadosService.CUANTOS && producto.category?.parentId) {
      const vistos = new Set(encontrados.map((p) => p.id));

      const hermanos = await this.prisma.lectura.product.findMany({
        where: {
          ...base,
          category: { parentId: producto.category.parentId },
          id: { notIn: [productId, ...vistos] },
        },
        select: seleccion,
        take: RelacionadosService.CUANTOS * 3,
        orderBy: { publishedAt: 'desc' },
      });

      encontrados.push(...hermanos);
    }

    // Lo agotado al final, como en el resto de la tienda: un relacionado que no
    // se puede comprar ocupa el sitio de uno que sí.
    const ordenados = agotadosAlFinal(encontrados, (p) => hayStock(p.variants)).slice(
      0,
      RelacionadosService.CUANTOS,
    );

    return this.conValoracion(ordenados, locale);
  }

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
  ): Promise<ProductoRelacionado[]> {
    if (productos.length === 0) return [];

    const valoraciones = await this.prisma.lectura.review.groupBy({
      by: ['productId'],
      where: { status: 'APPROVED', productId: { in: productos.map((p) => p.id) } },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const porProducto = new Map(valoraciones.map((v) => [v.productId, v]));

    // Sin traducción en ningún idioma no hay nombre ni slug: ese producto no
    // se puede ofrecer, solo llevar a un 404.
    return productos.flatMap((p) => {
      const variante = p.variants[0];
      const valoracion = porProducto.get(p.id);
      const t = traduccionPreferida(p.translations, locale);

      if (!t) return [];

      return {
        id: p.id,
        name: t.name,
        slug: t.slug,
        imagen: p.media[0]?.url ?? null,
        priceCents: variante?.priceCents ?? 0,
        compareAtCents: variante?.compareAtCents ?? null,
        disponible: hayStock(p.variants),
        valoracion: Math.round((valoracion?._avg.rating ?? 0) * 10) / 10,
        numeroResenas: valoracion?._count.rating ?? 0,
      };
    });
  }
}
