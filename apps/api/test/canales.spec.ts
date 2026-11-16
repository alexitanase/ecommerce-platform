import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { ChannelsService } from '../src/modules/channels/channels.service.js';
import { crearEntorno, vaciarBase, type EntornoPruebas } from './entorno.js';

/**
 * Afiliados y atribución de canal, de punta a punta.
 *
 * El cálculo está probado caso a caso en `canales.spec.ts`. Lo que se
 * comprueba aquí es que ese cálculo se convierta en la comisión correcta y —
 * sobre todo— que **no se pague de más**: un devengo duplicado por un webhook
 * repetido, o una comisión que sobrevive a una devolución, no dan ningún
 * error. Se descubren al liquidar, cuando el dinero ya se ha transferido.
 */

let entorno: EntornoPruebas;
let canales: ChannelsService;
/** Actor real: la auditoría tiene clave ajena contra la tabla de usuarios. */
let ctx: { actorId: string };

const direccion = {
  firstName: 'Ana',
  lastName: 'Ruiz',
  line1: 'Calle Mayor 1',
  city: 'Madrid',
  province: 'Madrid',
  postalCode: '28013',
  countryCode: 'ES',
};

async function crearAfiliado(code = 'CREADOR1', porcentaje = 10, estado = 'ACTIVO') {
  const id = newId();
  await entorno.prisma.client.affiliate.create({
    data: {
      id,
      name: 'Quien recomienda',
      email: `${code.toLowerCase()}@ejemplo.es`,
      code,
      commissionPercent: porcentaje,
      status: estado,
    },
  });
  return id;
}

/** Pedido pagado con una línea al 21 %, con su marcaje de canal. */
async function crearPedido(
  marcaje: { fuente?: string; campana?: string } = {},
  totalConIva = 12_100,
) {
  const id = newId();
  await entorno.prisma.client.order.create({
    data: {
      id,
      number: `ES-2026-${String(Math.floor(Math.random() * 900000) + 100000)}`,
      email: 'cliente@ejemplo.es',
      locale: 'es',
      status: 'PAID',
      paymentStatus: 'PAID',
      paidAt: new Date(),
      subtotalCents: totalConIva,
      totalCents: totalConIva,
      taxCents: 0,
      shippingCents: 0,
      discountCents: 0,
      phone: '600123456',
      shippingAddress: direccion,
      publicToken: newId(),
      ...(marcaje.fuente ? { utmSource: marcaje.fuente } : {}),
      ...(marcaje.campana ? { utmCampaign: marcaje.campana } : {}),
      items: {
        create: {
          id: newId(),
          sku: `SKU-${newId().slice(0, 8)}`,
          name: 'Artículo',
          quantity: 1,
          unitPriceCents: totalConIva,
          totalCents: totalConIva,
          taxRate: 21,
        },
      },
    },
  });
  return id;
}

const comisiones = () => entorno.prisma.client.affiliateCommission.findMany();

beforeAll(async () => {
  entorno = await crearEntorno();
  canales = entorno.app.get(ChannelsService);
});

afterAll(async () => {
  await entorno.app.close();
});

beforeEach(async () => {
  await vaciarBase(entorno);
  const { userId } = await entorno.personal(['payments:payout']);
  ctx = { actorId: userId };
});

describe('Cuando la venta la trae un afiliado', () => {
  it('se devenga la comisión sobre la base sin IVA', async () => {
    await crearAfiliado('CREADOR1', 10);
    // 121,00 € con IVA del 21 % → base 100,00 € → comisión 10,00 €.
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });

    await canales.devengarComision(orderId);

    const [comision] = await comisiones();
    expect(comision?.baseCents).toBe(10_000);
    expect(comision?.amountCents).toBe(1000);
  });

  it('queda PENDIENTE, no pagada', async () => {
    // El pedido todavía puede devolverse. Pagar antes de que venza el plazo de
    // desistimiento es regalar el dinero dos veces.
    await crearAfiliado();
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });

    await canales.devengarComision(orderId);

    expect((await comisiones())[0]?.status).toBe('PENDIENTE');
  });

  it('el código funciona escrito en minúsculas', async () => {
    // Viaja en una URL que copia y pega gente: si solo valiera en mayúsculas,
    // media campaña quedaría sin atribuir.
    await crearAfiliado('CREADOR1');
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });

    await canales.devengarComision(orderId);

    expect(await comisiones()).toHaveLength(1);
  });
});

describe('Lo que no genera comisión', () => {
  it('un pedido sin marcaje de afiliado', async () => {
    await crearAfiliado();
    const orderId = await crearPedido({ fuente: 'newsletter' });

    await canales.devengarComision(orderId);

    expect(await comisiones()).toEqual([]);
  });

  it('un código que no existe', async () => {
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'inventado' });

    await canales.devengarComision(orderId);

    expect(await comisiones()).toEqual([]);
  });

  it('un afiliado pausado', async () => {
    // Se pausa por algo —una promoción que no cumple, una relación terminada—
    // y seguir devengando sería seguir debiéndole dinero.
    await crearAfiliado('CREADOR1', 10, 'PAUSADO');
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });

    await canales.devengarComision(orderId);

    expect(await comisiones()).toEqual([]);
  });

  it('una comisión del 0 %', async () => {
    await crearAfiliado('CREADOR1', 0);
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });

    await canales.devengarComision(orderId);

    expect(await comisiones()).toEqual([]);
  });
});

describe('Pagar dos veces', () => {
  it('un webhook de pago repetido no duplica la comisión', async () => {
    // Es el fallo que más caro sale: no da ningún error y se descubre al
    // liquidar, cuando el dinero ya se ha transferido.
    await crearAfiliado();
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });

    await canales.devengarComision(orderId);
    await canales.devengarComision(orderId);
    await canales.devengarComision(orderId);

    expect(await comisiones()).toHaveLength(1);
  });
});

describe('Cuando la venta se deshace', () => {
  it('la comisión se anula', async () => {
    await crearAfiliado();
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });
    await canales.devengarComision(orderId);

    await canales.anularComision(orderId);

    expect((await comisiones())[0]?.status).toBe('ANULADA');
  });

  it('una comisión ya pagada no se anula', async () => {
    // El dinero ya salió: marcarla como anulada haría cuadrar mal la cuenta y
    // escondería que hay algo que reclamar.
    const afiliadoId = await crearAfiliado();
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });
    await canales.devengarComision(orderId);

    await entorno.prisma.client.affiliateCommission.updateMany({
      where: { affiliateId: afiliadoId },
      data: { status: 'PAGADA' },
    });
    await canales.anularComision(orderId);

    expect((await comisiones())[0]?.status).toBe('PAGADA');
  });
});

describe('Liquidar', () => {
  it('no se puede liquidar lo que todavía puede devolverse', async () => {
    const afiliadoId = await crearAfiliado();
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });
    await canales.devengarComision(orderId);

    await expect(canales.liquidar(afiliadoId, ctx)).rejects.toThrow(/aprobadas/i);
  });

  it('lo aprobado se marca como pagado y suma bien', async () => {
    const afiliadoId = await crearAfiliado();

    for (let i = 0; i < 3; i++) {
      const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });
      await canales.devengarComision(orderId);
    }

    await entorno.prisma.client.affiliateCommission.updateMany({
      where: { affiliateId: afiliadoId },
      data: { status: 'APROBADA' },
    });

    const resultado = await canales.liquidar(afiliadoId, ctx);

    expect(resultado.comisiones).toBe(3);
    expect(resultado.totalCents).toBe(3000);
    expect((await comisiones()).every((c) => c.status === 'PAGADA')).toBe(true);
  });

  it('liquidar dos veces seguidas no vuelve a pagar', async () => {
    const afiliadoId = await crearAfiliado();
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });
    await canales.devengarComision(orderId);
    await entorno.prisma.client.affiliateCommission.updateMany({
      where: { affiliateId: afiliadoId },
      data: { status: 'APROBADA' },
    });

    await canales.liquidar(afiliadoId, ctx);

    await expect(canales.liquidar(afiliadoId, ctx)).rejects.toThrow();
  });
});

describe('Aprobar lo que ya no puede devolverse', () => {
  it('no aprueba lo reciente', async () => {
    await crearAfiliado();
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });
    await canales.devengarComision(orderId);

    expect(await canales.aprobarVencidas()).toBe(0);
  });

  it('aprueba lo vencido de un pedido entregado', async () => {
    const afiliadoId = await crearAfiliado();
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });
    await canales.devengarComision(orderId);

    await entorno.prisma.client.order.update({
      where: { id: orderId },
      data: { status: 'DELIVERED' },
    });
    await entorno.prisma.client.affiliateCommission.updateMany({
      where: { affiliateId: afiliadoId },
      data: { createdAt: new Date(Date.now() - 20 * 86_400_000) },
    });

    expect(await canales.aprobarVencidas()).toBe(1);
  });

  it('no aprueba la de un pedido cancelado, por viejo que sea', async () => {
    // El plazo vencido no convierte una venta deshecha en una venta.
    const afiliadoId = await crearAfiliado();
    const orderId = await crearPedido({ fuente: 'afiliados', campana: 'creador1' });
    await canales.devengarComision(orderId);

    await entorno.prisma.client.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });
    await entorno.prisma.client.affiliateCommission.updateMany({
      where: { affiliateId: afiliadoId },
      data: { createdAt: new Date(Date.now() - 60 * 86_400_000) },
    });

    expect(await canales.aprobarVencidas()).toBe(0);
  });
});

describe('El informe por canal', () => {
  it('agrupa las ventas pagadas por su marcaje', async () => {
    await crearPedido({ fuente: 'newsletter' }, 10_000);
    await crearPedido({ fuente: 'newsletter' }, 20_000);
    await crearPedido({ fuente: 'reddit' }, 5000);
    await crearPedido({}, 3000);

    const informe = await canales.informe();

    expect(informe.total).toBe(4);
    expect(informe.canales[0]?.fuente).toBe('newsletter');
    expect(informe.canales[0]?.ingresoCents).toBe(30_000);
    // Los pedidos sin marcaje son tráfico directo y también salen.
    expect(informe.canales.map((c) => c.fuente)).toContain('directo');
  });
});
