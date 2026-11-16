import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { LOCALES } from '@ecom/shared';

export const actualizarPerfilSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s().-]{6,20}$/, 'Teléfono no válido')
    .optional(),
  locale: z.enum(LOCALES).optional(),
});

export const consentimientoSchema = z.object({
  marketingConsent: z.boolean(),
});

export const invitarSchema = z.object({
  email: z.email('Email no válido').toLowerCase().trim(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  roleIds: z.array(z.string().min(1)).min(1, 'Asigna al menos un rol'),
});

/**
 * Editar una cuenta del personal desde el panel.
 *
 * `roleIds` es el conjunto COMPLETO de roles que debe tener al terminar, no una
 * lista de roles a añadir. La pantalla de edición guarda un estado entero con un
 * botón, y traducir eso a una tanda de «asigna este» y «quita ese otro» desde el
 * navegador deja la cuenta a medias en cuanto una de las peticiones falla.
 *
 * Todos los campos son opcionales porque no siempre se editan los tres: mandar
 * solo `roleIds` no debe borrar el nombre.
 */
export const editarUsuarioSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    roleIds: z.array(z.string().min(1)).min(1, 'La cuenta necesita al menos un rol').optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay nada que cambiar' });

export const estadoUsuarioSchema = z.object({
  isActive: z.boolean(),
});

export const aceptarInvitacionSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(10, 'Debe tener al menos 10 caracteres')
    .max(128)
    .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
      message: 'Debe incluir mayúsculas, minúsculas y algún número',
    }),
});

export const listarUsuariosSchema = z.object({
  tipo: z.enum(['CUSTOMER', 'STAFF']).optional(),
  busqueda: z.string().trim().max(120).optional(),
  activos: z.coerce.boolean().optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export class ActualizarPerfilDto extends createZodDto(actualizarPerfilSchema) {}
export class ConsentimientoDto extends createZodDto(consentimientoSchema) {}
export class InvitarDto extends createZodDto(invitarSchema) {}
export class EditarUsuarioDto extends createZodDto(editarUsuarioSchema) {}
export class EstadoUsuarioDto extends createZodDto(estadoUsuarioSchema) {}
export class AceptarInvitacionDto extends createZodDto(aceptarInvitacionSchema) {}
export const listarClientesSchema = z.object({
  busqueda: z.string().max(120).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export class ListarClientesDto extends createZodDto(listarClientesSchema) {}
export class ListarUsuariosDto extends createZodDto(listarUsuariosSchema) {}
