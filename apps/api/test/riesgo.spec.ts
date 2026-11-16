import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { crearEntorno, vaciarBase, type EntornoPruebas, type ErrorApi } from './entorno.js';

/**
 * El control de riesgo, de punta a punta.
 *
 * El motor decide bien —eso está probado caso a caso en `riesgo.spec.ts`— pero
 * lo que importa aquí es otra cosa: que la decisión **llegue a impedir el
 * gasto**. En dropshipping el fraude no cuesta una devolución, cuesta la
 * mercancía: se cobra con una tarjeta robada, se compra el producto al
 * proveedor con dinero real, se envía, y semanas después llega el contracargo.
 *
 * Así que se comprueban las dos mitades: que un pedido normal no se entere de
 * que existe este control, y que uno sospechoso queda retenido ANTES de que
 * nadie compre nada.
 */

let entorno: EntornoPruebas;

interface PedidoCreado {
  id: string;
  number: string;
  riskScore: number;
  riskDecision: string;
}

interface Retenido {
  id: string;
  number: string;
  riskScore: number;
  riskReasons: { codigo: string; detalle: string }[] | null;
}

async function sembrar(): Promise<string> {
  const productId = newId();
  const variantId = newId();

  await entorno.prisma.client.shippingZone.create({
    data: {
      id: newId(),
      name: 'Península',
      countries: ['ES'],
      isActive: true,
      rates: {
        create: { id: newId(), name: 'Estándar', type: 'FLAT', priceCents: 495, isActive: true },
      },
    },
  });

  await entorno.prisma.client.product.create({
    data: {
      id: productId,
      handle: `p-${productId.slice(0, 8)}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      taxRate: 21,
      translations: {
        create: { id: newId(), locale: 'es', name: 'Artículo', slug: `a-${productId.slice(0, 8)}` },
      },
      variants: {
        create: {
          id: variantId,
          sku: `SKU-${productId.slice(0, 8)}`,
          priceCents: 4999,
          stock: 500,
          isDefault: true,
        },
      },
    },
  });

  return variantId;
}

const direccion = {
  firstName: 'Ana',
  lastName: 'Ruiz',
  line1: 'Calle Mayor 1',
  city: 'Madrid',
  province: 'Madrid',
  postalCode: '28013',
  countryCode: 'ES',
};

const comprar = <T>(variantId: string, extra: Record<string, unknown> = {}) =>
  entorno.peticion<T>({
    metodo: 'POST',
    ruta: '/api/v1/orders',
    cuerpo: {
      email: 'cliente@ejemplo.es',
      locale: 'es',
      cartId: `carrito-${newId().slice(0, 8)}`,
      lineas: [{ variantId, quantity: 1 }],
      phone: '600123456',
      shippingAddress: direccion,
      ...extra,
    },
  });

beforeAll(async () => {
  entorno = await crearEntorno();
});

afterAll(async () => {
  await entorno.app.close();
});

beforeEach(async () => {
  await vaciarBase(entorno);
});

describe('Un cliente normal no se entera de que esto existe', () => {
  it('compra y su pedido queda aceptado', async () => {
    const variantId = await sembrar();

    const respuesta = await comprar<PedidoCreado>(variantId);

    expect(respuesta.estado).toBe(201);
    expect(respuesta.datos.riskDecision).toBe('ACEPTAR');
    expect(respuesta.datos.riskScore).toBe(0);
  });

  it('equivocarse y pedir dos veces tampoco lo retiene', async () => {
    // Pasa constantemente: el botón parece que no responde y se pulsa otra vez.
    const variantId = await sembrar();

    await comprar<PedidoCreado>(variantId);
    const segundo = await comprar<PedidoCreado>(variantId);

    expect(segundo.datos.riskDecision).toBe('ACEPTAR');
  });

  it('un pedido aceptado no aparece en la lista de retenidos', async () => {
    const { token } = await entorno.personal(['orders:read']);
    const variantId = await sembrar();
    await comprar(variantId);

    const retenidos = await entorno.peticion<Retenido[]>({
      metodo: 'GET',
      ruta: '/api/v1/orders/retenidos',
      token,
    });

    expect(retenidos.datos).toEqual([]);
  });
});

describe('Lo que sí se retiene', () => {
  it('la ráfaga de pedidos del mismo email acaba retenida', async () => {
    // Es el patrón del bombardeo de tarjetas: un intento tras otro con una
    // distinta hasta que alguna pase.
    const variantId = await sembrar();

    const decisiones: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await comprar<PedidoCreado>(variantId);
      decisiones.push(r.datos.riskDecision ?? 'ERROR');
    }

    // Los primeros pasan, y a propósito: cuatro pedidos en una hora suman
    // puntos pero no llegan al umbral, porque alguien que se equivoca y
    // repite no puede acabar retenido. A partir de cinco ya no es un despiste.
    expect(decisiones[0]).toBe('ACEPTAR');
    expect(decisiones[1]).toBe('ACEPTAR');
    expect(decisiones.at(-1)).toBe('REVISAR');
  });

  it('un pedido retenido aparece con sus motivos explicados', async () => {
    // La lista la lee una persona decidiendo si suelta mercancía por valor de
    // cientos de euros: un código a secas no le sirve.
    const { token } = await entorno.personal(['orders:read']);
    const variantId = await sembrar();

    for (let i = 0; i < 6; i++) await comprar(variantId);

    const retenidos = await entorno.peticion<Retenido[]>({
      metodo: 'GET',
      ruta: '/api/v1/orders/retenidos',
      token,
    });

    expect(retenidos.datos.length).toBeGreaterThan(0);

    const primero = retenidos.datos[0];
    expect(primero?.riskScore).toBeGreaterThan(0);
    expect(primero?.riskReasons?.[0]?.detalle.length).toBeGreaterThan(10);
  });

  it('el bombardeo completo se rechaza sin llegar a crear el pedido', async () => {
    const variantId = await sembrar();

    const atacante = 'quienquiera@mailinator.com';

    let ultima = await comprar<ErrorApi>(variantId, { email: atacante });
    for (let i = 0; i < 12 && ultima.estado === 201; i++) {
      ultima = await comprar<ErrorApi>(variantId, { email: atacante, segundosEnElCheckout: 1 });
    }

    expect(ultima.estado).toBe(400);
    // El mensaje no dice QUÉ señal saltó: detallarlo es enseñarle a quien lo
    // intenta cómo esquivarla la próxima vez.
    expect(ultima.datos.message).not.toMatch(/velocidad|email|ip|desechable/i);

    // Insistir con las mismas señales no crea nada: es la diferencia entre
    // rechazar de verdad y limitarse a marcar el pedido.
    const antes = await entorno.prisma.client.order.count({ where: { email: atacante } });
    await comprar(variantId, { email: atacante, segundosEnElCheckout: 1 });
    const despues = await entorno.prisma.client.order.count({ where: { email: atacante } });

    expect(despues).toBe(antes);
  });

  it('quitar una señal no devuelve el pedido al camino normal', async () => {
    /*
     * Cada intento se puntúa por sí mismo, así que dejar de enviar el
     * formulario en un segundo baja la puntuación. Lo que NO puede pasar es
     * que eso baste para volver a ACEPTAR: la velocidad y el correo temporal
     * siguen ahí, y el pedido tiene que quedarse retenido antes de que nadie
     * compre mercancía.
     */
    const variantId = await sembrar();
    const atacante = 'otro@yopmail.com';

    let ultima = await comprar<PedidoCreado>(variantId, { email: atacante });
    for (let i = 0; i < 12 && ultima.estado === 201; i++) {
      ultima = await comprar<PedidoCreado>(variantId, {
        email: atacante,
        segundosEnElCheckout: 1,
      });
    }

    const suavizado = await comprar<PedidoCreado>(variantId, { email: atacante });

    expect(suavizado.datos.riskDecision).not.toBe('ACEPTAR');
  });
});

describe('Liberar un pedido retenido', () => {
  it('hace falta permiso para soltarlo', async () => {
    // Soltar un pedido es autorizar un gasto real en mercancía: no lo puede
    // hacer quien solo consulta.
    const { token } = await entorno.personal(['orders:read']);
    const variantId = await sembrar();
    const pedido = await comprar<PedidoCreado>(variantId);

    const respuesta = await entorno.peticion({
      metodo: 'POST',
      ruta: `/api/v1/orders/${pedido.datos.id}/liberar-riesgo`,
      token,
    });

    expect(respuesta.estado).toBe(403);
  });

  it('con permiso se suelta y queda registrado quién fue', async () => {
    const { token, userId } = await entorno.personal(['orders:fulfill']);
    const variantId = await sembrar();
    const pedido = await comprar<PedidoCreado>(variantId);

    const respuesta = await entorno.peticion({
      metodo: 'POST',
      ruta: `/api/v1/orders/${pedido.datos.id}/liberar-riesgo`,
      token,
    });

    expect(respuesta.estado).toBe(200);

    const guardado = await entorno.prisma.client.order.findUniqueOrThrow({
      where: { id: pedido.datos.id },
      select: { riskClearedAt: true, riskClearedBy: true },
    });

    // Es dinero real de mercancía: la responsabilidad tiene que tener nombre.
    expect(guardado.riskClearedAt).not.toBeNull();
    expect(guardado.riskClearedBy).toBe(userId);
  });

  it('sin sesión no se puede ni consultar la lista', async () => {
    const respuesta = await entorno.peticion({ metodo: 'GET', ruta: '/api/v1/orders/retenidos' });

    expect(respuesta.estado).toBe(401);
  });
});
