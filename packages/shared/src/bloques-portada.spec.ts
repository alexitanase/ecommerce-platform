import { describe, expect, it } from 'vitest';
import { bloquesPorDefecto, bloquesPortadaSchema, textoDe } from './bloques-portada.js';

/**
 * La portada es la página que más se visita: un bloque que no valida la deja
 * sin esa sección, y con los de fábrica la dejaría sin nada.
 */

describe('Textos por idioma', () => {
  it('devuelve el idioma pedido', () => {
    expect(textoDe({ es: 'Hola', en: 'Hi' }, 'en')).toBe('Hi');
  });

  it('cae al español cuando falta la traducción', () => {
    // Una portada en otro idioma es mejor que una portada con huecos.
    expect(textoDe({ es: 'Hola' }, 'ca')).toBe('Hola');
  });

  it('coge cualquier traducción si tampoco hay español', () => {
    expect(textoDe({ en: 'Hi' }, 'ca')).toBe('Hi');
  });

  it('sin texto devuelve cadena vacía, no "undefined"', () => {
    // Es lo que se pinta tal cual en la página.
    expect(textoDe(undefined, 'es')).toBe('');
    expect(textoDe({}, 'es')).toBe('');
  });
});

describe('Bloques de fábrica', () => {
  it('validan contra el esquema', () => {
    // Si dejan de validar, una tienda recién instalada abre con la portada
    // vacía: el esquema y los valores por defecto tienen que ir a la par.
    expect(bloquesPortadaSchema.safeParse(bloquesPorDefecto()).success).toBe(true);
  });

  it('traen hero y algún listado de productos', () => {
    const tipos = bloquesPorDefecto().map((b) => b.tipo);
    expect(tipos).toContain('hero');
    expect(tipos).toContain('destacados');
  });
});

describe('Validación', () => {
  it('rechaza un tipo de bloque que no existe', () => {
    const resultado = bloquesPortadaSchema.safeParse([{ id: 'x', tipo: 'carrusel3d' }]);
    expect(resultado.success).toBe(false);
  });

  it('rellena los valores por defecto de un bloque mínimo', () => {
    const resultado = bloquesPortadaSchema.parse([{ id: 'd', tipo: 'destacados', titulo: {} }]);
    const bloque = resultado[0];

    expect(bloque?.visible).toBe(true);
    expect(bloque?.tipo === 'destacados' && bloque.origen).toBe('novedad');
    expect(bloque?.tipo === 'destacados' && bloque.limite).toBe(8);
  });
});
