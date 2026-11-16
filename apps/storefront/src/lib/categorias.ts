import { api } from './api';

/**
 * Una categoría del árbol, tal y como la manda la API.
 *
 * `imagen` es la foto de portada: la que subió el panel o, si no hay, la que
 * la API calcula sola a partir de un producto de la rama. Puede seguir siendo
 * nula —una categoría recién creada y todavía vacía—, así que todo lo que la
 * pinte tiene que saber qué enseñar sin ella.
 */
export interface Categoria {
  id: string;
  handle: string;
  name: string;
  slug: string;
  depth: number;
  isAdult: boolean;
  imagen: string | null;
  /** Productos colgados directamente de ella. */
  productos: number;
  /** Productos de la rama entera. Es el número que se enseña. */
  productosRama: number;
  children: Categoria[];
}

/**
 * El árbol de categorías de la tienda.
 *
 * Con caché larga y etiqueta propia: el árbol cambia como mucho cuando alguien
 * toca el catálogo, entra en la cabecera y en tres pantallas más, y volver a
 * pedirlo en cada visita sería la consulta más repetida de la tienda para el
 * dato que menos cambia. La API además lo sirve con cabeceras de caché, así que
 * en producción la mayoría de las veces ni sale de la CDN.
 *
 * Si falla se devuelve vacío, como el menú: sin categorías la tienda se navega
 * peor, pero se navega. Propagar el error dejaría la cabecera —y por tanto
 * TODAS las páginas— en blanco por un listado que es de apoyo.
 */
export async function arbolCategorias(locale: string): Promise<Categoria[]> {
  try {
    return await api<Categoria[]>(`/catalog/categories/tree?locale=${locale}`, {
      revalidar: 600,
      etiquetas: ['catalogo', 'categorias'],
    });
  } catch {
    return [];
  }
}

/**
 * Busca una categoría por su slug en todo el árbol, a cualquier profundidad.
 *
 * Se usa para titular la página del catálogo con el nombre de la categoría en
 * la que se ha entrado. Sale del árbol —que ya viene cacheado y se pide para la
 * cabecera— en vez de una consulta propia: titular una página no justifica otra
 * llamada a la API en cada visita.
 */
export function buscarCategoria(arbol: Categoria[], slug: string): Categoria | null {
  for (const categoria of arbol) {
    if (categoria.slug === slug) return categoria;
    const dentro = buscarCategoria(categoria.children, slug);
    if (dentro) return dentro;
  }
  return null;
}

/**
 * Las categorías con las que se ofrece empezar a navegar.
 *
 * Las raíces con producto dentro, de la más grande a la más pequeña. Se
 * descartan las vacías a propósito: una categoría que lleva a «sin resultados»
 * es peor que no ofrecerla, y en un catálogo importado de un proveedor siempre
 * quedan ramas creadas que todavía no tienen nada.
 */
export function categoriasDestacadas(arbol: Categoria[], cuantas = 8): Categoria[] {
  return arbol
    .filter((c) => c.productosRama > 0)
    .sort((a, b) => b.productosRama - a.productosRama)
    .slice(0, cuantas);
}

/** Dónde se está y a dónde se puede ir desde ahí. */
export interface NavegacionCategorias {
  /** De la raíz hasta la actual, ambas incluidas. Vacío en el catálogo entero. */
  ruta: Categoria[];
  /** En cuál se está, si se está en alguna. */
  actual: Categoria | null;
  /** A dónde se puede bajar —o saltar— desde aquí. */
  opciones: Categoria[];
  /** `true` si `opciones` son hermanas porque la actual no tiene hijas. */
  sonHermanas: boolean;
}

const conProducto = (categorias: Categoria[]): Categoria[] =>
  categorias.filter((c) => c.productosRama > 0);

/** La rama desde la raíz hasta el slug, o `null` si no está en el árbol. */
function ramaHasta(arbol: Categoria[], slug: string): Categoria[] | null {
  for (const categoria of arbol) {
    if (categoria.slug === slug) return [categoria];
    const dentro = ramaHasta(categoria.children, slug);
    if (dentro) return [categoria, ...dentro];
  }
  return null;
}

/**
 * El filtro de categorías del catálogo, entendido como navegación.
 *
 * Antes era una faceta: se listaban las categorías **de los resultados
 * actuales**. Suena razonable y en la práctica era un callejón: al elegir una,
 * los resultados pasaban a ser solo de ella, así que la lista se quedaba con
 * esa sola categoría dentro. Desde ahí no se podía bajar a una subcategoría, ni
 * saltar a otra, ni volver atrás: la única salida era «Limpiar filtros», que de
 * paso se llevaba el precio y la marca. Y como no había ninguna señal de que
 * pulsándola otra vez se quitaba, quien entraba se quedaba encerrado.
 *
 * Ahora se navega el árbol, que es lo que la gente espera de una tienda:
 *
 *  · **Sin categoría** — las secciones grandes, para empezar por algún sitio.
 *  · **Dentro de una** — las migas para subir, y debajo sus subcategorías. Si no
 *    tiene, sus hermanas, que es lo que hace falta ahí: al llegar a la última
 *    rama lo siguiente que se quiere es mirar la de al lado, no volver arriba.
 *
 * Las vacías no se ofrecen nunca, aquí tampoco.
 */
export function navegarCategorias(arbol: Categoria[], slug?: string): NavegacionCategorias {
  const rama = slug ? ramaHasta(arbol, slug) : null;
  const actual = rama?.at(-1) ?? null;

  if (!actual) {
    return { ruta: [], actual: null, opciones: conProducto(arbol), sonHermanas: false };
  }

  const hijas = conProducto(actual.children);
  if (hijas.length > 0) {
    return { ruta: rama ?? [], actual, opciones: hijas, sonHermanas: false };
  }

  // Las hermanas salen del padre, y la actual se queda fuera: ya está arriba,
  // en las migas, marcada como dónde se está.
  const padre = rama?.at(-2);
  const hermanas = conProducto(padre ? padre.children : arbol).filter((c) => c.id !== actual.id);

  return { ruta: rama ?? [], actual, opciones: hermanas, sonHermanas: true };
}
