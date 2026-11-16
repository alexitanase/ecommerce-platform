import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContextoActor } from '../roles/roles.service.js';

/**
 * El árbol de categorías del proveedor, traído al nuestro.
 *
 * El catálogo de Dreamlove clasifica sus 12.913 artículos en 311 ramas, con
 * nombre en español en todos los niveles. Eso ya se guardaba al leer el
 * fichero, pero no servía de nada: al importar un producto había que elegirle
 * la categoría a mano en un desplegable, así que en la práctica los productos
 * entraban sin categoría y la tienda quedaba sin forma de navegarse.
 *
 * Esto crea el árbol entero de una vez y **deja anotado el vínculo**: cada
 * rama del proveedor apunta a la categoría nuestra que le corresponde, y es lo
 * que permite que la importación siguiente asigne sola.
 *
 * Se puede repetir sin miedo. Las ramas que ya tienen categoría se saltan, así
 * que ejecutarlo después de subir un catálogo nuevo solo crea lo que falte.
 */

export interface ResultadoSincronizacion {
  /** Ramas que declara el proveedor. */
  total: number;
  /** Categorías nuestras creadas ahora. */
  creadas: number;
  /** Ramas que ya tenían categoría y se han dejado como estaban. */
  yaEnlazadas: number;
  /** Ramas enlazadas a una categoría que ya existía con el mismo handle. */
  reutilizadas: number;
  /** Ramas que no se han podido crear, con el motivo. */
  fallidas: { path: string; motivo: string }[];
}

/** Nuestro árbol admite cinco niveles; el suyo llega justo a cinco. */
const PROFUNDIDAD_MAXIMA = 5;

@Injectable()
export class CategoriasProveedorService {
  private readonly logger = new Logger(CategoriasProveedorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Lo que hay: su árbol, con cuántos artículos cuelgan y qué está enlazado. */
  async listar(supplierId: string) {
    const filas = await this.prisma.client.supplierCategory.findMany({
      where: { supplierId },
      orderBy: [{ path: 'asc' }],
      include: { category: { select: { id: true, handle: true } } },
    });

    return {
      total: filas.length,
      enlazadas: filas.filter((f) => f.categoryId !== null).length,
      articulos: filas.reduce((n, f) => n + f.itemCount, 0),
      ramas: filas.map((f) => ({
        path: f.path,
        nombre: f.name,
        profundidad: f.depth,
        articulos: f.itemCount,
        categoryId: f.categoryId,
        handle: f.category?.handle ?? null,
      })),
    };
  }

  /**
   * Crea en nuestro catálogo todas las categorías que faltan.
   *
   * Se recorre por profundidad para que el padre exista siempre antes que la
   * hija: sin ese orden habría que crear a medias y volver a coser después.
   */
  async sincronizar(supplierId: string, ctx: ContextoActor): Promise<ResultadoSincronizacion> {
    const proveedor = await this.prisma.client.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true },
    });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado');

    const filas = await this.prisma.client.supplierCategory.findMany({
      where: { supplierId },
      orderBy: [{ depth: 'asc' }, { path: 'asc' }],
    });

    const resultado: ResultadoSincronizacion = {
      total: filas.length,
      creadas: 0,
      yaEnlazadas: 0,
      reutilizadas: 0,
      fallidas: [],
    };

    /** Ruta del proveedor → id de nuestra categoría. Se va llenando al crear. */
    const porRuta = new Map<string, string>();
    for (const fila of filas) {
      if (fila.categoryId) porRuta.set(fila.path, fila.categoryId);
    }

    for (const fila of filas) {
      if (fila.categoryId) {
        resultado.yaEnlazadas++;
        continue;
      }

      if (fila.depth > PROFUNDIDAD_MAXIMA) {
        resultado.fallidas.push({
          path: fila.path,
          motivo: `El árbol admite ${String(PROFUNDIDAD_MAXIMA)} niveles y esta rama tiene ${String(fila.depth)}`,
        });
        continue;
      }

      const segmentos = fila.path.split('|');
      const rutaPadre = segmentos.slice(0, -1).join('|');

      /*
       * Una rama huérfana no se cuelga de la raíz.
       *
       * Si su padre no está —porque falló al crearse o porque el proveedor
       * mandó la hija sin la madre—, subirla al primer nivel la mezclaría con
       * las secciones grandes de la tienda. Se anota y se sigue: el resto del
       * árbol es bueno igualmente.
       */
      const parentId = segmentos.length > 1 ? porRuta.get(rutaPadre) : undefined;
      if (segmentos.length > 1 && !parentId) {
        resultado.fallidas.push({ path: fila.path, motivo: `Falta su categoría padre` });
        continue;
      }

      try {
        const { id, reutilizada } = await this.crearOReutilizar(fila, parentId ?? null);

        await this.prisma.client.supplierCategory.update({
          where: { id: fila.id },
          data: { categoryId: id },
        });

        porRuta.set(fila.path, id);
        if (reutilizada) resultado.reutilizadas++;
        else resultado.creadas++;
      } catch (error) {
        const motivo = error instanceof Error ? error.message : String(error);
        this.logger.warn(`No se pudo crear la categoría «${fila.path}»: ${motivo}`);
        resultado.fallidas.push({ path: fila.path, motivo: motivo.slice(0, 200) });
      }
    }

    await this.audit.registrar({
      action: 'supplier.categories_sync',
      resource: 'supplier',
      resourceId: supplierId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: {
        proveedor: proveedor.name,
        creadas: resultado.creadas,
        reutilizadas: resultado.reutilizadas,
        fallidas: resultado.fallidas.length,
      },
    });

    this.logger.log(
      `Categorías de ${proveedor.name}: ${resultado.creadas} creadas, ` +
        `${resultado.reutilizadas} reutilizadas, ${resultado.yaEnlazadas} ya estaban, ` +
        `${resultado.fallidas.length} sin crear`,
    );

    return resultado;
  }

  /**
   * La categoría de esta rama: la que ya existiera con ese handle, o una nueva.
   *
   * Reutilizar en lugar de fallar es lo que hace que esto se pueda repetir y
   * que convivan dos proveedores con secciones parecidas. También es lo que
   * permite borrar el vínculo, volver a sincronizar y recuperarlo sin duplicar
   * media tienda.
   */
  private async crearOReutilizar(
    fila: { path: string; name: string; depth: number },
    parentId: string | null,
  ): Promise<{ id: string; reutilizada: boolean }> {
    const handle = await this.handleLibre(fila, parentId);

    const existente = await this.prisma.client.category.findUnique({
      where: { handle },
      select: { id: true },
    });
    if (existente) return { id: existente.id, reutilizada: true };

    const padre = parentId
      ? await this.prisma.client.category.findUnique({
          where: { id: parentId },
          select: { path: true, depth: true, isAdult: true },
        })
      : null;

    const id = newId();
    // El nombre en inglés sale gratis: es el último escalón de la ruta, que el
    // proveedor manda en inglés. Sin esto la tienda en inglés enseñaría
    // «Vibradores» en un menú por lo demás traducido.
    const nombreEn = fila.path.split('|').at(-1) ?? fila.name;

    await this.prisma.client.category.create({
      data: {
        id,
        handle,
        parentId,
        path: `${padre?.path ?? '/'}${handle}/`,
        depth: padre ? padre.depth + 1 : 0,
        // Se crean activas y vacías. En la tienda no se ven hasta que tengan
        // productos, así que activarlas no adelanta nada al cliente; lo que sí
        // hace es que estén listas en el panel para importar contra ellas.
        isActive: true,
        isAdult: padre?.isAdult ?? false,
        translations: {
          create: [
            {
              id: newId(),
              locale: 'es',
              name: fila.name,
              slug: await this.slugLibre('es', handle, id),
            },
            ...(nombreEn.toLowerCase() === fila.name.toLowerCase()
              ? []
              : [
                  {
                    id: newId(),
                    locale: 'en',
                    name: nombreEn,
                    slug: await this.slugLibre('en', this.aHandle(nombreEn), id),
                  },
                ]),
          ],
        },
      },
    });

    return { id, reutilizada: false };
  }

  /**
   * Un handle que no choque.
   *
   * El nombre del proveedor se repite entre ramas —hay varias «Otros» y varias
   * «Accesorios» colgando de secciones distintas—, y el handle es único en
   * toda la tienda. Se prueba primero el nombre a secas, que es el bonito, y
   * si está cogido por OTRA rama se le antepone el padre.
   */
  private async handleLibre(
    fila: { path: string; name: string },
    parentId: string | null,
  ): Promise<string> {
    const base = this.aHandle(fila.name);

    const enUso = await this.prisma.client.category.findUnique({
      where: { handle: base },
      select: { id: true, parentId: true },
    });

    // Libre, o cogido por una categoría que es justo esta —mismo nombre y mismo
    // sitio—: en los dos casos vale.
    if (!enUso || enUso.parentId === parentId) return base;

    const padreNombre = fila.path.split('|').at(-2);
    const compuesto = padreNombre ? `${this.aHandle(padreNombre)}-${base}` : base;

    const chocaTambien = await this.prisma.client.category.findUnique({
      where: { handle: compuesto },
      select: { parentId: true },
    });
    if (!chocaTambien || chocaTambien.parentId === parentId) return compuesto;

    // Último recurso: la ruta entera, que es única por definición.
    return this.aHandle(fila.path.replace(/\|/g, '-')).slice(0, 90);
  }

  /**
   * Un slug libre para ese idioma.
   *
   * Los slugs son únicos por idioma y las coincidencias no son raras: en el
   * catálogo de Dreamlove hay una rama que en español se llama «Anal-» y otra
   * que en inglés se llama «Anal», y las dos dan el mismo slug.
   *
   * Cuando el bonito está cogido se le pega un trozo del id. Es feo y por eso
   * es el último recurso, pero **tiene que existir**: la alternativa es que la
   * rama entera se quede sin crear por una colisión de nombres, que es justo
   * lo que pasó la primera vez que se probó esto contra el catálogo real.
   */
  private async slugLibre(locale: string, preferido: string, id: string): Promise<string> {
    const cogido = await this.prisma.client.categoryTranslation.findUnique({
      where: { locale_slug: { locale, slug: preferido } },
      select: { id: true },
    });
    if (!cogido) return preferido;

    // El id es único, así que este no puede chocar con nada.
    return `${preferido}-${id.slice(0, 6)}`;
  }

  private aHandle(texto: string): string {
    return (
      texto
        .toLowerCase()
        .normalize('NFD')
        // Se quitan las tildes: «Vibradores Realísticos» y «Vibradores
        // Realisticos» tienen que dar el mismo handle.
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/, '') || 'categoria'
    );
  }
}
