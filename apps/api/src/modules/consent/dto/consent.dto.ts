import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const registrarConsentimientoSchema = z.object({
  analiticas: z.boolean(),
  marketing: z.boolean(),
  version: z.number().int().min(1).max(1000),
});

export class RegistrarConsentimientoDto extends createZodDto(registrarConsentimientoSchema) {}

/**
 * Cambio de preferencias de correo.
 *
 * Todos los campos son opcionales: la pantalla puede mandar solo lo que el
 * cliente ha tocado, y así dos pestañas abiertas no se pisan las elecciones.
 */
export const actualizarPreferenciasSchema = z.object({
  cartRecovery: z.boolean().optional(),
  reviewInvites: z.boolean().optional(),
  offers: z.boolean().optional(),
  newsletter: z.boolean().optional(),
});

export class ActualizarPreferenciasDto extends createZodDto(actualizarPreferenciasSchema) {}

/**
 * Alta en la newsletter.
 *
 * Solo el correo: pedir más datos en un formulario de suscripción baja la
 * conversión y, sobre todo, no hacen falta para la finalidad.
 */
export const altaNewsletterSchema = z.object({
  email: z.email('Email no válido').toLowerCase().trim(),
});

export class AltaNewsletterDto extends createZodDto(altaNewsletterSchema) {}
