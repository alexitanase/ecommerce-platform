import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { LOCALES } from '@ecom/shared';

const slug = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones simples');

const traduccion = z.object({
  locale: z.enum(LOCALES),
  name: z.string().trim().min(1).max(120),
  slug,
  description: z.string().trim().max(2000).optional(),
});

export const crearCategoriaSchema = z.object({
  handle: slug,
  parentId: z.string().optional(),
  position: z.number().int().min(0).optional(),
  isAdult: z.boolean().default(false),
  translations: z.array(traduccion).min(1, 'Se requiere al menos una traducción'),
});

export const actualizarCategoriaSchema = z.object({
  position: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  isAdult: z.boolean().optional(),
  imageUrl: z.url().optional(),
  translations: z.array(traduccion).optional(),
});

export const moverCategoriaSchema = z.object({
  parentId: z.string().nullable(),
});

export const arbolCategoriasSchema = z.object({
  locale: z.enum(LOCALES).default('es'),
  incluirInactivas: z.coerce.boolean().default(false),
});

export class CrearCategoriaDto extends createZodDto(crearCategoriaSchema) {}
export class ActualizarCategoriaDto extends createZodDto(actualizarCategoriaSchema) {}
export class MoverCategoriaDto extends createZodDto(moverCategoriaSchema) {}
export class ArbolCategoriasDto extends createZodDto(arbolCategoriasSchema) {}

// ── Atributos ───────────────────────────────────────────────

const tipoAtributo = z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'SELECT', 'MULTISELECT']);

export const crearAtributoSchema = z.object({
  /** Clave técnica: se usa en el índice de búsqueda, así que sin espacios. */
  key: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'Solo minúsculas, números y guion bajo'),
  type: tipoAtributo,
  /** Unidad que se muestra junto al valor: "cm", "g", "W". */
  unit: z.string().max(12).optional(),
  isFilterable: z.boolean().default(true),
  isVisible: z.boolean().default(true),
  options: z.array(z.string().min(1).max(60)).max(100).optional(),
  labels: z.record(z.string(), z.string().max(80)).optional(),
});

export const actualizarAtributoSchema = z.object({
  unit: z.string().max(12).nullable().optional(),
  isFilterable: z.boolean().optional(),
  isVisible: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  options: z.array(z.string().min(1).max(60)).max(100).optional(),
  labels: z.record(z.string(), z.string().max(80)).optional(),
});

export class CrearAtributoDto extends createZodDto(crearAtributoSchema) {}
export class ActualizarAtributoDto extends createZodDto(actualizarAtributoSchema) {}
