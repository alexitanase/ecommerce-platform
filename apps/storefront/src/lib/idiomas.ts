import { idiomaPorDefectoValido, normalizarIdiomas, type Locale } from '@ecom/shared';
import { routing } from '@/i18n/routing';
import { ajustesPublicos } from '@/lib/api';

/**
 * Qué idiomas sirve la tienda ahora mismo, según el panel.
 *
 * Hasta aquí `shop.supportedLocales` y `shop.defaultLocale` estaban en la base de
 * datos desde la semilla y **nadie los leía**: la tienda usaba las constantes de
 * `routing.ts`, así que desactivar un idioma desde el panel no tenía ningún
 * efecto y el ajuste era decorativo.
 *
 * Conviene tener claro qué gobierna esto y qué no:
 *
 *  · **Sí gobierna** el selector, los `hreflang` y el sitemap; o sea, lo que la
 *    tienda OFRECE y lo que le anuncia a Google.
 *  · **No gobierna** qué URLs responden. `/en/...` sigue resolviendo aunque el
 *    inglés esté desactivado, porque el conjunto de rutas lo fija
 *    `defineRouting` al cargar el módulo y no se puede cambiar en caliente.
 *    Desactivar un idioma lo retira de la circulación; no lo borra.
 *  · **Tampoco crea idiomas.** Solo se pueden activar los que tienen ficheros de
 *    traducción compilados, y la API rechaza el resto al guardar.
 *
 * Si el endpoint de ajustes falla se devuelven los tres compilados: la tienda
 * tiene que seguir en pie, y ofrecer un idioma de más es mucho menos grave que
 * quedarse sin ninguno.
 */
export async function idiomasActivos(): Promise<Locale[]> {
  const ajustes = await ajustesPublicos();
  const guardados = ajustes['shop.supportedLocales'];

  if (!Array.isArray(guardados)) return [...routing.locales];

  return normalizarIdiomas(guardados);
}

/** El idioma que recibe quien entra sin indicar ninguno. */
export async function idiomaPorDefecto(): Promise<Locale> {
  const ajustes = await ajustesPublicos();
  const activos = await idiomasActivos();

  return idiomaPorDefectoValido(ajustes['shop.defaultLocale'], activos);
}
