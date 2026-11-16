import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const iniciarCobroSchema = z.object({
  orderId: z.string().min(1),
  provider: z.enum(['nowpayments', 'revolut', 'stripe', 'paypal']).optional(),
  /** Moneda en la que quiere pagar el cliente: BTC, ETH, USDTTRC20… */
  payCurrency: z.string().trim().max(20).optional(),
});

export class IniciarCobroDto extends createZodDto(iniciarCobroSchema) {}

/**
 * Configuración de las formas de pago.
 *
 * Deliberadamente no hay campo para credenciales: las claves de la pasarela
 * viven en el entorno, no en la base de datos. Guardarlas aquí significaría que
 * una filtración de la base entrega también la cuenta de cobro, y que cualquiera
 * con acceso al panel puede leerlas.
 */
export const configPasarelaSchema = z.object({
  key: z.enum(['nowpayments', 'revolut', 'stripe', 'paypal']),
  activa: z.boolean(),
  orden: z.number().int().min(0).max(99),
  minCents: z.number().int().min(0),
  maxCents: z.number().int().min(0).nullable(),
});

export const guardarPasarelasSchema = z.object({
  pasarelas: z.array(configPasarelaSchema).min(1),
});

export class GuardarPasarelasDto extends createZodDto(guardarPasarelasSchema) {}
