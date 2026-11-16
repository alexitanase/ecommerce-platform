import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { LOCALES } from '@ecom/shared';

/**
 * País desde el que sale la mercancía.
 *
 * Decide el IVA de cada venta que sirva este proveedor, así que un país mal
 * puesto no da ningún error: da una factura equivocada. Por eso se valida como
 * código ISO de dos letras en mayúscula y no como texto libre.
 */
const paisOrigen = z.string().trim().length(2).toUpperCase();

export const crearProveedorSchema = z.object({
  key: z.enum(['aliexpress', 'dreamlove', 'mock']),
  name: z.string().trim().min(2).max(80),
  credentials: z.record(z.string(), z.string()).optional(),
  defaultMarginPct: z.number().min(0).max(99).optional(),
  minMarginPct: z.number().min(0).max(99).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  shipsFromCountry: paisOrigen.optional(),
});

export const actualizarProveedorSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  defaultMarginPct: z.number().min(0).max(99).optional(),
  minMarginPct: z.number().min(0).max(99).optional(),
  priceEnding: z.number().int().min(0).max(99).optional(),
  includeShipping: z.boolean().optional(),
  /*
   * Lo que el proveedor añade AL PAGAR y su API no dice.
   *
   * El tope es 100 y no 99: no es un margen —que por definición no puede llegar
   * al 100 %— sino un recargo, y un impuesto de importación que doble el precio
   * es perfectamente posible en algunos destinos.
   */
  purchaseSurchargePct: z.number().min(0).max(100).optional(),
  /** Cargo fijo por categoría en importaciones de bajo valor, en céntimos. */
  importFeeCents: z.number().int().min(0).max(100_000).optional(),
  importFeeThresholdCents: z.number().int().min(0).max(10_000_000).optional(),
  syncIntervalMinutes: z.number().int().min(15).max(10080).optional(),
  shipsFromCountry: paisOrigen.optional(),
  /**
   * Portes que cobra el proveedor por PEDIDO.
   *
   * Distinto de repercutir el envío en cada artículo: es un cargo único por
   * compra, el que aplica quien no tiene API y sirve desde un almacén.
   */
  orderShippingCents: z.number().int().min(0).max(100_000).optional(),
  /** Importe a partir del cual esos portes no se cobran; 0 = siempre se pagan. */
  freeShippingThresholdCents: z.number().int().min(0).max(10_000_000).optional(),
});

export const credencialesSchema = z.object({
  credentials: z.record(z.string(), z.string()),
});

export const buscarProveedorSchema = z.object({
  q: z.string().trim().max(200).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(50).default(20),
  orden: z.enum(['relevancia', 'precio_asc', 'precio_desc', 'ventas']).optional(),
});

export const importarSchema = z.object({
  externalId: z.string().min(1),
  categoryId: z.string().optional(),
  /**
   * Marca elegida a mano al importar.
   *
   * Sin ella se usa la que declare el proveedor, creándola si no existe. Se
   * puede forzar porque el nombre del fichero no siempre es el bueno: llegan
   * gamas disfrazadas de marca y erratas del propio proveedor.
   */
  brandId: z.string().optional(),
  margenPersonalizado: z.number().min(0).max(99).optional(),
  descargarImagenes: z.boolean().default(true),
  locale: z.enum(LOCALES).default('es'),
});

/**
 * Subir a la tienda el catálogo entero de un proveedor sin API.
 *
 * Todo tiene valor por defecto y el valor por defecto es lo que se quiere el
 * 99 % de las veces: el catálogo completo, al PVP que recomienda el proveedor,
 * publicado y con fotos. Los interruptores están para la primera prueba y para
 * los casos raros, no para obligar a decidir cinco cosas antes de empezar.
 */
export const importarCatalogoSchema = z.object({
  precio: z.enum(['pvpr', 'margen']).default('pvpr'),
  publicar: z.boolean().default(true),
  /**
   * Repreciar lo que ya está importado.
   *
   * Por defecto sí: la regla de la casa es que el precio lo pone el proveedor,
   * y una pasada que no lo traslade deja la tienda con los precios del catálogo
   * anterior. Se puede apagar para arreglar categorías, marcas o existencias
   * sin mover el escaparate en mitad de una campaña.
   */
  actualizarPrecios: z.boolean().default(true),
  descargarImagenes: z.boolean().default(true),
  soloDisponibles: z.boolean().default(false),
  /** Tope de familias, para probar con unas pocas antes de soltar el catálogo. */
  limite: z.number().int().min(1).max(50_000).optional(),
});

export const sincronizarSchema = z.object({
  tipo: z.enum(['incremental', 'completa']).default('incremental'),
  limite: z.number().int().min(1).max(5000).optional(),
});

export class CrearProveedorDto extends createZodDto(crearProveedorSchema) {}
export class ActualizarProveedorDto extends createZodDto(actualizarProveedorSchema) {}
export class CredencialesDto extends createZodDto(credencialesSchema) {}
export class BuscarProveedorDto extends createZodDto(buscarProveedorSchema) {}
export class ImportarDto extends createZodDto(importarSchema) {}
export class ImportarCatalogoDto extends createZodDto(importarCatalogoSchema) {}
export class SincronizarDto extends createZodDto(sincronizarSchema) {}
