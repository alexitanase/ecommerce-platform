import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const solicitarDesistimientoSchema = z.object({
  lineas: z
    .array(z.object({ orderItemId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(100),
  /**
   * El cliente NO está obligado a motivar su desistimiento (art. 102.1).
   * Se pregunta para mejorar el catálogo, nunca para decidir si se acepta.
   */
  motivo: z.string().max(200).optional(),
  nota: z.string().max(2000).optional(),
});

export const cambiarEstadoSchema = z.object({
  estado: z.enum(['ACCEPTED', 'RECEIVED', 'REFUNDED', 'REJECTED', 'CANCELLED']),
  motivoRechazo: z.string().max(500).optional(),
});

export class SolicitarDesistimientoDto extends createZodDto(solicitarDesistimientoSchema) {}
export class CambiarEstadoDesistimientoDto extends createZodDto(cambiarEstadoSchema) {}
