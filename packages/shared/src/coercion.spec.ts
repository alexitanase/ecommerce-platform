import { describe, expect, it } from 'vitest';
import {
  fecha,
  listaDeObjetos,
  listaDeTextos,
  numero,
  numeroOpcional,
  objeto,
  texto,
  textoOpcional,
} from './coercion.js';

/**
 * La frontera con lo que no controlamos.
 *
 * Por aquí entran las respuestas de los proveedores, los cuerpos de los
 * webhooks, los campos JSON de la base de datos y los ajustes que se editan
 * desde el panel. En todos esos sitios el tipo de un campo cambia sin avisar, y
 * el daño de `String(objeto)` no es un error: es un producto titulado
 * "[object Object]" publicado en la tienda, o ese texto impreso en una factura.
 *
 * Por eso lo que más se prueba aquí no es la conversión correcta —esa es
 * obvia— sino qué pasa con lo que NO se debe convertir.
 */

describe('texto', () => {
  it('convierte los primitivos que tienen una representación evidente', () => {
    expect(texto('hola')).toBe('hola');
    expect(texto(42)).toBe('42');
    expect(texto(true)).toBe('true');
    expect(texto(9007199254740993n)).toBe('9007199254740993');
  });

  it('NO convierte objetos ni arrays', () => {
    // El caso que motiva todo el módulo.
    expect(texto({ a: 1 })).toBe('');
    expect(texto([1, 2])).toBe('');
    expect(texto({ a: 1 }, 'sin título')).toBe('sin título');
  });

  it('nulo, indefinido y NaN dan el valor por defecto', () => {
    expect(texto(null, 'x')).toBe('x');
    expect(texto(undefined, 'x')).toBe('x');
    expect(texto(NaN, 'x')).toBe('x');
    expect(texto(Infinity, 'x')).toBe('x');
  });

  it('la cadena vacía es un valor válido, no una ausencia', () => {
    // Una descripción vacía es una decisión de quien edita el producto; no se
    // sustituye por el valor por defecto.
    expect(texto('', 'defecto')).toBe('');
  });

  it('textoOpcional sí trata la cadena vacía como ausencia', () => {
    expect(textoOpcional('')).toBeUndefined();
    expect(textoOpcional({ a: 1 })).toBeUndefined();
    expect(textoOpcional('algo')).toBe('algo');
  });
});

describe('numero', () => {
  it('acepta números y cadenas numéricas', () => {
    // Las cadenas son lo habitual: casi todas las pasarelas mandan los
    // importes entrecomillados en el JSON.
    expect(numero(12.99)).toBe(12.99);
    expect(numero('12.99')).toBe(12.99);
    expect(numero('  45.20  ')).toBe(45.2);
    expect(numero(0)).toBe(0);
  });

  it('NO convierte objetos ni texto que no sea un número', () => {
    // `Number({})` es NaN y `Number([])` es 0: sin este filtro, un objeto
    // donde se esperaba un importe se guardaría como cero euros cobrados.
    expect(numero({ amount: '12.99' }, -1)).toBe(-1);
    expect(numero([], -1)).toBe(-1);
    expect(numero('doce euros', -1)).toBe(-1);
    expect(numero(NaN, -1)).toBe(-1);
  });

  it('una cadena vacía es una ausencia, no un cero', () => {
    // Un campo que llega vacío significa "no me lo han mandado". Devolver 0
    // haría que un ajuste sin rellenar en el panel machacara el valor por
    // defecto con un cero, y esa es la diferencia entre "sin tope" y
    // "tope de cero euros".
    expect(numero('', 7)).toBe(7);
    expect(numero('   ', 7)).toBe(7);
  });

  it('numeroOpcional distingue el cero de la ausencia', () => {
    // Importante: un precio de 0 es un dato, y `?? valor` lo confundiría con
    // no haberlo recibido si esto devolviera 0 en ambos casos.
    expect(numeroOpcional(0)).toBe(0);
    expect(numeroOpcional('')).toBeUndefined();
    expect(numeroOpcional(null)).toBeUndefined();
    expect(numeroOpcional({})).toBeUndefined();
  });
});

describe('fecha', () => {
  it('acepta lo que mandan los proveedores', () => {
    expect(fecha('2026-01-15T10:23:00Z')?.toISOString()).toBe('2026-01-15T10:23:00.000Z');
    expect(fecha(new Date('2026-01-15'))?.getFullYear()).toBe(2026);
  });

  it('entiende una marca de tiempo Unix', () => {
    // Varias APIs las mandan en milisegundos. Pasarlas por `new Date(texto)`
    // da "Invalid Date", y el adaptador que lo consume acaba poniendo la
    // fecha de hoy: el cliente vería su envío fechado con la hora en que
    // alguien consultó el seguimiento.
    expect(fecha(1_700_000_000_000)?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('devuelve undefined cuando no hay fecha que interpretar', () => {
    expect(fecha('mañana por la tarde')).toBeUndefined();
    expect(fecha(new Date('no es una fecha'))).toBeUndefined();
    expect(fecha(null)).toBeUndefined();
    expect(fecha({})).toBeUndefined();
    expect(fecha('')).toBeUndefined();
  });
});

describe('listaDeTextos', () => {
  it('acepta tanto un array como una cadena separada por comas', () => {
    // Los dos formatos llegan de verdad: el array desde la API, la cadena
    // desde los campos de texto del panel.
    expect(listaDeTextos(['a', 'b'])).toEqual(['a', 'b']);
    expect(listaDeTextos('a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  it('descarta los huecos en vez de dejar cadenas vacías', () => {
    expect(listaDeTextos('a,,b,')).toEqual(['a', 'b']);
    expect(listaDeTextos(['a', null, {}, 'b'])).toEqual(['a', 'b']);
  });

  it('admite otro separador', () => {
    expect(listaDeTextos('a|b', '|')).toEqual(['a', 'b']);
  });

  it('lo que no es lista ni texto da una lista vacía', () => {
    expect(listaDeTextos(null)).toEqual([]);
    expect(listaDeTextos({})).toEqual([]);
    expect(listaDeTextos('')).toEqual([]);
  });
});

describe('objeto y listaDeObjetos', () => {
  it('un objeto plano pasa tal cual', () => {
    expect(objeto({ a: 1 })).toEqual({ a: 1 });
  });

  it('nulo y array NO son objetos planos', () => {
    // `typeof null === 'object'` es la trampa clásica de JavaScript: sin
    // comprobarlo, leer una propiedad de la respuesta reventaría.
    expect(objeto(null)).toEqual({});
    expect(objeto([1, 2])).toEqual({});
    expect(objeto('texto')).toEqual({});
  });

  it('listaDeObjetos limpia los elementos que no lo son', () => {
    expect(listaDeObjetos([{ a: 1 }, null, 'x'])).toEqual([{ a: 1 }, {}, {}]);
    expect(listaDeObjetos({ a: 1 })).toEqual([]);
  });
});
