import { idiomaPorDefectoValido, normalizarIdiomas, type Locale } from '@ecom/shared';
import { routing } from '@/i18n/routing';

/**
 * Los idiomas del panel, leídos desde el middleware.
 *
 * Existe aparte de `lib/idiomas.ts` por dónde se ejecuta esto: el middleware
 * corre en el runtime de edge y antes de que haya página, así que no puede usar
 * el caché de datos de Next (`fetch` con `revalidate`) ni nada que dependa de
 * `next/headers`. Lo que hay aquí es lo mismo, pedido a pelo y guardado en
 * memoria del proceso.
 *
 * **Un minuto de caché, y no cinco.** Este dato decide a qué idioma va a parar
 * quien entra por el dominio: si alguien cambia el idioma por defecto en el
 * panel y la tienda tarda cinco minutos en enterarse, lo que se ve es que el
 * ajuste no funciona y se toca otra vez. Un minuto es lo que separa «tarda un
 * momento» de «no hace nada». El coste es una petición por minuto y por
 * instancia, no por visita.
 */

interface Idiomas {
  activos: Locale[];
  porDefecto: Locale;
}

/** El estado de partida y el de cuando la API no contesta. */
const COMPILADOS: Idiomas = {
  activos: [...routing.locales],
  porDefecto: routing.defaultLocale,
};

const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
const TTL = 60_000;
const TIEMPO_ESPERA = 2000;

let cache: { valor: Idiomas; hasta: number } | null = null;

export async function idiomasDelPanel(): Promise<Idiomas> {
  if (cache && Date.now() < cache.hasta) return cache.valor;

  try {
    /*
     * Con temporizador, y esto no es opcional aquí.
     *
     * El middleware se ejecuta ANTES de cada página: una API que no responde
     * dejaría toda la tienda esperando, no una sección. Dos segundos y se sigue
     * con los idiomas compilados, que es un degradado que nadie nota.
     */
    const respuesta = await fetch(`${BASE}/api/v1/settings/public`, {
      signal: AbortSignal.timeout(TIEMPO_ESPERA),
      // El caché de datos de Next no está disponible en el middleware; el
      // nuestro es el de arriba.
      cache: 'no-store',
    });

    if (!respuesta.ok) throw new Error(String(respuesta.status));

    const ajustes = (await respuesta.json()) as Record<string, unknown>;
    const activos = Array.isArray(ajustes['shop.supportedLocales'])
      ? normalizarIdiomas(ajustes['shop.supportedLocales'])
      : COMPILADOS.activos;

    const valor: Idiomas = {
      activos,
      porDefecto: idiomaPorDefectoValido(ajustes['shop.defaultLocale'], activos),
    };

    cache = { valor, hasta: Date.now() + TTL };
    return valor;
  } catch {
    /*
     * El fallo también se cachea, y por poco tiempo.
     *
     * Sin esto, una API caída significaría un `fetch` con su espera de dos
     * segundos en CADA petición de CADA visitante, que convierte una avería de
     * la API en una tienda que no se puede navegar. Diez segundos es suficiente
     * para no notarlo y para recuperarse enseguida.
     */
    cache = { valor: COMPILADOS, hasta: Date.now() + 10_000 };
    return COMPILADOS;
  }
}
