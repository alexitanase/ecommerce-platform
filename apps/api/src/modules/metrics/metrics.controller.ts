import {
  Controller,
  VERSION_NEUTRAL,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import type { Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { MetricsService } from './metrics.service.js';

/**
 * Endpoint que raspa Prometheus.
 *
 * Va fuera del prefijo `/api` y sin versionar porque no es parte del contrato
 * público: es infraestructura. Se excluye de la documentación por lo mismo.
 *
 * Es `@Public()` porque Prometheus no tiene sesión, pero eso no significa
 * abierto: exige un token propio. Aquí se publican pedidos por minuto e
 * ingresos, o sea la facturación del negocio; sin token, cualquiera que
 * conozca la URL sabe exactamente cuánto se vende.
 */
@ApiExcludeController()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Get()
  async exportar(
    @Headers('authorization') authorization: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const esperado = this.env.METRICS_TOKEN;

    // Sin token configurado el endpoint no existe, en vez de quedar abierto:
    // olvidarse de configurarlo no puede acabar en una fuga silenciosa.
    if (!esperado) {
      throw new NotFoundException();
    }

    const recibido = authorization?.replace(/^Bearer\s+/i, '') ?? '';

    if (!this.comparaSegura(recibido, esperado)) {
      throw new UnauthorizedException('Token de métricas inválido');
    }

    const cuerpo = await this.metrics.exportar();
    void reply.header('content-type', this.metrics.contentType).send(cuerpo);
  }

  /**
   * Comparación en tiempo constante.
   *
   * Con `===`, el tiempo de respuesta revela cuántos caracteres iniciales
   * acertó el atacante, y el token se reconstruye carácter a carácter.
   */
  private comparaSegura(a: string, b: string): boolean {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
  }
}
