import { describe, expect, it } from 'vitest';
import {
  MAXIMO_ENLACES,
  enlaceMenuSchema,
  menuNavegacionSchema,
  menuPorDefecto,
} from './menu-navegacion.js';

const base = {
  id: 'uno',
  tipo: 'url' as const,
  destino: '/buscar',
  etiqueta: { es: 'Catálogo' },
};

describe('enlaceMenuSchema', () => {
  it('rellena lo que no se indica', () => {
    const enlace = enlaceMenuSchema.parse(base);
    expect(enlace.visible).toBe(true);
    expect(enlace.destacado).toBe(false);
  });

  it('admite rutas de la tienda y direcciones completas', () => {
    for (const destino of [
      '/buscar',
      '/buscar?categoria=juguetes',
      '/es/aviso-legal',
      'https://instagram.com/chispaynoche',
      'http://ejemplo.es',
    ]) {
      expect(enlaceMenuSchema.safeParse({ ...base, destino }).success, destino).toBe(true);
    }
  });

  it('rechaza un destino que ejecutaría código', () => {
    /*
     * Este es el motivo de que el destino se valide. El valor acaba en el `href`
     * de un enlace que se sirve en TODAS las páginas de la tienda: un
     * `javascript:` guardado aquí es un XSS almacenado en la navegación
     * principal, no una errata.
     */
    for (const destino of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      '//malo.example',
      'malo.example',
      'ftp://ejemplo.es',
      ' javascript:alert(1)',
    ]) {
      expect(enlaceMenuSchema.safeParse({ ...base, destino }).success, destino).toBe(false);
    }
  });

  it('a una página o una categoría no se le exige forma de URL', () => {
    // Ahí el destino es un identificador, no una dirección.
    expect(
      enlaceMenuSchema.safeParse({ ...base, tipo: 'pagina', destino: 'ckq1234567890' }).success,
    ).toBe(true);
    expect(
      enlaceMenuSchema.safeParse({ ...base, tipo: 'categoria', destino: 'ckq0987654321' }).success,
    ).toBe(true);
  });

  it('la etiqueta es opcional y por idioma', () => {
    const enlace = enlaceMenuSchema.parse({ ...base, etiqueta: { es: 'Ofertas', en: 'Deals' } });
    expect(enlace.etiqueta?.es).toBe('Ofertas');
    expect(enlace.etiqueta?.ca).toBeUndefined();
  });

  it('una dirección sin texto no pasa: saldría un enlace en blanco', () => {
    expect(enlaceMenuSchema.safeParse({ id: 'x', tipo: 'url', destino: '/buscar' }).success).toBe(
      false,
    );
    expect(
      enlaceMenuSchema.safeParse({
        id: 'x',
        tipo: 'url',
        destino: '/buscar',
        etiqueta: { es: '  ' },
      }).success,
    ).toBe(false);
  });

  it('una página sin texto sí pasa: se usa su título real', () => {
    expect(
      enlaceMenuSchema.safeParse({ id: 'x', tipo: 'pagina', destino: 'ckq1234567890' }).success,
    ).toBe(true);
  });

  it('un tipo inventado no pasa', () => {
    expect(enlaceMenuSchema.safeParse({ ...base, tipo: 'iframe' }).success).toBe(false);
  });
});

describe('menuNavegacionSchema', () => {
  it('acepta una lista vacía: un menú sin enlaces es no tener sub-barra', () => {
    expect(menuNavegacionSchema.parse([])).toEqual([]);
  });

  it('corta en el máximo, que es de legibilidad y no técnico', () => {
    const muchos = Array.from({ length: MAXIMO_ENLACES + 1 }, (_, i) => ({
      ...base,
      id: `e${String(i)}`,
    }));
    expect(menuNavegacionSchema.safeParse(muchos).success).toBe(false);
  });

  it('el menú de fábrica es válido y lleva al catálogo y a las categorías', () => {
    const menu = menuNavegacionSchema.parse(menuPorDefecto());
    // Las dos rutas fijas de la tienda: el listado completo y su índice. Sin
    // la segunda, a una categoría que no esté en el menú solo se llega
    // acertando con el buscador de productos.
    expect(menu.map((e) => e.destino)).toEqual(['/buscar', '/categorias']);
    // Traducidas a los tres idiomas de la tienda desde el primer día.
    for (const enlace of menu) {
      expect(Object.keys(enlace.etiqueta ?? {}).sort()).toEqual(['ca', 'en', 'es']);
    }
  });
});
