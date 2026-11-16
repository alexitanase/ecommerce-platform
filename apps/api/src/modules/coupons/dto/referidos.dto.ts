import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Reglas del programa de referidos.
 *
 * Los topes de arriba no son decorativos: un cero de más en el premio convierte
 * el programa en una máquina de regalar dinero, y el fallo no da ningún error
 * —emite cupones y ya está— hasta que se cuadran cuentas semanas después.
 */
export const reglasReferidosSchema = z.object({
  activo: z.boolean().optional(),
  premioReferidorCents: z.number().int().min(0).max(50_000).optional(),
  premioReferidoCents: z.number().int().min(0).max(50_000).optional(),
  pedidoMinimoCents: z.number().int().min(0).max(1_000_000).optional(),
  /** Cero = sin tope de personas por cliente. */
  maximoPorReferidor: z.number().int().min(0).max(1000).optional(),
  diasDeValidez: z.number().int().min(1).max(365).optional(),
});

export class ReglasReferidosDto extends createZodDto(reglasReferidosSchema) {}

export const listarReferidosSchema = z.object({
  estado: z.enum(['PENDIENTE', 'COMPLETADO', 'RECHAZADO']).optional(),
});

export class ListarReferidosDto extends createZodDto(listarReferidosSchema) {}
