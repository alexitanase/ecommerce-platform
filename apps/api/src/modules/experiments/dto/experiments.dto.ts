import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const variante = z.object({
  /** Corta y legible: aparece en el panel y en la auditoría. */
  clave: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[a-z0-9-]+$/, 'Solo minúsculas, números y guion'),
  peso: z.number().int().min(0).max(100),
  /** Lo interpreta la tienda: un texto, unos céntimos, el nombre de un diseño. */
  valor: z.unknown(),
});

export const crearExperimentoSchema = z.object({
  key: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Solo minúsculas, números y guion'),
  name: z.string().trim().min(3).max(120),
  /**
   * Qué se espera que pase.
   *
   * Opcional pero se pide en el formulario: escribirlo ANTES de mirar los
   * datos es lo que impide encontrar después una explicación bonita para
   * cualquier resultado que haya salido.
   */
  hypothesis: z.string().trim().max(500).optional(),
  variantes: z.array(variante).min(2).max(5),
});

export class CrearExperimentoDto extends createZodDto(crearExperimentoSchema) {}

export const estadoExperimentoSchema = z.object({
  estado: z.enum(['BORRADOR', 'ACTIVO', 'PARADO']),
});

export class EstadoExperimentoDto extends createZodDto(estadoExperimentoSchema) {}

export const ganadoraSchema = z.object({
  variante: z.string().trim().min(1).max(20),
});

export class GanadoraDto extends createZodDto(ganadoraSchema) {}

export const asignacionSchema = z.object({
  /**
   * Identificador anónimo de quien navega.
   *
   * Lo genera el navegador y no se cruza con la cuenta: no identifica a nadie,
   * solo permite que la misma persona vea siempre la misma variante.
   */
  visitante: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'Identificador no válido'),
});

export class AsignacionDto extends createZodDto(asignacionSchema) {}
