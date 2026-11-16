import { Injectable } from '@nestjs/common';
import type { Locale } from '@ecom/shared';
import { categoriasConProductoEnLaRama } from '../catalog/ramas.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Una dirección del sitemap.
 *
 * El `id` va porque la tienda tiene que emparejar las tres traducciones de un
 * mismo contenido para declarar sus `hreflang`, y el slug cambia con el idioma.
 * Sin él habría que cruzarlas por posición, que es correcto justo hasta que un
 * producto no está traducido a uno de los tres idiomas: a partir de ahí, todo
 * lo que va detrás queda desplazado y cada ficha anuncia como alternativa
 * catalana la de OTRO producto. Un error así es peor que no tener hreflang.
 */
export interface EntradaSitemap {
  id: string;
  slug: string;
  actualizado: string;
}

export interface InventarioSitemap {
  productos: EntradaSitemap[];
  categorias: EntradaSitemap[];
  articulos: EntradaSitemap[];
}

/**
 * El inventario de lo que la tienda quiere que se indexe.
 *
 * Existe porque el sitemap lo pinta la tienda pero el catálogo lo conoce la
 * API, y no tiene sentido que la tienda hable con la base de datos.
 *
 * Lo que NO sale aquí, y es tan importante como lo que sale:
 *
 *  · **Los productos +18.** El sitemap es un fichero público que se le entrega
 *    a Google: meter ahí las fichas restringidas es publicar la lista completa
 *    del catálogo adulto, y salta la verificación de edad que protege el resto
 *    de la tienda. Se indexan por su categoría, como el resto.
 *  · **Lo que no está publicado**, lo borrado y las categorías vacías. Un
 *    sitemap lleno de URLs que devuelven 404 o «no hay productos» es la forma
 *    más rápida de que Google deje de fiarse del fichero.
 *  · **Las páginas de contenido**, que van con `noindex`. Anunciar en el
 *    sitemap algo que la propia página pide no indexar es mandarle al buscador
 *    dos instrucciones contrarias.
 */
@Injectable()
export class SitemapService {
  constructor(private readonly prisma: PrismaService) {}

  async inventario(locale: Locale): Promise<InventarioSitemap> {
    const [productos, categorias, rutasConProducto, articulos] = await Promise.all([
      this.prisma.lectura.productTranslation.findMany({
        where: {
          locale,
          product: { status: 'ACTIVE', deletedAt: null, isAdult: false },
        },
        select: { productId: true, slug: true, product: { select: { updatedAt: true } } },
        // Orden estable, y no por gusto: sin `orderBy`, Postgres puede devolver
        // las filas en distinto orden en cada consulta, y el sitemap cambiaría
        // de arriba abajo cada hora sin que haya cambiado nada.
        orderBy: { productId: 'asc' },
        // Un tope alto pero tope: el protocolo permite 50.000 URLs por fichero,
        // y pasarse hace que Google descarte el sitemap entero en lugar de leer
        // las primeras. Con más catálogo habría que partirlo por índices.
        take: 45_000,
      }),
      this.prisma.lectura.categoryTranslation.findMany({
        where: { locale, category: { isActive: true, deletedAt: null } },
        select: {
          categoryId: true,
          slug: true,
          category: { select: { updatedAt: true, path: true } },
        },
        orderBy: { categoryId: 'asc' },
      }),
      // Rutas de las categorías con producto propio, para quedarse solo con las
      // ramas que llevan a algo. Ver el filtro de más abajo.
      this.prisma.lectura.category.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          products: { some: { status: 'ACTIVE', deletedAt: null } },
        },
        select: { path: true },
      }),
      this.prisma.lectura.postTranslation.findMany({
        where: { locale, post: { status: 'PUBLISHED', deletedAt: null } },
        select: { postId: true, slug: true, post: { select: { updatedAt: true } } },
        orderBy: { postId: 'asc' },
      }),
    ]);

    /*
     * Solo las categorías que llevan a algo, mirando su RAMA.
     *
     * Una categoría vacía en el sitemap es una promesa de contenido que se rompe
     * al abrirla, y Google acaba rebajando el sitio entero por ellas. Pero el
     * filtro miraba el producto **propio**, y ahí se dejaba fuera justo las que
     * más tráfico traen: los productos cuelgan de la hoja, así que las secciones
     * grandes —las que la gente busca por su nombre— tienen cero productos suyos
     * y nunca llegaban al buscador. Es la misma regla del menú y de la portada.
     */
    const conProducto = categoriasConProductoEnLaRama(
      categorias.map((c) => ({ id: c.categoryId, path: c.category.path })),
      rutasConProducto.map((c) => c.path),
    );

    return {
      productos: productos.map((p) => ({
        id: p.productId,
        slug: p.slug,
        actualizado: p.product.updatedAt.toISOString(),
      })),
      categorias: categorias
        .filter((c) => conProducto.has(c.categoryId))
        .map((c) => ({
          id: c.categoryId,
          slug: c.slug,
          actualizado: c.category.updatedAt.toISOString(),
        })),
      articulos: articulos.map((a) => ({
        id: a.postId,
        slug: a.slug,
        actualizado: a.post.updatedAt.toISOString(),
      })),
    };
  }
}
