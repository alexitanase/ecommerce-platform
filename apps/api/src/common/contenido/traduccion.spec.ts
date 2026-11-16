import { describe, expect, it } from 'vitest';
import { traduccionPreferida } from './traduccion.js';

const ES = { locale: 'es', name: 'Auriculares', slug: 'auriculares' };
const CA = { locale: 'ca', name: 'Auriculars', slug: 'auriculars' };
const EN = { locale: 'en', name: 'Headphones', slug: 'headphones' };

describe('traduccionPreferida', () => {
  it('devuelve la del idioma pedido', () => {
    expect(traduccionPreferida([ES, CA, EN], 'ca')).toBe(CA);
  });

  it('sin la del idioma pedido, cae al español', () => {
    // Es el caso normal del catálogo importado: el proveedor manda en español
    // y las otras dos lenguas se rellenan después, o nunca.
    expect(traduccionPreferida([ES, CA], 'en')).toBe(ES);
  });

  it('sin español, la que haya', () => {
    // Un nombre en otro idioma es peor que el correcto y muchísimo mejor que
    // enseñar el identificador interno del producto.
    expect(traduccionPreferida([EN], 'ca')).toBe(EN);
  });

  it('sin ninguna devuelve null en vez de inventarse un texto', () => {
    // Quien llame tiene que descartar el producto: sin traducción no hay ni
    // nombre que enseñar ni slug al que enlazar.
    expect(traduccionPreferida([], 'es')).toBeNull();
  });
});
