import { describe, expect, it } from 'vitest';
import {
  costeEnCaracteres,
  MAXIMO_POR_ENVIO,
  mereceTraducirse,
  slugTraducido,
  trocear,
} from './preparar-texto.js';

describe('Trocear textos largos', () => {
  it('un texto corto va de una pieza', () => {
    expect(trocear('Botas de cuero con forro')).toEqual(['Botas de cuero con forro']);
  });

  it('un texto vacío no genera trozos', () => {
    // Mandar una cadena vacía a traducir gasta una petición para nada.
    expect(trocear('   ')).toEqual([]);
  });

  it('ningún trozo supera el límite', () => {
    const largo = Array.from({ length: 40 }, (_, i) =>
      `Párrafo número ${String(i)}. `.repeat(20),
    ).join('\n\n');

    for (const trozo of trocear(largo)) {
      expect(trozo.length).toBeLessThanOrEqual(MAXIMO_POR_ENVIO);
    }
  });

  it('no parte palabras por la mitad', () => {
    // Con cortes a ciegas, "cremallera" acaba en dos trozos y vuelven dos
    // frases sin sentido que al unirse no dicen nada.
    const largo = 'cremallera '.repeat(500);
    const trozos = trocear(largo);

    for (const trozo of trozos) {
      for (const palabra of trozo.split(/\s+/).filter(Boolean)) {
        expect(palabra).toBe('cremallera');
      }
    }
  });

  it('no pierde contenido al trocear', () => {
    const original = ['Primer párrafo.', 'Segundo párrafo con más texto.'].join('\n\n');
    expect(trocear(original, 20).join(' ').replace(/\s+/g, ' ')).toContain('Segundo párrafo');
  });

  it('parte una lista larga sin puntos', () => {
    // Caso real de proveedor: cien características separadas por comas y sin
    // un solo punto en toda la descripción.
    const lista = Array.from({ length: 300 }, (_, i) => `caracteristica${String(i)}`).join(', ');
    const trozos = trocear(lista);

    expect(trozos.length).toBeGreaterThan(1);
    for (const t of trozos) expect(t.length).toBeLessThanOrEqual(MAXIMO_POR_ENVIO);
  });
});

describe('Qué merece traducirse', () => {
  it('el texto normal sí', () => {
    expect(mereceTraducirse('Leather boots with warm lining')).toBe(true);
  });

  it('lo vacío o casi vacío no', () => {
    expect(mereceTraducirse(null)).toBe(false);
    expect(mereceTraducirse('')).toBe(false);
    expect(mereceTraducirse('XL')).toBe(false);
  });

  it('los códigos y medidas no', () => {
    // Se paga por carácter y traducidos quedan igual, o peor.
    expect(mereceTraducirse('XL-42 / 3.5mm')).toBe(false);
    expect(mereceTraducirse('SKU-99201-B')).toBe(false);
  });

  it('cuenta solo lo que se va a mandar', () => {
    expect(costeEnCaracteres(['Hola mundo', 'XL', null, 'Otra frase'])).toBe(20);
  });
});

describe('Slug traducido', () => {
  it('quita acentos y deja la URL limpia', () => {
    expect(slugTraducido('Botas de Cuero Marrón', 'ab12')).toBe('botas-de-cuero-marron-ab12');
  });

  it('lleva sufijo para no chocar con otro producto', () => {
    // Dos fichas de proveedor con el mismo título son lo normal, y el slug es
    // único por idioma: sin sufijo, la segunda importación falla.
    const a = slugTraducido('Leather boots', 'aa11');
    const b = slugTraducido('Leather boots', 'bb22');
    expect(a).not.toBe(b);
  });

  it('un título sin letras latinas no deja el slug vacío', () => {
    // Un slug vacío daría la URL "/es/" y chocaría con la portada.
    expect(slugTraducido('皮靴', 'cc33')).toBe('cc33');
  });
});
