import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorPasarela } from '../core/types.js';
import { crearPasarela } from '../core/registry.js';
import { PayiadProvider } from './payiad.provider.js';

/**
 * Payiad, contra su especificación (openapi.yaml v1.0.0).
 *
 * Lo crítico es la firma del webhook: si falla, cualquiera con un `curl` marca
 * pedidos como pagados. Lo demás es comprobar que se le habla como pide —JSON,
 * importes en céntimos, `Idempotency-Key`— y que sus estados se traducen bien,
 * sobre todo que un `failed` no se trata como definitivo.
 */

const SECRETO = 'whsec_payiad_de_prueba';

const proveedor = () => new PayiadProvider({ secretKey: 'sk_test_clave', webhookSecret: SECRETO });

const ahora = () => Math.floor(Date.now() / 1000);

function aviso(tipo: string, pago: Record<string, unknown>, id = 'evt_9sk2l'): string {
  return JSON.stringify({
    id,
    object: 'event',
    type: tipo,
    mode: 'sandbox',
    created: ahora(),
    data: {
      object: { id: 'pay_8f2k1x', object: 'payment', amount: 2500, currency: 'EUR', ...pago },
    },
  });
}

function firmado(cuerpo: string, secreto = SECRETO, segundos = ahora()) {
  return { 'payiad-signature': PayiadProvider.firmar(cuerpo, secreto, segundos) };
}

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
  vi.restoreAllMocks();
});

function espiar(cuerpo: unknown, status = 200) {
  const llamadas: { url: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: url instanceof Request ? url.url : url.toString(), init });
    return Promise.resolve(
      new Response(JSON.stringify(cuerpo), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return llamadas;
}

describe('firma del webhook', () => {
  it('acepta un aviso firmado con el formato de su documentación', () => {
    const cuerpo = aviso('payment.succeeded', { status: 'succeeded' });

    // Calculada a mano, sin pasar por `firmar`, para no probar el código contra sí mismo.
    const t = ahora();
    const v1 = crypto.createHmac('sha256', SECRETO).update(`${t}.${cuerpo}`).digest('hex');

    const evento = proveedor().verificarWebhook(cuerpo, { 'Payiad-Signature': `t=${t},v1=${v1}` });

    expect(evento).toMatchObject({
      externalId: 'pay_8f2k1x',
      estado: 'PAGADO',
      receivedCents: 2500,
      eventId: 'evt_9sk2l',
    });
  });

  it('acepta si cuadra cualquiera de las firmas (rotación del secreto)', () => {
    const cuerpo = aviso('payment.succeeded', { status: 'succeeded' });
    const t = ahora();
    const buena = crypto.createHmac('sha256', SECRETO).update(`${t}.${cuerpo}`).digest('hex');
    const vieja = crypto
      .createHmac('sha256', 'secreto-anterior')
      .update(`${t}.${cuerpo}`)
      .digest('hex');

    const evento = proveedor().verificarWebhook(cuerpo, {
      'payiad-signature': `t=${t},v1=${vieja},v1=${buena}`,
    });

    expect(evento?.estado).toBe('PAGADO');
  });

  it('rechaza otro secreto, un cuerpo alterado o la cabecera ausente', () => {
    const cuerpo = aviso('payment.succeeded', { status: 'succeeded' });

    expect(proveedor().verificarWebhook(cuerpo, firmado(cuerpo, 'otro'))).toBeNull();
    expect(proveedor().verificarWebhook(cuerpo.replace('2500', '1'), firmado(cuerpo))).toBeNull();
    expect(proveedor().verificarWebhook(cuerpo, {})).toBeNull();
  });

  it('rechaza una firma de hace más de 5 minutos (reenvío)', () => {
    const cuerpo = aviso('payment.succeeded', { status: 'succeeded' });
    expect(
      proveedor().verificarWebhook(cuerpo, firmado(cuerpo, SECRETO, ahora() - 301)),
    ).toBeNull();
    expect(
      proveedor().verificarWebhook(cuerpo, firmado(cuerpo, SECRETO, ahora() - 200)),
    ).not.toBeNull();
  });

  it('sin secreto configurado no acepta nada', () => {
    const cuerpo = aviso('payment.succeeded', { status: 'succeeded' });
    const sinSecreto = new PayiadProvider({ secretKey: 'sk_test_clave' });
    expect(sinSecreto.verificarWebhook(cuerpo, firmado(cuerpo))).toBeNull();
  });

  it('ignora los eventos de enlaces de pago', () => {
    const cuerpo = JSON.stringify({
      id: 'evt_x',
      type: 'payment_link.created',
      data: { object: { id: 'plink_3hd9a', object: 'payment_link' } },
    });
    expect(proveedor().verificarWebhook(cuerpo, firmado(cuerpo))).toBeNull();
  });
});

describe('estados', () => {
  const estadoDe = (status: string) => {
    const cuerpo = aviso('payment.created', { status });
    return proveedor().verificarWebhook(cuerpo, firmado(cuerpo))?.estado;
  };

  it('traduce cada estado de Payiad', () => {
    expect(estadoDe('requires_payment_method')).toBe('PENDIENTE');
    expect(estadoDe('requires_action')).toBe('PENDIENTE');
    expect(estadoDe('processing')).toBe('ESPERANDO_CONFIRMACION');
    expect(estadoDe('succeeded')).toBe('PAGADO');
    expect(estadoDe('failed')).toBe('FALLIDO');
    expect(estadoDe('canceled')).toBe('CADUCADO');
  });

  it('manda el estado del objeto, no el tipo del evento (llegan desordenados)', () => {
    const cuerpo = aviso('payment.failed', { status: 'succeeded' });
    expect(proveedor().verificarWebhook(cuerpo, firmado(cuerpo))?.estado).toBe('PAGADO');
  });

  it('solo da importe recibido cuando está pagado', () => {
    const cuerpo = aviso('payment.failed', { status: 'failed' });
    expect(proveedor().verificarWebhook(cuerpo, firmado(cuerpo))?.receivedCents).toBeUndefined();
  });
});

describe('crear cobro', () => {
  const solicitud = {
    orderId: 'ord_1',
    orderNumber: 'CN-1042',
    amountCents: 2500,
    currency: 'eur',
    customerEmail: 'ana@example.com',
    description: 'Pedido CN-1042',
    successUrl: 'https://tienda.test/vuelta',
    cancelUrl: 'https://tienda.test/cancelado',
    callbackUrl: 'https://api.tienda.test/webhook',
    idempotencyKey: 'pago-ord_1',
  };

  it('manda JSON con céntimos, divisa en mayúsculas, idempotencia y la URL de vuelta', async () => {
    const llamadas = espiar(
      {
        id: 'pay_1',
        status: 'requires_payment_method',
        checkout_url: 'https://payiad.com/checkout/pay_1?cs=x',
        mode: 'sandbox',
      },
      201,
    );

    const cobro = await proveedor().crearCobro(solicitud);

    expect(cobro).toMatchObject({
      externalId: 'pay_1',
      estado: 'PENDIENTE',
      checkoutUrl: 'https://payiad.com/checkout/pay_1?cs=x',
    });

    const [llamada] = llamadas;
    expect(llamada?.url).toBe('https://payiad.com/v1/payments');
    expect(llamada?.init?.method).toBe('POST');
    const cabeceras = new Headers(llamada?.init?.headers);
    expect(cabeceras.get('authorization')).toBe('Bearer sk_test_clave');
    expect(cabeceras.get('idempotency-key')).toBe('pago-ord_1');
    expect(cabeceras.get('content-type')).toBe('application/json');
    expect(JSON.parse(typeof llamada?.init?.body === 'string' ? llamada.init.body : '')).toEqual({
      amount: 2500,
      currency: 'EUR',
      description: 'Pedido CN-1042',
      customer_email: 'ana@example.com',
      metadata: { orderId: 'ord_1', orderNumber: 'CN-1042' },
      return_url: 'https://tienda.test/vuelta',
    });
  });

  it('sin checkout_url falla en lugar de dejar al cliente sin botón', async () => {
    espiar({ id: 'pay_1', status: 'requires_payment_method' }, 201);
    await expect(proveedor().crearCobro(solicitud)).rejects.toBeInstanceOf(ErrorPasarela);
  });

  it('traduce sus errores por el código', async () => {
    espiar({ error: { code: 'invalid_api_key', message: 'The API key is invalid.' } }, 401);
    await expect(proveedor().crearCobro(solicitud)).rejects.toMatchObject({ tipo: 'CREDENCIALES' });

    espiar(
      { error: { code: 'invalid_request', message: 'amount too small', field: 'amount' } },
      400,
    );
    await expect(proveedor().crearCobro(solicitud)).rejects.toMatchObject({
      tipo: 'IMPORTE_INVALIDO',
    });

    espiar({ error: { code: 'rate_limited', message: 'Slow down' } }, 429);
    await expect(proveedor().crearCobro(solicitud)).rejects.toMatchObject({
      tipo: 'RED',
      reintentable: true,
    });
  });
});

describe('consultar cobro', () => {
  it('pagado: importe recibido y fecha de pago', async () => {
    espiar({
      id: 'pay_1',
      status: 'succeeded',
      amount: 2500,
      currency: 'EUR',
      paid_at: '2026-11-17T10:00:00Z',
      card_brand: 'visa',
      card_last4: '4242',
    });

    const estado = await proveedor().consultarCobro('pay_1');

    expect(estado).toMatchObject({
      estado: 'PAGADO',
      amountCents: 2500,
      receivedCents: 2500,
      paidAt: new Date('2026-11-17T10:00:00Z'),
      metadata: { tarjeta: 'visa', ultimosDigitos: '4242' },
    });
  });

  it('un cobro que no existe es null, no un error', async () => {
    espiar({ error: { code: 'not_found', message: 'Payment not found.' } }, 404);
    expect(await proveedor().consultarCobro('pay_x')).toBeNull();
  });
});

describe('reembolsos', () => {
  it('fallan sin llamar a Payiad hasta que publiquen la API', async () => {
    const llamadas = espiar({});
    await expect(
      proveedor().reembolsar({
        externalPaymentId: 'pay_1',
        amountCents: 1000,
        currency: 'EUR',
        reason: 'devolución',
        idempotencyKey: 'r1',
      }),
    ).rejects.toBeInstanceOf(ErrorPasarela);
    expect(llamadas).toHaveLength(0);
  });

  it('no promete reembolso automático', () => {
    expect(proveedor().capacidades.reembolsoAutomatico).toBe(false);
  });
});

describe('registro', () => {
  it('se crea desde la fábrica con sus credenciales', () => {
    const pasarela = crearPasarela('payiad', { secretKey: 'sk_test_x', webhookSecret: 'y' });
    expect(pasarela).toBeInstanceOf(PayiadProvider);
    expect(pasarela.key).toBe('payiad');
  });
});
