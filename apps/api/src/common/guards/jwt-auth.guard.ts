import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { UsuarioAutenticado } from '../types/request.js';
import { TokensService } from '../../modules/auth/tokens.service.js';
import { PrismaService } from '../../modules/prisma/prisma.service.js';

/**
 * Guard de autenticación, aplicado de forma global.
 *
 * Por defecto toda ruta exige un access token válido; para abrir una hay que
 * marcarla con `@Public()`. Al revés (proteger explícitamente) es cuestión de
 * tiempo que alguien añada un endpoint y olvide el decorador, dejándolo abierto.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const esPublica = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: UsuarioAutenticado }>();
    const token = this.extraerToken(request);

    // Una ruta pública sigue queriendo saber QUIÉN llama cuando se sabe.
    //
    // El carrito, la ficha de producto y la verificación de edad son públicas
    // —hay que poder comprar sin registrarse— pero cambian de comportamiento
    // si el visitante tiene sesión: el carrito se asocia a su cuenta y le sigue
    // entre dispositivos. Con un `return true` seco, un cliente identificado
    // se trataba como invitado y su carrito no se guardaba en ningún sitio.
    //
    // Aquí un token inválido NO es un error: puede ser uno caducado que quedó
    // en el navegador, y eso no puede impedir seguir comprando como invitado.
    if (esPublica) {
      if (token) {
        try {
          request.user = await this.resolverUsuario(token);
        } catch {
          // Se continúa como anónimo.
        }
      }
      return true;
    }

    if (!token) {
      throw new UnauthorizedException('Falta el token de acceso');
    }

    request.user = await this.resolverUsuario(token);

    return true;
  }

  private async resolverUsuario(token: string): Promise<UsuarioAutenticado> {
    const payload = await this.tokens.verificarAccessToken(token);

    // Se comprueba el usuario en cada petición: una cuenta desactivada o
    // borrada debe perder el acceso al instante, no cuando caduque su token.
    const usuario = await this.prisma.client.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, type: true, isActive: true, deletedAt: true },
    });

    if (!usuario || !usuario.isActive || usuario.deletedAt) {
      throw new UnauthorizedException('La cuenta no está disponible');
    }

    return {
      id: usuario.id,
      email: usuario.email,
      type: usuario.type,
      sessionId: payload.sid,
    };
  }

  private extraerToken(request: FastifyRequest): string | undefined {
    const cabecera = request.headers.authorization;
    if (!cabecera) return undefined;
    const [esquema, valor] = cabecera.split(' ');
    return esquema?.toLowerCase() === 'bearer' ? valor : undefined;
  }
}
