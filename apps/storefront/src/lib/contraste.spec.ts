import { describe, expect, it } from 'vitest';
import { AA_TEXTO_NORMAL, colorSeguro, contraste, cumpleAA, textoSobre } from './contraste';

/**
 * Esta prueba es la paleta.
 *
 * Cada color de texto se comprueba contra el fondo MÁS CLARO (en tema claro) o
 * MÁS OSCURO (en tema oscuro) en el que puede aparecer, que es el caso peor.
 * Si alguien baja un tono porque "queda mejor", esto lo dice antes de que llegue
 * a producción, y no una auditoría de accesibilidad seis meses después.
 *
 * Los valores tienen que ir a la par de `styles/globals.css`. Duplicarlos aquí
 * es a propósito: un test que leyera el CSS pasaría siempre, porque compararía
 * el fichero consigo mismo.
 */

const CLARO = {
  fondos: { fondo: '#ffffff', sutil: '#f8fafc', elevado: '#ffffff' },
  textos: {
    texto: '#0f172a',
    suave: '#475569',
    tenue: '#64748b',
    exito: '#15803d',
    aviso: '#b45309',
    error: '#dc2626',
    info: '#0369a1',
  },
};

const OSCURO = {
  fondos: { fondo: '#0b0f17', sutil: '#111827', elevado: '#161d2b' },
  textos: {
    texto: '#f1f5f9',
    suave: '#cbd5e1',
    tenue: '#94a3b8',
    exito: '#4ade80',
    aviso: '#fbbf24',
    error: '#f87171',
    info: '#38bdf8',
  },
};

describe('Cálculo de contraste', () => {
  it('los extremos dan los valores conocidos', () => {
    expect(contraste('#000000', '#ffffff')).toBe(21);
    expect(contraste('#ffffff', '#ffffff')).toBe(1);
  });

  it('da igual el orden de los colores', () => {
    expect(contraste('#64748b', '#ffffff')).toBe(contraste('#ffffff', '#64748b'));
  });

  it('rechaza un color mal escrito en vez de devolver un número inventado', () => {
    // Un `NaN` silencioso aquí haría que la comprobación pasara siempre.
    expect(() => contraste('azul', '#ffffff')).toThrow();
    expect(() => contraste('#fff', '#ffffff')).toThrow();
  });

  it('detecta el gris que parecía elegante', () => {
    // #94a3b8 sobre blanco: el que había antes en la paleta.
    expect(contraste('#94a3b8', '#ffffff')).toBeLessThan(AA_TEXTO_NORMAL);
  });
});

describe('Paleta del tema claro', () => {
  for (const [nombreTexto, texto] of Object.entries(CLARO.textos)) {
    for (const [nombreFondo, fondo] of Object.entries(CLARO.fondos)) {
      it(`${nombreTexto} sobre ${nombreFondo} cumple AA`, () => {
        expect(contraste(texto, fondo)).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
      });
    }
  }
});

describe('Paleta del tema oscuro', () => {
  for (const [nombreTexto, texto] of Object.entries(OSCURO.textos)) {
    for (const [nombreFondo, fondo] of Object.entries(OSCURO.fondos)) {
      it(`${nombreTexto} sobre ${nombreFondo} cumple AA`, () => {
        expect(contraste(texto, fondo)).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
      });
    }
  }
});

describe('Color de marca inyectado en el CSS', () => {
  it('acepta hexadecimal de tres y seis dígitos', () => {
    expect(colorSeguro('#4f46e5', '#000000')).toBe('#4f46e5');
    expect(colorSeguro('#FFF', '#000000')).toBe('#FFF');
    expect(colorSeguro('  #abc123  ', '#000000')).toBe('#abc123');
  });

  it('descarta lo que podría cerrar la etiqueta de estilo', () => {
    // El caso que importa: con permiso para editar la marca, esto ejecutaría
    // JavaScript en la tienda de todos los visitantes.
    expect(colorSeguro('red}</style><script>alert(1)</script>', '#4f46e5')).toBe('#4f46e5');
    expect(colorSeguro('#fff;background:url(https://evil)', '#4f46e5')).toBe('#4f46e5');
  });

  it('descarta también lo que es CSS válido pero no un hexadecimal', () => {
    // No es por purismo: cuanto más estrecho el filtro, menos formas de colar
    // algo. Un nombre de color no aporta nada que no dé el selector del panel.
    expect(colorSeguro('rgb(1,2,3)', '#4f46e5')).toBe('#4f46e5');
    expect(colorSeguro('var(--otra)', '#4f46e5')).toBe('#4f46e5');
    expect(colorSeguro(null, '#4f46e5')).toBe('#4f46e5');
  });

  it('no revienta el layout con un color imposible', () => {
    // Se llama al pintar TODAS las páginas: aquí una excepción es un 500 en
    // toda la tienda por un ajuste mal escrito.
    expect(textoSobre('no-es-un-color')).toBe('#ffffff');
  });
});

describe('Color de marca configurable', () => {
  it('el botón principal por defecto es legible', () => {
    expect(cumpleAA('#ffffff', '#4f46e5')).toBe(true);
  });

  it('elige texto oscuro cuando la marca es un color claro', () => {
    // Una tienda con marca amarilla: con texto blanco el botón no se lee.
    expect(textoSobre('#facc15')).toBe('#0f172a');
    expect(textoSobre('#4f46e5')).toBe('#ffffff');
  });
});
