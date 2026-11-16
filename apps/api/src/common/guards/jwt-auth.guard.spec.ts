import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { TokensService } from '../../modules/auth/tokens.service.js';
import type { PrismaService } from '../../modules/prisma/prisma.service.js';

/**
 * Comportamiento del guard en rutas públicas y protegidas.
 *
 * Lo que se protege aquí: una ruta pública tiene que identificar al visitante
 * cuando trae token —el carrito lo necesita para asociarse a su cuenta— pero
 * jamás puede rechazarle por traer uno caducado, o dejaría de poder comprar
 * como invitado.
 */

interface UsuarioFalso {
  id: string;
  email: string;
  type: string;
  isActive: boolean;
  deletedAt: Date | null;
}

const USUARIO: UsuarioFalso = {
  id: 'u1',
  email: 'ana@ejemplo.es',
  type: 'CUSTOMER',
  isActive: true,
  deletedAt: null,
};

function montar(opciones: {
  publica: boolean;
  token?: string;
  tokenValido?: boolean;
  usuario?: UsuarioFalso | null;
}) {
  const request: { headers: Record<string, string>; user?: unknown } = {
    headers: opciones.token ? { authorization: `Bearer ${opciones.token}` } : {},
  };

  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(opciones.publica),
  } as unknown as Reflector;

  const tokens = {
    verificarAccessToken: vi.fn(() => {
      if (opciones.tokenValido === false) {
        return Promise.reject(new UnauthorizedException('Token inválido'));
      }
      return Promise.resolve({ sub: 'u1', sid: 's1', typ: 'CUSTOMER' });
    }),
  } as unknown as TokensService;

  const prisma = {
    client: {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue(opciones.usuario === undefined ? USUARIO : opciones.usuario),
      },
    },
  } as unknown as PrismaService;

  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;

  return { guard: new JwtAuthGuard(reflector, tokens, prisma), context, request };
}

describe('Guard de autenticación', () => {
  describe('rutas públicas', () => {
    it('deja pasar sin token y sin identificar a nadie', async () => {
      const { guard, context, request } = montar({ publica: true });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it('identifica al visitante cuando trae un token válido', async () => {
      // Sin esto, un cliente con sesión abierta se trataba como invitado y su
      // carrito no quedaba asociado a su cuenta: no le seguía entre
      // dispositivos y no había forma de recuperarlo.
      const { guard, context, request } = montar({ publica: true, token: 'bueno' });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toMatchObject({ id: 'u1', email: 'ana@ejemplo.es' });
    });

    it('con un token caducado deja seguir como invitado, no rechaza', async () => {
      // Un token viejo olvidado en el navegador no puede impedir comprar.
      const { guard, context, request } = montar({
        publica: true,
        token: 'caducado',
        tokenValido: false,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it('una cuenta desactivada tampoco bloquea la compra como invitado', async () => {
      const { guard, context, request } = montar({
        publica: true,
        token: 'bueno',
        usuario: { ...USUARIO, isActive: false },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });
  });

  describe('rutas protegidas', () => {
    it('rechaza si no hay token', async () => {
      const { guard, context } = montar({ publica: false });
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza un token inválido', async () => {
      const { guard, context } = montar({
        publica: false,
        token: 'malo',
        tokenValido: false,
      });
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza a un usuario que ya no existe', async () => {
      const { guard, context } = montar({ publica: false, token: 'bueno', usuario: null });
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza a una cuenta desactivada aunque el token sea válido', async () => {
      // La cuenta pierde el acceso al instante, sin esperar a que caduque.
      const { guard, context } = montar({
        publica: false,
        token: 'bueno',
        usuario: { ...USUARIO, isActive: false },
      });
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza a una cuenta borrada', async () => {
      const { guard, context } = montar({
        publica: false,
        token: 'bueno',
        usuario: { ...USUARIO, deletedAt: new Date() },
      });
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('deja pasar e identifica cuando todo es correcto', async () => {
      const { guard, context, request } = montar({ publica: false, token: 'bueno' });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toMatchObject({ id: 'u1', sessionId: 's1' });
    });
  });
});
