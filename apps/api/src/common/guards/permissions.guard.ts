import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator.js';
import type { UsuarioAutenticado } from '../types/request.js';
import { PermissionsService } from '../../modules/auth/permissions.service.js';

/**
 * Comprueba los permisos declarados con `@RequirePermissions(...)`.
 *
 * Se apoya en la caché de Redis, así que el coste por petición es una lectura
 * de sub-milisegundo y no dos JOIN contra Postgres.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permisos: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requeridos = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requeridos || requeridos.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: UsuarioAutenticado }>();
    const usuario = request.user;

    // Sin usuario en la petición, o el guard de JWT no corrió o la ruta es
    // pública: en cualquier caso, exigir permisos aquí no tendría sentido.
    if (!usuario) {
      throw new ForbiddenException('Se requiere autenticación');
    }

    const autorizado = await this.permisos.tiene(usuario.id, requeridos);
    if (!autorizado) {
      throw new ForbiddenException(
        `No tienes permiso para esta acción. Se requiere: ${requeridos.join(', ')}`,
      );
    }

    return true;
  }
}
