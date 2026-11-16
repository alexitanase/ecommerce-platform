import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const porEmailSchema = z.object({
  email: z.email().trim().toLowerCase(),
});

export const suprimirSchema = z.object({
  email: z.email().trim().toLowerCase(),
  /**
   * Confirmación explícita.
   *
   * La supresión no se puede deshacer: la cuenta queda anonimizada y los datos
   * personales de los pedidos liberados, borrados. Obligar a enviarla evita el
   * clic de más en la operación más destructiva del módulo.
   */
  confirmo: z.literal(true),
});

export const suprimirMiaSchema = z.object({
  confirmo: z.literal(true),
});

export class PorEmailDto extends createZodDto(porEmailSchema) {}
export class SuprimirDto extends createZodDto(suprimirSchema) {}
export class SuprimirMiaDto extends createZodDto(suprimirMiaSchema) {}
