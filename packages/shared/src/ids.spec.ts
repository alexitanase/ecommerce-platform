import { describe, expect, it } from 'vitest';
import {
  ID_PREFIX,
  formatOrderNumber,
  idempotencyKey,
  isValidId,
  newId,
  prefixedId,
} from './ids.js';

/**
 * Identificadores y claves de idempotencia.
 *
 * La clave de idempotencia es lo que impide comprar dos veces al proveedor
 * cuando un reintento llega después de que la primera llamada ya funcionara.
 * Si dejara de ser estable —o si dos operaciones distintas produjeran la
 * misma— el fallo se paga en mercancía.
 */

describe('Identificadores internos', () => {
  it('son válidos y distintos entre sí', () => {
    const generados = new Set(Array.from({ length: 500 }, () => newId()));

    expect(generados.size).toBe(500);
    for (const id of generados) expect(isValidId(id)).toBe(true);
  });

  it('no revelan cuántos llevamos', () => {
    // El motivo de no usar enteros autoincrementales: con ellos, un
    // competidor cuenta nuestras ventas mirando el ID de su propio pedido.
    const primero = newId();
    const segundo = newId();

    expect(Number.isNaN(Number(primero))).toBe(true);
    expect(segundo).not.toBe(primero);
  });

  it('los prefijados llevan su tipo delante', () => {
    for (const [tipo, prefijo] of Object.entries(ID_PREFIX)) {
      const id = prefixedId(tipo as keyof typeof ID_PREFIX);
      expect(id.startsWith(`${prefijo}_`), tipo).toBe(true);
    }
  });
});

describe('Número de pedido visible', () => {
  it('lleva el año y seis cifras', () => {
    expect(formatOrderNumber(1, 2026)).toBe('ES-2026-000001');
    expect(formatOrderNumber(123, 2026)).toBe('ES-2026-000123');
  });

  it('el ancho fijo hace que el orden alfabético sea el numérico', () => {
    // De esto depende `siguienteNumero`, que busca el último pedido ordenando
    // por texto. Sin los ceros a la izquierda, "ES-2026-9" sería mayor que
    // "ES-2026-10" y el correlativo empezaría a repetirse.
    const numeros = [1, 2, 9, 10, 99, 100, 1000].map((n) => formatOrderNumber(n, 2026));
    const ordenados = [...numeros].sort();

    expect(ordenados).toEqual(numeros);
  });

  it('admite otro prefijo de serie', () => {
    expect(formatOrderNumber(7, 2026, 'FR')).toBe('FR-2026-000007');
  });

  it('un número mayor de seis cifras no se recorta', () => {
    // Preferible un número largo que dos pedidos con el mismo identificador.
    expect(formatOrderNumber(1_234_567, 2026)).toBe('ES-2026-1234567');
  });
});

describe('Clave de idempotencia', () => {
  it('la misma operación da siempre la misma clave', () => {
    expect(idempotencyKey('order', 'ES-2026-000001', 1)).toBe(
      idempotencyKey('order', 'ES-2026-000001', 1),
    );
  });

  it('operaciones distintas dan claves distintas', () => {
    expect(idempotencyKey('order', 'ES-2026-000001')).not.toBe(
      idempotencyKey('order', 'ES-2026-000002'),
    );
  });

  it('quita lo que no sea seguro en una URL o una cabecera', () => {
    // Las claves viajan a las APIs de los proveedores; un carácter raro puede
    // hacer que rechacen la petición entera.
    expect(idempotencyKey('pedido/2026', 'línea 1')).toBe('pedido2026:lnea1');
    expect(idempotencyKey('a b', 'c\nd')).toMatch(/^[a-zA-Z0-9_:-]+$/);
  });

  it('el separador impide que dos claves distintas se confundan', () => {
    // Sin él, ("ab","c") y ("a","bc") serían la misma clave y el segundo
    // pedido no llegaría a hacerse.
    expect(idempotencyKey('ab', 'c')).not.toBe(idempotencyKey('a', 'bc'));
  });
});
