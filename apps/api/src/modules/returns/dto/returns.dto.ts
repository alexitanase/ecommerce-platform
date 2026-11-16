import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const motivo = z.enum([
  'DEFECTIVE',
  'NOT_AS_DESCRIBED',
  'DAMAGED_IN_TRANSIT',
  'WRONG_ITEM',
  'MISSING_ITEM',
  'WITHDRAWAL',
]);

export const solicitarDevolucionSchema = z.object({
  motivo,
  lineas: z
    .array(z.object({ orderItemId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(100),
  nota: z.string().max(2000).optional(),
  /** Fotos del defecto. En una falta de conformidad son la prueba. */
  fotos: z.array(z.url()).max(8).optional(),
});

export const recibirDevolucionSchema = z.object({
  lineas: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        // Estado tal y como llega. Solo "nuevo" y "perfecto" permiten reponer.
        condicion: z.enum(['nuevo', 'perfecto', 'usado', 'dañado', 'incompleto']),
      }),
    )
    .min(1),
});

export const resolverDevolucionSchema = z.object({
  resolucion: z.enum(['REPAIR', 'REPLACE', 'REFUND', 'PRICE_REDUCTION', 'REJECTED']),
  importeCents: z.number().int().min(0).optional(),
  motivoRechazo: z.string().max(500).optional(),
});

export class SolicitarDevolucionDto extends createZodDto(solicitarDevolucionSchema) {}
export class RecibirDevolucionDto extends createZodDto(recibirDevolucionSchema) {}
export class ResolverDevolucionDto extends createZodDto(resolverDevolucionSchema) {}
