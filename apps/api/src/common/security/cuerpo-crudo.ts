import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';

/**
 * Conserva el cuerpo tal y como llegó, byte a byte.
 *
 * Hace falta para verificar las firmas de los webhooks. Revolut firma la
 * cadena `v1.{timestamp}.{cuerpo}` con HMAC-SHA256, y Stripe hace algo
 * equivalente: lo firmado son **los bytes exactos** que salieron de su
 * servidor.
 *
 * Sin esto, lo que se verifica es `JSON.stringify(JSON.parse(cuerpo))`, que no
 * es lo mismo: cambia el espaciado, el formato de los números (`1.0` vuelve
 * como `1`) y el escapado de los caracteres no ASCII. El resultado es que
 * **ninguna notificación legítima verifica** y todos los pagos con tarjeta se
 * quedan sin confirmar. Es un fallo que no aparece en desarrollo, porque en
 * desarrollo los webhooks no llegan.
 *
 * NOWPayments no lo necesita porque firma el JSON reordenado alfabéticamente y
 * su adaptador reconstruye esa forma canónica; es la excepción, no la regla.
 *
 * ## Por qué un hook y no un analizador propio
 *
 * Lo natural sería sustituir el analizador de `application/json`, pero Nest
 * registra el suyo al inicializarse y Fastify no admite dos para el mismo tipo:
 * la API no arranca («Content type parser 'application/json' already present»).
 *
 * `preParsing` corre antes, recibe el cuerpo como flujo, y devuelve el flujo
 * que verá el analizador de Nest. Así se lee el original sin quitarle el suyo a
 * nadie.
 *
 * ## Por qué solo en las rutas de webhook
 *
 * Guardar el crudo de todas las peticiones duplica en memoria cada cuerpo que
 * entra —hasta 10 MB por petición según el límite configurado—. Los webhooks
 * son pocos, pequeños y los únicos que lo necesitan.
 */

/** Prefijos de ruta cuyo cuerpo hay que conservar sin tocar. */
const RUTAS_CON_FIRMA = ['/api/v1/payments/webhook/', '/api/v1/suppliers/webhook/'];

/**
 * Tamaño máximo de un webhook.
 *
 * El límite general de Fastify lo aplica el analizador, que corre DESPUÉS de
 * este hook: sin un tope propio, un cuerpo enorme se acumularía entero en
 * memoria antes de que a nadie le diera tiempo a rechazarlo. Un aviso de pago
 * son unos cientos de bytes; 1 MB es tres órdenes de magnitud de margen.
 */
const LIMITE_BYTES = 1024 * 1024;

declare module 'fastify' {
  interface FastifyRequest {
    /** Cuerpo original de la petición; solo en las rutas que firman. */
    cuerpoCrudo?: string;
  }
}

export function necesitaCuerpoCrudo(url: string): boolean {
  // Sin la query: `?reintento=1` en la URL no debe impedir la comprobación.
  const ruta = url.split('?')[0] ?? '';
  return RUTAS_CON_FIRMA.some((prefijo) => ruta.startsWith(prefijo));
}

export class CuerpoDemasiadoGrandeError extends Error {
  readonly statusCode = 413;
}

export function registrarCuerpoCrudo(app: FastifyInstance): void {
  app.addHook('preParsing', async (peticion, _respuesta, carga) => {
    if (!necesitaCuerpoCrudo(peticion.url)) return carga;

    const trozos: Buffer[] = [];
    let total = 0;

    for await (const trozo of carga) {
      const bloque = Buffer.isBuffer(trozo) ? trozo : Buffer.from(trozo as string);
      total += bloque.length;
      if (total > LIMITE_BYTES) {
        throw new CuerpoDemasiadoGrandeError('El cuerpo del webhook excede el límite permitido');
      }
      trozos.push(bloque);
    }

    const crudo = Buffer.concat(trozos);
    peticion.cuerpoCrudo = crudo.toString('utf8');

    // El flujo original ya está consumido: se devuelve uno nuevo con los
    // mismos bytes para que el analizador de Nest siga funcionando igual.
    const nuevo = Readable.from(crudo) as Readable & { receivedEncodedLength?: number };
    // Fastify compara esto con `Content-Length` para detectar cuerpos
    // truncados. Sin ponerlo, toda petición con esa cabecera daría error de
    // longitud y el webhook se perdería.
    nuevo.receivedEncodedLength = crudo.length;

    return nuevo;
  });
}
