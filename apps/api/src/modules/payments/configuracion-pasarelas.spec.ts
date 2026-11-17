import { describe, expect, it } from 'vitest';
import {
  aplicables,
  dejaLaTiendaSinCobrar,
  motivoNoDisponible,
  normalizar,
  ordenar,
  validar,
  type ConfigPasarela,
} from './configuracion-pasarelas.js';

/**
 * Cada rama de aquí decide qué formas de pago ve el cliente. Ninguna falla con
 * una excepción: fallan enseñando menos opciones de las que la tienda cree, y
 * eso solo se nota en las ventas que no llegan.
 */

const config = (parcial: Partial<ConfigPasarela> = {}): ConfigPasarela => ({
  key: 'nowpayments',
  activa: true,
  orden: 0,
  minCents: 0,
  maxCents: null,
  ...parcial,
});

const TODO_OK = {
  implementada: () => true,
  tieneCredenciales: () => true,
};

describe('Lectura del ajuste guardado', () => {
  it('devuelve todas las pasarelas aunque no haya nada guardado', () => {
    // El panel tiene que poder mostrar y activar las que aún no se usan.
    const configs = normalizar(null);
    expect(configs.map((c) => c.key)).toEqual([
      'nowpayments',
      'revolut',
      'stripe',
      'payiad',
      'paypal',
    ]);
  });

  it('deja activada solo NOWPayments por defecto', () => {
    const configs = normalizar(undefined);
    expect(configs.filter((c) => c.activa).map((c) => c.key)).toEqual(['nowpayments']);
  });

  it('conserva el orden del formato antiguo de lista de claves', () => {
    // Es lo que hay escrito en las tiendas que ya funcionan: si se ignorara,
    // al desplegar cambiaría el orden del checkout sin que nadie lo tocara.
    const configs = ordenar(normalizar(['stripe', 'nowpayments']));

    expect(configs.map((c) => c.key).slice(0, 2)).toEqual(['stripe', 'nowpayments']);
    expect(configs.find((c) => c.key === 'paypal')?.activa).toBe(false);
  });

  it('lee el formato nuevo con límites', () => {
    const configs = normalizar([
      { key: 'nowpayments', activa: true, orden: 1, minCents: 2000, maxCents: 500000 },
    ]);
    const now = configs.find((c) => c.key === 'nowpayments');

    expect(now).toMatchObject({ activa: true, orden: 1, minCents: 2000, maxCents: 500000 });
  });

  it('distingue un tope de 0 de la ausencia de tope', () => {
    // `null` es "sin tope" y `0` es un tope real de 0 €. Confundirlos deja una
    // pasarela ofreciéndose siempre o no ofreciéndose nunca.
    const sinTope = normalizar([{ key: 'stripe', maxCents: null }]);
    const topeCero = normalizar([{ key: 'stripe', maxCents: 0 }]);

    expect(sinTope.find((c) => c.key === 'stripe')?.maxCents).toBeNull();
    expect(topeCero.find((c) => c.key === 'stripe')?.maxCents).toBe(0);
  });

  it('ignora basura sin quedarse sin configuración', () => {
    // Un ajuste corrupto no puede tumbar el checkout entero.
    expect(normalizar('vaya').map((c) => c.key)).toHaveLength(5);
    expect(normalizar([{ sinClave: true }, 42]).map((c) => c.key)).toHaveLength(5);
    expect(
      normalizar([{ key: 'nowpayments', minCents: -50 }]).find((c) => c.key === 'nowpayments')
        ?.minCents,
    ).toBe(0);
  });

  it('no deja activa una pasarela que aún no existe', () => {
    // El formato antiguo listaba las cuatro. Sin este ajuste el panel las
    // muestra marcadas, junto a una casilla bloqueada que no se puede
    // desmarcar: parece una decisión de la tienda y no lo es.
    // PayPal es la que queda sin escribir; Stripe pasó a estar implementada y
    // por eso ya no sirve de ejemplo aquí.
    const configs = normalizar(['nowpayments', 'paypal']);
    expect(configs.filter((c) => c.activa).map((c) => c.key)).toEqual(['nowpayments']);

    const explicito = normalizar([{ key: 'paypal', activa: true }]);
    expect(explicito.find((c) => c.key === 'paypal')?.activa).toBe(false);
  });

  it('descarta una clave que ya no existe', () => {
    const configs = normalizar([{ key: 'bitpay', activa: true }]);
    expect(configs.map((c) => c.key)).not.toContain('bitpay');
  });
});

describe('Orden en el checkout', () => {
  it('ordena por el campo orden', () => {
    const configs = [
      config({ key: 'stripe', orden: 2 }),
      config({ key: 'nowpayments', orden: 0 }),
      config({ key: 'paypal', orden: 1 }),
    ];
    expect(ordenar(configs).map((c) => c.key)).toEqual(['nowpayments', 'paypal', 'stripe']);
  });

  it('es estable cuando dos comparten posición', () => {
    // Sin desempate, el checkout cambiaría de orden entre visitas sin motivo.
    const configs = [config({ key: 'stripe', orden: 1 }), config({ key: 'paypal', orden: 1 })];
    expect(ordenar(configs).map((c) => c.key)).toEqual(['paypal', 'stripe']);
  });
});

describe('Motivo por el que no se ofrece', () => {
  it('desactivada manualmente', () => {
    expect(
      motivoNoDisponible(config({ activa: false }), {
        implementada: true,
        tieneCredenciales: true,
      }),
    ).toBe('DESACTIVADA');
  });

  it('sin credenciales en el entorno', () => {
    expect(motivoNoDisponible(config(), { implementada: true, tieneCredenciales: false })).toBe(
      'SIN_CREDENCIALES',
    );
  });

  it('todavía sin implementar', () => {
    expect(motivoNoDisponible(config(), { implementada: false, tieneCredenciales: true })).toBe(
      'NO_IMPLEMENTADA',
    );
  });

  it('el pedido no llega al mínimo', () => {
    expect(
      motivoNoDisponible(config({ minCents: 2000 }), {
        ...{ implementada: true, tieneCredenciales: true },
        totalCents: 1999,
      }),
    ).toBe('IMPORTE_BAJO');
  });

  it('el mínimo se cumple justo en el límite', () => {
    expect(
      motivoNoDisponible(config({ minCents: 2000 }), {
        implementada: true,
        tieneCredenciales: true,
        totalCents: 2000,
      }),
    ).toBeNull();
  });

  it('el pedido supera el tope', () => {
    expect(
      motivoNoDisponible(config({ maxCents: 50000 }), {
        implementada: true,
        tieneCredenciales: true,
        totalCents: 50001,
      }),
    ).toBe('IMPORTE_ALTO');
  });

  it('sin importe no se filtra por importe', () => {
    // El panel pregunta sin pedido delante: ahí los límites no aplican.
    expect(
      motivoNoDisponible(config({ minCents: 9999 }), {
        implementada: true,
        tieneCredenciales: true,
      }),
    ).toBeNull();
  });
});

describe('Pasarelas ofrecibles', () => {
  it('filtra por importe y respeta el orden', () => {
    const configs = [
      config({ key: 'stripe', orden: 1 }),
      config({ key: 'nowpayments', orden: 0, minCents: 2000 }),
    ];

    expect(aplicables(configs, { ...TODO_OK, totalCents: 1000 }).map((c) => c.key)).toEqual([
      'stripe',
    ]);
    expect(aplicables(configs, { ...TODO_OK, totalCents: 5000 }).map((c) => c.key)).toEqual([
      'nowpayments',
      'stripe',
    ]);
  });

  it('excluye las que no tienen credenciales aunque estén activas', () => {
    const configs = [config({ key: 'nowpayments' }), config({ key: 'stripe' })];
    const soloNow = aplicables(configs, {
      implementada: () => true,
      tieneCredenciales: (k) => k === 'nowpayments',
    });

    expect(soloNow.map((c) => c.key)).toEqual(['nowpayments']);
  });
});

describe('Validación antes de guardar', () => {
  it('acepta una configuración correcta', () => {
    expect(validar([config()], TODO_OK)).toEqual([]);
  });

  it('avisa si no quedaría ninguna forma de pago', () => {
    // Es el fallo caro: guardar no da error, la tienda sigue en pie y el
    // problema aparece con el cliente ya en el checkout.
    const problemas = validar([config({ activa: false })], TODO_OK);
    expect(problemas.join(' ')).toContain('Ninguna forma de pago');
  });

  it('avisa si el máximo es menor que el mínimo', () => {
    const problemas = validar([config({ minCents: 5000, maxCents: 1000 })], TODO_OK);
    expect(problemas.join(' ')).toContain('nunca se ofrecería');
  });

  it('avisa de una pasarela activada sin credenciales', () => {
    const problemas = validar([config()], {
      implementada: () => true,
      tieneCredenciales: () => false,
    });
    expect(problemas.join(' ')).toContain('credenciales');
  });

  it('impide activar una pasarela sin implementar', () => {
    const problemas = validar([config({ key: 'paypal' })], {
      implementada: () => false,
      tieneCredenciales: () => true,
    });
    expect(problemas.join(' ')).toContain('no está implementada');
  });
});

describe('Cuándo frenar el guardado', () => {
  it('frena si se apaga la última pasarela que sí cobraba', () => {
    // Esto sí lo provoca el panel y sí lo puede deshacer: merece un freno.
    expect(dejaLaTiendaSinCobrar([config({ activa: false })], TODO_OK)).toBe(true);
  });

  it('no frena cuando faltan credenciales en el servidor', () => {
    // Ninguna configuración salvaría la situación: bloquear aquí dejaría la
    // pantalla inservible durante la puesta en marcha, que es justo cuando
    // todavía no hay credenciales puestas.
    const sinCredenciales = { implementada: () => true, tieneCredenciales: () => false };
    expect(dejaLaTiendaSinCobrar([config()], sinCredenciales)).toBe(false);
    expect(dejaLaTiendaSinCobrar([config({ activa: false })], sinCredenciales)).toBe(false);
  });

  it('no frena si queda alguna operativa', () => {
    expect(
      dejaLaTiendaSinCobrar([config(), config({ key: 'stripe', activa: false })], TODO_OK),
    ).toBe(false);
  });
});
