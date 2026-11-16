import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { isLocale, negociarIdioma } from '@ecom/shared';
import { routing } from './i18n/routing';
import { rutaAbierta } from './lib/puerta';
import { esRobotDeVistaPrevia } from './lib/vista-previa';
import { esBuscadorVerificado } from './lib/buscadores';
import { idiomasDelPanel } from './lib/idiomas-middleware';

/**
 * Redirige a la versión del idioma correspondiente.
 *
 * next-intl detecta el idioma en este orden: cookie de preferencia guardada,
 * cabecera Accept-Language del navegador, y por último el idioma por defecto.
 * La cookie manda sobre el navegador a propósito: si alguien eligió catalán
 * explícitamente, no queremos devolverlo a castellano en la visita siguiente
 * solo porque su sistema esté en castellano.
 */
const idiomas = createMiddleware(routing);

/**
 * Cookie de verificación de edad. La pone la API y es httpOnly: desde el
 * JavaScript de la página no se puede leer ni falsificar.
 */
const COOKIE_EDAD = 'age_id';

/** La cookie con la que next-intl recuerda el idioma elegido. */
const COOKIE_IDIOMA = 'NEXT_LOCALE';

/**
 * Decide en qué idioma recibir a quien entra sin decir ninguno.
 *
 * El problema que resuelve: `defineRouting` fija `defaultLocale: 'es'` al cargar
 * el módulo, así que quien entraba por el dominio a secas acababa siempre en la
 * versión española **aunque el panel dijera otra cosa**. El ajuste
 * `shop.defaultLocale` ya gobernaba el selector, los `hreflang` y el sitemap;
 * la puerta de entrada, que es lo más visible de los cuatro, seguía sin
 * enterarse.
 *
 * En vez de reconstruir el enrutador —que además tendría que traducir los slugs
 * a mano— se le escribe a next-intl la preferencia en la cookie que él ya mira,
 * y el resto lo hace él: elige el idioma, traduce la ruta y redirige. Así solo
 * se cambia la DECISIÓN, no el camino.
 *
 * El orden es el de siempre y el que espera cualquiera:
 *
 *  1. Lo que el visitante eligió, si ese idioma se sigue ofreciendo.
 *  2. Lo que pide su navegador, entre los idiomas activos.
 *  3. El idioma por defecto del panel.
 *
 * No toca nada cuando la URL ya trae idioma: `/en/...` sigue respondiendo aunque
 * el inglés esté desactivado. Desactivar un idioma lo retira de la circulación
 * —del selector, del sitemap, de los hreflang— pero no rompe los enlaces que ya
 * estén publicados o guardados en un marcador.
 */
async function elegirIdioma(request: NextRequest): Promise<void> {
  const primerTramo = request.nextUrl.pathname.split('/').filter(Boolean)[0] ?? '';
  if (isLocale(primerTramo)) return;

  const { activos, porDefecto } = await idiomasDelPanel();

  const elegido = request.cookies.get(COOKIE_IDIOMA)?.value;
  if (elegido && isLocale(elegido) && activos.includes(elegido)) return;

  const delNavegador = negociarIdioma(request.headers.get('accept-language'), activos);

  /*
   * Se escribe en las cookies de la PETICIÓN, no en las de la respuesta.
   *
   * Es lo que lee next-intl un par de líneas más abajo, y no sale hacia el
   * navegador: la preferencia del visitante sigue siendo suya, y la próxima vez
   * se vuelve a decidir con los ajustes que haya entonces. Guardarla como cookie
   * de verdad congelaría el idioma por defecto del panel en el navegador de cada
   * visitante el día que lo cambiara.
   */
  request.cookies.set(COOKIE_IDIOMA, delNavegador ?? porDefecto);
}

/**
 * La puerta de la tienda.
 *
 * Aquí solo se mira si la cookie EXISTE, no se valida. Es a propósito y
 * conviene entender por qué no es un agujero: la cookie solo la pone el
 * servidor cuando la verificación ha salido favorable, caduca a los treinta
 * días a la vez que su registro, y al cerrar el acceso se borran las dos. Y lo
 * que de verdad protege el contenido sigue estando en la API, que responde 403
 * en la ficha de un producto restringido sin ni siquiera mandar sus datos.
 *
 * Validar contra la API desde aquí sería una llamada de red en CADA petición
 * de CADA visitante, incluidas las de quien ya está dentro. No compensa para
 * reforzar una puerta cuyo cerrojo real está en otro sitio.
 *
 * Se reescribe en lugar de redirigir para que la URL no cambie: al verificar,
 * la página se recarga y quien entró buscando un producto concreto acaba en
 * ese producto y no en la portada.
 */
export default async function middleware(request: NextRequest) {
  await elegirIdioma(request);

  const respuesta = idiomas(request);

  const ruta = request.nextUrl.pathname;

  if (request.cookies.has(COOKIE_EDAD) || rutaAbierta(ruta)) {
    return respuesta;
  }

  /*
   * Los robots que sacan la vista previa de un enlace pasan.
   *
   * WhatsApp, Telegram y compañía piden la página sin cookies para leer el
   * título, la descripción y la foto. Con la puerta delante, TODAS las vistas
   * previas de la tienda salían iguales: el nombre genérico de la tienda, sin
   * foto y sin decir qué producto se estaba compartiendo. En un catálogo que no
   * puede anunciarse en Google Ads ni en Meta, el enlace que un cliente le pasa
   * a otro es de los pocos canales que quedan, y así no se pulsaba.
   *
   * No abre nada que no se quisiera compartir: estos robots leen la cabecera
   * del HTML y se van, y quien pulse el enlace entra con su navegador, que sí
   * se encuentra la verificación de edad.
   */
  if (esRobotDeVistaPrevia(request.headers.get('user-agent'))) {
    return respuesta;
  }

  /*
   * Los buscadores también pasan, y esto sí hay que justificarlo.
   *
   * Con la puerta delante, Googlebot recibía la pantalla de verificación en las
   * más de diez mil URLs del catálogo. Esa pantalla va con `noindex, nofollow`,
   * así que el buscador no veía una tienda con contenido restringido: veía diez
   * mil páginas pidiéndole expresamente que no las indexara. La tienda entera
   * estaba fuera de Google, y con Ads y Meta cerrados a un catálogo +18 la
   * búsqueda orgánica es el canal que queda.
   *
   * El precio es real y se paga a sabiendas: servirle al robot lo que ve una
   * persona verificada, y no lo que ve una sin verificar, es *cloaking* según
   * las guías de Google. Es la práctica habitual del sector y la decisión no
   * era técnica, así que se tomó a la vista de las dos cosas.
   *
   * Se comprueba por **rango de IP publicado**, nunca por el user-agent: si
   * bastara la cadena, la puerta habría dejado de existir para cualquiera capaz
   * de cambiarla, que es todo el mundo. Ver `lib/buscadores.ts`.
   */
  if (esBuscadorVerificado(request.headers)) {
    return respuesta;
  }

  /*
   * El idioma que next-intl acaba de resolver.
   *
   * Se lee de su respuesta y no de la URL porque en `/` todavía no hay
   * ninguno: sin esto, la puerta saldría siempre en castellano a quien tiene
   * el navegador en catalán, que es justo la primera pantalla en la que peor
   * sienta.
   */
  const destino =
    respuesta.headers.get('x-middleware-rewrite') ?? respuesta.headers.get('location');
  const idioma = (destino ?? ruta).split('/').filter(Boolean)[0] ?? routing.defaultLocale;
  const locale = routing.locales.includes(idioma as (typeof routing.locales)[number])
    ? idioma
    : routing.defaultLocale;

  const url = request.nextUrl.clone();
  url.pathname = `/${locale}/acceso`;

  const puerta = NextResponse.rewrite(url);
  // Sin esto, una respuesta cacheada de la puerta se le serviría a quien ya
  // está verificado, y al revés.
  puerta.headers.set('cache-control', 'private, no-store');
  return puerta;
}

export const config = {
  /*
   * Se excluyen las rutas que no son páginas:
   *  · /api      — llamadas internas
   *  · /_next    — recursos generados por Next
   *  · /_vercel  — instrumentación de la plataforma
   *  · /icono    — el icono de la aplicación instalable
   *  · ficheros con extensión (imágenes, robots.txt, sitemap.xml…)
   *
   * Sin esta exclusión, el middleware intentaría redirigir /favicon.ico a
   * /es/favicon.ico y el navegador no encontraría el icono.
   *
   * `/icono` no lleva extensión, así que sin nombrarlo aquí acababa
   * redirigido a /es/icono: el navegador recibía un 307 al pedir el icono del
   * manifiesto y descartaba la instalación sin decir por qué.
   */
  matcher: '/((?!api|_next|_vercel|icono|.*\\..*).*)',
};
