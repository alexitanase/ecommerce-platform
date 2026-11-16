import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationException } from 'nestjs-zod';
import { newId } from '@ecom/shared';
import { ErrorProveedor } from '@ecom/suppliers';
// Directo del paquete, no de ./observabilidad.js: ese módulo arranca las
// instrumentaciones al importarse y exigiría el entorno completo en cualquier
// test que toque el filtro. Sin init, captureException no hace nada.
import * as Sentry from '@sentry/node';

/**
 * Respuesta de error uniforme para toda la API.
 *
 * Cada error lleva un `traceId` que también se escribe en el log. Cuando un
 * cliente reporta "me ha dado un error", ese identificador lleva directo a la
 * traza exacta sin adivinar. Los errores no controlados nunca exponen su
 * mensaje interno al exterior: se registra completo y se devuelve genérico,
 * porque un stack trace filtrado es información gratis para un atacante.
 */
export interface ApiError {
  statusCode: number;
  error: string;
  message: string | string[];
  /** Errores por campo, para que el formulario pueda señalar cada input. */
  fields?: Record<string, string[]>;
  /**
   * Detalle estructurado que acompaña al mensaje.
   *
   * Lo usan los errores que no van por campo de formulario pero sí tienen una
   * lista que enseñar: por ejemplo, qué le falta a una ficha para poder
   * publicarse. Sin esto el panel solo recibe un texto y no puede señalar nada.
   */
  detalles?: unknown[];
  traceId: string;
  path: string;
  timestamp: string;
}

/**
 * Qué código HTTP le corresponde a cada fallo de un proveedor externo.
 *
 * Importa más de lo que parece: el panel decide con él si tiene sentido
 * reintentar, y un 5xx acaba en Sentry. Que falte autorizar en AliExpress no
 * es una avería nuestra y no debe despertar a nadie de madrugada.
 */
const ESTADO_POR_ERROR_PROVEEDOR: Record<string, number> = {
  CREDENCIALES: HttpStatus.BAD_REQUEST,
  SIN_PERMISO: HttpStatus.BAD_REQUEST,
  NO_ENCONTRADO: HttpStatus.NOT_FOUND,
  SIN_STOCK: HttpStatus.CONFLICT,
  PRECIO_CAMBIADO: HttpStatus.CONFLICT,
  DIRECCION_INVALIDA: HttpStatus.BAD_REQUEST,
  LIMITE_PETICIONES: HttpStatus.TOO_MANY_REQUESTS,
  // Estos tres sí son del otro lado y sí conviene verlos si se repiten.
  PROVEEDOR_CAIDO: HttpStatus.BAD_GATEWAY,
  RED: HttpStatus.BAD_GATEWAY,
  DATOS_INVALIDOS: HttpStatus.BAD_GATEWAY,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const traceId = newId();

    // Tipado como number, no como el enum HttpStatus: getStatus() puede
    // devolver códigos que no están en el enum y luego los comparamos por rango.
    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Se ha producido un error inesperado';
    let error = 'Internal Server Error';

    let fields: Record<string, string[]> | undefined;
    let detalles: unknown[] | undefined;

    // Los errores de validación se desglosan por campo. Devolver solo
    // "Validation failed" obliga al frontend a adivinar qué input marcar en
    // rojo, y al usuario a probar hasta acertar.
    if (exception instanceof ZodValidationException) {
      statusCode = HttpStatus.BAD_REQUEST;
      error = 'ValidationError';
      message = 'Los datos enviados no son válidos';
      fields = {};

      // getZodError() está tipado como unknown en nestjs-zod; la forma real es
      // un ZodError, del que solo necesitamos la ruta y el mensaje de cada fallo.
      const zodError = exception.getZodError() as {
        issues?: { path: (string | number)[]; message: string }[];
      };

      for (const issue of zodError.issues ?? []) {
        const campo = issue.path.join('.') || '_';
        (fields[campo] ??= []).push(issue.message);
      }
    } else if (exception instanceof ErrorProveedor) {
      // Un fallo del proveedor no es un fallo nuestro, y su mensaje sí sirve
      // de algo: dice si faltan credenciales, si el producto ya no existe o si
      // su servicio está caído. Devolver el 500 genérico de más abajo obligaba
      // a mirar los logs del servidor para saber por qué no salía nada en el
      // buscador del panel.
      statusCode = ESTADO_POR_ERROR_PROVEEDOR[exception.tipo] ?? HttpStatus.BAD_GATEWAY;
      error = `Proveedor:${exception.tipo}`;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const respuesta = exception.getResponse();

      if (typeof respuesta === 'string') {
        message = respuesta;
        error = exception.name;
      } else if (typeof respuesta === 'object' && respuesta !== null) {
        const cuerpo = respuesta as {
          message?: string | string[];
          error?: string;
          detalles?: unknown[];
        };
        message = cuerpo.message ?? exception.message;
        error = cuerpo.error ?? exception.name;
        if (Array.isArray(cuerpo.detalles)) detalles = cuerpo.detalles;
      }
    }

    const payload: ApiError = {
      statusCode,
      error,
      message,
      ...(fields ? { fields } : {}),
      ...(detalles ? { detalles } : {}),
      traceId,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    if (statusCode >= 500) {
      // Solo los 5xx llegan a Sentry. Un 404 o un 400 de validación no son
      // fallos nuestros: mandarlos ahogaría los errores reales entre miles de
      // eventos que nadie va a atender.
      Sentry.captureException(exception, {
        // El mismo traceId que ve el cliente y que se escribe en el log: cuando
        // alguien reporta "me sale un error", ese código lleva a los tres sitios.
        tags: { traceId, ruta: request.url, metodo: request.method },
      });

      this.logger.error(
        `[${traceId}] ${request.method} ${request.url} → ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`[${traceId}] ${request.method} ${request.url} → ${statusCode}`);
    }

    void reply.status(statusCode).send(payload);
  }
}
