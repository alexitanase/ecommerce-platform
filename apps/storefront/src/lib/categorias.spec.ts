import { describe, expect, it } from 'vitest';
import { navegarCategorias, type Categoria } from './categorias';

const cat = (slug: string, productosRama: number, children: Categoria[] = []): Categoria => ({
  id: slug,
  handle: slug,
  name: slug,
  slug,
  depth: 0,
  isAdult: false,
  imagen: null,
  productos: 0,
  productosRama,
  children,
});

const ARBOL: Categoria[] = [
  cat('juguetes', 5270, [
    cat('vibradores', 900, [cat('vibradores-realisticos', 175), cat('vibradores-mando', 292)]),
    cat('dildos', 153),
    cat('vacia', 0),
  ]),
  cat('bdsm', 1209, [cat('esposas', 226)]),
  cat('legado-vacia', 0),
];

const slugs = (cs: Categoria[]) => cs.map((c) => c.slug);

describe('navegarCategorias', () => {
  it('sin categoría ofrece las secciones grandes', () => {
    const nav = navegarCategorias(ARBOL);

    expect(nav.actual).toBeNull();
    expect(slugs(nav.opciones)).toEqual(['juguetes', 'bdsm']);
  });

  it('nunca ofrece una categoría vacía', () => {
    // Un enlace a un listado sin nada se pulsa una vez y ya no se vuelve a
    // pulsar ninguno.
    expect(slugs(navegarCategorias(ARBOL).opciones)).not.toContain('legado-vacia');
    expect(slugs(navegarCategorias(ARBOL, 'juguetes').opciones)).not.toContain('vacia');
  });

  it('dentro de una sección se puede bajar a sus subcategorías', () => {
    const nav = navegarCategorias(ARBOL, 'juguetes');

    expect(nav.actual?.slug).toBe('juguetes');
    expect(slugs(nav.opciones)).toEqual(['vibradores', 'dildos']);
    expect(nav.sonHermanas).toBe(false);
  });

  it('las migas llevan de vuelta arriba', () => {
    // Es la salida que no existía: al elegir una categoría, la lista se
    // quedaba con esa sola dentro y no había forma de volver ni de saltar a
    // otra sin limpiar todos los filtros.
    const nav = navegarCategorias(ARBOL, 'vibradores-realisticos');

    expect(slugs(nav.ruta)).toEqual(['juguetes', 'vibradores', 'vibradores-realisticos']);
  });

  it('en la última rama se ofrecen las hermanas, no un hueco', () => {
    // Al llegar abajo del todo, lo siguiente que se quiere mirar es la rama de
    // al lado.
    const nav = navegarCategorias(ARBOL, 'vibradores-realisticos');

    expect(nav.sonHermanas).toBe(true);
    expect(slugs(nav.opciones)).toEqual(['vibradores-mando']);
  });

  it('una hoja de primer nivel ofrece las otras secciones', () => {
    const nav = navegarCategorias(ARBOL, 'bdsm');

    expect(slugs(nav.opciones)).toEqual(['esposas']);
  });

  it('un slug que no existe se trata como el catálogo entero', () => {
    // Un enlace viejo o escrito a mano no puede dejar la barra en blanco.
    const nav = navegarCategorias(ARBOL, 'no-existe');

    expect(nav.actual).toBeNull();
    expect(slugs(nav.opciones)).toEqual(['juguetes', 'bdsm']);
  });
});
