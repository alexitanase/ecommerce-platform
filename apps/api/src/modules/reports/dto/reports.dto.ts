import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const rangoSchema = z.object({
  desde: z.iso.datetime({ offset: true }).optional(),
  hasta: z.iso.datetime({ offset: true }).optional(),
});

export class RangoDto extends createZodDto(rangoSchema) {}

/** Trimestre natural a declarar. Sin indicarlo se coge el anterior al de hoy. */
export const trimestreSchema = z.object({
  anio: z.coerce.number().int().min(2020).max(2100).optional(),
  trimestre: z.coerce.number().int().min(1).max(4).optional(),
});

export class TrimestreDto extends createZodDto(trimestreSchema) {}

/**
 * Conversión de cripto a euros.
 *
 * `amount` va como texto y no como número: las cantidades en cripto llegan a
 * dieciocho decimales y un `number` de JSON los pierde en silencio. El error no
 * se vería hasta que el saldo dejara de cuadrar.
 */
export const conversionCriptoSchema = z.object({
  currency: z.string().trim().min(2).max(20),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,18})?$/, 'La cantidad debe ser un número decimal positivo'),
  proceedsCents: z.number().int().positive(),
  feeCents: z.number().int().min(0).optional(),
  venue: z.string().trim().max(100).optional(),
  reference: z.string().trim().max(200).optional(),
  txHash: z.string().trim().max(200).optional(),
  settledAt: z.iso.datetime({ offset: true }),
});

export class ConversionCriptoDto extends createZodDto(conversionCriptoSchema) {}
