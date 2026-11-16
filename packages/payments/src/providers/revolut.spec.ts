import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevolutProvider, TOLERANCIA_FIRMA_REVOLUT_MS } from './revolut.provider.js';

/**
 * Igual que con NOWPayments: si la verificación de firma falla, la tienda
 * regala productos a quien sepa escribir un `curl`. Con tarjeta hay además un
 * segundo riesgo propio —el reenvío de un aviso legítimo capturado— que aquí
 * se cubre con la comprobación del timestamp.
 */

const SECRETO = 'wsk_secreto-de-prueba';

const proveedor = () => new RevolutProvider({ apiKey: 'sk_test', webhookSecret: SECRETO }, true);

const avisoCompletado = {
  event: 'ORDER_COMPLETED',
  order_id: '6516e3db-a07d-a1dd-b04b-2ab0b1b2c3d4',
  merchant_order_ext_ref: 'ES-2026-000002',
};

/** Firma como lo hace Revolut: HMAC-SHA256 sobre `v1.{timestamp}.{cuerpo}`. */
function firmar(cuerpo: string, secreto = SECRETO, marca = Date.now()): Record<string, string> {
  return {
    'revolut-request-timestamp': String(marca),
    'revolut-signature': RevolutProvider.firmar(cuerpo, secreto, marca),
  };
}

/** Sustituye `fetch` para observar qué se le pide a la pasarela. */
function espiar(respuestas: Record<string, unknown>, status = 200) {
  const llamadas: { url: string; metodo: string; cuerpo: unknown; cabeceras: unknown }[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    const ruta = url instanceof Request ? url.url : url.toString();
    const cuerpo = typeof init?.body === 'string' ? init.body : null;

    llamadas.push({
      url: ruta,
      metodo: init?.method ?? 'GET',
      cuerpo: cuerpo === null ? undefined : JSON.parse(cuerpo),
      cabeceras: init?.headers ?? {},
    });

    // Se busca la clave más específica que encaje: `/orders/x/refund` no debe
    // resolverse con la respuesta registrada para `/orders`.
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

describe('Revolut · verificación de webhooks', () => {
  it('acepta un aviso con firma correcta', () => {
    const cuerpo = JSON.stringify(avisoCompletado);
    const evento = proveedor().verificarWebhook(cuerpo, firmar(cuerpo));

    expect(evento).not.toBeNull();
    expect(evento?.externalId).toBe(avisoCompletado.order_id);
    expect(evento?.estado).toBe('PAGADO');
  });

  it('el aviso NO trae importe: se deja sin rellenar a propósito', () => {
    // Revolut solo dice "el pedido X se ha completado". Inventarse aquí un
    // importe sería peor que no ponerlo: quien procesa el pago tiene que saber
    // que hace falta consultarlo.
    const cuerpo = JSON.stringify(avisoCompletado);
    const evento = proveedor().verificarWebhook(cuerpo, firmar(cuerpo));

    expect(evento?.receivedCents).toBeUndefined();
  });

  it('RECHAZA una firma inválida', () => {
    const cuerpo = JSON.stringify(avisoCompletado);
    const evento = proveedor().verificarWebhook(cuerpo, {
      'revolut-request-timestamp': String(Date.now()),
      'revolut-signature': `v1=${'a'.repeat(64)}`,
    });

    expect(evento).toBeNull();
  });

  it('RECHAZA un aviso firmado con otro secreto', () => {
    const cuerpo = JSON.stringify(avisoCompletado);
    const evento = proveedor().verificarWebhook(cuerpo, firmar(cuerpo, 'wsk_del-atacante'));

    expect(evento).toBeNull();
  });

  it('RECHAZA si alguien cambia el pedido tras firmar', () => {
    // El ataque directo: interceptar un "completado" real y apuntarlo a otro
    // pedido, el propio, para que se dé por pagado sin haber pagado.
    const original = JSON.stringify(avisoCompletado);
    const cabeceras = firmar(original);
    const manipulado = JSON.stringify({ ...avisoCompletado, order_id: 'pedido-del-atacante' });

    expect(proveedor().verificarWebhook(manipulado, cabeceras)).toBeNull();
  });

  it('la firma cubre los bytes exactos, no el JSON reserializado', () => {
    // Esta es la razón de que la API guarde el cuerpo crudo. Revolut manda su
    // JSON con un espaciado concreto; volver a serializar el objeto parseado
    // produce otra cadena y la firma deja de cuadrar. Si esto se rompe, no
    // falla un pago: fallan TODOS.
    const conEspacios = JSON.stringify(avisoCompletado, null, 2);
    const cabeceras = firmar(conEspacios);

    expect(proveedor().verificarWebhook(conEspacios, cabeceras)).not.toBeNull();
    expect(proveedor().verificarWebhook(JSON.stringify(avisoCompletado), cabeceras)).toBeNull();
  });

  it('RECHAZA un aviso reenviado horas después', () => {
    // Sin comprobar el timestamp, un "pedido completado" legítimo capturado
    // una vez vale para siempre: se reenvía y vuelve a dar por pagado.
    const cuerpo = JSON.stringify(avisoCompletado);
    const viejo = Date.now() - TOLERANCIA_FIRMA_REVOLUT_MS - 1_000;

    expect(proveedor().verificarWebhook(cuerpo, firmar(cuerpo, SECRETO, viejo))).toBeNull();
  });

  it('acepta dentro de la ventana de tolerancia', () => {
    const cuerpo = JSON.stringify(avisoCompletado);
    const reciente = Date.now() - (TOLERANCIA_FIRMA_REVOLUT_MS - 10_000);

    expect(proveedor().verificarWebhook(cuerpo, firmar(cuerpo, SECRETO, reciente))).not.toBeNull();
  });

  it('RECHAZA un timestamp del futuro', () => {
    const cuerpo = JSON.stringify(avisoCompletado);
    const futuro = Date.now() + TOLERANCIA_FIRMA_REVOLUT_MS + 60_000;

    expect(proveedor().verificarWebhook(cuerpo, firmar(cuerpo, SECRETO, futuro))).toBeNull();
  });

  it('RECHAZA un timestamp que no es un número', () => {
    const cuerpo = JSON.stringify(avisoCompletado);
    expect(
      proveedor().verificarWebhook(cuerpo, {
        'revolut-request-timestamp': 'ahora mismo',
        'revolut-signature': `v1=${'b'.repeat(64)}`,
      }),
    ).toBeNull();
  });

  it('acepta si una de varias firmas cuadra (rotación del secreto)', () => {
    // Mientras se cambia el secreto conviven el viejo y el nuevo, y Revolut
    // manda las dos firmas separadas por coma. Quedarse con la primera dejaría
    // los pagos sin confirmar justo durante la rotación.
    const cuerpo = JSON.stringify(avisoCompletado);
    const marca = Date.now();
    const buena = RevolutProvider.firmar(cuerpo, SECRETO, marca);
    const vieja = RevolutProvider.firmar(cuerpo, 'wsk_secreto-anterior', marca);

    const evento = proveedor().verificarWebhook(cuerpo, {
      'revolut-request-timestamp': String(marca),
      'revolut-signature': `${vieja}, ${buena}`,
    });

    expect(evento).not.toBeNull();
  });

  it('lee las cabeceras venga como venga su capitalización', () => {
    // Node las normaliza a minúsculas, pero el contrato recibe un mapa
    // cualquiera y Revolut las documenta capitalizadas.
    const cuerpo = JSON.stringify(avisoCompletado);
    const marca = Date.now();

    const evento = proveedor().verificarWebhook(cuerpo, {
      'Revolut-Request-Timestamp': String(marca),
      'Revolut-Signature': RevolutProvider.firmar(cuerpo, SECRETO, marca),
    });

    expect(evento).not.toBeNull();
  });

  it('RECHAZA si faltan las cabeceras', () => {
    expect(proveedor().verificarWebhook(JSON.stringify(avisoCompletado), {})).toBeNull();
  });

  it('RECHAZA un cuerpo que no es JSON', () => {
    const cuerpo = 'esto no es json';
    expect(proveedor().verificarWebhook(cuerpo, firmar(cuerpo))).toBeNull();
  });

  it('RECHAZA un aviso sin identificador de pedido', () => {
    const cuerpo = JSON.stringify({ event: 'ORDER_COMPLETED' });
    expect(proveedor().verificarWebhook(cuerpo, firmar(cuerpo))).toBeNull();
  });

  it('devuelve null si no hay secreto configurado', () => {
    const sinSecreto = new RevolutProvider({ apiKey: 'sk_test' }, true);
    const cuerpo = JSON.stringify(avisoCompletado);
    expect(sinSecreto.verificarWebhook(cuerpo, firmar(cuerpo))).toBeNull();
  });

  it('deduplica por pedido y evento', () => {
    // La pasarela reintenta el mismo aviso; el identificador tiene que ser
    // estable para que el segundo se descarte, pero distinto entre eventos
    // para que "autorizado" y "completado" no se pisen.
    const completado = JSON.stringify(avisoCompletado);
    const autorizado = JSON.stringify({ ...avisoCompletado, event: 'ORDER_AUTHORISED' });

    const a = proveedor().verificarWebhook(completado, firmar(completado));
    const b = proveedor().verificarWebhook(completado, firmar(completado));
    const c = proveedor().verificarWebhook(autorizado, firmar(autorizado));

    expect(a?.eventId).toBe(b?.eventId);
    expect(a?.eventId).not.toBe(c?.eventId);
  });
});

describe('Revolut · traducción de eventos', () => {
  const estadoDe = (evento: string) => {
    const cuerpo = JSON.stringify({ ...avisoCompletado, event: evento });
    return proveedor().verificarWebhook(cuerpo, firmar(cuerpo))?.estado;
  };

  it('solo ORDER_COMPLETED cuenta como pagado', () => {
    expect(estadoDe('ORDER_COMPLETED')).toBe('PAGADO');
  });

  it('autorizado NO es pagado', () => {
    // El dinero está retenido en la tarjeta pero todavía no es nuestro. Con
    // captura manual puede caducar sin capturarse nunca.
    expect(estadoDe('ORDER_AUTHORISED')).toBe('ESPERANDO_CONFIRMACION');
    expect(estadoDe('ORDER_PAYMENT_AUTHENTICATED')).toBe('ESPERANDO_CONFIRMACION');
  });

  it('reconoce rechazo, fallo y cancelación', () => {
    expect(estadoDe('ORDER_PAYMENT_DECLINED')).toBe('FALLIDO');
    expect(estadoDe('ORDER_PAYMENT_FAILED')).toBe('FALLIDO');
    expect(estadoDe('ORDER_CANCELLED')).toBe('CADUCADO');
  });

  it('reconoce el reembolso completado', () => {
    expect(estadoDe('REFUND_COMPLETED')).toBe('REEMBOLSADO');
  });

  it('un evento nuevo no se interpreta como pagado', () => {
    // Si Revolut añade eventos, lo peor que puede pasar es que demos por bueno
    // uno que no lo es y enviemos mercancía sin cobrar.
    expect(estadoDe('ORDER_ALGO_QUE_NO_EXISTE')).toBe('DESCONOCIDO');
    expect(estadoDe('REFUND_FAILED')).toBe('DESCONOCIDO');
  });
});

describe('Revolut · creación del cobro', () => {
  it('envía el importe en céntimos, sin dividir', async () => {
    // Dividir por 100 y volver a multiplicar es de donde salen los céntimos
    // descuadrados. Su API usa las mismas unidades menores que nosotros.
    const espia = espiar({
      '/orders': { id: 'ord-1', state: 'pending', checkout_url: 'https://checkout.revolut.com/x' },
    });

    try {
      const r = await proveedor().crearCobro({
        orderId: 'o-1',
        orderNumber: 'ES-2026-000002',
        amountCents: 4199,
        currency: 'eur',
        customerEmail: 'cliente@ejemplo.es',
        description: 'Pedido ES-2026-000002',
        successUrl: 'https://tienda.es/gracias',
        cancelUrl: 'https://tienda.es/pago',
        callbackUrl: 'https://api.tienda.es/api/v1/payments/webhook/revolut',
        idempotencyKey: 'k-1',
        locale: 'es',
      });

      const enviado = espia.llamadas[0]?.cuerpo as Record<string, unknown>;
      expect(enviado['amount']).toBe(4199);
      expect(enviado['currency']).toBe('EUR');
      expect(enviado['merchant_order_ext_ref']).toBe('ES-2026-000002');
      expect(r.checkoutUrl).toBe('https://checkout.revolut.com/x');
      expect(r.estado).toBe('PENDIENTE');
    } finally {
      espia.restaurar();
    }
  });

  it('pide captura automática', async () => {
    // Con captura manual el pedido se quedaría autorizado y el dinero sin
    // ingresar hasta que alguien lo capturase a mano desde su panel.
    const espia = espiar({
      '/orders': { id: 'ord-1', state: 'pending', checkout_url: 'https://checkout.revolut.com/x' },
    });

    try {
      await proveedor().crearCobro({
        orderId: 'o-1',
        orderNumber: 'ES-1',
        amountCents: 1000,
        currency: 'EUR',
        customerEmail: 'c@e.es',
        description: 'd',
        successUrl: 'https://t.es/ok',
        cancelUrl: 'https://t.es/no',
        callbackUrl: 'https://api.t.es/w',
        idempotencyKey: 'k',
      });

      expect((espia.llamadas[0]?.cuerpo as Record<string, unknown>)['capture_mode']).toBe(
        'automatic',
      );
    } finally {
      espia.restaurar();
    }
  });

  it('falla si no llega URL de pago, en vez de devolver un cobro sin botón', async () => {
    const espia = espiar({ '/orders': { id: 'ord-1', state: 'pending' } });

    try {
      await expect(
        proveedor().crearCobro({
          orderId: 'o-1',
          orderNumber: 'ES-1',
          amountCents: 1000,
          currency: 'EUR',
          customerEmail: 'c@e.es',
          description: 'd',
          successUrl: 'https://t.es/ok',
          cancelUrl: 'https://t.es/no',
          callbackUrl: 'https://api.t.es/w',
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/URL de pago/);
    } finally {
      espia.restaurar();
    }
  });

  it('fija la versión de la API en la cabecera', async () => {
    // Sin fijarla, una actualización suya cambia las respuestas sin avisar.
    const espia = espiar({
      '/orders': { id: 'ord-1', state: 'pending', checkout_url: 'https://c.revolut.com/x' },
    });

    try {
      await proveedor().crearCobro({
        orderId: 'o-1',
        orderNumber: 'ES-1',
        amountCents: 1000,
        currency: 'EUR',
        customerEmail: 'c@e.es',
        description: 'd',
        successUrl: 'https://t.es/ok',
        cancelUrl: 'https://t.es/no',
        callbackUrl: 'https://api.t.es/w',
        idempotencyKey: 'k',
      });

      const cabeceras = espia.llamadas[0]?.cabeceras as Record<string, string>;
      expect(cabeceras['Revolut-Api-Version']).toBe('2024-09-01');
      expect(cabeceras['Authorization']).toBe('Bearer sk_test');
    } finally {
      espia.restaurar();
    }
  });

  it('usa el entorno de pruebas cuando toca', async () => {
    const espia = espiar({
      '/orders': { id: 'ord-1', state: 'pending', checkout_url: 'https://c.revolut.com/x' },
    });

    try {
      const solicitud = {
        orderId: 'o-1',
        orderNumber: 'ES-1',
        amountCents: 1000,
        currency: 'EUR',
        customerEmail: 'c@e.es',
        description: 'd',
        successUrl: 'https://t.es/ok',
        cancelUrl: 'https://t.es/no',
        callbackUrl: 'https://api.t.es/w',
        idempotencyKey: 'k',
      };

      await proveedor().crearCobro(solicitud);
      await new RevolutProvider({ apiKey: 'sk_live' }, false).crearCobro(solicitud);

      expect(espia.llamadas[0]?.url).toContain('sandbox-merchant.revolut.com');
      expect(espia.llamadas[1]?.url).toBe('https://merchant.revolut.com/api/orders');
    } finally {
      espia.restaurar();
    }
  });

  it('falla claro si no hay clave configurada', async () => {
    await expect(
      new RevolutProvider({}, true).crearCobro({
        orderId: 'o-1',
        orderNumber: 'ES-1',
        amountCents: 1000,
        currency: 'EUR',
        customerEmail: 'c@e.es',
        description: 'd',
        successUrl: 'https://t.es/ok',
        cancelUrl: 'https://t.es/no',
        callbackUrl: 'https://api.t.es/w',
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/clave de API/i);
  });
});

describe('Revolut · consulta del cobro', () => {
  it('suma solo los pagos completados', async () => {
    // Un intento fallido y un reintento bueno conviven en el mismo pedido.
    // Sumar los dos daría el doble de lo cobrado.
    const espia = espiar({
      '/orders/ord-1': {
        id: 'ord-1',
        state: 'completed',
        amount: 4199,
        currency: 'EUR',
        payments: [
          { id: 'p-1', state: 'failed', amount: 4199 },
          {
            id: 'p-2',
            state: 'completed',
            amount: 4199,
            fees: [{ amount: 55, currency: 'EUR', type: 'acquiring' }],
            updated_at: '2026-07-29T10:00:00Z',
            payment_method: { type: 'card', card_brand: 'VISA', card_last_four: '4242' },
          },
        ],
      },
    });

    try {
      const estado = await proveedor().consultarCobro('ord-1');

      expect(estado?.estado).toBe('PAGADO');
      expect(estado?.amountCents).toBe(4199);
      expect(estado?.receivedCents).toBe(4199);
      expect(estado?.feeCents).toBe(55);
      expect(estado?.paidAt).toEqual(new Date('2026-07-29T10:00:00Z'));
    } finally {
      espia.restaurar();
    }
  });

  it('un pedido completado sin detalle de pagos cuenta como cobrado entero', async () => {
    const espia = espiar({
      '/orders/ord-2': { id: 'ord-2', state: 'completed', amount: 2500, currency: 'EUR' },
    });

    try {
      const estado = await proveedor().consultarCobro('ord-2');
      expect(estado?.receivedCents).toBe(2500);
    } finally {
      espia.restaurar();
    }
  });

  it('un pedido autorizado no ha cobrado nada todavía', async () => {
    const espia = espiar({
      '/orders/ord-3': {
        id: 'ord-3',
        state: 'authorised',
        amount: 2500,
        currency: 'EUR',
        payments: [{ id: 'p-1', state: 'authorised', amount: 2500 }],
      },
    });

    try {
      const estado = await proveedor().consultarCobro('ord-3');
      expect(estado?.estado).toBe('ESPERANDO_CONFIRMACION');
      expect(estado?.receivedCents).toBe(0);
    } finally {
      espia.restaurar();
    }
  });

  it('devuelve null si el pedido no existe', async () => {
    const espia = espiar({ '/orders': { message: 'not found' } }, 404);

    try {
      expect(await proveedor().consultarCobro('no-existe')).toBeNull();
    } finally {
      espia.restaurar();
    }
  });
});

describe('Revolut · reembolsos', () => {
  it('devuelve al mismo método de pago, sin pedir destino', async () => {
    const espia = espiar({ '/refund': { id: 'ref-1', state: 'completed' } });

    try {
      const r = await proveedor().reembolsar({
        externalPaymentId: 'ord-1',
        amountCents: 4199,
        currency: 'EUR',
        reason: 'Desistimiento',
        idempotencyKey: 'k-1',
      });

      const enviado = espia.llamadas[0]?.cuerpo as Record<string, unknown>;
      expect(espia.llamadas[0]?.url).toContain('/orders/ord-1/refund');
      expect(enviado['amount']).toBe(4199);
      expect(enviado['currency']).toBe('EUR');
      expect(r.estado).toBe('COMPLETADO');
    } finally {
      espia.restaurar();
    }
  });

  it('un reembolso en curso NO se da por completado', async () => {
    // Cerrarlo antes de tiempo deja al cliente sin su dinero y a nosotros
    // creyendo que ya está devuelto.
    const espia = espiar({ '/refund': { id: 'ref-2', state: 'processing' } });

    try {
      const r = await proveedor().reembolsar({
        externalPaymentId: 'ord-1',
        amountCents: 1000,
        currency: 'EUR',
        reason: 'Parcial',
        idempotencyKey: 'k-2',
      });

      expect(r.estado).toBe('PROCESANDO');
    } finally {
      espia.restaurar();
    }
  });

  it('rechaza un importe de cero o negativo', async () => {
    const espia = espiar({ '/refund': { id: 'ref-3', state: 'completed' } });

    try {
      await expect(
        proveedor().reembolsar({
          externalPaymentId: 'ord-1',
          amountCents: 0,
          currency: 'EUR',
          reason: 'x',
          idempotencyKey: 'k-3',
        }),
      ).rejects.toThrow(/mayor que 0/);

      expect(espia.llamadas).toHaveLength(0);
    } finally {
      espia.restaurar();
    }
  });
});

describe('Revolut · capacidades declaradas', () => {
  it('reembolsa sola, sin pedir dirección', () => {
    // Es la diferencia práctica con cripto: el checkout no pinta el campo de
    // dirección de devolución.
    const c = proveedor().capacidades;
    expect(c.reembolsoAutomatico).toBe(true);
    expect(c.requiereDireccionReembolso).toBe(false);
  });

  it('avisa de que hay chargebacks', () => {
    // El coste de aceptar tarjeta: el cliente puede reclamar meses después.
    expect(proveedor().capacidades.admiteDisputas).toBe(true);
  });

  it('el cobro no caduca ni admite pago parcial', () => {
    const c = proveedor().capacidades;
    expect(c.cobroCaduca).toBe(false);
    expect(c.admitePagoParcial).toBe(false);
  });

  it('no ofrece selector de divisa', async () => {
    expect(await proveedor().monedasDisponibles()).toEqual([]);
  });
});

describe('Revolut · cobertura del pedido', () => {
  it('exige el importe exacto: en tarjeta no hay comisión de red', () => {
    expect(RevolutProvider.cubreElPedido(4199, 4199)).toBe(true);
    expect(RevolutProvider.cubreElPedido(4198, 4199)).toBe(false);
    expect(RevolutProvider.cubreElPedido(4500, 4199)).toBe(true);
  });

  it('no acepta nada si el importe esperado es cero', () => {
    expect(RevolutProvider.cubreElPedido(0, 0)).toBe(false);
  });
});

describe('Revolut · errores de la pasarela', () => {
  it('distingue credenciales rechazadas de un fallo pasajero', async () => {
    const espia = espiar({ '/orders': { message: 'Unauthorized' } }, 401);

    try {
      const r = await proveedor().verificar();
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/clave de API/i);
    } finally {
      espia.restaurar();
    }
  });

  it('un 5xx es reintentable; un 401 no', async () => {
    const caida = espiar({ '/orders': {} }, 503);
    try {
      await proveedor()
        .consultarCobro('ord-1')
        .catch((e: { tipo: string; reintentable: boolean }) => {
          expect(e.tipo).toBe('PASARELA_CAIDA');
          expect(e.reintentable).toBe(true);
        });
    } finally {
      caida.restaurar();
    }

    const rechazo = espiar({ '/orders': {} }, 403);
    try {
      await proveedor()
        .consultarCobro('ord-1')
        .catch((e: { tipo: string; reintentable: boolean }) => {
          expect(e.tipo).toBe('CREDENCIALES');
          expect(e.reintentable).toBe(false);
        });
    } finally {
      rechazo.restaurar();
    }
  });

  it('confirma que las credenciales sirven', async () => {
    const espia = espiar({ '/orders': [] });

    try {
      const r = await proveedor().verificar();
      expect(r.ok).toBe(true);
      expect(r.mensaje).toMatch(/pruebas/);
    } finally {
      espia.restaurar();
    }
  });
});

describe('Revolut · la firma auxiliar coincide con la del proveedor', () => {
  it('produce el mismo HMAC que documenta Revolut', () => {
    // Fija el formato exacto de lo firmado: `v1.{timestamp}.{cuerpo}`. Si
    // alguien lo cambia por `{timestamp}.{cuerpo}` o por el cuerpo a secas,
    // los avisos reales dejan de verificar y esto lo detecta antes.
    const cuerpo = '{"event":"ORDER_COMPLETED"}';
    const esperado =
      'v1=' +
      crypto.createHmac('sha256', SECRETO).update(`v1.1753776000000.${cuerpo}`).digest('hex');

    expect(RevolutProvider.firmar(cuerpo, SECRETO, 1_753_776_000_000)).toBe(esperado);
  });
});
