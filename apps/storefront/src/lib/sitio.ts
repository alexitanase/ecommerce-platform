import type { Metadata } from 'next';
import { getPathname } from '@/i18n/routing';
import { idiomaPorDefecto, idiomasActivos } from '@/lib/idiomas';

/*
 * `SITIO` y `urlAbsoluta` viven en `url-sitio.ts` y se reexportan desde aquí.
 *
 * Hacen falta para tres cosas que solo funcionan con URL absoluta —el canonical,
 * el hreflang y la imagen de Open Graph— y las necesitan módulos que no tienen
 * nada que ver con el enrutador. Este fichero sí lo importa para resolver los
 * slugs traducidos, y eso arrastra medio Next: cualquier cosa que importara
 * `urlAbsoluta` desde aquí dejaba de poder probarse fuera del navegador.
 *
 * Se reexportan para no tocar los diez sitios que ya las importaban de `sitio`.
 */
export { SITIO, urlAbsoluta } from './url-sitio';
import { urlAbsoluta } from './url-sitio';

/**
 * Canonical y hreflang de una página que existe en los tres idiomas.
 *
 * La ruta de cada idioma la resuelve el propio enrutador (`/es/buscar`,
 * `/ca/cercar`, `/en/search`), así que no hay que mantener aquí una copia de
 * los slugs traducidos: el día que se cambie uno en `routing.ts`, esto lo
 * sigue solo.
 *
 * `x-default` apunta al español. Es lo que se le sirve a quien no encaja en
 * ninguno de los tres idiomas, y sin él Google elige por su cuenta —a menudo el
 * inglés, que es justo el mercado que no es el nuestro—.
 */
/**
 * Las rutas que el enrutador sabe traducir.
 *
 * Se toma del propio `getPathname` en vez de escribir `string`: así, pedir las
 * alternativas de una ruta que no está declarada en `routing.ts` no compila. Es
 * la diferencia entre enterarse ahora y publicar un hreflang que apunta a un
 * 404 —que hace que Google descarte el grupo entero de alternativas—.
 */
type RutaConocida = Parameters<typeof getPathname>[0]['href'];

/**
 * Es asíncrona porque los idiomas ofrecidos los decide el panel.
 *
 * Antes anunciaba los tres compilados siempre. Con un idioma desactivado eso es
 * un `hreflang` a una versión que se ha decidido no ofrecer: Google la rastrea,
 * la indexa y la enseña, y el visitante acaba en un idioma que la tienda ya no
 * quería servir. Ahora sale de `shop.supportedLocales`.
 */
export async function alternativas(
  href: RutaConocida,
  locale: string,
): Promise<Metadata['alternates']> {
  const activos = await idiomasActivos();
  const porDefecto = await idiomaPorDefecto();

  const languages = Object.fromEntries(
    activos.map((l) => [l, urlAbsoluta(getPathname({ href, locale: l }))]),
  );

  return {
    canonical: urlAbsoluta(getPathname({ href, locale })),
    languages: {
      ...languages,
      'x-default': urlAbsoluta(getPathname({ href, locale: porDefecto })),
    },
  };
}

/**
 * Lo mismo, para páginas cuyo slug cambia con el idioma.
 *
 * Es el caso de las fichas de producto y de los artículos del blog: el
 * enrutador no puede deducir `/ca/producto/botes-de-cuir` a partir de
 * `/es/producto/botas-de-cuero`, porque el slug lo pone el contenido y no la
 * configuración. Aquí se le pasan hechas.
 *
 * Solo se declaran los idiomas que EXISTEN. Un producto sin traducir al catalán
 * no debe anunciar una URL catalana: sería un hreflang apuntando a un 404, y
 * Google descarta el grupo entero de alternativas cuando uno falla.
 */
export async function alternativasDeContenido(
  rutas: Record<string, string>,
  locale: string,
): Promise<Metadata['alternates']> {
  const activos = await idiomasActivos();
  const porDefectoIdioma = await idiomaPorDefecto();

  // Dos filtros que se suman: la traducción tiene que EXISTIR (lo que llega en
  // `rutas`) y su idioma tiene que estar ACTIVO (lo que dice el panel).
  const languages = Object.fromEntries(
    Object.entries(rutas)
      .filter(([l]) => (activos as readonly string[]).includes(l))
      .map(([l, ruta]) => [l, urlAbsoluta(ruta)]),
  );

  const propia = rutas[locale];
  const porDefecto = rutas[porDefectoIdioma] ?? propia;

  return {
    ...(propia ? { canonical: urlAbsoluta(propia) } : {}),
    languages: {
      ...languages,
      ...(porDefecto ? { 'x-default': urlAbsoluta(porDefecto) } : {}),
    },
  };
}
