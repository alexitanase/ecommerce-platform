import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UsuarioAutenticado } from '../types/request.js';

/**
 * Inyecta el usuario autenticado en el handler.
 *
 *   @Get('perfil')
 *   perfil(@CurrentUser() usuario: UsuarioAutenticado) { … }
 *   perfil(@CurrentUser('id') userId: string) { … }
 */
export const CurrentUser = createParamDecorator(
  (campo: keyof UsuarioAutenticado | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: UsuarioAutenticado }>();
    const usuario = request.user;
    if (!usuario) return undefined;
    return campo ? usuario[campo] : usuario;
  },
);
