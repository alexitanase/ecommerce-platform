import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Validación de direcciones.
 *
 * El código postal se valida según el país: en España son 5 dígitos y los dos
 * primeros identifican la provincia (01–52), así que un "99999" es imposible y
 * conviene rechazarlo antes de mandar el pedido al proveedor. Una dirección mal
 * validada en dropshipping significa un paquete perdido a medio camino de China.
 */
const PATRONES_CP: Record<string, RegExp> = {
  ES: /^(?:0[1-9]|[1-4]\d|5[0-2])\d{3}$/,
  PT: /^\d{4}-\d{3}$/,
  FR: /^\d{5}$/,
  IT: /^\d{5}$/,
  DE: /^\d{5}$/,
  AD: /^AD\d{3}$/,
};

const base = z.object({
  type: z.enum(['SHIPPING', 'BILLING']).default('SHIPPING'),
  firstName: z.string().trim().min(1, 'El nombre es obligatorio').max(100),
  lastName: z.string().trim().min(1, 'Los apellidos son obligatorios').max(100),
  company: z.string().trim().max(150).optional(),
  taxId: z.string().trim().max(30).optional(),
  line1: z.string().trim().min(3, 'La dirección es obligatoria').max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, 'La localidad es obligatoria').max(120),
  province: z.string().trim().min(1, 'La provincia es obligatoria').max(120),
  postalCode: z.string().trim().min(3).max(12),
  countryCode: z
    .string()
    .trim()
    .length(2, 'Código de país ISO de 2 letras')
    .toUpperCase()
    .default('ES'),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s().-]{6,20}$/, 'Teléfono no válido')
    .optional(),
  isDefault: z.boolean().default(false),
});

/** Comprueba que el código postal encaja con el país indicado. */
const conCpCoherente = <T extends z.ZodType>(schema: T) =>
  schema.superRefine((datos, ctx) => {
    const d = datos as { countryCode?: string; postalCode?: string };
    if (!d.countryCode || !d.postalCode) return;

    const patron = PATRONES_CP[d.countryCode];
    if (patron && !patron.test(d.postalCode)) {
      ctx.addIssue({
        code: 'custom',
        path: ['postalCode'],
        message: `El código postal no es válido para ${d.countryCode}`,
      });
    }
  });

export const crearDireccionSchema = conCpCoherente(base);
export const actualizarDireccionSchema = conCpCoherente(base.partial());

export class CrearDireccionDto extends createZodDto(crearDireccionSchema) {}
export class ActualizarDireccionDto extends createZodDto(actualizarDireccionSchema) {}
