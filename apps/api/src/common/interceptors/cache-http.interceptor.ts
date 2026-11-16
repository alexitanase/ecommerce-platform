import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CACHE_HTTP, type OpcionesCacheHttp } from '../decorators/cache-http.decorator.js';
import { CABECERA_BUSCADOR } from '../../modules/age/buscador.js';

/**
 * Cabeceras de caché y ETag para las respuestas públicas.
 *
 * Dos efectos distintos:
 *
 * - `Cache-Control` deja que el CDN responda sin llegar a la API. Es lo que
 *   convierte un pico de campaña en tráfico que ni nos roza.
 * - El `ETag` ahorra el cuerpo cuando el cliente ya lo tiene: la ficha de un
 *   producto son decenas de KB y devolver 304 evita mandarlos otra vez.
 */
@Injectable()
export class CacheHttpInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const opciones = this.reflector.getAllAndOverride<OpcionesCacheHttp | undefined>(CACHE_HTTP, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!opciones) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    // Una respuesta que depende de quién la pide no puede guardarse en una
    // caché compartida: el CDN se la serviría a otro cliente. Es la forma más
    // fácil de filtrar el carrito o los datos de una persona a un desconocido.
    //
    // Lo mismo con el aviso de buscador verificado: a Google se le sirve la
    // ficha +18 completa, y esa copia no puede acabar en un CDN que se la
    // entregue a un visitante sin verificar.
    if (
      request.headers.authorization ??
      request.headers.cookie ??
      request.headers[CABECERA_BUSCADOR]
    ) {
      void reply.header('cache-control', 'private, no-store');
      return next.handle();
    }

    return next.handle().pipe(
      map((cuerpo: unknown) => {
        const partes = [
          `public`,
          `max-age=${opciones.navegador ?? 0}`,
          `s-maxage=${opciones.compartida}`,
        ];

        if (opciones.mientrasRevalida) {
          partes.push(`stale-while-revalidate=${opciones.mientrasRevalida}`);
        }

        void reply.header('cache-control', partes.join(', '));

        // Vary por idioma y por cookie. El idioma es evidente: sin él, el CDN
        // serviría catalán a quien pidió castellano.
        //
        // La cookie importa por la verificación de edad: una ficha +18 responde
        // 404 a quien no está verificado. Sin este Vary, ese 404 quedaría
        // cacheado y se le serviría también a quien SÍ se verificó —o peor, al
        // revés: la ficha de un producto para adultos servida a alguien sin
        // verificar.
        // El aviso de buscador, por lo mismo: sin él, un CDN delante de la API
        // le devolvería al robot la copia guardada para un anónimo, el 403.
        void reply.header('vary', `Accept-Language, Accept-Encoding, Cookie, ${CABECERA_BUSCADOR}`);

        const etag = this.etag(cuerpo);
        void reply.header('etag', etag);

        if (request.headers['if-none-match'] === etag) {
          void reply.status(304);
          return undefined;
        }

        return cuerpo;
      }),
    );
  }

  private etag(cuerpo: unknown): string {
    const json = JSON.stringify(cuerpo) ?? '';
    return `"${crypto.createHash('sha1').update(json).digest('base64url')}"`;
  }
}
