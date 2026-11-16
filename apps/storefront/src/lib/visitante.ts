import { createHmac } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { esBuscadorVerificado } from './buscadores';

/**
 * Lo que la API tiene que saber de quien pide la página para decidir si le
 * enseña el catálogo +18.
 *
 * Son dos cosas, y las dos solo se ven desde aquí:
 *
 *  · **Las cookies del visitante.** En un componente de servidor no hay
 *    navegador que las adjunte; sin reenviarlas, la API ve a todo el mundo sin
 *    verificar.
 *  · **Que es Google o Bing**, comprobado por su IP (`buscadores.ts`). El
 *    middleware ya les dejaba pasar la puerta, pero luego la ficha se pedía a la
 *    API sin cookie, la API respondía 403 y el robot recibía la verificación con
 *    `noindex`: ninguna ficha +18 —casi todo el catálogo— se indexaba. Se le
 *    avisa a la API con una firma que solo pueden calcular la tienda y la API
 *    (ver `apps/api/src/modules/age/buscador.ts`). Indexar las fichas +18 es una
 *    decisión de negocio tomada el 16-11-2026.
 *
 * Devuelve opciones listas para `api()`, o `null` si la petición es anónima y
 * puede ir a la caché compartida. Cuando no es `null` va siempre sin caché: la
 * respuesta depende de quién pregunta y una copia guardada se le serviría a otro.
 */
export async function opcionesDelVisitante(): Promise<{
  cache: 'no-store';
  cookies?: string;
  headers?: Record<string, string>;
} | null> {
  const [galletas, cabeceras] = await Promise.all([cookies(), headers()]);
  const texto = galletas.toString();
  const aviso = esBuscadorVerificado(cabeceras) ? avisoDeBuscador() : null;

  if (!texto && !aviso) return null;

  return {
    cache: 'no-store',
    ...(texto ? { cookies: texto } : {}),
    ...(aviso ? { headers: aviso } : {}),
  };
}

/** Debe coincidir con `CABECERA_BUSCADOR` y `firmaBuscador` de la API. */
const CABECERA_BUSCADOR = 'x-buscador-verificado';
const ETIQUETA = 'buscador-verificado:v1';

function avisoDeBuscador(): Record<string, string> | null {
  const secreto = process.env['REVALIDATE_SECRET'];
  if (!secreto) return null;
  return {
    [CABECERA_BUSCADOR]: createHmac('sha256', secreto).update(ETIQUETA).digest('hex'),
  };
}
