import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { LOCALES } from '@ecom/shared';

/**
 * Requisitos de contraseña.
 *
 * Longitud mínima de 10 en lugar de las 8 habituales, y sin exigir símbolos:
 * la guía del NIST prioriza longitud sobre composición, porque obligar a
 * caracteres raros produce contraseñas del tipo `Password1!` que son fáciles
 * de adivinar y difíciles de recordar.
 */
const password = z
  .string()
  .min(10, 'Debe tener al menos 10 caracteres')
  .max(128, 'No puede superar los 128 caracteres')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'Debe incluir mayúsculas, minúsculas y algún número',
  });

const email = z.email('Email no válido').toLowerCase().trim().max(255);

export const registerSchema = z.object({
  email,
  password,
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  locale: z.enum(LOCALES).default('es'),
  /** Consentimiento explícito de marketing; por defecto NO (RGPD). */
  marketingConsent: z.boolean().default(false),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'La contraseña es obligatoria'),
  /** Código TOTP, obligatorio si la cuenta tiene 2FA activo. */
  totpCode: z
    .string()
    .regex(/^\d{6}$/, 'El código debe tener 6 dígitos')
    .optional(),
});

export const refreshSchema = z.object({
  /** Opcional: si no llega en el cuerpo, se lee de la cookie httpOnly. */
  refreshToken: z.string().min(1).optional(),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

export const verifyEmailSchema = z.object({ token: z.string().min(1) });

export const enable2faSchema = z.object({
  totpCode: z.string().regex(/^\d{6}$/, 'El código debe tener 6 dígitos'),
});

export const disable2faSchema = z.object({
  password: z.string().min(1),
  totpCode: z.string().regex(/^\d{6}$/, 'El código debe tener 6 dígitos'),
});

export class RegisterDto extends createZodDto(registerSchema) {}
export class LoginDto extends createZodDto(loginSchema) {}
export class RefreshDto extends createZodDto(refreshSchema) {}
export class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
export class VerifyEmailDto extends createZodDto(verifyEmailSchema) {}
export class Enable2faDto extends createZodDto(enable2faSchema) {}
export class Disable2faDto extends createZodDto(disable2faSchema) {}
