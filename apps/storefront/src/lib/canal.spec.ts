import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturarCanal, leerCanal } from './canal.js';

/**
 * Atribución de canal.
 *
 * Con la publicidad convencional cerrada para catálogo adulto, este dato
 * decide a qué canal se le dedican los meses siguientes. Y falla en silencio:
 * un marcaje que no se conserva hasta el checkout no da ningún error, solo
 * hace que todas las ventas parezcan directas y que ningún canal parezca
 * funcionar.
 */

const almacen = new Map<string, string>();

beforeEach(() => {
  almacen.clear();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => almacen.get(k) ?? null,
      setItem: (k: string, v: string) => almacen.set(k, v),
      removeItem: (k: string) => almacen.delete(k),
    },
  });
});

describe('Capturar el marcaje', () => {
  it('guarda fuente, medio y campaña', () => {
    capturarCanal('?utm_source=reddit&utm_medium=post&utm_campaign=lanzamiento');

    expect(leerCanal()).toEqual({ fuente: 'reddit', medio: 'post', campana: 'lanzamiento' });
  });

  it('normaliza mayúsculas y espacios', () => {
    // Sin esto, 'Newsletter' y 'newsletter' serían dos canales en el informe y
    // ninguno tendría datos para decidir nada.
    capturarCanal('?utm_source=Newsletter&utm_campaign=Junio+2026');

    expect(leerCanal()).toEqual({ fuente: 'newsletter', campana: 'junio-2026' });
  });

  it('guarda la creatividad que trajo el clic', () => {
    // Es lo que separa «ExoClick trajo doce ventas» de saber cuál de los nueve
    // banners las trajo. Lo pone el Studio en cada pieza que exporta.
    capturarCanal('?utm_source=exoclick&utm_campaign=rebajas&utm_content=vertical-rojo-a1b2c3');

    expect(leerCanal()?.contenido).toBe('vertical-rojo-a1b2c3');
  });

  it('sin fuente no guarda nada', () => {
    capturarCanal('?utm_medium=email');

    expect(leerCanal()).toBeNull();
  });

  it('descarta lo que no puede ser una clave', () => {
    capturarCanal('?utm_source=%3C%3E');

    expect(leerCanal()).toBeNull();
  });
});

describe('Quién se lleva la venta', () => {
  it('el último clic pisa al anterior', () => {
    // Si alguien llega por la newsletter, se va, y vuelve por Reddit, la venta
    // es de Reddit: es lo último que lo trajo de vuelta.
    capturarCanal('?utm_source=newsletter');
    capturarCanal('?utm_source=reddit');

    expect(leerCanal()?.fuente).toBe('reddit');
  });

  it('volver sin marcaje no borra el canal anterior', () => {
    // Es lo que hace todo el mundo: se llega por un enlace y se vuelve
    // tecleando la dirección o desde el historial. Sin esto, casi todas las
    // ventas acabarían contando como directas.
    capturarCanal('?utm_source=newsletter');
    capturarCanal('');
    capturarCanal('?pagina=2');

    expect(leerCanal()?.fuente).toBe('newsletter');
  });

  it('el medio de la campaña vieja no se arrastra a la nueva', () => {
    // Sería peor que no tener el dato: 'reddit / email' es una combinación que
    // nunca existió, y en el informe parecería una campaña real.
    capturarCanal('?utm_source=newsletter&utm_medium=email');
    capturarCanal('?utm_source=reddit');

    expect(leerCanal()).toEqual({ fuente: 'reddit' });
  });
});

describe('Caducidad', () => {
  it('a los 30 días deja de valer', () => {
    // Decir que una venta viene de una campaña de hace dos meses es contarse
    // un cuento.
    almacen.set(
      'canal',
      JSON.stringify({ fuente: 'reddit', guardadoEl: Date.now() - 31 * 86_400_000 }),
    );

    expect(leerCanal()).toBeNull();
  });

  it('a los 29 sigue valiendo', () => {
    almacen.set(
      'canal',
      JSON.stringify({ fuente: 'reddit', guardadoEl: Date.now() - 29 * 86_400_000 }),
    );

    expect(leerCanal()?.fuente).toBe('reddit');
  });
});

describe('Cuando algo va mal', () => {
  it('un valor corrupto se trata como si no hubiera', () => {
    almacen.set('canal', 'esto no es json');

    expect(leerCanal()).toBeNull();
  });

  it('el almacenamiento bloqueado no impide comprar', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('bloqueado');
        },
        setItem: () => {
          throw new Error('bloqueado');
        },
        removeItem: () => {
          throw new Error('bloqueado');
        },
      },
    });

    expect(() => {
      capturarCanal('?utm_source=reddit');
    }).not.toThrow();
    expect(leerCanal()).toBeNull();
  });
});
