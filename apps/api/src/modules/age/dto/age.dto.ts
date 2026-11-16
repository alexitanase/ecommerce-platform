import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Solo el año de nacimiento.
 *
 * No se pide la fecha completa: basta para calcular la mayoría de edad y es un
 * dato personal menos que guardar. Recoger de más en el control que existe
 * para proteger a los menores sería contradictorio.
 */
export const verificarEdadSchema = z.object({
  anioNacimiento: z
    .number()
    .int()
    .min(1900, 'Año no válido')
    .max(new Date().getFullYear(), 'El año no puede ser futuro'),
});

export class VerificarEdadDto extends createZodDto(verificarEdadSchema) {}
