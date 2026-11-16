import { Injectable } from '@nestjs/common';
import { Prisma } from '@ecom/db';
import type {
  ArticuloDreamlove,
  GrupoDreamlove,
  RepositorioCatalogoDreamlove,
} from '@ecom/suppliers';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * El catálogo de un proveedor sin API, servido desde nuestra base de datos.
 *
 * Es la otra mitad del adaptador de Dreamlove: allí está la lógica de negocio
 * —agrupar colores, elegir cabeza de familia, calcular disponibilidad— y aquí
 * el acceso a los datos. Separarlo permite que el paquete de proveedores no
 * dependa de Prisma y que el adaptador se pruebe con un catálogo en memoria.
 *
 * Las consultas de búsqueda van en SQL y no por el cliente de Prisma porque
 * hay que agrupar por familia ANTES de paginar: con 12.913 artículos y 945
 * familias de colores, paginar filas y agrupar después daría páginas de
 * tamaños distintos y productos repetidos entre ellas.
 */
@Injectable()
export class CatalogoDreamloveService {
  constructor(private readonly prisma: PrismaService) {}

  /** El repositorio tal y como lo espera el adaptador, atado a un proveedor. */
  paraProveedor(supplierId: string): RepositorioCatalogoDreamlove {
    return {
      buscar: (parametros) => this.buscar(supplierId, parametros),
      grupoPorReferencia: (referencia) => this.grupoPorReferencia(supplierId, referencia),
      gruposPorClaves: (claves) => this.gruposPorClaves(supplierId, claves),
    };
  }

  private async buscar(
    supplierId: string,
    parametros: {
      texto?: string;
      soloDisponibles?: boolean;
      pagina: number;
      porPagina: number;
      orden?: 'relevancia' | 'precio_asc' | 'precio_desc' | 'ventas';
    },
  ): Promise<{ grupos: GrupoDreamlove[]; total: number }> {
    const condiciones = [
      Prisma.sql`"supplierId" = ${supplierId}`,
      // Lo que el proveedor ya no manda en su catálogo no se ofrece para
      // importar: sería dar de alta un producto que nace descatalogado.
      Prisma.sql`"removed" = false`,
      ...this.filtroDeTexto(parametros.texto),
      ...(parametros.soloDisponibles ? [Prisma.sql`"available" = true`] : []),
    ];

    const donde = Prisma.sql`WHERE ${Prisma.join(condiciones, ' AND ')}`;

    const [conteo] = await this.prisma.client.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(DISTINCT "groupKey") AS total
      FROM "supplier_catalog_items"
      ${donde}
    `;

    const total = Number(conteo?.total ?? 0);
    if (total === 0) return { grupos: [], total: 0 };

    const claves = await this.prisma.client.$queryRaw<{ groupKey: string }[]>`
      SELECT "groupKey"
      FROM "supplier_catalog_items"
      ${donde}
      GROUP BY "groupKey"
      ${this.ordenacion(parametros.orden)}
      LIMIT ${parametros.porPagina}
      OFFSET ${(parametros.pagina - 1) * parametros.porPagina}
    `;

    return {
      grupos: await this.gruposPorClaves(
        supplierId,
        claves.map((c) => c.groupKey),
        // El orden de la página lo decide la consulta de arriba; recuperar los
        // artículos por separado lo perdería y la lista saldría barajada.
        claves.map((c) => c.groupKey),
      ),
      total,
    };
  }

  /**
   * Cada palabra buscada tiene que aparecer, no basta con una.
   *
   * Buscando «satisfyer azul» con un OR salen los 300 artículos de Satisfyer y
   * todo lo azul del catálogo; con AND sale lo que se buscaba. Se compara
   * contra `searchText`, que ya está en minúsculas y sin tildes.
   */
  private filtroDeTexto(texto: string | undefined): Prisma.Sql[] {
    const palabras = normalizar(texto ?? '')
      .split(/\s+/)
      .filter((p) => p.length > 0)
      // Un tope para que una consulta absurdamente larga no genere una
      // sentencia con doscientos LIKE encadenados.
      .slice(0, 8);

    return palabras.map((palabra) => Prisma.sql`"searchText" LIKE ${`%${escaparLike(palabra)}%`}`);
  }

  private ordenacion(orden: string | undefined): Prisma.Sql {
    switch (orden) {
      case 'precio_asc':
        return Prisma.sql`ORDER BY MIN("costCents") ASC, MIN("title") ASC`;
      case 'precio_desc':
        return Prisma.sql`ORDER BY MIN("costCents") DESC, MIN("title") ASC`;
      default:
        /*
         * Sin criterio pedido, lo servible primero.
         *
         * No hay dato de ventas en el catálogo, así que «relevancia» y
         * «ventas» acaban aquí. Ordenar por título a secas dejaba las primeras
         * páginas llenas de artículos agotados, que son los que menos interesa
         * importar. El título de desempate hace que la paginación sea estable:
         * sin él, dos artículos empatados pueden cambiar de página entre una
         * consulta y la siguiente y uno se pierde.
         */
        return Prisma.sql`ORDER BY BOOL_OR("available") DESC, MIN("title") ASC`;
    }
  }

  private async grupoPorReferencia(
    supplierId: string,
    referencia: string,
  ): Promise<GrupoDreamlove | null> {
    const buscada = referencia.trim();
    if (!buscada) return null;

    const encontrado = await this.prisma.client.supplierCatalogItem.findFirst({
      where: {
        supplierId,
        // Las cuatro formas de nombrar lo mismo: el id interno, el código que
        // se ve en su web, el EAN de la caja y el identificador del grupo. Se
        // aceptan todas porque todas son cosas que alguien tiene delante.
        OR: [
          { externalId: buscada },
          { code: buscada },
          { groupKey: buscada },
          { eans: { has: buscada } },
        ],
      },
      select: { groupKey: true },
    });

    if (!encontrado) return null;

    const [grupo] = await this.gruposPorClaves(supplierId, [encontrado.groupKey]);
    return grupo && grupo.length > 0 ? grupo : null;
  }

  private async gruposPorClaves(
    supplierId: string,
    claves: string[],
    orden?: string[],
  ): Promise<GrupoDreamlove[]> {
    if (claves.length === 0) return [];

    const filas = await this.prisma.client.supplierCatalogItem.findMany({
      where: { supplierId, groupKey: { in: claves } },
      orderBy: [{ available: 'desc' }, { stock: 'desc' }, { externalId: 'asc' }],
    });

    const porClave = new Map<string, ArticuloDreamlove[]>();
    for (const fila of filas) {
      const grupo = porClave.get(fila.groupKey) ?? [];
      grupo.push(this.aArticulo(fila));
      porClave.set(fila.groupKey, grupo);
    }

    const orden_ = orden ?? claves;
    return orden_.map((clave) => porClave.get(clave)).filter((g): g is GrupoDreamlove => !!g);
  }

  /** De la fila de la base de datos al artículo que entiende el adaptador. */
  private aArticulo(fila: {
    externalId: string;
    code: string;
    groupId: string | null;
    groupKey: string;
    title: string;
    groupTitle: string | null;
    shortDescription: string | null;
    descriptionHtml: string | null;
    brand: string | null;
    brandRoot: string | null;
    costCents: number;
    rrpCents: number;
    vatPct: Prisma.Decimal;
    currency: string;
    stock: number;
    available: boolean;
    imageUrls: Prisma.JsonValue;
    categoryPath: Prisma.JsonValue;
    categoryName: string | null;
    eans: string[];
    weightGrams: number | null;
    options: Prisma.JsonValue;
    minUnits: number;
    maxUnits: number;
    leadTimeMinDays: number | null;
    leadTimeMaxDays: number | null;
    supplierUrl: string | null;
    onSale: boolean;
    isNew: boolean;
    clearance: boolean;
    supplierUpdatedAt: Date | null;
  }): ArticuloDreamlove {
    return {
      externalId: fila.externalId,
      codigo: fila.code,
      grupoId: fila.groupId,
      claveGrupo: fila.groupKey,
      titulo: fila.title,
      tituloGrupo: fila.groupTitle,
      descripcion: fila.shortDescription ?? '',
      descripcionHtml: fila.descriptionHtml ?? '',
      marca: fila.brand,
      // La jerarquía entera no se guarda —solo servía para navegar por su
      // web—, pero sí su raíz, que es la marca que se importa.
      marcaJerarquia: null,
      marcaRaiz: fila.brandRoot,
      costeCents: fila.costCents,
      pvpRecomendadoCents: fila.rrpCents,
      ivaPct: Number(fila.vatPct),
      moneda: fila.currency,
      // Los portes son del proveedor, no del artículo: los pone el importador
      // desde la configuración y aquí no hacen falta.
      portesPedidoCents: 0,
      stock: fila.stock,
      disponible: fila.available,
      imagenes: listaDeTextos(fila.imageUrls),
      categoria: listaDeTextos(fila.categoryPath),
      categoriaEs: fila.categoryName,
      // La cadena de ancestros solo sirve al leer el fichero, para levantar el
      // árbol del proveedor; en la fila se guarda la principal y nada más.
      categorias: [],
      eans: fila.eans,
      pesoGramos: fila.weightGrams,
      medidasMm: null,
      opciones: objetoDeTextos(fila.options),
      minUnidades: fila.minUnits,
      maxUnidades: fila.maxUnits,
      plazoDias:
        fila.leadTimeMinDays !== null && fila.leadTimeMaxDays !== null
          ? { min: fila.leadTimeMinDays, max: fila.leadTimeMaxDays }
          : null,
      urlProveedor: fila.supplierUrl,
      codigoArancelario: null,
      enOferta: fila.onSale,
      esNovedad: fila.isNew,
      liquidacion: fila.clearance,
      refrigerado: false,
      actualizadoEn: fila.supplierUpdatedAt,
    };
  }
}

/**
 * Texto comparable: en minúsculas y sin tildes.
 *
 * Tiene que hacer lo MISMO que se aplicó al guardar `searchText`, o la
 * búsqueda no encontraría lo que ella misma indexó.
 */
export const normalizar = (texto: string): string =>
  texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/**
 * Escapa lo que en `LIKE` significa otra cosa.
 *
 * Sin esto, buscar «100%» devuelve el catálogo entero —`%` es «cualquier
 * cosa»— y un guion bajo casa con cualquier carácter.
 */
const escaparLike = (texto: string): string => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

const listaDeTextos = (valor: unknown): string[] =>
  Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : [];

const objetoDeTextos = (valor: unknown): Record<string, string> => {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return {};

  const salida: Record<string, string> = {};
  for (const [clave, v] of Object.entries(valor)) {
    if (typeof v === 'string') salida[clave] = v;
  }
  return salida;
};
