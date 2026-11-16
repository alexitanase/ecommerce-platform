import { request } from '@playwright/test';
import path from 'node:path';

/**
 * Cruza la puerta de edad una vez, antes de todas las pruebas.
 *
 * La tienda es +18 y el middleware la tapa entera mientras no haya cookie de
 * verificación. Sin esto, TODAS las pruebas de tienda se encontrarían el
 * formulario de edad en lugar de la portada, y fallarían por un motivo que no
 * tiene nada que ver con lo que cada una comprueba.
 *
 * Se hace por API y no pulsando el formulario a propósito: probar la puerta es
 * trabajo de `puerta-edad.spec.ts`, y repetirlo al principio de cada una de
 * las otras solo añade segundos y un punto más donde romperse.
 *
 * La cookie la pone la API en `localhost`. Las cookies ignoran el puerto, así
 * que la que se guarda aquí vale también para la tienda del 3000. En
 * producción eso lo resuelve `COOKIE_DOMAIN`, que la comparte entre la API y
 * la tienda.
 */
export const ESTADO_VERIFICADO = path.join(import.meta.dirname, '.auth', 'edad.json');

/** Un año que da la mayoría de edad sobradamente y no depende de cuándo se ejecute. */
const ANIO_NACIMIENTO = 1990;

export default async function preparar(): Promise<void> {
  const api = process.env['E2E_API'] ?? 'http://localhost:3001';

  const contexto = await request.newContext({ baseURL: api });

  const respuesta = await contexto.post('/api/v1/age/verify', {
    data: { anioNacimiento: ANIO_NACIMIENTO },
  });

  const cuerpo = (await respuesta.json()) as { verificado?: boolean };

  if (!cuerpo.verificado) {
    // Sin esto el fallo aparecería veinte pruebas después y disfrazado de
    // "no encuentro el botón de comprar".
    throw new Error(
      `La API no ha verificado la edad (${respuesta.status()}). Sin cookie, la tienda ` +
        `entera responde con la puerta de edad y no se puede probar nada.`,
    );
  }

  await contexto.storageState({ path: ESTADO_VERIFICADO });
  await contexto.dispose();
}
