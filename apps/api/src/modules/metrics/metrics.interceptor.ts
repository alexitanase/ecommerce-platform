import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MetricsService } from './metrics.service.js';

/**
 * Mide cada petición HTTP.
 *
 * La etiqueta `route` usa el patrón de la ruta (`/products/:slug`), nunca la
 * URL concreta. Con la URL real, cada producto generaría su propia serie
 * temporal y Prometheus acabaría con cientos de miles de series por una sola
 * métrica: es la forma más habitual de tumbar el sistema de monitorización con
 * el propio sistema de monitorización.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest & { routeOptions?: { url?: string } }>();
    const inicio = process.hrtime.bigint();

    const registrar = (status: number): void => {
      const segundos = Number(process.hrtime.bigint() - inicio) / 1e9;
      const etiquetas = {
        method: request.method,
        route: request.routeOptions?.url ?? 'desconocida',
        status: String(status),
      };

      this.metrics.httpDuracion.observe(etiquetas, segundos);
      this.metrics.httpTotal.inc(etiquetas);
    };

    return next.handle().pipe(
      tap({
        next: () => {
          registrar(http.getResponse<FastifyReply>().statusCode);
        },
        // Un error también es una petición atendida: sin esto, la tasa de error
        // que se calcula a partir de esta métrica saldría siempre en cero.
        error: (error: unknown) => {
          const status =
            typeof error === 'object' && error !== null && 'status' in error
              ? Number(error.status)
              : 500;
          registrar(Number.isFinite(status) ? status : 500);
        },
      }),
    );
  }
}
