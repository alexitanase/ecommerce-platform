import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const comprobarCuponSchema = z.object({
  codigo: z.string().min(2).max(40),
  lineas: z
    .array(
      z.object({
        productId: z.string().min(1),
        categoryId: z.string().nullable(),
        totalCents: z.number().int().min(0),
      }),
    )
    .max(100),
  subtotalCents: z.number().int().min(0),
  email: z.email().optional(),
});

export const crearCuponSchema = z.object({
  /** Se guarda en mayúsculas: los clientes lo escriben como quieren. */
  code: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Solo letras, números, guion y guion bajo'),
  type: z.enum(['PERCENTAGE', 'FIXED', 'FREE_SHIPPING']),
  value: z.number().int().min(0).max(1_000_000),
  maxDiscountCents: z.number().int().min(1).nullable().optional(),
  minOrderCents: z.number().int().min(0).optional(),
  maxUses: z.number().int().min(1).nullable().optional(),
  maxUsesPerCustomer: z.number().int().min(1).max(100).optional(),
  validFrom: z.iso.datetime({ offset: true }).optional(),
  validUntil: z.iso.datetime({ offset: true }).nullable().optional(),
  categoryIds: z.array(z.string()).max(50).optional(),
  excludedProductIds: z.array(z.string()).max(200).optional(),
  internalNote: z.string().max(300).optional(),
});

export const actualizarCuponSchema = z.object({
  isActive: z.boolean().optional(),
  validUntil: z.iso.datetime({ offset: true }).nullable().optional(),
  maxUses: z.number().int().min(1).nullable().optional(),
});

export class ComprobarCuponDto extends createZodDto(comprobarCuponSchema) {}
export class CrearCuponDto extends createZodDto(crearCuponSchema) {}
export class ActualizarCuponDto extends createZodDto(actualizarCuponSchema) {}
