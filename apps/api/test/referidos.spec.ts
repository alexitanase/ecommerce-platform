import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { ReferidosService } from '../src/modules/coupons/referidos.service.js';
import { crearEntorno, vaciarBase, type EntornoPruebas } from './entorno.js';

/**
 * Programa de referidos, de punta a punta.
 *
 * Las reglas están probadas caso a caso en `referidos.spec.ts`, y decidir bien
 * no basta: lo que importa aquí es que la decisión llegue a **emitir o no
 * emitir dinero**. Un referido mal resuelto no da ningún error —crea un cupón
 * y ya está— y se descubre semanas después cuadrando cuentas, cuando ya se han
 * regalado cientos de euros que no se recuperan.
 *
 * Por eso todas las comprobaciones acaban mirando la tabla de cupones: no si
 * el estado quedó en RECHAZADO, sino si se creó o no un cupón.
 */

let entorno: EntornoPruebas;
let referidos: ReferidosService;

const direccion = {
  firstName: 'Ana',
  lastName: 'Ruiz',
  line1: 'Calle Mayor 1',
  city: 'Madrid',
  province: 'Madrid',
  postalCode: '28013',
  countryCode: 'ES',
};

/** Deja el programa encendido con las reglas por defecto. */
async function encender(cambios: Record<string, unknown> = {}) {
  const valores = {
    activo: true,
    premioReferidorCents: 500,
    premioReferidoCents: 500,
    pedidoMinimoCents: 2500,
    maximoPorReferidor: 10,
    diasDeValidez: 90,
    ...cambios,
  };

  for (const [key, value] of Object.entries(valores)) {
    await entorno.prisma.client.setting.create({
      data: { id: newId(), namespace: 'referidos', key, value: value as never },
    });
  }
}

/** Persona registrada que puede recomendar. */
async function crearReferidor(email: string, codigo: string): Promise<string> {
  const id = newId();
  await entorno.prisma.client.user.create({
    data: { id, email, password: 'x', referralCode: codigo },
  });
  return id;
}

/** Pedido pagado, sin pasar por el checkout: aquí se prueba el premio. */
async function crearPedido(email: string, totalCents = 4999): Promise<string> {
  const id = newId();
  await entorno.prisma.client.order.create({
    data: {
      id,
      number: `ES-2026-${String(Math.floor(Math.random() * 900000) + 100000)}`,
      email,
      locale: 'es',
      status: 'PAID',
      paymentStatus: 'PAID',
      paidAt: new Date(),
      subtotalCents: totalCents,
      totalCents,
      taxCents: 0,
      shippingCents: 0,
      discountCents: 0,
      phone: '600123456',
      shippingAddress: direccion,
      publicToken: newId(),
    },
  });
  return id;
}

const cupones = () => entorno.prisma.client.coupon.count();

beforeAll(async () => {
  entorno = await crearEntorno();
  referidos = entorno.app.get(ReferidosService);
});

afterAll(async () => {
  await entorno.app.close();
});

beforeEach(async () => {
  await vaciarBase(entorno);
});

describe('Un referido legítimo', () => {
  it('emite un cupón para cada parte y los deja atados a la invitación', async () => {
    await encender();
    await crearReferidor('ana@ejemplo.es', 'ANACODE1');
    const orderId = await crearPedido('luis@ejemplo.es');

    await referidos.registrarUso({
      codigo: 'ANACODE1',
      emailReferido: 'luis@ejemplo.es',
      orderId,
    });
    await referidos.alPagarPedido(orderId);

    const invitacion = await entorno.prisma.client.referral.findUniqueOrThrow({
      where: { orderId },
    });

    expect(invitacion.status).toBe('COMPLETADO');
    expect(invitacion.referrerCouponId).not.toBeNull();
    expect(invitacion.referredCouponId).not.toBeNull();
    expect(await cupones()).toBe(2);
  });

  it('los cupones caducan y son de un solo uso', async () => {
    // Un cupón emitido por un programa automático sin caducidad ni tope acaba
    // circulando por foros de descuentos y lo usa quien no lo ganó.
    await encender({ diasDeValidez: 30 });
    await crearReferidor('ana@ejemplo.es', 'ANACODE1');
    const orderId = await crearPedido('luis@ejemplo.es');

    await referidos.registrarUso({
      codigo: 'ANACODE1',
      emailReferido: 'luis@ejemplo.es',
      orderId,
    });
    await referidos.alPagarPedido(orderId);

    const emitidos = await entorno.prisma.client.coupon.findMany();

    for (const c of emitidos) {
      expect(c.maxUses).toBe(1);
      expect(c.maxUsesPerCustomer).toBe(1);
      expect(c.validUntil).not.toBeNull();
      // El mínimo del programa se hereda: si no, el premio por un pedido de
      // 25 € podría gastarse en uno de 6 €.
      expect(c.minOrderCents).toBe(2500);
    }
  });

  it('el código escrito con espacios y en minúsculas también vale', async () => {
    // Se dicta por teléfono y se copia de un mensaje: si solo valiera la forma
    // exacta, la mitad de las invitaciones se perderían por un espacio.
    await encender();
    await crearReferidor('ana@ejemplo.es', 'ANACODE1');
    const orderId = await crearPedido('luis@ejemplo.es');

    await referidos.registrarUso({
      codigo: ' anacode1 ',
      emailReferido: 'luis@ejemplo.es',
      orderId,
    });
    await referidos.alPagarPedido(orderId);

    expect(await cupones()).toBe(2);
  });
});

describe('Lo que no llega a emitir ni un céntimo', () => {
  it('con el programa apagado', async () => {
    // Un programa que regala dinero no puede activarse solo porque se
    // despliegue una versión nueva.
    await crearReferidor('ana@ejemplo.es', 'ANACODE1');
    const orderId = await crearPedido('luis@ejemplo.es');

    await referidos.registrarUso({
      codigo: 'ANACODE1',
      emailReferido: 'luis@ejemplo.es',
      orderId,
    });
    await referidos.alPagarPedido(orderId);

    expect(await cupones()).toBe(0);
    const invitacion = await entorno.prisma.client.referral.findUniqueOrThrow({
      where: { orderId },
    });
    expect(invitacion.status).toBe('RECHAZADO');
    expect(invitacion.rejectionReason).toBe('PROGRAMA_APAGADO');
  });

  it('referirse a uno mismo', async () => {
    await encender();
    await crearReferidor('ana@ejemplo.es', 'ANACODE1');
    const orderId = await crearPedido('ana@ejemplo.es');

    await referidos.registrarUso({
      codigo: 'ANACODE1',
      emailReferido: 'ana@ejemplo.es',
      orderId,
    });
    await referidos.alPagarPedido(orderId);

    expect(await cupones()).toBe(0);
  });

  it('quien ya había comprado antes', async () => {
    // El programa trae gente nueva. Premiar a un cliente de siempre por
    // "llegar recomendado" es regalar descuentos por ventas que ya se tenían.
    await encender();
    await crearReferidor('ana@ejemplo.es', 'ANACODE1');
    await crearPedido('luis@ejemplo.es');
    const orderId = await crearPedido('luis@ejemplo.es');

    await referidos.registrarUso({
      codigo: 'ANACODE1',
      emailReferido: 'luis@ejemplo.es',
      orderId,
    });
    await referidos.alPagarPedido(orderId);

    expect(await cupones()).toBe(0);
    const invitacion = await entorno.prisma.client.referral.findUniqueOrThrow({
      where: { orderId },
    });
    expect(invitacion.rejectionReason).toBe('YA_ERA_CLIENTE');
  });

  it('un pedido por debajo del mínimo', async () => {
    await encender({ pedidoMinimoCents: 5000 });
    await crearReferidor('ana@ejemplo.es', 'ANACODE1');
    const orderId = await crearPedido('luis@ejemplo.es', 1000);

    await referidos.registrarUso({
      codigo: 'ANACODE1',
      emailReferido: 'luis@ejemplo.es',
      orderId,
    });
    await referidos.alPagarPedido(orderId);

    expect(await cupones()).toBe(0);
  });

  it('un código que no existe no anota nada ni rompe el pedido', async () => {
    await encender();
    const orderId = await crearPedido('luis@ejemplo.es');

    await expect(
      referidos.registrarUso({
        codigo: 'NOEXISTE',
        emailReferido: 'luis@ejemplo.es',
        orderId,
      }),
    ).resolves.toBeUndefined();

    expect(await entorno.prisma.client.referral.count()).toBe(0);
  });
});

describe('Resolver dos veces el mismo pedido', () => {
  it('no duplica los premios', async () => {
    // El webhook de pago puede llegar repetido, y un reintento que emite otro
    // par de cupones dobla el coste del programa sin que nadie se entere.
    await encender();
    await crearReferidor('ana@ejemplo.es', 'ANACODE1');
    const orderId = await crearPedido('luis@ejemplo.es');

    await referidos.registrarUso({
      codigo: 'ANACODE1',
      emailReferido: 'luis@ejemplo.es',
      orderId,
    });
    await referidos.alPagarPedido(orderId);
    await referidos.alPagarPedido(orderId);

    expect(await cupones()).toBe(2);
  });
});

describe('El límite por persona', () => {
  it('deja de premiar al llegar al tope', async () => {
    await encender({ maximoPorReferidor: 2 });
    const referidorId = await crearReferidor('ana@ejemplo.es', 'ANACODE1');

    for (let i = 0; i < 3; i++) {
      const email = `invitado${String(i)}@ejemplo.es`;
      const orderId = await crearPedido(email);
      await referidos.registrarUso({ codigo: 'ANACODE1', emailReferido: email, orderId });
      await referidos.alPagarPedido(orderId);
    }

    const completados = await entorno.prisma.client.referral.count({
      where: { referrerId: referidorId, status: 'COMPLETADO' },
    });

    expect(completados).toBe(2);
    // Dos parejas de cupones, no tres: el tercero se queda fuera.
    expect(await cupones()).toBe(4);
  });
});

describe('El código de invitación propio', () => {
  it('se crea la primera vez y luego es siempre el mismo', async () => {
    const id = newId();
    await entorno.prisma.client.user.create({
      data: { id, email: 'nueva@ejemplo.es', password: 'x' },
    });

    const primero = await referidos.miCodigo(id);
    const segundo = await referidos.miCodigo(id);

    expect(primero.codigo).toHaveLength(8);
    expect(segundo.codigo).toBe(primero.codigo);
  });
});
