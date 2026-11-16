import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { LOCALES } from '@ecom/shared';

export const crearResenaSchema = z.object({
  productId: z.string().min(1),
  rating: z.number().int().min(1, 'Mínimo 1 estrella').max(5, 'Máximo 5 estrellas'),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().max(3000).optional(),
  locale: z.enum(LOCALES).default('es'),
});

export const moderarResenaSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
});

export const responderResenaSchema = z.object({
  reply: z.string().trim().min(1).max(2000),
});

export const calcularPvpSchema = z.object({
  costeCents: z.number().int().min(0),
  margenObjetivo: z.number().min(0).max(99),
  envioCents: z.number().int().min(0).optional(),
  // El tipo del producto. Sin él el margen se mediría sobre el precio con IVA,
  // que es el fallo que puso productos a la venta perdiendo dinero.
  taxRate: z.number().min(0).max(100).default(21),
  redondear: z.boolean().default(true),
  terminacion: z.number().int().min(0).max(99).default(99),
  margenMinimo: z.number().min(0).max(99).optional(),
});

export class CrearResenaDto extends createZodDto(crearResenaSchema) {}
export class ModerarResenaDto extends createZodDto(moderarResenaSchema) {}
export class ResponderResenaDto extends createZodDto(responderResenaSchema) {}
export class CalcularPvpDto extends createZodDto(calcularPvpSchema) {}
