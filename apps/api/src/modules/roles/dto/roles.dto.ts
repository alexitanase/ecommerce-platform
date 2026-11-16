import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const clave = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, 'Solo minúsculas, números y guion bajo; debe empezar por letra');

export const crearRolSchema = z.object({
  key: clave,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string()).default([]),
});

export const actualizarRolSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string()).optional(),
});

export const asignarRolSchema = z.object({
  roleId: z.string().min(1),
});

export class CrearRolDto extends createZodDto(crearRolSchema) {}
export class ActualizarRolDto extends createZodDto(actualizarRolSchema) {}
export class AsignarRolDto extends createZodDto(asignarRolSchema) {}
