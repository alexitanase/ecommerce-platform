/**
 * Qué categorías tienen algo que vender, contando lo que cuelga de ellas.
 *
 * Es LA regla del catálogo, y estaba escrita cuatro veces —menú, portada,
 * sitemap y árbol— con cuatro criterios distintos. La incoherencia entre ellos
 * es lo que producía los fallos: el mismo «Lovetoys» salía en el menú, no salía
 * en la portada y no entraba en el sitemap.
 *
 * Lo que decide es la RAMA, no los productos propios. En un catálogo importado
 * de un proveedor los productos cuelgan siempre de la hoja más concreta, así que
 * las categorías grandes —las que interesa enseñar— tienen cero productos suyos
 * y miles por debajo. Mirando el producto directo se esconden justo esas y
 * quedan a la vista las hojas sueltas, que es lo contrario de lo que hace falta.
 */

/**
 * Los identificadores de las categorías con producto en su rama.
 *
 * @param todas       todas las categorías vivas, con su ruta materializada
 * @param conProducto rutas de las categorías que tienen producto **propio**
 *
 * Se resuelve por prefijos y no comparando cada categoría con cada ruta: una
 * ruta materializada lleva dentro las de todos sus ancestros, así que de
 * `/moda/calzado/botas/` salen `/moda/`, `/moda/calzado/` y ella misma. Con eso
 * el recorrido es lineal en vez de cuadrático, que con las 318 categorías del
 * proveedor son 100.000 comparaciones menos por cada portada que se pinta.
 */
export function categoriasConProductoEnLaRama(
  todas: { id: string; path: string }[],
  conProducto: string[],
): Set<string> {
  const ramas = new Set<string>();

  for (const ruta of conProducto) {
    let acumulada = '/';
    for (const tramo of ruta.split('/').filter(Boolean)) {
      acumulada += `${tramo}/`;
      ramas.add(acumulada);
    }
  }

  const resultado = new Set<string>();
  for (const categoria of todas) {
    if (ramas.has(categoria.path)) resultado.add(categoria.id);
  }

  return resultado;
}
