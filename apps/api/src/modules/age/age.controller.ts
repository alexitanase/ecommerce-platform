import {
  Body,
  Controller,
  Inject,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { AgeService } from './age.service.js';
import { VerificarEdadDto } from './dto/age.dto.js';

/**
 * Cookie httpOnly con el identificador del visitante verificado.
 *
 * httpOnly a propósito: si el JavaScript de la página pudiera leerla o
 * escribirla, saltarse la verificación sería escribir una línea en la consola
 * del navegador. Así solo el servidor decide quién está verificado.
 */
export const COOKIE_EDAD = 'age_id';

@ApiTags('Verificación de edad')
@Controller({ path: 'age', version: '1' })
export class AgeController {
  constructor(
    private readonly age: AgeService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Opciones de la cookie de verificación.
   *
   * El `domain` es lo que hace que funcione en producción: la API vive en
   * `api.midominio.com` y la tienda en `midominio.com`, y sin él la cookie se
   * queda en el subdominio de la API. La tienda pinta sus páginas en el
   * servidor y necesita leerla para saber a quién deja pasar; sin compartir el
   * dominio, verificar la edad no servía de nada —la puerta volvía a aparecer
   * en la página siguiente—.
   */
  private get opcionesCookie() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      ...(this.env.COOKIE_DOMAIN ? { domain: this.env.COOKIE_DOMAIN } : {}),
    };
  }

  @Public()
  @Get('status')
  @ApiOperation({ summary: '¿Está verificada la edad de este visitante?' })
  async estado(@Req() req: FastifyRequest, @CurrentUser('id') userId?: string) {
    const visitorId = req.cookies[COOKIE_EDAD];
    return { verificado: await this.age.estaVerificado(visitorId, userId) };
  }

  @Public()
  @Post('verify')
  // Un visitante declara su edad una vez. Un número alto de intentos es
  // alguien probando años hasta que uno pase.
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Declarar la edad para acceder al catálogo +18' })
  async verificar(
    @Body() dto: VerificarEdadDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser('id') userId?: string,
  ) {
    let visitorId = req.cookies[COOKIE_EDAD];

    if (!visitorId) {
      visitorId = crypto.randomBytes(16).toString('hex');
    }

    const resultado = await this.age.verificar({
      visitorId,
      anioNacimiento: dto.anioNacimiento,
      ...(userId ? { userId } : {}),
      ip: req.ip,
      ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}),
    });

    // La cookie solo se pone si la verificación fue favorable: si se pusiera
    // siempre, un menor tendría un identificador con el que reintentar.
    if (resultado.verificado) {
      void reply.setCookie(COOKIE_EDAD, visitorId, {
        ...this.opcionesCookie,
        secure: req.protocol === 'https',
        maxAge: 30 * 86_400,
      });
    }

    return resultado;
  }

  @Public()
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retirar la verificación (dispositivo compartido)' })
  async retirar(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const visitorId = req.cookies[COOKIE_EDAD];
    if (visitorId) await this.age.retirar(visitorId);

    // Con las MISMAS opciones con que se puso: una cookie con `domain` no se
    // borra con una orden sin él, y el visitante se quedaría verificado
    // creyendo que ha cerrado el acceso en un dispositivo compartido.
    void reply.clearCookie(COOKIE_EDAD, this.opcionesCookie);
  }
}
