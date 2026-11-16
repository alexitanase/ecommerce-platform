import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { LOCALES } from '@ecom/shared';

export const buscarSchema = z.object({
  q: z.string().trim().max(200).default(''),
  locale: z.enum(LOCALES).default('es'),
  categoryId: z.string().optional(),
  /**
   * Categoría por su slug traducido.
   *
   * Es como enlazan el menú y los bloques de portada —`/buscar?categoria=
   * vibradores`—, y hasta ahora la API no lo entendía: el parámetro llegaba,
   * se ignoraba, y entrar en una categoría devolvía el catálogo entero.
   */
  categoria: z.string().trim().max(200).optional(),
  marca: z.string().optional(),
  precioMin: z.coerce.number().int().min(0).optional(),
  precioMax: z.coerce.number().int().min(0).optional(),
  soloDisponibles: z.coerce.boolean().optional(),
  /** Solo lo rebajado. Es lo que sirve la página de ofertas. */
  soloOfertas: z.coerce.boolean().optional(),
  orden: z
    .enum(['relevancia', 'precio_asc', 'precio_desc', 'novedad', 'valoracion', 'descuento'])
    .default('relevancia'),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(60).default(24),
});

export const sugerenciasSchema = z.object({
  q: z.string().trim().max(100),
  locale: z.enum(LOCALES).default('es'),
});

export class BuscarDto extends createZodDto(buscarSchema) {}
export class SugerenciasDto extends createZodDto(sugerenciasSchema) {}
