/**
 * Lo que no se puede comprar va al final.
 *
 * Un producto agotado en la primera fila de un listado es una venta que no
 * ocurre: el cliente entra en la ficha, se encuentra el botón apagado y se va
 * —normalmente a otra tienda, no a la fila siguiente—. Con un catálogo de
 * dropshipping donde el proveedor deja sin stock decenas de referencias cada
 * semana, eso pasa a diario y sin que nadie lo toque.
 *
 * La regla es la misma en toda la plataforma: **primero lo disponible, y
 * dentro de cada grupo el orden que ya hubiera**. No es lo mismo que esconder
 * lo agotado: sigue estando, se sigue pudiendo encontrar y se sigue indexando
 * para Google, simplemente deja de ocupar el sitio de lo que sí se vende.
 *
 * Este fichero es solo el criterio, para que no se escriba distinto en cada
 * pantalla. Quien puede ordenar en la base de datos —o en el buscador— lo hace
 * allí; esto es para las listas que ya vienen dadas.
 */

/**
 * Reordena dejando lo agotado al final, **conservando el orden relativo**.
 *
 * La estabilidad no es un detalle: se aplica encima de listas que ya venían
 * ordenadas por algo que costó decidir —lo que eligió el administrador a mano,
 * la nota media, la fecha de publicación—, y una ordenación inestable barajaría
 * ese trabajo cada vez. `Array.prototype.sort` es estable desde ES2019, pero se
 * hace con dos filtros porque así se lee lo que hace sin tener que recordarlo.
 */
export function agotadosAlFinal<T>(elementos: T[], disponible: (elemento: T) => boolean): T[] {
  const enStock: T[] = [];
  const agotados: T[] = [];

  for (const elemento of elementos) {
    if (disponible(elemento)) enStock.push(elemento);
    else agotados.push(elemento);
  }

  return [...enStock, ...agotados];
}

/**
 * ¿Se puede comprar este producto ahora mismo?
 *
 * Basta con que UNA variante tenga existencias: un producto de ocho colores
 * con siete agotados se sigue vendiendo, y tratarlo como agotado lo enterraría
 * junto con el color que sí queda.
 *
 * `allowBackorder` cuenta como disponible a propósito. Es lo que marca lo que
 * se vende bajo pedido —el caso normal en dropshipping cuando el proveedor
 * repone—: hay stock cero en casa y aun así se puede comprar, así que
 * enterrarlo sería esconder catálogo que factura.
 */
export function hayStock(variantes: { stock: number; allowBackorder?: boolean }[]): boolean {
  return variantes.some((v) => v.stock > 0 || v.allowBackorder === true);
}
