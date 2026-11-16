import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { newId, type Locale } from '@ecom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import type { ContextoActor } from '../../roles/roles.service.js';

export interface NodoCategoria {
  id: string;
  handle: string;
  name: string;
  slug: string;
  depth: number;
  position: number;
  isActive: boolean;
  isAdult: boolean;
  /** Foto de la categoría: la del panel, o la que se calcula del catálogo. */
  imagen: string | null;
  /**
   * Productos colgados directamente de ella, publicados o no.
   *
   * Es el número del panel: quien va a desactivar o a borrar una categoría
   * necesita saber qué hay dentro aunque esté en borrador.
   */
  productos: number;
  /**
   * Productos **a la venta** en la rama entera, ella incluida.
   *
   * Es el número que se le enseña a quien compra, y el que decide si la
   * categoría se ofrece o no. Dos decisiones dentro:
   *
   *  · **La rama.** Los productos cuelgan de la hoja más concreta, así que una
   *    raíz como «Lovetoys» tiene `productos: 0` y miles por debajo: enseñar el
   *    directo la haría parecer vacía justo a la categoría más grande.
   *  · **Solo lo publicado.** Contaba también los borradores y los borrados, y
   *    al importar un catálogo de proveedor eso son miles: la tienda anunciaba
   *    «312 productos» en una categoría que al abrirla no tenía ninguno.
   */
  productosRama: number;
  children: NodoCategoria[];
}

/**
 * Suma los productos a la venta de toda la rama y los deja en cada nodo.
 *
 * De abajo arriba: cada nodo necesita el total ya calculado de sus hijos, así
 * que se resuelven primero. Recorrer el árbol una vez es O(n); calcularlo con
 * un `count` por categoría serían cientos de consultas para pintar una lista.
 */
function acumularRama(nodo: NodoCategoria, propios: Map<string, number>): number {
  nodo.productosRama =
    (propios.get(nodo.id) ?? 0) +
    nodo.children.reduce((total, hija) => total + acumularRama(hija, propios), 0);
  return nodo.productosRama;
}

/**
 * Categorías en árbol con ruta materializada.
 *
 * Cada categoría guarda su `path` completo ("/moda/calzado/botas/"). Consultar
 * toda una rama es entonces un `LIKE '/moda/%'` con índice, en lugar de una
 * consulta recursiva o de N llamadas anidadas. El coste es mantener el path
 * al mover una categoría, que es una operación rara; el beneficio se cobra en
 * cada listado de la tienda, que es lo que ocurre miles de veces al día.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async arbol(locale: Locale, soloActivas = true): Promise<NodoCategoria[]> {
    const [categorias, publicados] = await Promise.all([
      this.prisma.client.category.findMany({
        where: { deletedAt: null, ...(soloActivas ? { isActive: true } : {}) },
        orderBy: [{ depth: 'asc' }, { position: 'asc' }],
        include: {
          translations: true,
          _count: { select: { products: true } },
        },
      }),
      // Cuántos hay a la venta en cada categoría, en una sola consulta agrupada.
      // El `_count` de arriba no sirve para esto: cuenta todas las filas, y en
      // un catálogo importado la mayoría son borradores.
      this.prisma.client.product.groupBy({
        by: ['categoryId'],
        where: { status: 'ACTIVE', deletedAt: null, categoryId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const aLaVenta = new Map(
      publicados.map((fila) => [fila.categoryId ?? '', fila._count._all] as const),
    );

    const nodos = new Map<string, NodoCategoria>();
    const raices: NodoCategoria[] = [];

    for (const c of categorias) {
      const t = c.translations.find((x) => x.locale === locale) ?? c.translations[0];
      nodos.set(c.id, {
        id: c.id,
        handle: c.handle,
        name: t?.name ?? c.handle,
        slug: t?.slug ?? c.handle,
        depth: c.depth,
        position: c.position,
        isActive: c.isActive,
        isAdult: c.isAdult,
        imagen: c.imageUrl ?? c.coverUrl,
        productos: c._count.products,
        // Se rellena al final, cuando el árbol ya está montado: hasta entonces
        // un nodo no sabe quiénes son sus hijos.
        productosRama: aLaVenta.get(c.id) ?? 0,
        children: [],
      });
    }

    // Se recorre en orden de profundidad, así que el padre siempre existe ya.
    for (const c of categorias) {
      const nodo = nodos.get(c.id);
      if (!nodo) continue;
      const padre = c.parentId ? nodos.get(c.parentId) : undefined;
      if (padre) padre.children.push(nodo);
      else raices.push(nodo);
    }

    for (const raiz of raices) acumularRama(raiz, aLaVenta);

    return raices;
  }

  async porSlug(slug: string, locale: Locale) {
    const traduccion = await this.prisma.client.categoryTranslation.findUnique({
      where: { locale_slug: { locale, slug } },
      include: { category: { include: { translations: true } } },
    });

    if (!traduccion || traduccion.category.deletedAt || !traduccion.category.isActive) {
      throw new NotFoundException('Categoría no encontrada');
    }

    return traduccion.category;
  }

  /** IDs de una categoría y toda su descendencia, para filtrar el listado. */
  async idsDeLaRama(categoryId: string): Promise<string[]> {
    const categoria = await this.prisma.client.category.findUnique({
      where: { id: categoryId },
      select: { path: true },
    });
    if (!categoria) throw new NotFoundException('Categoría no encontrada');

    const rama = await this.prisma.client.category.findMany({
      where: { path: { startsWith: categoria.path }, deletedAt: null },
      select: { id: true },
    });

    return rama.map((c) => c.id);
  }

  async crear(
    datos: {
      handle: string;
      parentId?: string;
      position?: number;
      isAdult?: boolean;
      translations: { locale: Locale; name: string; slug: string; description?: string }[];
    },
    ctx: ContextoActor,
  ) {
    const existe = await this.prisma.client.category.findUnique({
      where: { handle: datos.handle },
    });
    if (existe)
      throw new BadRequestException(`Ya existe una categoría con el handle "${datos.handle}"`);

    let path = '/';
    let depth = 0;
    let heredaAdulto = false;

    if (datos.parentId) {
      const padre = await this.prisma.client.category.findUnique({
        where: { id: datos.parentId },
        select: { path: true, depth: true, isAdult: true },
      });
      if (!padre) throw new BadRequestException('La categoría padre no existe');

      if (padre.depth >= 4) {
        throw new BadRequestException(
          'Se ha alcanzado la profundidad máxima de 5 niveles. Un árbol más profundo hace la navegación inmanejable.',
        );
      }

      path = padre.path;
      depth = padre.depth + 1;
      // Si el padre es +18, la hija también lo es: no tendría sentido que una
      // subcategoría de una restringida fuera visible sin verificar la edad.
      heredaAdulto = padre.isAdult;
    }

    const id = newId();
    const categoria = await this.prisma.client.category.create({
      data: {
        id,
        handle: datos.handle,
        parentId: datos.parentId ?? null,
        path: `${path}${datos.handle}/`,
        depth,
        position: datos.position ?? 0,
        isAdult: heredaAdulto || (datos.isAdult ?? false),
        translations: {
          create: datos.translations.map((t) => ({
            id: newId(),
            locale: t.locale,
            name: t.name,
            slug: t.slug,
            description: t.description ?? null,
          })),
        },
      },
      include: { translations: true },
    });

    await this.audit.registrar({
      action: 'category.create',
      resource: 'category',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { handle: categoria.handle, path: categoria.path },
    });

    return categoria;
  }

  async actualizar(
    categoryId: string,
    datos: {
      position?: number;
      isActive?: boolean;
      isAdult?: boolean;
      imageUrl?: string;
      translations?: { locale: Locale; name: string; slug: string; description?: string }[];
    },
    ctx: ContextoActor,
  ) {
    const antes = await this.prisma.client.category.findUnique({
      where: { id: categoryId },
      include: { translations: true },
    });
    if (!antes || antes.deletedAt) throw new NotFoundException('Categoría no encontrada');

    const categoria = await this.prisma.client.category.update({
      where: { id: categoryId },
      data: {
        ...(datos.position !== undefined ? { position: datos.position } : {}),
        ...(datos.isActive !== undefined ? { isActive: datos.isActive } : {}),
        ...(datos.isAdult !== undefined ? { isAdult: datos.isAdult } : {}),
        ...(datos.imageUrl !== undefined ? { imageUrl: datos.imageUrl } : {}),
      },
      include: { translations: true },
    });

    if (datos.translations) {
      for (const t of datos.translations) {
        await this.prisma.client.categoryTranslation.upsert({
          where: { categoryId_locale: { categoryId, locale: t.locale } },
          update: { name: t.name, slug: t.slug, description: t.description ?? null },
          create: {
            id: newId(),
            categoryId,
            locale: t.locale,
            name: t.name,
            slug: t.slug,
            description: t.description ?? null,
          },
        });
      }
    }

    // Marcar una categoría como +18 debe propagarse a toda su rama.
    if (datos.isAdult === true && !antes.isAdult) {
      await this.prisma.client.category.updateMany({
        where: { path: { startsWith: antes.path }, deletedAt: null },
        data: { isAdult: true },
      });
    }

    await this.audit.registrar({
      action: 'category.update',
      resource: 'category',
      resourceId: categoryId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { isActive: antes.isActive, isAdult: antes.isAdult, position: antes.position },
      after: {
        isActive: categoria.isActive,
        isAdult: categoria.isAdult,
        position: categoria.position,
      },
    });

    return categoria;
  }

  /**
   * Mueve una categoría bajo otro padre, recalculando el path de toda su rama.
   */
  async mover(categoryId: string, nuevoPadreId: string | null, ctx: ContextoActor) {
    const categoria = await this.prisma.client.category.findUnique({ where: { id: categoryId } });
    if (!categoria || categoria.deletedAt) throw new NotFoundException('Categoría no encontrada');

    let pathPadre = '/';
    let depthPadre = -1;

    if (nuevoPadreId) {
      const padre = await this.prisma.client.category.findUnique({ where: { id: nuevoPadreId } });
      if (!padre) throw new BadRequestException('La categoría padre no existe');

      // Mover una categoría dentro de su propia rama crearía un ciclo y dejaría
      // esos nodos huérfanos, invisibles para siempre.
      if (padre.path.startsWith(categoria.path)) {
        throw new BadRequestException(
          'No se puede mover una categoría dentro de sí misma o de una de sus descendientes',
        );
      }

      pathPadre = padre.path;
      depthPadre = padre.depth;
    }

    const pathAntiguo = categoria.path;
    const pathNuevo = `${pathPadre}${categoria.handle}/`;
    const desplazamiento = depthPadre + 1 - categoria.depth;

    const descendientes = await this.prisma.client.category.findMany({
      where: { path: { startsWith: pathAntiguo }, deletedAt: null },
    });

    await this.prisma.client.$transaction([
      this.prisma.client.category.update({
        where: { id: categoryId },
        data: { parentId: nuevoPadreId, path: pathNuevo, depth: depthPadre + 1 },
      }),
      ...descendientes
        .filter((d) => d.id !== categoryId)
        .map((d) =>
          this.prisma.client.category.update({
            where: { id: d.id },
            data: {
              path: d.path.replace(pathAntiguo, pathNuevo),
              depth: d.depth + desplazamiento,
            },
          }),
        ),
    ]);

    await this.audit.registrar({
      action: 'category.move',
      resource: 'category',
      resourceId: categoryId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { path: pathAntiguo, parentId: categoria.parentId },
      after: { path: pathNuevo, parentId: nuevoPadreId },
    });

    return { movidas: descendientes.length, pathNuevo };
  }

  async eliminar(categoryId: string, ctx: ContextoActor): Promise<void> {
    const categoria = await this.prisma.client.category.findUnique({
      where: { id: categoryId },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (!categoria || categoria.deletedAt) throw new NotFoundException('Categoría no encontrada');

    if (categoria._count.children > 0) {
      throw new BadRequestException(
        `Tiene ${categoria._count.children} subcategoría(s). Muévelas o elimínalas antes.`,
      );
    }
    if (categoria._count.products > 0) {
      throw new BadRequestException(
        `Tiene ${categoria._count.products} producto(s) asignados. Reasígnalos antes de eliminarla.`,
      );
    }

    await this.prisma.client.category.update({
      where: { id: categoryId },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.registrar({
      action: 'category.delete',
      resource: 'category',
      resourceId: categoryId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { handle: categoria.handle },
    });
  }
}
