import { cookies } from 'next/headers';
import { DIVISA_BASE } from '@ecom/shared';
import { api } from '@/lib/api';
import { COOKIE_DIVISA } from './divisa-cookie';
import { SOLO_EUROS, formatearPrecio, type EstadoDivisa } from './divisa-mostrar';

/**
 * En qué divisa se le enseñan los precios a este visitante.
 *
 * Se cobra siempre en euros. Esto solo decide el número que se pinta, y de ahí
 * salen las tres reglas que gobiernan el módulo:
 *
 *  · **Si algo falla, euros.** Sin tasas, sin cookie o con la API caída, se
 *    enseña el precio real. Un precio inventado es peor que un precio en otra
 *    divisa, y una ficha sin precio es peor que las dos cosas.
 *  · **La preferencia va en cookie y no en la URL.** No es contenido: la ficha
 *    en libras y la ficha en euros son la misma página, y darles dos direcciones
 *    sería contenido duplicado que competiría consigo mismo en Google.
 *  · **Nada de esto entra en el pedido.** Lo que se guarda y lo que se factura
 *    son los céntimos de euro, intactos.
 */

// El nombre vive aparte: lo necesita también el selector, que es de cliente y no
// puede arrastrar `next/headers`. Ver `lib/divisa-cookie.ts`.
export { COOKIE_DIVISA } from './divisa-cookie';
export type { EstadoDivisa } from './divisa-mostrar';

interface RespuestaDivisas {
  activas: string[];
  porDefecto: string;
  tasas: Record<string, number>;
}

/**
 * Lo que la tienda puede ofrecer ahora mismo.
 *
 * Va con caché de una hora aunque las tasas duren un día en la API: lo que se
 * cachea aquí es la RESPUESTA, y la lista de divisas activas cambia cuando
 * alguien la toca en el panel. Una hora es el compromiso entre no pedirlo en
 * cada página y que activar una divisa se note el mismo día.
 */
async function catalogo(): Promise<RespuestaDivisas> {
  try {
    return await api<RespuestaDivisas>('/settings/public/divisas', { revalidar: 3600 });
  } catch {
    return { activas: [DIVISA_BASE], porDefecto: DIVISA_BASE, tasas: {} };
  }
}

export async function estadoDivisa(): Promise<EstadoDivisa> {
  const datos = await catalogo();

  // Con una sola divisa no hay nada que elegir ni que convertir.
  if (datos.activas.length < 2) return SOLO_EUROS;

  const elegida = (await cookies()).get(COOKIE_DIVISA)?.value?.toUpperCase();

  /*
   * La cookie se valida contra lo que la tienda ofrece HOY.
   *
   * Una cookie vieja puede traer una divisa que se ha desactivado, o una tasa
   * que ya no se publica. En los dos casos se cae a la divisa por defecto en vez
   * de arrastrar la preferencia: nadie quiere ver precios de una divisa que la
   * tienda ha dejado de mantener.
   */
  const actual =
    elegida && datos.activas.includes(elegida) ? elegida : datos.porDefecto || DIVISA_BASE;

  return {
    actual,
    disponibles: datos.activas,
    tasa: actual === DIVISA_BASE ? 1 : (datos.tasas[actual] ?? 1),
  };
}

/**
 * El formateador de precios para una página de servidor.
 *
 * Es el equivalente de `usePrecio` fuera del árbol de cliente: las páginas que
 * pintan precios sin ser interactivas —el listado del blog, la franja de
 * garantías con el umbral de envío gratis— no pueden leer el contexto de React,
 * y sin esto se quedaban en euros mientras el resto de la tienda cambiaba de
 * divisa. Un catálogo en libras con el umbral de envío gratis en euros no es un
 * detalle de formato: es una cifra que el visitante compara con su carrito.
 *
 * Se pide una vez por página y se reutiliza para todos sus importes, que es lo
 * que evita leer la cookie y las tasas una vez por precio.
 */
export async function formateadorPrecio(locale: string): Promise<(cents: number) => string> {
  const estado = await estadoDivisa();
  return (cents: number) => formatearPrecio(cents, locale, estado);
}
