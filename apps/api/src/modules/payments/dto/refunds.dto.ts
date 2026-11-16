import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const solicitarReembolsoSchema = z.object({
  orderId: z.string().min(1),
  importeCents: z.number().int().positive(),
  motivo: z.string().trim().min(3).max(500),
  /**
   * Dirección de destino. Se guarda tal cual, sin recortar espacios: un
   * `trim()` silencioso podría "arreglar" una dirección mal pegada y enviar
   * los fondos a un sitio que el cliente no escribió. Es mejor rechazarla.
   */
  direccion: z.string().min(20).max(120).optional(),
  moneda: z.string().trim().max(20).optional(),
  red: z.string().trim().max(40).optional(),
});

export const aprobarReembolsoSchema = z.object({
  /**
   * Confirmación explícita. No aporta seguridad frente a quien llama a la API
   * a mano, pero obliga a la interfaz a pedirla y evita el clic de más en una
   * operación que no se puede deshacer.
   */
  confirmo: z.literal(true),
});

export const rechazarReembolsoSchema = z.object({
  motivo: z.string().trim().min(3).max(500),
});

export class SolicitarReembolsoDto extends createZodDto(solicitarReembolsoSchema) {}
export class AprobarReembolsoDto extends createZodDto(aprobarReembolsoSchema) {}
export class RechazarReembolsoDto extends createZodDto(rechazarReembolsoSchema) {}
