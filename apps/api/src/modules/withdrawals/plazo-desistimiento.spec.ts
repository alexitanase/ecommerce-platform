import { describe, expect, it } from 'vitest';
import {
  DIAS_DESISTIMIENTO,
  diasRestantes,
  enPlazo,
  evaluarLineas,
  fechaLimite,
  fechaLimiteReembolso,
  reembolsoDeEnvio,
  type LineaDesistible,
} from './plazo-desistimiento.js';

/**
 * Cada test de aquí corresponde a un artículo de la ley.
 *
 * Fallar cualquiera no produce un error visible: produce una devolución
 * denegada que debería haberse aceptado, que es una reclamación al consumo.
 */

const dia = (iso: string) => new Date(iso);

describe('Plazo de desistimiento', () => {
  describe('desde cuándo se cuenta', () => {
    it('se cuenta desde la ENTREGA, no desde el pedido', () => {
      // El fallo más común en dropshipping: un paquete tarda tres semanas en
      // llegar de China, así que contar desde la compra dejaría al cliente con
      // cero días de derecho.
      const limite = fechaLimite(dia('2026-03-01T10:00:00Z'));
      expect(limite?.toISOString().slice(0, 10)).toBe('2026-03-15');
    });

    it('sin entrega registrada el plazo no ha empezado', () => {
      expect(fechaLimite(null)).toBeNull();
      // Y desistir sigue valiendo: se puede desistir incluso antes de recibirlo.
      expect(enPlazo(null)).toBe(true);
    });

    it('el último día cuenta entero', () => {
      // Recibir el paquete a las 18:00 da 14 días completos, no 13 y 6 horas.
      const limite = fechaLimite(dia('2026-03-01T18:00:00Z'));
      expect(limite?.getHours()).toBe(23);
      expect(limite?.getMinutes()).toBe(59);
    });
  });

  describe('días naturales, no hábiles', () => {
    it('los fines de semana y festivos cuentan', () => {
      // Contar días hábiles alargaría el plazo indebidamente y descuadraría
      // el aviso que se le da al cliente.
      const entrega = dia('2026-03-01T12:00:00Z');
      const limite = fechaLimite(entrega)!;
      const dias = Math.round((limite.getTime() - entrega.getTime()) / 86_400_000);
      expect(dias).toBe(DIAS_DESISTIMIENTO);
    });
  });

  describe('está en plazo o no', () => {
    const entrega = dia('2026-03-01T12:00:00Z');

    it('el día 13 sí', () => {
      expect(enPlazo(entrega, dia('2026-03-14T12:00:00Z'))).toBe(true);
    });

    it('el día 14 todavía sí', () => {
      expect(enPlazo(entrega, dia('2026-03-15T20:00:00Z'))).toBe(true);
    });

    it('el día 15 ya no', () => {
      expect(enPlazo(entrega, dia('2026-03-16T00:30:00Z'))).toBe(false);
    });
  });

  describe('si no se informó del derecho', () => {
    it('el plazo se alarga a un año', () => {
      // Art. 105: es la sanción por no informar. Por eso el aviso aparece en
      // la ficha, en el checkout y en el correo de confirmación.
      const entrega = dia('2026-03-01T12:00:00Z');
      expect(enPlazo(entrega, dia('2026-11-01T12:00:00Z'), false)).toBe(true);
      expect(enPlazo(entrega, dia('2026-11-01T12:00:00Z'), true)).toBe(false);
    });
  });

  describe('días que le quedan al cliente', () => {
    it('el día de la entrega quedan 14, no 15', () => {
      // El límite son las 23:59 del día 14, así que quedan casi 15 días de
      // reloj. Redondear eso al alza le diría al cliente que tiene 15 días de
      // plazo cuando la ley le da 14, y acabaría con una devolución legítima
      // denegada por fiarse de lo que le dijimos.
      const entrega = dia('2026-03-01T10:00:00Z');
      expect(diasRestantes(entrega, dia('2026-03-01T10:30:00Z'))).toBe(14);
    });

    it('los cuenta bien a mitad de plazo', () => {
      const entrega = dia('2026-03-01T12:00:00Z');
      expect(diasRestantes(entrega, dia('2026-03-10T12:00:00Z'))).toBe(5);
    });

    it('el último día quedan 0, y sigue estando en plazo', () => {
      const entrega = dia('2026-03-01T12:00:00Z');
      expect(diasRestantes(entrega, dia('2026-03-15T09:00:00Z'))).toBe(0);
      expect(enPlazo(entrega, dia('2026-03-15T09:00:00Z'))).toBe(true);
    });

    it('devuelve 0 cuando ya pasó, nunca negativo', () => {
      expect(diasRestantes(dia('2026-03-01T12:00:00Z'), dia('2026-04-01T12:00:00Z'))).toBe(0);
    });

    it('devuelve null si aún no se ha entregado', () => {
      expect(diasRestantes(null)).toBeNull();
    });
  });
});

describe('Qué se puede devolver', () => {
  const lineas: LineaDesistible[] = [
    { orderItemId: 'normal', quantity: 3, totalCents: 9000, exencion: null },
    { orderItemId: 'intimo', quantity: 1, totalCents: 4999, exencion: 'HYGIENE_UNSEALED' },
    { orderItemId: 'personalizado', quantity: 1, totalCents: 3000, exencion: 'CUSTOM_MADE' },
  ];

  it('acepta un producto normal', () => {
    const r = evaluarLineas(lineas, [{ orderItemId: 'normal', quantity: 3 }]);
    expect(r.aceptadas).toHaveLength(1);
    expect(r.reembolsoProductosCents).toBe(9000);
  });

  it('reembolsa proporcionalmente en una devolución parcial', () => {
    // Compró 3 por 90 € y devuelve 1: recupera 30 €, no los 90.
    const r = evaluarLineas(lineas, [{ orderItemId: 'normal', quantity: 1 }]);
    expect(r.reembolsoProductosCents).toBe(3000);
  });

  it('rechaza un producto precintado por higiene', () => {
    // Art. 103.e: es la excepción que aplica al catálogo +18 una vez
    // desprecintado. Sin ella habría que aceptar devoluciones de productos
    // íntimos abiertos, que no se pueden volver a vender.
    const r = evaluarLineas(lineas, [{ orderItemId: 'intimo', quantity: 1 }]);
    expect(r.aceptadas).toHaveLength(0);
    expect(r.rechazadas[0]?.motivo).toBe('EXENTO');
  });

  it('rechaza un producto personalizado', () => {
    const r = evaluarLineas(lineas, [{ orderItemId: 'personalizado', quantity: 1 }]);
    expect(r.rechazadas[0]?.motivo).toBe('EXENTO');
  });

  it('acepta unas líneas y rechaza otras en la misma solicitud', () => {
    // El caso real: un pedido con un producto normal y uno íntimo.
    const r = evaluarLineas(lineas, [
      { orderItemId: 'normal', quantity: 2 },
      { orderItemId: 'intimo', quantity: 1 },
    ]);

    expect(r.aceptadas).toHaveLength(1);
    expect(r.rechazadas).toHaveLength(1);
    expect(r.reembolsoProductosCents).toBe(6000);
  });

  it('rechaza devolver más unidades de las compradas', () => {
    const r = evaluarLineas(lineas, [{ orderItemId: 'normal', quantity: 5 }]);
    expect(r.rechazadas[0]?.motivo).toBe('CANTIDAD');
  });

  it('rechaza cantidades cero o negativas', () => {
    expect(evaluarLineas(lineas, [{ orderItemId: 'normal', quantity: 0 }]).rechazadas).toHaveLength(
      1,
    );
    expect(
      evaluarLineas(lineas, [{ orderItemId: 'normal', quantity: -1 }]).rechazadas,
    ).toHaveLength(1);
  });

  it('rechaza una línea que no está en el pedido', () => {
    const r = evaluarLineas(lineas, [{ orderItemId: 'inventada', quantity: 1 }]);
    expect(r.rechazadas[0]?.motivo).toBe('NO_EXISTE');
  });
});

describe('Reembolso del envío de ida', () => {
  it('se devuelve entero en una devolución total', () => {
    // Art. 107.2: el envío de ida SÍ se devuelve. Quedárselo es de los
    // incumplimientos más habituales.
    expect(reembolsoDeEnvio(495, 495, true)).toBe(495);
  });

  it('en una devolución parcial no se devuelve', () => {
    // El envío se consumió trayendo lo que el cliente se queda.
    expect(reembolsoDeEnvio(495, 495, false)).toBe(0);
  });

  it('si eligió envío urgente, solo se devuelve el ordinario', () => {
    // Pagó 9,95 € de urgente cuando el estándar eran 4,95 €: la diferencia la
    // eligió él y no hay que reembolsarla.
    expect(reembolsoDeEnvio(995, 495, true)).toBe(495);
  });

  it('si el envío fue gratis no se devuelve nada', () => {
    expect(reembolsoDeEnvio(0, 495, true)).toBe(0);
  });
});

describe('Plazo para devolver el dinero', () => {
  it('son 14 días desde que el cliente lo comunica', () => {
    // Y desde que lo COMUNICA, no desde que llega el paquete de vuelta.
    const limite = fechaLimiteReembolso(dia('2026-03-10T12:00:00Z'));
    expect(limite.toISOString().slice(0, 10)).toBe('2026-03-24');
  });
});
