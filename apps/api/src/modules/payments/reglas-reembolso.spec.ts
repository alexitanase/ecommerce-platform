import { describe, expect, it } from 'vitest';
import {
  cantidadADevolver,
  explicarRechazo,
  importeReembolsable,
  motivoNoReembolsable,
  pareceDireccionValida,
  puedeTransicionar,
  type EstadoReembolso,
  type SolicitudValidable,
} from './reglas-reembolso.js';

/**
 * Un reembolso en cripto es irreversible. Aquí no se prueban casos de borde por
 * completitud: cada uno de ellos es dinero que sale de la cuenta y no vuelve.
 */

const solicitud = (parcial: Partial<SolicitudValidable> = {}): SolicitudValidable => ({
  importeCents: 5000,
  cobradoCents: 10000,
  pagoCobrado: true,
  reembolsosPrevios: [],
  requiereDireccion: true,
  direccion: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
  moneda: 'USDTTRC20',
  ...parcial,
});

describe('Máquina de estados', () => {
  it('sigue el camino normal', () => {
    expect(puedeTransicionar('REQUESTED', 'APPROVED')).toBe(true);
    expect(puedeTransicionar('APPROVED', 'PROCESSING')).toBe(true);
    expect(puedeTransicionar('PROCESSING', 'COMPLETED')).toBe(true);
  });

  it('no deja saltarse la aprobación', () => {
    // Ejecutar sin aprobar sería enviar fondos sin que nadie los haya mirado.
    expect(puedeTransicionar('REQUESTED', 'PROCESSING')).toBe(false);
    expect(puedeTransicionar('REQUESTED', 'COMPLETED')).toBe(false);
  });

  it('un reembolso completado ya no se mueve', () => {
    // El dinero salió de la cuenta: no hay operación que lo traiga de vuelta.
    for (const destino of ['APPROVED', 'PROCESSING', 'REJECTED', 'FAILED'] as EstadoReembolso[]) {
      expect(puedeTransicionar('COMPLETED', destino)).toBe(false);
    }
  });

  it('uno fallido puede reintentarse', () => {
    // Pasa cuando la pasarela se queda sin saldo: el reembolso sigue siendo
    // debido y hay que poder relanzarlo sin crear otro.
    expect(puedeTransicionar('FAILED', 'APPROVED')).toBe(true);
  });

  it('uno rechazado no revive', () => {
    expect(puedeTransicionar('REJECTED', 'APPROVED')).toBe(false);
  });
});

describe('Importe disponible', () => {
  it('descuenta lo ya devuelto', () => {
    expect(importeReembolsable(10000, [{ amountCents: 3000, status: 'COMPLETED' }])).toBe(7000);
  });

  it('cuenta también los que están esperando aprobación', () => {
    // Si solo contaran los completados, pedir dos veces el mismo reembolso
    // mientras el primero espera pasaría las dos y se devolvería el doble.
    expect(importeReembolsable(10000, [{ amountCents: 10000, status: 'REQUESTED' }])).toBe(0);
    expect(importeReembolsable(10000, [{ amountCents: 4000, status: 'PROCESSING' }])).toBe(6000);
  });

  it('no cuenta los rechazados ni los fallidos', () => {
    // Un reembolso que no llegó a salir no ha consumido nada.
    expect(
      importeReembolsable(10000, [
        { amountCents: 5000, status: 'REJECTED' },
        { amountCents: 5000, status: 'FAILED' },
      ]),
    ).toBe(10000);
  });

  it('nunca es negativo', () => {
    expect(importeReembolsable(1000, [{ amountCents: 5000, status: 'COMPLETED' }])).toBe(0);
  });
});

describe('Direcciones', () => {
  it('acepta una dirección TRON correcta', () => {
    expect(pareceDireccionValida('TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', 'USDTTRC20')).toBe(true);
  });

  it('acepta una dirección Ethereum correcta', () => {
    expect(pareceDireccionValida('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'USDTERC20')).toBe(
      true,
    );
  });

  it('rechaza la dirección de otra red', () => {
    // El error más caro y el más fácil de cometer: pegar la dirección de
    // Ethereum en un envío por TRON. Los fondos se pierden.
    expect(pareceDireccionValida('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'USDTTRC20')).toBe(
      false,
    );
    expect(pareceDireccionValida('TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', 'USDTERC20')).toBe(false);
  });

  it('rechaza espacios pegados al copiar', () => {
    expect(pareceDireccionValida(' TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', 'USDTTRC20')).toBe(false);
    expect(pareceDireccionValida('TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE ', 'USDTTRC20')).toBe(false);
  });

  it('rechaza texto que no es una dirección', () => {
    expect(pareceDireccionValida('mi cartera de bitcoin', 'BTC')).toBe(false);
    expect(pareceDireccionValida('', 'BTC')).toBe(false);
    expect(pareceDireccionValida('0x123', 'ETH')).toBe(false);
  });

  it('acepta bitcoin en sus dos formatos', () => {
    expect(pareceDireccionValida('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'BTC')).toBe(true);
    expect(pareceDireccionValida('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'BTC')).toBe(true);
  });

  it('deja pasar una red desconocida con forma razonable', () => {
    // No se puede conocer cada red; la pasarela tiene la validación buena.
    expect(pareceDireccionValida('addr1q9xy8kf7rf6kmjnvlwtu2n0y7xcvz3qwe', 'ADA')).toBe(true);
  });
});

describe('Puede pedirse el reembolso', () => {
  it('acepta una solicitud correcta', () => {
    expect(motivoNoReembolsable(solicitud())).toBeNull();
  });

  it('rechaza si el cobro nunca se completó', () => {
    expect(motivoNoReembolsable(solicitud({ pagoCobrado: false }))).toBe('PAGO_NO_COBRADO');
  });

  it('rechaza más de lo cobrado', () => {
    expect(motivoNoReembolsable(solicitud({ importeCents: 20000 }))).toBe('SUPERA_LO_COBRADO');
  });

  it('rechaza importe cero o negativo', () => {
    expect(motivoNoReembolsable(solicitud({ importeCents: 0 }))).toBe('IMPORTE_CERO');
    expect(motivoNoReembolsable(solicitud({ importeCents: -100 }))).toBe('IMPORTE_CERO');
  });

  it('exige dirección cuando la pasarela no devuelve al origen', () => {
    expect(motivoNoReembolsable(solicitud({ direccion: undefined }))).toBe('FALTA_DIRECCION');
  });

  it('no pide dirección a una pasarela que devuelve sola', () => {
    // Una tarjeta reembolsa al medio de pago original: pedir destino sería
    // inventarse un paso que no existe.
    expect(
      motivoNoReembolsable(
        solicitud({ requiereDireccion: false, direccion: undefined, moneda: undefined }),
      ),
    ).toBeNull();
  });

  it('rechaza una dirección de otra red', () => {
    expect(
      motivoNoReembolsable(solicitud({ direccion: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' })),
    ).toBe('DIRECCION_INVALIDA');
  });

  it('avisa de que ya está todo comprometido', () => {
    expect(
      motivoNoReembolsable(
        solicitud({ reembolsosPrevios: [{ amountCents: 10000, status: 'REQUESTED' }] }),
      ),
    ).toBe('YA_EN_CURSO');
  });

  it('explica cuánto queda cuando el importe se pasa', () => {
    // Con coma decimal: lo lee una persona en castellano.
    expect(explicarRechazo('SUPERA_LO_COBRADO', 7000)).toContain('70,00 €');
  });
});

describe('Conversión a la moneda de envío', () => {
  it('convierte al cambio indicado', () => {
    // 50 € a 1,08 USDT por euro.
    expect(cantidadADevolver(5000, 1.08)).toBe('54.00000000');
  });

  it('devuelve texto para no perder decimales', () => {
    // Un `number` pierde precisión en las cantidades largas de cripto, y el
    // error solo se ve cuando el envío llega con menos de lo debido.
    const cantidad = cantidadADevolver(10000, 0.000023456789);
    expect(typeof cantidad).toBe('string');
    expect(cantidad).toBe('0.00234568');
  });

  it('redondea hacia arriba, nunca a la baja', () => {
    // Devolver un céntimo de menos es lo que genera la reclamación; de más,
    // no se queja nadie.
    expect(Number(cantidadADevolver(100, 0.000000015))).toBeGreaterThanOrEqual(0.000000015);
  });

  it('no acepta un cambio imposible', () => {
    // Un cambio a cero enviaría un importe de cero y el reembolso constaría
    // como hecho sin que el cliente reciba nada.
    expect(() => cantidadADevolver(5000, 0)).toThrow();
    expect(() => cantidadADevolver(5000, -1)).toThrow();
    expect(() => cantidadADevolver(5000, Number.NaN)).toThrow();
  });
});
