import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * El aviso de la tienda de que quien pide la página es un buscador verificado.
 *
 * Quién es Google lo decide la tienda, no la API: la tienda es la que recibe la
 * petición del robot y la que puede comparar su IP con los rangos publicados
 * (`apps/storefront/src/lib/buscadores.ts`). La API solo ve la IP del servidor
 * de la tienda. Así que la tienda se lo dice con esta cabecera, y la API la
 * trata como una verificación de edad más.
 *
 * Por qué hace falta: la tienda dejaba pasar a Google por la puerta de edad,
 * pero luego pedía la ficha a la API sin cookie, la API respondía 403 y la
 * página le servía al robot la verificación con `noindex`. Ninguna ficha +18
 * —que es casi todo el catálogo— llegaba a indexarse.
 *
 * **No es una contraseña que viaje tal cual.** Se manda una firma HMAC de una
 * etiqueta fija con `REVALIDATE_SECRET`, que ya comparten la tienda y la API.
 * Quien la lea en un registro no obtiene el secreto con el que se purga la
 * caché de la tienda.
 */
export const CABECERA_BUSCADOR = 'x-buscador-verificado';

const ETIQUETA = 'buscador-verificado:v1';

export function firmaBuscador(secreto: string): string {
  return createHmac('sha256', secreto).update(ETIQUETA).digest('hex');
}

/** ¿La cabecera trae la firma correcta? Sin secreto configurado, nunca. */
export function esBuscadorAvisado(valor: unknown, secreto: string | undefined): boolean {
  if (!secreto || typeof valor !== 'string' || valor.length === 0) return false;

  const esperada = Buffer.from(firmaBuscador(secreto));
  const recibida = Buffer.from(valor);
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}
