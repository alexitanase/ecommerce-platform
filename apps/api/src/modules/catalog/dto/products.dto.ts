import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { LOCALES } from '@ecom/shared';

/** Identificador para URL: minúsculas, números y guiones. */
const slug = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones simples');

const traduccion = z.object({
  locale: z.enum(LOCALES),
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  slug,
  shortDescription: z.string().trim().max(500).optional(),
  description: z.string().max(20000).optional(),
  metaTitle: z.string().trim().max(70).optional(),
  metaDescription: z.string().trim().max(160).optional(),
});

const variante = z.object({
  sku: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo'),
  barcode: z.string().trim().max(40).optional(),
  // Todos los importes en céntimos como entero: nunca coma flotante.
  priceCents: z.number().int().min(0, 'El precio no puede ser negativo'),
  compareAtCents: z.number().int().min(0).optional(),
  costCents: z.number().int().min(0).optional(),
  weightGrams: z.number().int().min(0).max(1_000_000).optional(),
  stock: z.number().int().min(0).default(0),
  lowStockAlert: z.number().int().min(0).default(5),
  allowBackorder: z.boolean().default(false),
  /** Combinación de opciones: { color: "rojo", talla: "xl" } */
  options: z.record(z.string(), z.string()).optional(),
});

const opcion = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'Solo minúsculas, números y guion bajo'),
  labels: z.array(z.object({ locale: z.enum(LOCALES), name: z.string().trim().min(1).max(60) })),
  values: z.array(
    z.object({
      value: z.string().trim().min(1).max(60),
      labels: z.record(z.string(), z.string()).optional(),
      hexColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, 'Color en formato #rrggbb')
        .optional(),
    }),
  ),
});

export const crearProductoSchema = z
  .object({
    handle: slug,
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
    categoryId: z.string().optional(),
    brandId: z.string().optional(),
    // Tipos de IVA vigentes en España.
    taxRate: z.number().min(0).max(100).default(21),
    isAdult: z.boolean().default(false),
    requiresShipping: z.boolean().default(true),
    translations: z.array(traduccion).min(1, 'Se requiere al menos una traducción'),
    options: z.array(opcion).optional(),
    variants: z.array(variante).min(1, 'Un producto necesita al menos una variante'),
  })
  .superRefine((datos, ctx) => {
    // Un idioma repetido dejaría dos traducciones compitiendo por la misma ficha.
    const locales = datos.translations.map((t) => t.locale);
    if (new Set(locales).size !== locales.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['translations'],
        message: 'Hay idiomas repetidos en las traducciones',
      });
    }

    // Publicar sin precio es un error caro: el cliente compraría a cero euros.
    if (datos.status === 'ACTIVE' && datos.variants.some((v) => v.priceCents === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['variants'],
        message: 'No se puede publicar un producto con alguna variante a precio cero',
      });
    }

    // El precio tachado debe ser mayor que el real; al revés confunde y, si se
    // usa en publicidad, es una práctica comercial engañosa.
    datos.variants.forEach((v, i) => {
      if (v.compareAtCents !== undefined && v.compareAtCents <= v.priceCents) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants', i, 'compareAtCents'],
          message: 'El precio comparativo debe ser mayor que el precio de venta',
        });
      }
    });

    // Si hay varias variantes tienen que distinguirse por opciones; si no, el
    // cliente vería dos filas idénticas sin saber cuál elegir.
    if (datos.variants.length > 1 && (!datos.options || datos.options.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Con varias variantes hay que declarar al menos una opción que las diferencie',
      });
    }
  });

export const actualizarProductoSchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  /**
   * Publicar aun con la ficha incompleta.
   *
   * Va como decisión explícita y no como ajuste global a propósito: se pide
   * producto a producto, queda registrada en la auditoría con lo que se saltó,
   * y el día que llegue una reclamación se puede saber quién lo decidió y qué
   * sabía en ese momento.
   */
  publicarConAvisos: z.boolean().optional(),
  categoryId: z.string().nullable().optional(),
  brandId: z.string().nullable().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  isAdult: z.boolean().optional(),
  translations: z.array(traduccion).optional(),
});

/**
 * Cambios sobre una variante ya existente.
 *
 * Va aparte de `actualizarProductoSchema` porque el precio no es un campo más:
 * cambiarlo obliga a anotar el histórico —de ahí sale el precio más bajo de los
 * últimos 30 días, que es lo que la ley permite anunciar como precio anterior—
 * y a reindexar el buscador. Todo opcional: se manda solo lo que se toca.
 */
export const actualizarVarianteSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[A-Za-z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo')
      .optional(),
    barcode: z.string().trim().max(40).nullable().optional(),
    priceCents: z.number().int().min(0, 'El precio no puede ser negativo').optional(),
    compareAtCents: z.number().int().min(0).nullable().optional(),
    costCents: z.number().int().min(0).nullable().optional(),
    weightGrams: z.number().int().min(0).max(1_000_000).nullable().optional(),
    lowStockAlert: z.number().int().min(0).optional(),
    allowBackorder: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'No hay ningún cambio que guardar');

export const listarProductosSchema = z.object({
  locale: z.enum(LOCALES).default('es'),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  categoryId: z.string().optional(),
  busqueda: z.string().trim().max(120).optional(),
  /**
   * Identificadores concretos, separados por comas.
   *
   * Lo necesita quien guarda una lista de productos elegidos a mano —la
   * portada— para poder enseñar sus nombres al volver a abrir la pantalla:
   * sin esto solo tendría los cuids guardados y pintaría una lista de códigos.
   */
  ids: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined)),
  sinStock: z.coerce.boolean().optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const ajustarStockSchema = z.object({
  stock: z.number().int().min(0),
  nota: z.string().trim().max(300).optional(),
});

export class CrearProductoDto extends createZodDto(crearProductoSchema) {}
export class ActualizarProductoDto extends createZodDto(actualizarProductoSchema) {}
export class ListarProductosDto extends createZodDto(listarProductosSchema) {}
export class AjustarStockDto extends createZodDto(ajustarStockSchema) {}
export class ActualizarVarianteDto extends createZodDto(actualizarVarianteSchema) {}

/**
 * Plazo de entrega fijado a mano.
 *
 * El tope de 180 días no es arbitrario: por encima de eso no es un plazo de
 * entrega, es un error de tecleo, y publicarlo sería peor que no tenerlo.
 */
export const plazoEntregaSchema = z.object({
  dias: z.number().int().min(1).max(180),
});

export class PlazoEntregaDto extends createZodDto(plazoEntregaSchema) {}

/**
 * Margen objetivo que se quiere aplicar a un producto.
 *
 * El tope de 95 % no es un capricho: por encima, la fórmula
 * `pvp = coste / (1 - margen)` dispara el precio a cifras absurdas, y un 99 %
 * tecleado por error multiplicaría el PVP por cien.
 */
export const aplicarMargenSchema = z.object({
  margen: z.number().min(0).max(95),
  /** Devuelve el cálculo sin guardar nada, para previsualizarlo. */
  simular: z.boolean().optional(),
});

export class AplicarMargenDto extends createZodDto(aplicarMargenSchema) {}
