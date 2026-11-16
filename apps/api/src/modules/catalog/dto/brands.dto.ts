import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Una marca es un nombre propio: no lleva traducciones ni descripción.
 *
 * El identificador tampoco se pide: se deriva del nombre. Dejarlo escribir a
 * mano solo abre la puerta a que la misma marca entre dos veces con dos
 * identificadores distintos, que es justo lo que se quiere evitar.
 */
export const crearMarcaSchema = z.object({
  name: z.string().trim().min(1, 'La marca necesita un nombre').max(120),
  logoUrl: z.url().max(500).optional(),
});

export const actualizarMarcaSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  // Nula a propósito: es como se quita un logotipo que estaba mal.
  logoUrl: z.url().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

export class CrearMarcaDto extends createZodDto(crearMarcaSchema) {}
export class ActualizarMarcaDto extends createZodDto(actualizarMarcaSchema) {}
