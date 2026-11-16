import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const enlaceSchema = z.object({
  base: z.url('Tiene que ser una dirección completa, con https://'),
  fuente: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9._-]+$/, 'Solo minúsculas, números, punto, guion y guion bajo'),
  medio: z
    .string()
    .trim()
    .max(60)
    .regex(/^[a-z0-9._-]*$/)
    .optional(),
  campana: z
    .string()
    .trim()
    .max(60)
    .regex(/^[a-z0-9._-]*$/)
    .optional(),
});

export class EnlaceDto extends createZodDto(enlaceSchema) {}

export const informeCanalesSchema = z.object({
  desde: z.iso.datetime({ offset: true }).optional(),
  hasta: z.iso.datetime({ offset: true }).optional(),
});

export class InformeCanalesDto extends createZodDto(informeCanalesSchema) {}

export const crearAfiliadoSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  /** Viaja en el enlace y se dicta por teléfono: corto y sin ambigüedades. */
  code: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, 'Solo letras, números y guion'),
  /**
   * Sobre la base imponible de las líneas.
   *
   * El tope de 50 no es caprichoso: por encima, la comisión se come el margen
   * de un dropshipping entero y el error de teclear un cero de más costaría
   * dinero real en cada venta.
   */
  commissionPercent: z.number().min(0).max(50),
  payoutNotes: z.string().trim().max(500).optional(),
});

export class CrearAfiliadoDto extends createZodDto(crearAfiliadoSchema) {}

export const actualizarAfiliadoSchema = z.object({
  commissionPercent: z.number().min(0).max(50).optional(),
  status: z.enum(['ACTIVO', 'PAUSADO', 'BAJA']).optional(),
  payoutNotes: z.string().trim().max(500).optional(),
});

export class ActualizarAfiliadoDto extends createZodDto(actualizarAfiliadoSchema) {}
