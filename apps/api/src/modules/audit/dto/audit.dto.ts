import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const consultarAuditoriaSchema = z.object({
  actorId: z.string().optional(),
  /** Tipo de recurso: order, product, user… */
  resource: z.string().max(60).optional(),
  resourceId: z.string().optional(),
  /** Prefijo de acción: "order." trae todas las de pedidos. */
  action: z.string().max(60).optional(),
  desde: z.iso.datetime({ offset: true }).optional(),
  hasta: z.iso.datetime({ offset: true }).optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

export class ConsultarAuditoriaDto extends createZodDto(consultarAuditoriaSchema) {}
