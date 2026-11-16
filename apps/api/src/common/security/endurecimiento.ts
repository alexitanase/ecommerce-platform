import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Endurecimiento a nivel de petición, antes de que nada llegue a Nest.
 *
 * Son comprobaciones baratas que cortan clases enteras de ataque en el borde:
 * si el cuerpo trae `__proto__`, o la petición viene de un origen que no es el
 * nuestro, no hace falta gastar una consulta a base de datos para rechazarla.
 */

/**
 * Claves que, asignadas en un objeto, modifican el prototipo de Object.
 *
 * Un JSON con `{"__proto__": {"isAdmin": true}}` puede acabar contaminando
 * TODOS los objetos del proceso si algo hace un merge recursivo por el camino.
 * El parser de Fastify ya protege `__proto__`, pero no `constructor` ni
 * `prototype`, y la comprobación recursiva es barata comparada con el daño.
 */
const CLAVES_PROHIBIDAS = new Set(['__proto__', 'constructor', 'prototype']);

/** Profundidad máxima del JSON aceptado. */
const PROFUNDIDAD_MAXIMA = 20;

export class CargaMaliciosaError extends Error {}

/**
 * Recorre el cuerpo buscando claves peligrosas y anidamiento excesivo.
 *
 * El límite de profundidad frena un JSON de 10.000 niveles que reventaría la
 * pila al serializar: un cuerpo de 2 KB puede tumbar el proceso sin él.
 */
export function revisarCarga(valor: unknown, profundidad = 0): void {
  if (profundidad > PROFUNDIDAD_MAXIMA) {
    throw new CargaMaliciosaError('La estructura enviada está anidada demasiado profundamente');
  }

  if (Array.isArray(valor)) {
    for (const elemento of valor) revisarCarga(elemento, profundidad + 1);
    return;
  }

  if (typeof valor !== 'object' || valor === null) return;

  for (const clave of Object.keys(valor)) {
    if (CLAVES_PROHIBIDAS.has(clave)) {
      throw new CargaMaliciosaError(`El campo "${clave}" no está permitido`);
    }
    revisarCarga((valor as Record<string, unknown>)[clave], profundidad + 1);
  }
}

/**
 * Quita bytes nulos y caracteres de control de las cadenas.
 *
 * Un `\0` dentro de un texto puede truncar la cadena en capas escritas en C
 * (nombres de fichero, algunas rutas de búsqueda), de modo que lo validado y lo
 * usado dejan de ser lo mismo. Se conservan salto de línea y tabulador porque
 * las descripciones de producto los usan de verdad.
 */
export function limpiarTexto(texto: string): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/** Métodos que no cambian estado y por tanto no necesitan comprobación de origen. */
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Rutas exentas de la comprobación de origen.
 *
 * Los webhooks los llama el servidor de la pasarela, que no manda `Origin` ni
 * puede mandarlo. Su autenticidad se verifica con la firma HMAC del cuerpo, que
 * es más fuerte que cualquier cabecera.
 */
const EXENTAS = ['/api/v1/payments/webhook/', '/api/v1/suppliers/webhook/', '/health'];

/**
 * Comprueba que las peticiones que cambian estado vienen de un origen nuestro.
 *
 * El refresh token viaja en cookie httpOnly, así que el navegador la adjunta
 * sola. `sameSite: lax` ya frena el caso habitual, pero es una defensa que
 * depende del navegador del usuario; esta se aplica en el servidor y no hace
 * suposiciones sobre el cliente.
 */
export function comprobarOrigen(
  request: FastifyRequest,
  origenesPermitidos: string[],
): string | null {
  if (METODOS_SEGUROS.has(request.method)) return null;
  if (EXENTAS.some((ruta) => request.url.startsWith(ruta))) return null;

  const cabeceras = request.headers;
  const origen = cabeceras.origin ?? null;

  if (!origen) {
    // Sin Origin no hay navegador de por medio (curl, app móvil, servidor).
    // Esos clientes no arrastran cookies ajenas, que es lo que CSRF explota.
    // Si además viene con cookie de sesión, sí es sospechoso.
    return cabeceras.cookie ? 'Falta la cabecera Origin en una petición con cookie' : null;
  }

  if (!origenesPermitidos.includes(origen)) {
    return `Origen no permitido: ${origen}`;
  }

  return null;
}

/**
 * Registra el endurecimiento en la instancia de Fastify.
 */
export function registrarEndurecimiento(
  app: FastifyInstance,
  opciones: { origenesPermitidos: string[] },
): void {
  app.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, done) => {
    // El id de petición vuelve siempre al cliente: cuando alguien reporta un
    // fallo, ese identificador lleva directo a sus logs sin tener que adivinar.
    void reply.header('x-request-id', request.id);

    const problema = comprobarOrigen(request, opciones.origenesPermitidos);
    if (problema) {
      void reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: problema,
      });
      return;
    }

    done();
  });

  app.addHook('preValidation', (request: FastifyRequest, reply: FastifyReply, done) => {
    try {
      revisarCarga(request.body);
      revisarCarga(request.query);
    } catch (error) {
      void reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: error instanceof CargaMaliciosaError ? error.message : 'Petición no válida',
      });
      return;
    }

    done();
  });
}
