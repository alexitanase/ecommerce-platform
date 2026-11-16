import { describe, expect, it } from 'vitest';
import { agotadosAlFinal, hayStock } from './orden-por-stock.js';

/**
 * El criterio con el que se ordena todo lo que ve el cliente.
 *
 * Vale para la portada, la lista de deseos y los productos de un artículo del
 * blog, así que un fallo aquí no se nota en una pantalla: se nota en todas.
 */

describe('agotados al final', () => {
  const p = (nombre: string, disponible: boolean) => ({ nombre, disponible });

  it('mueve al final lo que no se puede comprar', () => {
    const lista = [p('a', false), p('b', true), p('c', false), p('d', true)];

    expect(agotadosAlFinal(lista, (x) => x.disponible).map((x) => x.nombre)).toEqual([
      'b',
      'd',
      'a',
      'c',
    ]);
  });

  it('conserva el orden dentro de cada grupo', () => {
    /*
     * Es lo que hace que se pueda aplicar encima de un orden que ya costó
     * decidir: lo que el administrador colocó a mano, la nota media o la fecha
     * de publicación. Con una ordenación inestable, cada pasada barajaría ese
     * trabajo.
     */
    const lista = [p('1', true), p('2', false), p('3', true), p('4', false), p('5', true)];

    expect(agotadosAlFinal(lista, (x) => x.disponible).map((x) => x.nombre)).toEqual([
      '1',
      '3',
      '5',
      '2',
      '4',
    ]);
  });

  it('no toca nada cuando están todos igual', () => {
    const todos = [p('a', true), p('b', true)];
    expect(agotadosAlFinal(todos, (x) => x.disponible)).toEqual(todos);

    const ninguno = [p('a', false), p('b', false)];
    expect(agotadosAlFinal(ninguno, (x) => x.disponible)).toEqual(ninguno);
  });

  it('con la lista vacía devuelve una lista vacía', () => {
    expect(agotadosAlFinal([], () => true)).toEqual([]);
  });
});

describe('hay stock', () => {
  it('basta con que una variante quede', () => {
    // Un producto de ocho colores con siete agotados se sigue vendiendo:
    // tratarlo como agotado enterraría el color que sí queda.
    expect(hayStock([{ stock: 0 }, { stock: 0 }, { stock: 3 }])).toBe(true);
  });

  it('lo que se vende bajo pedido cuenta como disponible', () => {
    // Es el caso normal en dropshipping: cero unidades en casa y aun así se
    // puede comprar porque el proveedor lo sirve.
    expect(hayStock([{ stock: 0, allowBackorder: true }])).toBe(true);
  });

  it('sin unidades y sin encargo, está agotado', () => {
    expect(hayStock([{ stock: 0, allowBackorder: false }, { stock: 0 }])).toBe(false);
  });

  it('un producto sin variantes no se puede comprar', () => {
    expect(hayStock([])).toBe(false);
  });
});
