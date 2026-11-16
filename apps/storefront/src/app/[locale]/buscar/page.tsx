import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPathname } from '@/i18n/routing';
import { arbolCategorias, buscarCategoria } from '@/lib/categorias';
import { urlAbsoluta } from '@/lib/sitio';
import { tarjetaDeEnlace } from '@/lib/tarjeta-enlace';
import { ListadoCatalogo } from '@/components/listado-catalogo';

/**
 * Listado y buscador.
 *
 * Es dinámica, no estática: los filtros van en la URL y cada combinación es
 * una página distinta. Pregenerarlas todas sería imposible y cachearlas por
 * separado llenaría el caché de variantes que nadie vuelve a visitar.
 */
export const dynamic = 'force-dynamic';

/** Lo que convierte el catálogo en «un corte del catálogo». */
const CLAVES_QUE_FILTRAN = [
  'q',
  'marca',
  'precioMin',
  'precioMax',
  'soloDisponibles',
  'orden',
] as const;

const primero = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/**
 * Metadatos del catálogo y de cada categoría.
 *
 * Esta página no tenía ninguno: ni título, ni descripción, ni canonical, ni
 * robots. Todas las categorías de la tienda compartían el título «Mi Tienda» y
 * competían entre sí por ser la misma página. En una tienda, la categoría es
 * la puerta de entrada de casi todo el tráfico de búsqueda, así que era el
 * agujero más caro de los que había.
 *
 * Lo que se decide aquí es qué versión de esta página existe para el buscador:
 *
 *  · **Sin filtros, o solo con categoría** → se indexa, y el canonical es ella
 *    misma. Son las URLs que van en el sitemap.
 *  · **Con cualquier filtro, orden, búsqueda o página** → `noindex`, y el
 *    canonical apunta a la versión limpia. Son cortes de la misma lista: cinco
 *    filtros dan cientos de URLs con el mismo contenido barajado, y sin esto
 *    Google las rastrea todas y reparte entre ellas la fuerza que debería ir a
 *    una sola.
 *
 * Los `hreflang` de las categorías se declaran en el sitemap y no aquí. El slug
 * cambia en cada idioma, así que hacerlo en la página costaría pedir el árbol
 * de categorías de los tres idiomas en cada visita al catálogo; en el sitemap
 * se resuelve una vez por hora y Google lo admite igual.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ locale }, sp, t] = await Promise.all([params, searchParams, getTranslations('listado')]);

  const slugCategoria = primero(sp['categoria']);
  const pagina = Number(primero(sp['pagina']) ?? '1');
  const recortado =
    CLAVES_QUE_FILTRAN.some((k) => primero(sp[k])) || (Number.isFinite(pagina) && pagina > 1);

  const categoria = slugCategoria
    ? buscarCategoria(await arbolCategorias(locale), slugCategoria)
    : null;

  const base = getPathname({ href: '/buscar', locale });
  const limpia = categoria ? `${base}?categoria=${encodeURIComponent(categoria.slug)}` : base;

  const consulta = primero(sp['q']);

  const titulo = consulta ? `«${consulta}»` : (categoria?.name ?? t('titulo'));
  const descripcion = categoria
    ? t('meta_categoria', { categoria: categoria.name, total: categoria.productosRama })
    : t('meta_catalogo');

  return {
    title: titulo,
    description: descripcion,
    alternates: { canonical: urlAbsoluta(limpia) },
    robots: recortado ? { index: false, follow: true } : { index: true, follow: true },
    /*
     * La tarjeta del enlace, que aquí no existía en absoluto.
     *
     * Compartir una categoría es de lo más habitual —«mira esta sección»— y
     * hasta ahora salía con el nombre genérico de la tienda y sin foto, igual
     * que si se hubiera pegado la dirección de la portada. La foto es la
     * portada de la categoría, que la API ya calcula sola a partir de un
     * producto de la rama, así que sale con imagen sin que nadie suba nada.
     *
     * Se comparte SIEMPRE la dirección limpia, no la que trae los filtros: lo
     * que se quiere enseñar es la categoría, no los cuatro artículos que
     * quedaban tras filtrar por marca y precio.
     */
    ...tarjetaDeEnlace({
      titulo,
      descripcion,
      ruta: limpia,
      imagen: categoria?.imagen ? { url: categoria.imagen, alt: categoria.name } : null,
    }),
  };
}

export default async function PaginaBuscar({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  // El cuerpo vive en `ListadoCatalogo`: lo comparte con `/ofertas`, que es
  // este mismo listado con un filtro puesto de antemano.
  return <ListadoCatalogo locale={locale} sp={sp} />;
}
