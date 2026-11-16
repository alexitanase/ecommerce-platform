import type { MetadataRoute } from 'next';
import { api } from '@/lib/api';
import { getPathname, routing } from '@/i18n/routing';
import { idiomaPorDefecto, idiomasActivos } from '@/lib/idiomas';
import { urlAbsoluta } from '@/lib/sitio';

/** Un idioma de los compilados. Alias por brevedad: sale en varias firmas. */
type Idioma = (typeof routing.locales)[number];

interface Entrada {
  /** El mismo en los tres idiomas: es por donde se emparejan las traducciones. */
  id: string;
  slug: string;
  actualizado: string;
}

interface Inventario {
  productos: Entrada[];
  categorias: Entrada[];
  articulos: Entrada[];
}

/**
 * El mapa del sitio.
 *
 * No existía, y es lo primero que pide Google al dar de alta un dominio. Sin
 * él, un catálogo importado de un proveedor —miles de fichas a las que solo se
 * llega tras dos o tres clics de filtros— se descubre a ritmo de rastreo
 * casual: semanas para lo que aquí se anuncia de una vez.
 *
 * Se regenera cada hora. El catálogo cambia con la sincronización del
 * proveedor, así que un fichero estático generado en el despliegue se quedaría
 * viejo el primer día; recalcularlo en cada lectura sería la consulta más cara
 * de la tienda a merced de cualquier robot que la pida en bucle.
 */
export const revalidate = 3600;

/**
 * Cada URL se anuncia UNA vez, con sus tres idiomas dentro.
 *
 * Es la forma que espera Google: una entrada por contenido con sus
 * `alternates`, en lugar de tres entradas sueltas. Declarándolas por separado,
 * las tres compiten entre sí como si fueran páginas distintas con el mismo
 * contenido, que es justo lo que el hreflang existe para evitar.
 */
function conIdiomas(
  ruta: (locale: (typeof routing.locales)[number]) => string,
  actualizado: Date,
  prioridad: number,
  /*
   * Los idiomas se reciben, no se leen de las constantes.
   *
   * Antes anunciaba los tres compilados, así que un idioma desactivado desde el
   * panel seguía en el sitemap: Google lo rastreaba, lo indexaba y lo enseñaba.
   * Desactivarlo tiene que sacarlo de aquí, o no está desactivado.
   */
  activos: Idioma[],
  porDefecto: Idioma,
): MetadataRoute.Sitemap[number] {
  return {
    url: urlAbsoluta(ruta(porDefecto)),
    lastModified: actualizado,
    priority: prioridad,
    alternates: {
      languages: Object.fromEntries(activos.map((l) => [l, urlAbsoluta(ruta(l))])),
    },
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const ahora = new Date();

  // Qué idiomas sirve la tienda según el panel. Todo lo de abajo sale de aquí.
  const activos = await idiomasActivos();
  const porDefecto = await idiomaPorDefecto();

  /*
   * Las páginas fijas. Van siempre, aunque la API no responda.
   *
   * Es deliberado: si el sitemap dependiera por entero de que la API conteste,
   * un despliegue con la API arrancando todavía publicaría un sitemap vacío, y
   * un sitemap vacío no dice «espera un momento», dice «este sitio no tiene
   * nada».
   */
  const fijas: MetadataRoute.Sitemap = [
    conIdiomas((l) => getPathname({ href: '/', locale: l }), ahora, 1, activos, porDefecto),
    conIdiomas((l) => getPathname({ href: '/buscar', locale: l }), ahora, 0.9, activos, porDefecto),
    conIdiomas(
      (l) => getPathname({ href: '/categorias', locale: l }),
      ahora,
      0.8,
      activos,
      porDefecto,
    ),
    conIdiomas((l) => getPathname({ href: '/marcas', locale: l }), ahora, 0.7, activos, porDefecto),
    // Alta a propósito: «ofertas» es de las pocas palabras que la gente escribe
    // en Google junto al nombre de una tienda.
    conIdiomas(
      (l) => getPathname({ href: '/ofertas', locale: l }),
      ahora,
      0.8,
      activos,
      porDefecto,
    ),
    conIdiomas((l) => getPathname({ href: '/blog', locale: l }), ahora, 0.6, activos, porDefecto),
  ];

  // El inventario de los tres idiomas. Los slugs cambian con el idioma
  // —`botas-de-cuero` / `botes-de-cuir`— así que no se deducen unos de otros:
  // hay que pedir los tres y emparejarlos.
  const porIdioma = await Promise.all(
    activos.map(async (locale) => {
      const inventario = await api<Inventario>(`/content/sitemap/${locale}`, {
        revalidar: 3600,
        etiquetas: ['catalogo', 'sitemap'],
      }).catch((): Inventario => ({ productos: [], categorias: [], articulos: [] }));

      return [locale, inventario] as const;
    }),
  );

  const inventarios = new Map(porIdioma);
  const principal = inventarios.get(porDefecto);
  if (!principal) return fijas;

  /**
   * Los slugs de un tipo de contenido, indexados por identificador y por idioma.
   *
   * **Se cruza por identificador, nunca por posición.** Emparejar por índice
   * funciona justo hasta que un producto no está traducido a uno de los tres
   * idiomas: a partir de ese hueco, todo lo que va detrás queda desplazado y
   * cada ficha anuncia como versión catalana la de otro producto distinto.
   * Google seguiría los hreflang y acabaría enseñando el artículo equivocado,
   * que es bastante peor que no declarar ninguno.
   */
  const indicePor = (tipo: keyof Inventario) =>
    new Map(
      routing.locales.map((l) => [
        l,
        new Map((inventarios.get(l)?.[tipo] ?? []).map((e) => [e.id, e.slug])),
      ]),
    );

  /**
   * Las alternativas de un contenido, solo en los idiomas donde existe.
   *
   * Un producto sin traducir al catalán no tiene URL catalana, y anunciarla
   * sería mandar a Google a un 404: cuando una alternativa falla, descarta el
   * grupo entero y la ficha se queda sin hreflang en ningún idioma.
   */
  const alternativasDe = (
    indices: ReturnType<typeof indicePor>,
    id: string,
    ruta: (locale: (typeof routing.locales)[number], slug: string) => string,
  ) =>
    Object.fromEntries(
      activos.flatMap((l) => {
        const slug = indices.get(l)?.get(id);
        return slug ? [[l, urlAbsoluta(ruta(l, slug))]] : [];
      }),
    );

  const deProductos = indicePor('productos');
  const deCategorias = indicePor('categorias');
  const deArticulos = indicePor('articulos');

  const productos: MetadataRoute.Sitemap = principal.productos.map((p) => ({
    url: urlAbsoluta(`/${porDefecto}/producto/${p.slug}`),
    lastModified: new Date(p.actualizado),
    priority: 0.8,
    alternates: {
      languages: alternativasDe(deProductos, p.id, (l, slug) => `/${l}/producto/${slug}`),
    },
  }));

  const rutaCategoria = (l: (typeof routing.locales)[number], slug: string) =>
    `${getPathname({ href: '/buscar', locale: l })}?categoria=${encodeURIComponent(slug)}`;

  const categorias: MetadataRoute.Sitemap = principal.categorias.map((c) => ({
    url: urlAbsoluta(rutaCategoria(porDefecto, c.slug)),
    lastModified: new Date(c.actualizado),
    // Por encima de las fichas a propósito: en una tienda, la categoría es la
    // página por la que entra el tráfico de búsqueda y desde la que se llega a
    // todo lo demás.
    priority: 0.9,
    alternates: { languages: alternativasDe(deCategorias, c.id, rutaCategoria) },
  }));

  const articulos: MetadataRoute.Sitemap = principal.articulos.map((a) => ({
    url: urlAbsoluta(`/${porDefecto}/blog/${a.slug}`),
    lastModified: new Date(a.actualizado),
    priority: 0.7,
    alternates: {
      languages: alternativasDe(deArticulos, a.id, (l, slug) => `/${l}/blog/${slug}`),
    },
  }));

  return [...fijas, ...categorias, ...productos, ...articulos];
}
