import { describe, expect, it } from 'vitest';
import {
  baseAplicable,
  evaluarCupon,
  mensajeRechazo,
  type Cupon,
  type LineaCarrito,
} from './calculo-cupon.js';

/**
 * Cada rama de aquí es dinero que sale de la caja. Un error no da excepción:
 * da pedidos cobrados de menos que solo se ven al cuadrar el mes.
 */

const AHORA = new Date('2026-07-26T12:00:00Z');

function cupon(p: Partial<Cupon> = {}): Cupon {
  return {
    code: 'VERANO',
    type: 'PERCENTAGE',
    value: 10,
    maxDiscountCents: null,
    minOrderCents: 0,
    maxUses: null,
    maxUsesPerCustomer: 1,
    usedCount: 0,
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validUntil: null,
    categoryIds: [],
    excludedProductIds: [],
    isActive: true,
    ...p,
  };
}

const linea = (
  productId: string,
  totalCents: number,
  categoryId: string | null = 'cat1',
): LineaCarrito => ({
  productId,
  categoryId,
  totalCents,
});

const CARRITO = [linea('p1', 5000), linea('p2', 3000, 'cat2')];

describe('Descuento por porcentaje', () => {
  it('aplica el porcentaje sobre el carrito', () => {
    const r = evaluarCupon(cupon({ value: 10 }), CARRITO, 8000, 0, AHORA);
    expect(r.aplicable).toBe(true);
    expect(r.descuentoCents).toBe(800);
  });

  it('respeta el tope de descuento', () => {
    // Sin tope, un 50% sobre un pedido grande regala cientos de euros que la
    // promoción no pretendía.
    const r = evaluarCupon(
      cupon({ value: 50, maxDiscountCents: 1000 }),
      [linea('p1', 20_000)],
      20_000,
      0,
      AHORA,
    );
    expect(r.descuentoCents).toBe(1000);
  });

  it('redondea al céntimo', () => {
    const r = evaluarCupon(cupon({ value: 15 }), [linea('p1', 3333)], 3333, 0, AHORA);
    expect(r.descuentoCents).toBe(500);
    expect(Number.isInteger(r.descuentoCents)).toBe(true);
  });
});

describe('Descuento de importe fijo', () => {
  it('descuenta el importe', () => {
    const r = evaluarCupon(cupon({ type: 'FIXED', value: 1500 }), CARRITO, 8000, 0, AHORA);
    expect(r.descuentoCents).toBe(1500);
  });

  it('nunca descuenta más de lo que cubre', () => {
    // Un cupón de 20 € sobre 15 € de producto descuenta 15 €: no deja el
    // pedido en negativo ni convierte la promoción en una devolución.
    const r = evaluarCupon(
      cupon({ type: 'FIXED', value: 2000 }),
      [linea('p1', 1500)],
      1500,
      0,
      AHORA,
    );
    expect(r.descuentoCents).toBe(1500);
  });
});

describe('Envío gratis', () => {
  it('no toca el precio de los productos', () => {
    const r = evaluarCupon(cupon({ type: 'FREE_SHIPPING' }), CARRITO, 8000, 0, AHORA);
    expect(r.envioGratis).toBe(true);
    expect(r.descuentoCents).toBe(0);
  });
});

describe('Restricción por categoría', () => {
  it('solo descuenta sobre las líneas incluidas', () => {
    // Aplicarlo al pedido entero sería regalar descuento en productos que la
    // promoción nunca incluyó.
    const r = evaluarCupon(cupon({ value: 10, categoryIds: ['cat1'] }), CARRITO, 8000, 0, AHORA);
    expect(r.baseAplicableCents).toBe(5000);
    expect(r.descuentoCents).toBe(500);
  });

  it('excluye productos concretos aunque su categoría entre', () => {
    const r = evaluarCupon(
      cupon({ value: 10, categoryIds: ['cat1'], excludedProductIds: ['p1'] }),
      CARRITO,
      8000,
      0,
      AHORA,
    );
    expect(r.aplicable).toBe(false);
    expect(r.motivo).toBe('SIN_PRODUCTOS_APLICABLES');
  });

  it('sin restricción cubre todo el carrito', () => {
    expect(baseAplicable(cupon(), CARRITO)).toBe(8000);
  });

  it('avisa si no aplica a nada, en vez de descontar 0 en silencio', () => {
    const r = evaluarCupon(cupon({ categoryIds: ['inexistente'] }), CARRITO, 8000, 0, AHORA);
    expect(r.motivo).toBe('SIN_PRODUCTOS_APLICABLES');
  });
});

describe('Compra mínima', () => {
  it('rechaza por debajo del mínimo', () => {
    const r = evaluarCupon(cupon({ minOrderCents: 5000 }), [linea('p1', 3000)], 3000, 0, AHORA);
    expect(r.motivo).toBe('MINIMO_NO_ALCANZADO');
  });

  it('el mínimo mira el carrito entero, no solo lo que cubre el cupón', () => {
    // Quien pide 80 € y tiene 30 € en la categoría del cupón sí alcanza un
    // mínimo de 50 €: el mínimo es de compra, no de descuento.
    const r = evaluarCupon(
      cupon({ minOrderCents: 5000, categoryIds: ['cat2'] }),
      CARRITO,
      8000,
      0,
      AHORA,
    );
    expect(r.aplicable).toBe(true);
    expect(r.baseAplicableCents).toBe(3000);
  });
});

describe('Límites de uso', () => {
  it('rechaza un cupón agotado', () => {
    // Sin tope, un cupón que acaba en un foro de descuentos se usa miles de
    // veces en una noche.
    const r = evaluarCupon(cupon({ maxUses: 100, usedCount: 100 }), CARRITO, 8000, 0, AHORA);
    expect(r.motivo).toBe('AGOTADO');
  });

  it('admite el uso número 100 de 100', () => {
    const r = evaluarCupon(cupon({ maxUses: 100, usedCount: 99 }), CARRITO, 8000, 0, AHORA);
    expect(r.aplicable).toBe(true);
  });

  it('rechaza al cliente que ya lo usó', () => {
    const r = evaluarCupon(cupon({ maxUsesPerCustomer: 1 }), CARRITO, 8000, 1, AHORA);
    expect(r.motivo).toBe('LIMITE_CLIENTE');
  });

  it('sin tope global se puede usar indefinidamente', () => {
    const r = evaluarCupon(cupon({ maxUses: null, usedCount: 99_999 }), CARRITO, 8000, 0, AHORA);
    expect(r.aplicable).toBe(true);
  });
});

describe('Fechas', () => {
  it('rechaza uno que aún no ha empezado', () => {
    const r = evaluarCupon(
      cupon({ validFrom: new Date('2026-12-01T00:00:00Z') }),
      CARRITO,
      8000,
      0,
      AHORA,
    );
    expect(r.motivo).toBe('AUN_NO_VALIDO');
  });

  it('rechaza uno caducado', () => {
    const r = evaluarCupon(
      cupon({ validUntil: new Date('2026-07-01T00:00:00Z') }),
      CARRITO,
      8000,
      0,
      AHORA,
    );
    expect(r.motivo).toBe('CADUCADO');
  });

  it('sin fecha de fin no caduca', () => {
    expect(evaluarCupon(cupon({ validUntil: null }), CARRITO, 8000, 0, AHORA).aplicable).toBe(true);
  });
});

describe('Cupón inexistente o apagado', () => {
  it('un código que no existe', () => {
    expect(evaluarCupon(null, CARRITO, 8000, 0, AHORA).motivo).toBe('NO_EXISTE');
  });

  it('uno desactivado', () => {
    expect(evaluarCupon(cupon({ isActive: false }), CARRITO, 8000, 0, AHORA).motivo).toBe(
      'INACTIVO',
    );
  });
});

describe('Mensajes al cliente', () => {
  it('el del mínimo dice cuánto falta alcanzar', () => {
    // "No válido" a secas hace que el cliente lo intente otra vez o se vaya.
    const mensaje = mensajeRechazo('MINIMO_NO_ALCANZADO', cupon({ minOrderCents: 5000 }));
    expect(mensaje).toContain('50.00');
  });

  it('todos los motivos tienen mensaje', () => {
    const motivos = [
      'NO_EXISTE',
      'INACTIVO',
      'AUN_NO_VALIDO',
      'CADUCADO',
      'AGOTADO',
      'LIMITE_CLIENTE',
      'MINIMO_NO_ALCANZADO',
      'SIN_PRODUCTOS_APLICABLES',
    ] as const;

    for (const m of motivos) {
      expect(mensajeRechazo(m).length, m).toBeGreaterThan(10);
    }
  });
});
