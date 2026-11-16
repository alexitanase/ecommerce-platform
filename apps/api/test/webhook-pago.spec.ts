import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { crearEntorno, vaciarBase, type EntornoPruebas, type Respuesta } from './entorno.js';

/** Lo que se responde a la pasarela: si se procesó y, si no, por qué. */
interface ResultadoWebhook {
  ok: boolean;
  motivo?: string;
}

/**
 * El aviso de cobro, de punta a punta.
 *
 * Que la firma se comprueba bien ya está probado en `packages/payments`. Lo que
 * falta —y es lo que de verdad importa— es que ese "no" llegue hasta la base de
 * datos: que un aviso falsificado no deje el pedido en PAGADO ni dispare el
 * envío al proveedor. Entre la verificación y el `UPDATE` hay un servicio, una
 * deduplicación en Redis y una transacción, y cualquiera de los tres puede
 * dejarse la comprobación por el camino.
 *
 * Si algo de este fichero falla, la tienda regala mercancía.
 */

let entorno: EntornoPruebas;

const SECRETO_IPN = 'secreto-ipn-de-pruebas';
const IMPORTE_CENTS = 4199;

/** Firma como NOWPayments: HMAC-SHA512 sobre el JSON con las claves ordenadas. */
function firmar(datos: Record<string, unknown>, secreto = SECRETO_IPN): string {
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

/** Contador para que cada pedido de prueba tenga su propio número correlativo. */
let correlativo = 0;

/** Pedido esperando pago con su cobro ya iniciado en la pasarela. */
async function pedidoEsperandoPago(): Promise<{ orderId: string; externalId: string }> {
  const orderId = newId();
  const externalId = `np-${newId().slice(0, 10)}`;
  correlativo += 1;

  await entorno.prisma.client.order.create({
    data: {
      id: orderId,
      number: `ES-2026-${String(correlativo).padStart(6, '0')}`,
      publicToken: newId(),
      email: 'cliente@ejemplo.es',
      locale: 'es',
      status: 'AWAITING_PAYMENT',
      subtotalCents: IMPORTE_CENTS,
      shippingCents: 0,
      discountCents: 0,
      taxCents: 729,
      totalCents: IMPORTE_CENTS,
      currency: 'EUR',
      taxRate: 21,
      taxRegime: 'INTERIOR',
      taxCountry: 'ES',
      shippingAddress: { countryCode: 'ES', city: 'Madrid' },
      billingAddress: { countryCode: 'ES', city: 'Madrid' },
    },
  });

  await entorno.prisma.client.payment.create({
    data: {
      id: newId(),
      orderId,
      provider: 'nowpayments',
      externalId,
      status: 'PENDING',
      amountCents: IMPORTE_CENTS,
      currency: 'EUR',
    },
  });

  return { orderId, externalId };
}

/** Aviso de "pago finalizado" tal como lo manda NOWPayments. */
const aviso = (externalId: string) => ({
  payment_id: externalId,
  payment_status: 'finished',
  pay_address: 'TXyz123',
  price_amount: IMPORTE_CENTS / 100,
  price_currency: 'eur',
  pay_amount: 45.2,
  actually_paid: 45.2,
  pay_currency: 'usdttrc20',
  payin_hash: '0xabc123',
});

async function enviarAviso(
  cuerpo: Record<string, unknown>,
  firma: string,
): Promise<Respuesta<ResultadoWebhook>> {
  return entorno.peticion<ResultadoWebhook>({
    metodo: 'POST',
    ruta: '/api/v1/payments/webhook/nowpayments',
    cuerpo,
    cabeceras: { 'x-nowpayments-sig': firma },
  });
}

/** Deja NOWPayments configurada y encendida, como en una tienda en marcha. */
async function activarPasarela(): Promise<void> {
  const { token } = await entorno.personal(['settings:write']);

  await entorno.peticion({
    metodo: 'POST',
    ruta: '/api/v1/integrations/nowpayments',
    token,
    cuerpo: {
      activa: true,
      credenciales: { apiKey: 'clave-de-pruebas', ipnSecret: SECRETO_IPN },
      ajustes: { sandbox: true },
    },
  });
}

const estadoDelPedido = async (orderId: string): Promise<string> =>
  (
    await entorno.prisma.client.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    })
  ).status;

beforeAll(async () => {
  entorno = await crearEntorno();
});

afterAll(async () => {
  await entorno.app.close();
});

beforeEach(async () => {
  await vaciarBase(entorno);
  await activarPasarela();
});

describe('Aviso de cobro falsificado', () => {
  it('firmado con otro secreto no cobra el pedido', async () => {
    // El caso realista: alguien conoce el formato del callback —está
    // documentado— y prueba a mandarlo.
    const { orderId, externalId } = await pedidoEsperandoPago();
    const cuerpo = aviso(externalId);

    const respuesta = await enviarAviso(cuerpo, firmar(cuerpo, 'secreto-del-atacante'));

    // Se responde 200 a propósito, para que la pasarela real no reintente en
    // bucle; lo que no puede cambiar es el pedido.
    expect(respuesta.estado).toBe(200);
    expect(respuesta.datos.ok).toBe(false);
    expect(await estadoDelPedido(orderId)).toBe('AWAITING_PAYMENT');
  });

  it('sin cabecera de firma tampoco', async () => {
    const { orderId, externalId } = await pedidoEsperandoPago();

    const respuesta = await entorno.peticion<ResultadoWebhook>({
      metodo: 'POST',
      ruta: '/api/v1/payments/webhook/nowpayments',
      cuerpo: aviso(externalId),
    });

    expect(respuesta.datos.ok).toBe(false);
    expect(await estadoDelPedido(orderId)).toBe('AWAITING_PAYMENT');
  });

  it('con el cuerpo manipulado después de firmar, tampoco', async () => {
    // Se firma un importe pequeño y se manda otro: es el intento de pagar
    // cinco euros un pedido de cuarenta.
    const { orderId, externalId } = await pedidoEsperandoPago();
    const original = aviso(externalId);
    const firma = firmar(original);

    const respuesta = await enviarAviso({ ...original, price_amount: 0.01 }, firma);

    expect(respuesta.datos.ok).toBe(false);
    expect(await estadoDelPedido(orderId)).toBe('AWAITING_PAYMENT');
  });

  it('un aviso bien firmado para un cobro que no existe no crea nada', async () => {
    const cuerpo = aviso('cobro-que-no-existe-000');

    const respuesta = await enviarAviso(cuerpo, firmar(cuerpo));

    expect(respuesta.datos.ok).toBe(false);
    expect(await entorno.prisma.client.payment.count()).toBe(0);
  });
});

describe('Aviso de cobro legítimo', () => {
  it('marca el pedido como pagado', async () => {
    const { orderId, externalId } = await pedidoEsperandoPago();
    const cuerpo = aviso(externalId);

    const respuesta = await enviarAviso(cuerpo, firmar(cuerpo));

    expect(respuesta.datos.ok).toBe(true);
    expect(await estadoDelPedido(orderId)).toBe('PAID');

    const pago = await entorno.prisma.client.payment.findFirstOrThrow({ where: { externalId } });
    expect(pago.status).toBe('PAID');
    // El hash de la transacción se guarda para poder auditar el cobro después.
    expect(pago.txHash).toBe('0xabc123');
  });

  it('el mismo aviso repetido no cobra dos veces', async () => {
    // Las pasarelas reenvían el callback hasta que reciben un 200 limpio, y a
    // veces también después. Sin deduplicación, cada reenvío vuelve a disparar
    // el envío al proveedor: dos veces la misma mercancía.
    const { orderId, externalId } = await pedidoEsperandoPago();
    const cuerpo = aviso(externalId);
    const firma = firmar(cuerpo);

    await enviarAviso(cuerpo, firma);
    const segundo = await enviarAviso(cuerpo, firma);

    expect(segundo.datos.motivo).toBeDefined();
    expect(await estadoDelPedido(orderId)).toBe('PAID');

    const eventos = await entorno.prisma.client.orderEvent.count({
      where: { orderId, type: 'payment.paid' },
    });
    expect(eventos).toBeLessThanOrEqual(1);
  });

  it('un aviso tardío no revierte un pedido ya pagado', async () => {
    // Los callbacks llegan desordenados: un "expirado" emitido antes puede
    // aparecer después del "pagado". Reabrir el cobro cancelaría un pedido que
    // ya se ha enviado.
    const { orderId, externalId } = await pedidoEsperandoPago();

    const pagado = aviso(externalId);
    await enviarAviso(pagado, firmar(pagado));

    const expirado = { ...aviso(externalId), payment_status: 'expired', actually_paid: 0 };
    await enviarAviso(expirado, firmar(expirado));

    expect(await estadoDelPedido(orderId)).toBe('PAID');
  });
});
