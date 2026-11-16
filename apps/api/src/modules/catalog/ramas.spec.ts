import { describe, expect, it } from 'vitest';
import { categoriasConProductoEnLaRama } from './ramas.js';

const MODA = { id: 'moda', path: '/moda/' };
const CALZADO = { id: 'calzado', path: '/moda/calzado/' };
const BOTAS = { id: 'botas', path: '/moda/calzado/botas/' };
const BDSM = { id: 'bdsm', path: '/bdsm/' };

describe('categoriasConProductoEnLaRama', () => {
  it('una raíz sin productos propios cuenta si los tiene una hija', () => {
    // Es el caso normal del catálogo importado: los productos cuelgan de la
    // hoja y la raíz —la que se enseña en el menú y en la portada— tiene cero.
    const conProducto = categoriasConProductoEnLaRama([MODA, CALZADO, BOTAS, BDSM], [BOTAS.path]);

    expect(conProducto.has('moda')).toBe(true);
    expect(conProducto.has('calzado')).toBe(true);
    expect(conProducto.has('botas')).toBe(true);
  });

  it('una rama sin nada dentro no cuenta', () => {
    const conProducto = categoriasConProductoEnLaRama([MODA, CALZADO, BDSM], [CALZADO.path]);

    expect(conProducto.has('bdsm')).toBe(false);
  });

  it('no cuenta una categoría cuyo nombre empieza igual que otra con producto', () => {
    // «/moda/» y «/modafresca/» son ramas distintas. Comparando el texto sin
    // cuidado, la segunda heredaría los productos de la primera y saldría
    // anunciada como llena para llevar a un listado vacío.
    const conProducto = categoriasConProductoEnLaRama(
      [MODA, { id: 'modafresca', path: '/modafresca/' }],
      [MODA.path],
    );

    expect(conProducto.has('moda')).toBe(true);
    expect(conProducto.has('modafresca')).toBe(false);
  });

  it('sin ningún producto no cuenta ninguna', () => {
    expect(categoriasConProductoEnLaRama([MODA, CALZADO], []).size).toBe(0);
  });
});
