import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StripeProvider, TOLERANCIA_FIRMA_STRIPE_MS } from './stripe.provider.js';

/**
 * Igual que con las otras pasarelas: si la verificación de firma falla, la
 * tienda regala productos a quien sepa escribir un `curl`.
 *
 * Y hay dos cosas propias de Stripe que se prueban aquí porque solo se ven
 * cuando ya han pasado: que el cuerpo de la petición va como formulario y no
 * como JSON —mandarle JSON es un 400 sin explicación—, y que una sesión
 * «completada» no siempre está pagada. Lo segundo es lo que trae Bizum: cierra
 * la sesión y confirma minutos después, así que darla por cobrada es enviar la
 * mercancía contra un pago que aún puede fallar.
 */

const SECRETO = 'whsec_secreto-de-prueba';

const proveedor = () => new StripeProvider({ secretKey: 'sk_test_clave', webhookSecret: SECRETO });

/** Firma como lo hace Stripe: HMAC-SHA256 sobre `{t}.{cuerpo}`. */
function firmar(cuerpo: string, secreto = SECRETO, segundos = Math.floor(Date.now() / 1000)) {
  return { 'stripe-signature': StripeProvider.firmar(cuerpo, secreto, segundos) };
}

/** Un aviso de Stripe con la forma real: envoltorio `event` y objeto dentro. */
function aviso(tipo: string, sesion: Record<string, unknown>): string {
  return JSON.stringify({
    id: 'evt_1PruebaEvento',
    object: 'event',
    type: tipo,
    data: { object: { id: 'cs_test_a1b2c3', object: 'checkout.session', ...sesion } },
  });
}

/** Sustituye `fetch` para observar qué se le pide a la pasarela. */
function espiar(respuestas: Record<string, unknown>, status = 200) {
  const llamadas: { url: string; metodo: string; cuerpo: string; cabeceras: Headers }[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    const ruta = url instanceof Request ? url.url : url.toString();

    llamadas.push({
      url: ruta,
      metodo: init?.method ?? 'GET',
      cuerpo: typeof init?.body === 'string' ? init.body : '',
      cabeceras: new Headers(init?.headers),
    });

    // La clave más específica que encaje: `/v1/refunds` no debe resolverse con
    // lo registrado para `/v1`.
    const clave =
      Object.keys(respuestas)
        .filter((k) => ruta.includes(k))
        .sort((a, b) => b.length - a.length)[0] ?? '';

    return Promise.resolve(
      new Response(JSON.stringify(respuestas[clave] ?? {}), {
        status,
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

afterEach(() => {
  vi.useRealTimers();
});

describe('firma del webhook', () => {
  it('acepta un aviso firmado con el secreto bueno', () => {
    const cuerpo = aviso('checkout.session.completed', {
      payment_status: 'paid',
      amount_total: 3990,
    });

    const evento = proveedor().verificarWebhook(cuerpo, firmar(cuerpo));

    expect(evento?.externalId).toBe('cs_test_a1b2c3');
    expect(evento?.estado).toBe('PAGADO');
    // El identificador del evento es lo que deduplica los reenvíos: Stripe
    // reintenta durante tres días hasta recibir un 2xx.
    expect(evento?.eventId).toBe('evt_1PruebaEvento');
  });

  it('rechaza una firma calculada con otro secreto', () => {
    const cuerpo = aviso('checkout.session.completed', { payment_status: 'paid' });

    expect(proveedor().verificarWebhook(cuerpo, firmar(cuerpo, 'whsec_otro'))).toBeNull();
  });

  it('rechaza el cuerpo alterado después de firmarlo', () => {
    // El caso que importa: alguien intercepta un aviso legítimo y le cambia el
    // importe. La firma es sobre el cuerpo crudo, así que deja de cuadrar.
    const cuerpo = aviso('checkout.session.completed', {
      payment_status: 'paid',
      amount_total: 100,
    });
    const cabeceras = firmar(cuerpo);

    const manipulado = cuerpo.replace('"amount_total":100', '"amount_total":999900');

    expect(proveedor().verificarWebhook(manipulado, cabeceras)).toBeNull();
  });

  it('rechaza un aviso viejo aunque su firma sea válida', () => {
    /*
     * Reenvío: una notificación legítima capturada del tráfico. Sin comprobar
     * el timestamp valdría para siempre y bastaría con reenviarla para volver a
     * dar por pagado el mismo pedido.
     */
    const cuerpo = aviso('checkout.session.completed', { payment_status: 'paid' });
    const viejo = Math.floor((Date.now() - TOLERANCIA_FIRMA_STRIPE_MS - 1000) / 1000);

    expect(proveedor().verificarWebhook(cuerpo, firmar(cuerpo, SECRETO, viejo))).toBeNull();
  });

  it('rechaza un aviso del futuro', () => {
    const cuerpo = aviso('checkout.session.completed', { payment_status: 'paid' });
    const futuro = Math.floor((Date.now() + TOLERANCIA_FIRMA_STRIPE_MS + 1000) / 1000);

    expect(proveedor().verificarWebhook(cuerpo, firmar(cuerpo, SECRETO, futuro))).toBeNull();
  });

  it('acepta cuando llegan varias firmas y una cuadra', () => {
    // Pasa mientras se rota el secreto: conviven el viejo y el nuevo.
    const cuerpo = aviso('checkout.session.completed', { payment_status: 'paid' });
    const segundos = Math.floor(Date.now() / 1000);
    const buena = StripeProvider.firmar(cuerpo, SECRETO, segundos).split(',')[1] ?? '';
    const mala = crypto.createHmac('sha256', 'whsec_viejo').update(`${segundos}.x`).digest('hex');

    const evento = proveedor().verificarWebhook(cuerpo, {
      'stripe-signature': `t=${segundos},v1=${mala},${buena}`,
    });

    expect(evento?.estado).toBe('PAGADO');
  });

  it('sin secreto configurado no acepta nada', () => {
    // Una integración a medias no puede quedar aceptando avisos sin verificar.
    const sinSecreto = new StripeProvider({ secretKey: 'sk_test_clave' });
    const cuerpo = aviso('checkout.session.completed', { payment_status: 'paid' });

    expect(sinSecreto.verificarWebhook(cuerpo, firmar(cuerpo))).toBeNull();
  });

  it('ignora los eventos que no son de la sesión de checkout', () => {
    /*
     * Lo que se guarda como identificador del cobro es la sesión (`cs_…`), así
     * que un `payment_intent.succeeded` llega con un `pi_…` que no casa con
     * ningún cobro nuestro. Ignorarlo aquí evita procesar ruido.
     */
    const cuerpo = JSON.stringify({
      id: 'evt_otro',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_123', object: 'payment_intent' } },
    });

    expect(proveedor().verificarWebhook(cuerpo, firmar(cuerpo))).toBeNull();
  });
});

describe('estados', () => {
  it('una sesión completada pero sin pagar NO es un cobro', () => {
    /*
     * El caso de Bizum y de las transferencias: la sesión se cierra y el dinero
     * llega después. Tratarlo como pagado es enviar la mercancía contra un pago
     * que todavía puede fallar.
     */
    const cuerpo = aviso('checkout.session.completed', {
      status: 'complete',
      payment_status: 'unpaid',
      amount_total: 3990,
    });

    const evento = proveedor().verificarWebhook(cuerpo, firmar(cuerpo));

    expect(evento?.estado).toBe('ESPERANDO_CONFIRMACION');
    // Y sin importe: no se ha cobrado nada que anotar.
    expect(evento?.receivedCents).toBeUndefined();
  });

  it('el pago diferido que se confirma después sí lo es', () => {
    const cuerpo = aviso('checkout.session.async_payment_succeeded', {
      status: 'complete',
      payment_status: 'paid',
      amount_total: 3990,
    });

    const evento = proveedor().verificarWebhook(cuerpo, firmar(cuerpo));

    expect(evento?.estado).toBe('PAGADO');
    // El importe se toma del aviso, que viene firmado con nuestro secreto: se
    // ahorra una consulta por cada cobro.
    expect(evento?.receivedCents).toBe(3990);
  });

  it('el pago diferido que falla se marca como fallido', () => {
    const cuerpo = aviso('checkout.session.async_payment_failed', { payment_status: 'unpaid' });

    expect(proveedor().verificarWebhook(cuerpo, firmar(cuerpo))?.estado).toBe('FALLIDO');
  });

  it('la sesión caducada libera el pedido', () => {
    const cuerpo = aviso('checkout.session.expired', {
      status: 'expired',
      payment_status: 'unpaid',
    });

    expect(proveedor().verificarWebhook(cuerpo, firmar(cuerpo))?.estado).toBe('CADUCADO');
  });
});

describe('creación del cobro', () => {
  it('manda el importe en céntimos y como formulario, no como JSON', async () => {
    const espia = espiar({
      '/v1/checkout/sessions': {
        id: 'cs_test_nuevo',
        url: 'https://checkout.stripe.com/c/pay/cs_test_nuevo',
        status: 'open',
        payment_status: 'unpaid',
      },
    });

    try {
      const respuesta = await proveedor().crearCobro({
        orderId: 'ord_1',
        orderNumber: 'ES-2026-000010',
        amountCents: 3990,
        currency: 'EUR',
        customerEmail: 'cliente@ejemplo.es',
        description: 'Pedido ES-2026-000010',
        successUrl: 'https://tienda.es/pedido/abc',
        cancelUrl: 'https://tienda.es/pedido/abc?cancelado=1',
        callbackUrl: 'https://api.tienda.es/api/v1/payments/webhook/stripe',
        idempotencyKey: 'pay:ord_1:stripe:auto',
        locale: 'es',
      });

      expect(respuesta.externalId).toBe('cs_test_nuevo');
      expect(respuesta.checkoutUrl).toContain('checkout.stripe.com');

      const llamada = espia.llamadas[0];
      expect(llamada?.cabeceras.get('content-type')).toBe('application/x-www-form-urlencoded');
      // La idempotencia nativa: un reintento por timeout devuelve la MISMA
      // sesión en vez de dejar al cliente con dos cobros abiertos.
      expect(llamada?.cabeceras.get('idempotency-key')).toBe('pay:ord_1:stripe:auto');

      const enviado = new URLSearchParams(llamada?.cuerpo ?? '');
      // En céntimos y sin decimales de por medio, que es de donde salen los
      // descuadres de un céntimo al conciliar.
      expect(enviado.get('line_items[0][price_data][unit_amount]')).toBe('3990');
      expect(enviado.get('line_items[0][price_data][currency]')).toBe('eur');
      expect(enviado.get('mode')).toBe('payment');
      expect(enviado.get('client_reference_id')).toBe('ES-2026-000010');
      expect(enviado.get('metadata[orderId]')).toBe('ord_1');
      expect(enviado.get('customer_email')).toBe('cliente@ejemplo.es');
      expect(enviado.get('locale')).toBe('es');

      // Los métodos de pago NO se fijan aquí: se activan en el dashboard y
      // Stripe decide cuáles enseñar. Declararlos rompería el día que se
      // active Bizum.
      expect(llamada?.cuerpo).not.toContain('payment_method_types');
    } finally {
      espia.restaurar();
    }
  });

  it('falla si Stripe no devuelve URL de pago', async () => {
    // Mejor fallar aquí que dejar al cliente mirando una pantalla sin botón.
    const espia = espiar({ '/v1/checkout/sessions': { id: 'cs_test_sin_url' } });

    try {
      await expect(
        proveedor().crearCobro({
          orderId: 'ord_2',
          orderNumber: 'ES-2026-000011',
          amountCents: 1000,
          currency: 'EUR',
          customerEmail: 'c@ejemplo.es',
          description: 'Pedido',
          successUrl: 'https://tienda.es/ok',
          cancelUrl: 'https://tienda.es/no',
          callbackUrl: 'https://api.tienda.es/webhook',
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/URL de pago/);
    } finally {
      espia.restaurar();
    }
  });

  it('traduce el rechazo de credenciales sin filtrar detalles al cliente', async () => {
    const espia = espiar(
      { '/v1/checkout/sessions': { error: { type: 'invalid_request_error', message: 'no' } } },
      401,
    );

    try {
      await expect(proveedor().verificar()).resolves.toMatchObject({ ok: false });
    } finally {
      espia.restaurar();
    }
  });
});

describe('consulta del cobro', () => {
  it('lee lo cobrado y la comisión de la cadena expandida', async () => {
    /*
     * La comisión solo vive en el apunte contable, dos saltos más abajo que la
     * sesión. Es lo que convierte «hemos cobrado 39,90 €» en lo que de verdad
     * entra en caja, que es el número contra el que se mide el margen.
     */
    const espia = espiar({
      '/v1/checkout/sessions/cs_test_a1b2c3': {
        id: 'cs_test_a1b2c3',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 3990,
        currency: 'eur',
        payment_intent: {
          id: 'pi_test_1',
          amount_received: 3990,
          latest_charge: {
            id: 'ch_1',
            created: 1_780_000_000,
            payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } },
            balance_transaction: { fee: 83, currency: 'eur' },
          },
        },
      },
    });

    try {
      const estado = await proveedor().consultarCobro('cs_test_a1b2c3');

      expect(estado?.estado).toBe('PAGADO');
      expect(estado?.receivedCents).toBe(3990);
      expect(estado?.feeCents).toBe(83);
      expect(estado?.metadata?.['ultimosDigitos']).toBe('4242');
      expect(estado?.paidAt).toBeInstanceOf(Date);

      // Se pide la cadena entera en UNA llamada en vez de tres.
      expect(espia.llamadas[0]?.url).toContain(
        'expand[]=payment_intent.latest_charge.balance_transaction',
      );
    } finally {
      espia.restaurar();
    }
  });

  it('devuelve null cuando la sesión no existe', async () => {
    const espia = espiar({ '/v1/checkout/sessions': { error: { code: 'resource_missing' } } }, 404);

    try {
      await expect(proveedor().consultarCobro('cs_test_fantasma')).resolves.toBeNull();
    } finally {
      espia.restaurar();
    }
  });
});

describe('reembolso', () => {
  it('resuelve el PaymentIntent de la sesión antes de devolver', async () => {
    // Nosotros guardamos la sesión; Stripe devuelve contra el intento.
    const espia = espiar({
      '/v1/checkout/sessions/cs_test_a1b2c3': {
        id: 'cs_test_a1b2c3',
        payment_intent: 'pi_test_1',
      },
      '/v1/refunds': { id: 're_1', status: 'succeeded', amount: 1500, currency: 'eur' },
    });

    try {
      const resultado = await proveedor().reembolsar({
        externalPaymentId: 'cs_test_a1b2c3',
        amountCents: 1500,
        currency: 'EUR',
        reason: 'Producto defectuoso',
        idempotencyKey: 'refund:1',
      });

      expect(resultado.estado).toBe('COMPLETADO');
      expect(resultado.cantidadEnviada).toBe('15.00');

      const devolucion = espia.llamadas.find((l) => l.url.includes('/v1/refunds'));
      const enviado = new URLSearchParams(devolucion?.cuerpo ?? '');
      expect(enviado.get('payment_intent')).toBe('pi_test_1');
      expect(enviado.get('amount')).toBe('1500');
      // El motivo nuestro va en metadatos: Stripe solo admite tres suyos y
      // perderlo dejaría la devolución sin explicación en su panel.
      expect(enviado.get('metadata[motivo]')).toBe('Producto defectuoso');
    } finally {
      espia.restaurar();
    }
  });

  it('un reembolso pendiente no se da por completado', async () => {
    // Darlo por cerrado dejaría al cliente sin su dinero y a nosotros
    // creyendo que ya está.
    const espia = espiar({
      '/v1/refunds': { id: 're_2', status: 'pending' },
    });

    try {
      const resultado = await proveedor().reembolsar({
        externalPaymentId: 'pi_test_directo',
        amountCents: 500,
        currency: 'EUR',
        reason: 'Devolución',
        idempotencyKey: 'refund:2',
      });

      expect(resultado.estado).toBe('PROCESANDO');
      // Con un `pi_…` no hace falta resolver nada: una sola llamada.
      expect(espia.llamadas).toHaveLength(1);
    } finally {
      espia.restaurar();
    }
  });

  it('no deja pedir un reembolso de cero', async () => {
    await expect(
      proveedor().reembolsar({
        externalPaymentId: 'pi_1',
        amountCents: 0,
        currency: 'EUR',
        reason: 'x',
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/mayor que 0/);
  });
});

describe('modo de la clave', () => {
  it('distingue pruebas de producción por el prefijo de la clave', async () => {
    const espia = espiar({ '/v1/checkout/sessions': { data: [] } });

    try {
      const pruebas = await new StripeProvider({ secretKey: 'sk_test_x' }).verificar();
      const produccion = await new StripeProvider({ secretKey: 'sk_live_x' }).verificar();

      expect(pruebas.mensaje).toContain('pruebas');
      expect(produccion.mensaje).toContain('producción');
    } finally {
      espia.restaurar();
    }
  });
});
