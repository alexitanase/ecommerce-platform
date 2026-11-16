import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NowPaymentsProvider } from './nowpayments.provider.js';

/**
 * La verificación de firma es la defensa que impide que cualquiera nos envíe
 * un "pago confirmado" falso y se lleve la mercancía sin pagar. Si estos tests
 * fallan, la tienda regala productos.
 */

const SECRETO = 'secreto-ipn-de-prueba';

const proveedor = () => new NowPaymentsProvider({ apiKey: 'clave-test', ipnSecret: SECRETO }, true);

/** Firma como lo hace NOWPayments: HMAC-SHA512 sobre el JSON ordenado. */
function firmar(datos: Record<string, unknown>, secreto = SECRETO): string {
  const ordenado = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(ordenado).join(',')}]`;
    return `{${Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, val]) => `${JSON.stringify(k)}:${ordenado(val)}`)
      .join(',')}}`;
  };
  return crypto.createHmac('sha512', secreto).update(ordenado(datos)).digest('hex');
}

const callbackValido = {
  payment_id: '5745459419',
  payment_status: 'finished',
  pay_address: 'TXyz123',
  price_amount: 41.99,
  price_currency: 'eur',
  pay_amount: 45.2,
  actually_paid: 45.2,
  pay_currency: 'usdttrc20',
  order_id: 'ES-2026-000002',
  payin_hash: '0xabc123',
};

describe('NOWPayments · verificación de webhooks', () => {
  it('acepta un callback con firma correcta', () => {
    const cuerpo = JSON.stringify(callbackValido);
    const evento = proveedor().verificarWebhook(cuerpo, {
      'x-nowpayments-sig': firmar(callbackValido),
    });

    expect(evento).not.toBeNull();
    expect(evento?.externalId).toBe('5745459419');
    expect(evento?.estado).toBe('PAGADO');
    expect(evento?.txHash).toBe('0xabc123');
  });

  it('RECHAZA una firma inválida', () => {
    const cuerpo = JSON.stringify(callbackValido);
    const evento = proveedor().verificarWebhook(cuerpo, {
      'x-nowpayments-sig': 'a'.repeat(128),
    });

    expect(evento).toBeNull();
  });

  it('RECHAZA un callback firmado con otro secreto', () => {
    // Alguien que conoce el formato pero no nuestro secreto IPN.
    const cuerpo = JSON.stringify(callbackValido);
    const evento = proveedor().verificarWebhook(cuerpo, {
      'x-nowpayments-sig': firmar(callbackValido, 'secreto-del-atacante'),
    });

    expect(evento).toBeNull();
  });

  it('RECHAZA si alguien altera el importe tras firmar', () => {
    // El ataque evidente: interceptar un callback real de 5 € y cambiarlo a
    // 500 € o marcarlo como pagado. La firma deja de cuadrar.
    const firmaOriginal = firmar(callbackValido);
    const manipulado = { ...callbackValido, price_amount: 9999 };

    const evento = proveedor().verificarWebhook(JSON.stringify(manipulado), {
      'x-nowpayments-sig': firmaOriginal,
    });

    expect(evento).toBeNull();
  });

  it('RECHAZA si falta la cabecera de firma', () => {
    expect(proveedor().verificarWebhook(JSON.stringify(callbackValido), {})).toBeNull();
  });

  it('RECHAZA un cuerpo que no es JSON', () => {
    expect(
      proveedor().verificarWebhook('esto no es json', { 'x-nowpayments-sig': 'x'.repeat(128) }),
    ).toBeNull();
  });

  it('devuelve null si no hay secreto IPN configurado', () => {
    // Sin secreto no se puede verificar nada: es preferible rechazar todo a
    // aceptar a ciegas.
    const sinSecreto = new NowPaymentsProvider({ apiKey: 'x' }, true);
    expect(
      sinSecreto.verificarWebhook(JSON.stringify(callbackValido), {
        'x-nowpayments-sig': firmar(callbackValido),
      }),
    ).toBeNull();
  });

  it('la firma no depende del orden de las claves en el JSON recibido', () => {
    // NOWPayments firma con las claves ordenadas; el JSON que llega puede
    // venir en cualquier orden y debe validar igual.
    const desordenado = {
      payin_hash: callbackValido.payin_hash,
      price_amount: callbackValido.price_amount,
      payment_id: callbackValido.payment_id,
      actually_paid: callbackValido.actually_paid,
      pay_amount: callbackValido.pay_amount,
      payment_status: callbackValido.payment_status,
      pay_address: callbackValido.pay_address,
      price_currency: callbackValido.price_currency,
      pay_currency: callbackValido.pay_currency,
      order_id: callbackValido.order_id,
    };

    const evento = proveedor().verificarWebhook(JSON.stringify(desordenado), {
      'x-nowpayments-sig': firmar(callbackValido),
    });

    expect(evento).not.toBeNull();
  });
});

describe('NOWPayments · traducción de estados', () => {
  const estadoDe = (estado: string) => {
    const datos = { ...callbackValido, payment_status: estado };
    return proveedor().verificarWebhook(JSON.stringify(datos), {
      'x-nowpayments-sig': firmar(datos),
    })?.estado;
  };

  it('"confirming" NO es pagado', () => {
    // La transacción está en la cadena pero puede revertirse: tratarla como
    // pagada significaría enviar mercancía por un cobro que aún no es firme.
    expect(estadoDe('confirming')).toBe('ESPERANDO_CONFIRMACION');
    expect(estadoDe('confirmed')).toBe('ESPERANDO_CONFIRMACION');
    expect(estadoDe('sending')).toBe('ESPERANDO_CONFIRMACION');
  });

  it('solo "finished" cuenta como pagado', () => {
    expect(estadoDe('finished')).toBe('PAGADO');
  });

  it('reconoce el pago parcial', () => {
    expect(estadoDe('partially_paid')).toBe('PAGADO_PARCIAL');
  });

  it('reconoce caducado y fallido', () => {
    expect(estadoDe('expired')).toBe('CADUCADO');
    expect(estadoDe('failed')).toBe('FALLIDO');
  });

  it('un estado desconocido no se interpreta como pagado', () => {
    // Si NOWPayments añade un estado nuevo, lo peor que puede pasar es que lo
    // demos por bueno y enviemos sin cobrar.
    expect(estadoDe('estado_que_no_existe')).toBe('DESCONOCIDO');
  });
});

describe('NOWPayments · tolerancia a pagos parciales', () => {
  it('acepta una diferencia mínima por comisión de red', () => {
    // 41,99 € esperados; llegan 41,80 € porque la red se llevó la comisión.
    // Rechazarlo costaría más en soporte que los 19 céntimos.
    expect(NowPaymentsProvider.cubreElPedido(4180, 4199)).toBe(true);
  });

  it('rechaza cuando falta un importe significativo', () => {
    expect(NowPaymentsProvider.cubreElPedido(3000, 4199)).toBe(false);
  });

  it('acepta el importe exacto y el sobrepago', () => {
    expect(NowPaymentsProvider.cubreElPedido(4199, 4199)).toBe(true);
    expect(NowPaymentsProvider.cubreElPedido(4500, 4199)).toBe(true);
  });

  it('la tolerancia es configurable', () => {
    expect(NowPaymentsProvider.cubreElPedido(4000, 4199, 5)).toBe(true);
    expect(NowPaymentsProvider.cubreElPedido(4000, 4199, 1)).toBe(false);
  });

  it('no acepta nada si el importe esperado es cero', () => {
    expect(NowPaymentsProvider.cubreElPedido(0, 0)).toBe(false);
  });
});

describe('NOWPayments · capacidades declaradas', () => {
  it('avisa de que no hay reembolso automático', () => {
    // El checkout consulta esto para pedir la dirección de devolución.
    const c = proveedor().capacidades;
    expect(c.reembolsoAutomatico).toBe(false);
    expect(c.requiereDireccionReembolso).toBe(true);
  });

  it('avisa de que el cobro caduca', () => {
    expect(proveedor().capacidades.cobroCaduca).toBe(true);
  });

  it('no admite disputas: es la ventaja frente a la tarjeta', () => {
    expect(proveedor().capacidades.admiteDisputas).toBe(false);
  });
});

describe('NOWPayments · reembolsos', () => {
  /** Sustituye `fetch` para observar qué se le pide a la pasarela. */
  function espiar(respuestas: Record<string, unknown>) {
    const llamadas: { url: string; cuerpo: unknown }[] = [];
    const original = globalThis.fetch;

    globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
      // `Request` no se convierte a texto solo: sin esto la ruta quedaría como
      // "[object Object]" y las aserciones sobre la URL pasarían por vacío.
      const ruta = url instanceof Request ? url.url : url.toString();
      const cuerpo = typeof init?.body === 'string' ? init.body : null;

      llamadas.push({ url: ruta, cuerpo: cuerpo === null ? undefined : JSON.parse(cuerpo) });
      const clave = Object.keys(respuestas).find((k) => ruta.includes(k)) ?? '';
      return Promise.resolve(
        new Response(JSON.stringify(respuestas[clave] ?? {}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    return {
      llamadas,
      restaurar: () => {
        globalThis.fetch = original;
      },
    };
  }

  it('convierte el importe a la moneda de destino antes de enviarlo', async () => {
    // El fallo que esto fija: mandar los euros tal cual como cantidad. Con
    // USDT cuela de casualidad (50 € ≈ 50 USDT); con bitcoin, un reembolso de
    // 50 € pediría enviar 50 BTC.
    const espia = espiar({
      '/estimate': { estimated_amount: '0.00082341' },
      '/payout': { withdrawals: [{ id: 'p-1', status: 'CREATING' }] },
    });

    try {
      const r = await proveedor().reembolsar({
        externalPaymentId: '5745459419',
        amountCents: 5000,
        currency: 'EUR',
        reason: 'Desistimiento',
        idempotencyKey: 'k-1',
        payoutAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        payoutCurrency: 'btc',
      });

      const payout = espia.llamadas.find((l) => l.url.includes('/payout'));
      const enviado = (payout?.cuerpo as { withdrawals: { amount: number }[] }).withdrawals[0];

      expect(enviado?.amount).toBe(0.00082341);
      expect(enviado?.amount).not.toBe(50);
      expect(r.cantidadEnviada).toBe('0.00082341');
      expect(r.monedaEnviada).toBe('btc');
    } finally {
      espia.restaurar();
    }
  });

  it('no envía nada si no puede calcular la equivalencia', async () => {
    // Enviar a ciegas con una cantidad desconocida es dinero perdido sin
    // forma de recuperarlo.
    const espia = espiar({
      '/estimate': { estimated_amount: '0' },
      '/payout': { withdrawals: [{ id: 'p-2' }] },
    });

    try {
      await expect(
        proveedor().reembolsar({
          externalPaymentId: '1',
          amountCents: 5000,
          currency: 'EUR',
          reason: 'Devolución',
          idempotencyKey: 'k-2',
          payoutAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
          payoutCurrency: 'btc',
        }),
      ).rejects.toThrow(/equivale/);

      expect(espia.llamadas.some((l) => l.url.includes('/payout'))).toBe(false);
    } finally {
      espia.restaurar();
    }
  });

  it('exige dirección de destino', async () => {
    await expect(
      proveedor().reembolsar({
        externalPaymentId: '1',
        amountCents: 5000,
        currency: 'EUR',
        reason: 'Devolución',
        idempotencyKey: 'k-3',
      }),
    ).rejects.toThrow(/dirección de destino/);
  });
});
