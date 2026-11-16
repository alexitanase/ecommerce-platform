import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { crearEntorno, vaciarBase, type EntornoPruebas, type ErrorApi } from './entorno.js';

/** Lo que devuelve el checkout y comprueban estas pruebas. */
interface PedidoCreado {
  id: string;
  number: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  taxCents: number;
  taxRegime: string;
  taxCountry: string;
}

/**
 * El camino que mueve dinero, contra una base de datos de verdad.
 *
 * Los fallos que aparecieron esta semana vivían todos aquí: un número de pedido
 * que chocaba y dejaba al cliente sin poder comprar, un umbral fiscal que leía
 * un campo con otro nombre y daba siempre cero. Ninguno lo detecta un test
 * unitario, porque el problema no está en la lógica sino en cómo habla con la
 * base de datos.
 */

let entorno: EntornoPruebas;

/** Catálogo mínimo para poder comprar: un producto activo con stock. */
async function sembrarCatalogo(): Promise<{ variantId: string; productId: string }> {
  const productId = newId();
  const variantId = newId();

  await entorno.prisma.client.product.create({
    data: {
      id: productId,
      handle: `producto-${productId.slice(0, 6)}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      taxRate: 21,
      translations: {
        create: {
          id: newId(),
          locale: 'es',
          name: 'Botas de prueba',
          slug: `botas-${productId.slice(0, 6)}`,
        },
      },
      variants: {
        create: {
          id: variantId,
          sku: `SKU-${productId.slice(0, 6)}`,
          priceCents: 4999,
          costCents: 2000,
          stock: 10,
          isDefault: true,
        },
      },
    },
  });

  return { variantId, productId };
}

/** Zona de envío para España; sin ella el checkout rechaza cualquier dirección. */
async function sembrarEnvios(): Promise<void> {
  const zoneId = newId();

  await entorno.prisma.client.shippingZone.create({
    data: {
      id: zoneId,
      name: 'Península',
      countries: ['ES'],
      isActive: true,
      rates: {
        create: {
          id: newId(),
          name: 'Estándar',
          type: 'FLAT',
          priceCents: 495,
          minDays: 2,
          maxDays: 5,
          isActive: true,
        },
      },
    },
  });
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

beforeAll(async () => {
  entorno = await crearEntorno();
});

afterAll(async () => {
  await entorno.app.close();
});

describe('Crear un pedido', () => {
  it('descuenta stock, calcula el IVA y devuelve un número correlativo', async () => {
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { variantId } = await sembrarCatalogo();

    const respuesta = await entorno.peticion<PedidoCreado>({
      metodo: 'POST',
      ruta: '/api/v1/orders',
      cuerpo: {
        email: 'cliente@ejemplo.es',
        locale: 'es',
        cartId: 'carrito-de-prueba',
        lineas: [{ variantId, quantity: 2 }],
        phone: '600123456',
        shippingAddress: direccion,
      },
    });

    expect(respuesta.estado).toBe(201);
    expect(respuesta.datos.number).toMatch(/^ES-\d{4}-\d{6}$/);

    // 2 × 49,99 € + 4,95 € de porte, con el IVA dentro del precio.
    expect(respuesta.datos.subtotalCents).toBe(9998);
    expect(respuesta.datos.shippingCents).toBe(495);
    expect(respuesta.datos.totalCents).toBe(10493);
    expect(respuesta.datos.taxCents).toBeGreaterThan(0);

    // El régimen fiscal se congela con el pedido: sin esto, la declaración
    // trimestral no cuadraría con las facturas ya emitidas.
    expect(respuesta.datos.taxRegime).toBe('INTERIOR');
    expect(respuesta.datos.taxCountry).toBe('ES');
  });

  it('dos pedidos seguidos no repiten número', async () => {
    // El correlativo salía de contar pedidos: en cuanto faltaba uno, el
    // siguiente chocaba con el índice único y el cliente no podía comprar.
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { variantId } = await sembrarCatalogo();

    const crear = () =>
      entorno.peticion<PedidoCreado>({
        metodo: 'POST',
        ruta: '/api/v1/orders',
        cuerpo: {
          email: 'cliente@ejemplo.es',
          locale: 'es',
          cartId: `carrito-${newId().slice(0, 8)}`,
          lineas: [{ variantId, quantity: 1 }],
          phone: '600123456',
          shippingAddress: direccion,
        },
      });

    const primero = await crear();
    const segundo = await crear();

    expect(primero.estado).toBe(201);
    expect(segundo.estado).toBe(201);
    expect(segundo.datos.number).not.toBe(primero.datos.number);
  });

  it('sigue funcionando aunque falte un número en la serie', async () => {
    // El caso que rompía de verdad: se borra un pedido y el contador deja de
    // coincidir con el último número usado.
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { variantId } = await sembrarCatalogo();

    const cuerpo = (cartId: string) => ({
      email: 'cliente@ejemplo.es',
      locale: 'es',
      cartId,
      lineas: [{ variantId, quantity: 1 }],
      phone: '600123456',
      shippingAddress: direccion,
    });

    const primero = await entorno.peticion<PedidoCreado>({
      metodo: 'POST',
      ruta: '/api/v1/orders',
      cuerpo: cuerpo('carrito-1'),
    });
    const segundo = await entorno.peticion<PedidoCreado>({
      metodo: 'POST',
      ruta: '/api/v1/orders',
      cuerpo: cuerpo('carrito-2'),
    });

    // Se borra el primero: quedan menos pedidos que el último número emitido.
    await entorno.prisma.client.order.delete({ where: { id: primero.datos.id } });

    const tercero = await entorno.peticion<PedidoCreado>({
      metodo: 'POST',
      ruta: '/api/v1/orders',
      cuerpo: cuerpo('carrito-3'),
    });

    expect(tercero.estado).toBe(201);
    expect(tercero.datos.number).not.toBe(segundo.datos.number);
  });

  it('rechaza el pedido si no hay stock suficiente', async () => {
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { variantId } = await sembrarCatalogo();

    const respuesta = await entorno.peticion<ErrorApi>({
      metodo: 'POST',
      ruta: '/api/v1/orders',
      cuerpo: {
        email: 'cliente@ejemplo.es',
        locale: 'es',
        cartId: 'carrito-sin-stock',
        lineas: [{ variantId, quantity: 99 }],
        phone: '600123456',
        shippingAddress: direccion,
      },
    });

    // Vender lo que no hay acaba en un pedido cobrado que no se puede servir.
    expect(respuesta.estado).toBe(400);
    expect(respuesta.datos.message).toContain('stock');
  });

  it('rechaza el pedido sin teléfono de contacto', async () => {
    // El transportista avisa por SMS o llamando, y varios proveedores devuelven
    // el pedido sin teléfono: el paquete se queda parado en el almacén y el
    // cliente no se entera hasta que reclama.
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { variantId } = await sembrarCatalogo();

    const respuesta = await entorno.peticion<ErrorApi>({
      metodo: 'POST',
      ruta: '/api/v1/orders',
      cuerpo: {
        email: 'cliente@ejemplo.es',
        locale: 'es',
        cartId: 'carrito-sin-telefono',
        lineas: [{ variantId, quantity: 1 }],
        shippingAddress: direccion,
      },
    });

    expect(respuesta.estado).toBe(400);
  });

  it('no acepta el precio que mande el navegador', async () => {
    // El precio se recalcula siempre en el servidor: aceptar el del cliente
    // sería dejarle elegir cuánto paga.
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { variantId } = await sembrarCatalogo();

    const respuesta = await entorno.peticion<PedidoCreado>({
      metodo: 'POST',
      ruta: '/api/v1/orders',
      cuerpo: {
        email: 'cliente@ejemplo.es',
        locale: 'es',
        cartId: 'carrito-listo',
        lineas: [{ variantId, quantity: 1, priceCents: 1 }],
        phone: '600123456',
        shippingAddress: direccion,
        totalCents: 1,
      },
    });

    expect(respuesta.estado).toBe(201);
    expect(respuesta.datos.subtotalCents).toBe(4999);
  });

  it('el seguimiento con una clave inventada no revela nada', async () => {
    const respuesta = await entorno.peticion({
      metodo: 'GET',
      ruta: '/api/v1/orders/track/clave-inventada-que-no-existe',
    });

    expect(respuesta.estado).toBe(404);
  });
});

/**
 * Marcar un pedido como pagado a mano.
 *
 * Existe porque el aviso de la pasarela puede no llegar nunca —el webhook sin dar
 * de alta, una transferencia— y entonces el dinero está en la cuenta y el pedido
 * se queda esperando para siempre.
 *
 * Lo que se comprueba no es que un campo cambie: es que el pedido siga **el mismo
 * camino** que con un cobro automático. Un pago marcado que no encola la compra
 * al proveedor es peor que no marcarlo, porque además nadie vuelve a mirarlo.
 */
describe('Pedidos hechos sin haber entrado', () => {
  /*
   * Comprar sin registrarse tiene que seguir siendo posible, así que un pedido
   * puede nacer sin dueño. Lo que no puede pasar es que quien SÍ tiene cuenta con
   * ese email no lo vea en «mis pedidos»: el pedido existe, le llega el correo, y
   * en su cuenta no está. Es lo que ocurrió con un pedido real.
   */
  const pedidoDe = async (email: string): Promise<PedidoCreado> => {
    const { variantId } = await sembrarCatalogo();
    const respuesta = await entorno.peticion<PedidoCreado>({
      metodo: 'POST',
      ruta: '/api/v1/orders',
      cuerpo: {
        email,
        locale: 'es',
        cartId: `carrito-${newId().slice(0, 8)}`,
        lineas: [{ variantId, quantity: 1 }],
        phone: '600123456',
        shippingAddress: direccion,
      },
    });
    expect(respuesta.estado).toBe(201);
    return respuesta.datos;
  };

  const mios = (token: string) =>
    entorno.peticion<{ items: { id: string }[] }>({
      metodo: 'GET',
      ruta: '/api/v1/orders/mine',
      token,
    });

  it('un pedido con sesión nace ya vinculado a la cuenta', async () => {
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { token, email } = await entorno.personal(['orders:read']);
    const { variantId } = await sembrarCatalogo();

    // Con token: es lo que la tienda no mandaba, y por eso el pedido salía
    // registrado como de invitado con el email correcto.
    const creado = await entorno.peticion<PedidoCreado>({
      metodo: 'POST',
      ruta: '/api/v1/orders',
      cuerpo: {
        email,
        locale: 'es',
        cartId: `carrito-${newId().slice(0, 8)}`,
        lineas: [{ variantId, quantity: 1 }],
        phone: '600123456',
        shippingAddress: direccion,
      },
      token,
    });

    expect(creado.estado).toBe(201);
    expect((await mios(token)).datos.items.map((o) => o.id)).toEqual([creado.datos.id]);
  });

  it('se adopta el pedido que se hizo sin sesión con el mismo email', async () => {
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { token, email } = await entorno.personal(['orders:read']);

    // Sin token: como el pedido que ya está en producción.
    const huerfano = await pedidoDe(email);

    const respuesta = await mios(token);
    expect(respuesta.datos.items.map((o) => o.id)).toEqual([huerfano.id]);

    // Y queda vinculado de verdad, no solo listado.
    const guardado = await entorno.prisma.client.order.findUniqueOrThrow({
      where: { id: huerfano.id },
      select: { userId: true },
    });
    expect(guardado.userId).not.toBeNull();
  });

  it('no se adoptan los pedidos de otra persona', async () => {
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { token } = await entorno.personal(['orders:read']);

    await pedidoDe('otra-persona@ejemplo.es');

    expect((await mios(token)).datos.items).toHaveLength(0);
  });

  it('se puede pedir otra vez el correo de verificación', async () => {
    /*
     * Sin esto, quien no recibiera el primero se quedaba SIN NINGUNA forma de
     * verificar su email —y de la verificación depende que la cuenta adopte los
     * pedidos hechos sin sesión—. Responde igual exista o no la cuenta: si
     * distinguiera, sería un comprobador gratuito de emails registrados.
     */
    await vaciarBase(entorno);
    const { email } = await entorno.personal(['orders:read']);

    const conCuenta = await entorno.peticion({
      metodo: 'POST',
      ruta: '/api/v1/auth/resend-verification',
      cuerpo: { email },
    });
    const sinCuenta = await entorno.peticion({
      metodo: 'POST',
      ruta: '/api/v1/auth/resend-verification',
      cuerpo: { email: 'no-existe@ejemplo.es' },
    });

    expect(conCuenta.estado).toBe(200);
    expect(sinCuenta.estado).toBe(200);
    expect(JSON.stringify(conCuenta.datos)).toBe(JSON.stringify(sinCuenta.datos));
  });

  it('sin el email verificado no se adopta nada', async () => {
    /*
     * Esta es la condición que impide que esto sea una forma de leer los pedidos
     * de otra persona: sin ella bastaría registrarse con su dirección para
     * quedarse con todo lo que hubiera comprado como invitada.
     */
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { token, userId, email } = await entorno.personal(['orders:read']);

    await entorno.prisma.client.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: null },
    });

    await pedidoDe(email);

    expect((await mios(token)).datos.items).toHaveLength(0);
  });
});

describe('Buscar en el listado', () => {
  it('encuentra por número de pedido y no solo por email', async () => {
    /*
     * El buscador del panel dice «Nº de pedido o email» y solo filtraba por
     * email: escribir el número no encontraba nada. Y buscar por número es justo
     * lo que se hace cuando un cliente pregunta por su pedido.
     */
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { variantId } = await sembrarCatalogo();
    const { token } = await entorno.personal(['orders:read']);

    const crear = (email: string) =>
      entorno.peticion<PedidoCreado>({
        metodo: 'POST',
        ruta: '/api/v1/orders',
        cuerpo: {
          email,
          locale: 'es',
          cartId: `carrito-${newId().slice(0, 8)}`,
          lineas: [{ variantId, quantity: 1 }],
          phone: '600123456',
          shippingAddress: direccion,
        },
      });

    const uno = (await crear('uno@ejemplo.es')).datos;
    await crear('dos@ejemplo.es');

    const porNumero = await entorno.peticion<{ items: { number: string }[] }>({
      metodo: 'GET',
      ruta: `/api/v1/orders?busqueda=${encodeURIComponent(uno.number)}`,
      token,
    });

    expect(porNumero.estado).toBe(200);
    expect(porNumero.datos.items.map((o) => o.number)).toEqual([uno.number]);

    // Y el email sigue funcionando por la misma vía.
    const porEmail = await entorno.peticion<{ items: { number: string }[] }>({
      metodo: 'GET',
      ruta: '/api/v1/orders?busqueda=dos@ejemplo.es',
      token,
    });
    expect(porEmail.datos.items).toHaveLength(1);
  });
});

describe('Marcar pagado a mano', () => {
  const crearPedido = async (): Promise<PedidoCreado> => {
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { variantId } = await sembrarCatalogo();

    const respuesta = await entorno.peticion<PedidoCreado>({
      metodo: 'POST',
      ruta: '/api/v1/orders',
      cuerpo: {
        email: 'cliente@ejemplo.es',
        locale: 'es',
        cartId: `carrito-${newId().slice(0, 8)}`,
        lineas: [{ variantId, quantity: 1 }],
        phone: '600123456',
        shippingAddress: direccion,
      },
    });

    expect(respuesta.estado).toBe(201);
    return respuesta.datos;
  };

  const marcar = (id: string, token: string, cuerpo: unknown) =>
    entorno.peticion({ metodo: 'POST', ruta: `/api/v1/orders/${id}/marcar-pagado`, cuerpo, token });

  it('deja el pedido pagado y encola el trabajo, como un webhook', async () => {
    const pedido = await crearPedido();
    const { token } = await entorno.personal(['orders:write', 'payments:write']);

    const respuesta = await marcar(pedido.id, token, {
      motivo: 'Transferencia recibida el 3 de agosto',
    });

    expect(respuesta.estado).toBe(200);

    const guardado = await entorno.prisma.client.order.findUniqueOrThrow({
      where: { id: pedido.id },
      select: { status: true, paymentStatus: true, paidAt: true },
    });
    expect(guardado.status).toBe('PAID');
    expect(guardado.paymentStatus).toBe('PAID');
    expect(guardado.paidAt).not.toBeNull();

    // Lo que de verdad importa: el trabajo queda encolado en el outbox. Sin
    // esto, el pedido consta pagado y nunca se compra al proveedor.
    const eventos = await entorno.prisma.client.outboxEvent.findMany({
      where: { aggregateId: pedido.id, eventType: 'order.paid' },
    });
    expect(eventos.length, 'no se ha encolado order.paid').toBe(1);
  });

  it('el cobro queda registrado como manual, no como si lo hubiera cobrado una pasarela', async () => {
    const pedido = await crearPedido();
    const { token } = await entorno.personal(['orders:write', 'payments:write']);

    await marcar(pedido.id, token, { motivo: 'Pagado en efectivo al recoger' });

    const pagos = await entorno.prisma.client.payment.findMany({ where: { orderId: pedido.id } });
    expect(pagos).toHaveLength(1);
    expect(pagos[0]).toMatchObject({
      provider: 'manual',
      status: 'PAID',
      receivedCents: pedido.totalCents,
    });
  });

  it('el historial dice que lo marcó una persona y por qué', async () => {
    /*
     * El historial no puede decir «pago confirmado» a secas: nadie lo confirmó
     * salvo una persona, y en seis meses el motivo es lo único que lo explica.
     */
    const pedido = await crearPedido();
    const { token } = await entorno.personal(['orders:write', 'payments:write']);

    await marcar(pedido.id, token, { motivo: 'Transferencia recibida el 3 de agosto' });

    const eventos = await entorno.prisma.client.orderEvent.findMany({
      where: { orderId: pedido.id, type: 'order.paid_manually' },
    });

    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.description).toContain('Transferencia recibida');
    expect(eventos[0]?.actorType).toBe('staff');
  });

  it('sin motivo no se guarda', async () => {
    const pedido = await crearPedido();
    const { token } = await entorno.personal(['orders:write', 'payments:write']);

    expect((await marcar(pedido.id, token, {})).estado).toBe(400);
    expect((await marcar(pedido.id, token, { motivo: 'ok' })).estado).toBe(400);
  });

  it('no se puede marcar dos veces', async () => {
    const pedido = await crearPedido();
    const { token } = await entorno.personal(['orders:write', 'payments:write']);

    await marcar(pedido.id, token, { motivo: 'Transferencia recibida' });
    const segunda = await marcar(pedido.id, token, { motivo: 'Otra vez' });

    expect(segunda.estado).toBe(400);
    expect((segunda.datos as unknown as ErrorApi).message).toContain('ya está');
  });

  it('quien gestiona pedidos no decide qué está cobrado', async () => {
    // El rol de pedidos tiene todo lo de pedidos y NO `payments:write`: declarar
    // que ha entrado dinero es otra decisión.
    const pedido = await crearPedido();
    const { token } = await entorno.personal(['orders:write', 'orders:fulfill']);

    expect((await marcar(pedido.id, token, { motivo: 'Me consta que pagó' })).estado).toBe(403);
  });

  it('un pedido cancelado no se puede marcar pagado', async () => {
    const pedido = await crearPedido();
    const { token } = await entorno.personal(['orders:write', 'payments:write', 'orders:cancel']);

    await entorno.peticion({
      metodo: 'POST',
      ruta: `/api/v1/orders/${pedido.id}/cancel`,
      cuerpo: { motivo: 'El cliente se arrepintió' },
      token,
    });

    const respuesta = await marcar(pedido.id, token, { motivo: 'Transferencia recibida' });
    expect(respuesta.estado).toBe(400);
  });
});

/**
 * Un pedido atascado en incidencia.
 *
 * Es el peor sitio donde puede quedarse un pedido: el cliente pagó, la compra al
 * proveedor no salió y el pedido no avanza ni retrocede. En producción pasó, y
 * al mirarlo no había NADA que hacer desde el panel: ni cancelar y devolver el
 * dinero, ni cerrar la incidencia diciendo que se compró a mano.
 *
 * Estas pruebas recorren las dos salidas.
 */
describe('Salidas de una incidencia', () => {
  /*
   * El personal se crea DESPUÉS de vaciar la base, no antes: `vaciarBase` borra
   * los usuarios, así que un token pedido antes deja de valer y todo responde
   * 401 —que es un fallo del montaje de la prueba, no del código—.
   */
  const pedidoPagado = async (
    permisos: string[],
  ): Promise<{ pedido: PedidoCreado; token: string }> => {
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { token } = await entorno.personal(permisos);
    const { variantId } = await sembrarCatalogo();

    const creado = await entorno.peticion<PedidoCreado>({
      metodo: 'POST',
      ruta: '/api/v1/orders',
      cuerpo: {
        email: 'cliente@ejemplo.es',
        locale: 'es',
        cartId: `carrito-${newId().slice(0, 8)}`,
        lineas: [{ variantId, quantity: 1 }],
        phone: '600123456',
        shippingAddress: direccion,
      },
    });
    expect(creado.estado).toBe(201);

    const pagado = await entorno.peticion({
      metodo: 'POST',
      ruta: `/api/v1/orders/${creado.datos.id}/marcar-pagado`,
      cuerpo: { motivo: 'Cobro comprobado para la prueba' },
      token,
    });
    expect(pagado.estado).toBe(200);

    return { pedido: creado.datos, token };
  };

  /** Lo deja como el pedido real: cobrado y en incidencia. */
  const enIncidencia = async (orderId: string) => {
    await entorno.prisma.client.order.update({
      where: { id: orderId },
      data: { status: 'FAILED' },
    });
  };

  it('cancelar un pedido en incidencia SÍ devuelve el dinero', async () => {
    /*
     * El fallo que esto arregla: el plan de cancelación decidía el reembolso por
     * una lista de estados que no incluía FAILED. Cancelar devolvía el pedido y
     * no el dinero, sin error y sin aviso.
     */
    const { pedido, token } = await pedidoPagado([
      'orders:write',
      'payments:write',
      'orders:cancel',
      'orders:read',
    ]);
    await enIncidencia(pedido.id);

    const respuesta = await entorno.peticion<{ reembolsoSolicitado: boolean }>({
      metodo: 'POST',
      ruta: `/api/v1/orders/${pedido.id}/cancel`,
      cuerpo: { motivo: 'El proveedor ha subido el precio y no compensa' },
      token,
    });

    expect(respuesta.estado).toBe(200);
    expect(respuesta.datos.reembolsoSolicitado, 'no se ha pedido el reembolso').toBe(true);

    // El reembolso se encola: si la pasarela tarda, el pedido ya está cancelado
    // y se reintenta solo.
    const encolado = await entorno.prisma.client.outboxEvent.findFirst({
      where: { aggregateId: pedido.id, eventType: 'order.refund_requested' },
    });
    expect(encolado, 'el reembolso no se ha encolado').not.toBeNull();

    const guardado = await entorno.prisma.client.order.findUniqueOrThrow({
      where: { id: pedido.id },
      select: { status: true },
    });
    expect(guardado.status).toBe('CANCELLED');
  });

  it('un pedido en incidencia SIN cobrar no reembolsa nada', async () => {
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { token } = await entorno.personal(['orders:cancel', 'orders:read']);
    const { variantId } = await sembrarCatalogo();

    const creado = await entorno.peticion<PedidoCreado>({
      metodo: 'POST',
      ruta: '/api/v1/orders',
      cuerpo: {
        email: 'cliente@ejemplo.es',
        locale: 'es',
        cartId: `carrito-${newId().slice(0, 8)}`,
        lineas: [{ variantId, quantity: 1 }],
        phone: '600123456',
        shippingAddress: direccion,
      },
    });
    await enIncidencia(creado.datos.id);

    const respuesta = await entorno.peticion<{ reembolsoSolicitado: boolean }>({
      metodo: 'POST',
      ruta: `/api/v1/orders/${creado.datos.id}/cancel`,
      cuerpo: { motivo: 'Nunca llegó a pagarse' },
      token,
    });

    expect(respuesta.estado).toBe(200);
    expect(respuesta.datos.reembolsoSolicitado).toBe(false);
  });

  it('se cierra diciendo que se compró a mano, con su referencia', async () => {
    const { pedido, token } = await pedidoPagado([
      'orders:write',
      'payments:write',
      'orders:fulfill',
      'orders:read',
    ]);
    await enIncidencia(pedido.id);

    // Un sub-pedido fallido, como el que deja la comprobación de coste.
    const proveedor = await entorno.prisma.client.supplier.create({
      data: { id: newId(), key: 'aliexpress', name: 'AliExpress', isActive: true },
    });
    const sub = await entorno.prisma.client.supplierOrder.create({
      data: {
        id: newId(),
        orderId: pedido.id,
        supplierId: proveedor.id,
        status: 'FAILED',
        needsReview: true,
        lastError: 'El coste ha subido un 102 %',
        costTotalCents: 1399,
        idempotencyKey: `prueba-${newId().slice(0, 8)}`,
        shippingSnapshot: direccion,
        linesSnapshot: [{ externalProductId: '1005008382946674', quantity: 1 }],
      },
    });

    const respuesta = await entorno.peticion<{ ok: boolean; mensaje: string }>({
      metodo: 'POST',
      ruta: `/api/v1/orders/incidencias/${sub.id}/resolver`,
      cuerpo: { referencia: '8171234567890123' },
      token,
    });

    expect(respuesta.estado).toBe(200);
    expect(respuesta.datos.ok).toBe(true);

    const guardado = await entorno.prisma.client.supplierOrder.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(guardado).toMatchObject({
      status: 'PLACED',
      needsReview: false,
      externalOrderId: '8171234567890123',
    });

    // Y el pedido avanza: si no, el cliente seguiría viendo «incidencia» con la
    // mercancía ya comprada.
    const pedidoGuardado = await entorno.prisma.client.order.findUniqueOrThrow({
      where: { id: pedido.id },
      select: { status: true },
    });
    expect(pedidoGuardado.status).toBe('SENT_TO_SUPPLIER');

    // Desaparece de la cola.
    const cola = await entorno.peticion<unknown[]>({
      metodo: 'GET',
      ruta: '/api/v1/orders/incidencias',
      token,
    });
    expect(cola.datos).toHaveLength(0);
  });

  it('un sub-pedido fallido SIEMPRE sale en la cola, sepamos o no por qué', async () => {
    /*
     * Esto es lo que dejó un pedido invisible en producción.
     *
     * La cola filtraba por `needsReview`, y esa marca solo se ponía para cuatro
     * tipos de error conocidos. AliExpress rechazó un pedido con un error que no
     * estaba en la lista: el sub-pedido quedó FALLIDO, con el cliente cobrado, y
     * no salía en ninguna pantalla. El botón de reintentar vive en esta cola, así
     * que tampoco había forma de reintentarlo.
     */
    // `marcar-pagado` exige sus dos permisos: el helper deja el pedido cobrado.
    const { pedido, token } = await pedidoPagado([
      'orders:write',
      'payments:write',
      'orders:fulfill',
      'orders:read',
    ]);

    const proveedor = await entorno.prisma.client.supplier.create({
      data: { id: newId(), key: 'aliexpress', name: 'AliExpress', isActive: true },
    });
    await entorno.prisma.client.supplierOrder.create({
      data: {
        id: newId(),
        orderId: pedido.id,
        supplierId: proveedor.id,
        status: 'FAILED',
        // Sin marcar para revisión: es justo el caso que se perdía.
        needsReview: false,
        lastError: 'AliExpress ha rechazado el pedido: sin detalle',
        lastErrorType: 'DESCONOCIDO',
        costTotalCents: 1399,
        idempotencyKey: `prueba-${newId().slice(0, 8)}`,
        shippingSnapshot: direccion,
        linesSnapshot: [],
      },
    });

    const cola = await entorno.peticion<{ numeroPedido: string }[]>({
      metodo: 'GET',
      ruta: '/api/v1/orders/incidencias',
      token,
    });

    expect(cola.datos).toHaveLength(1);
    expect(cola.datos[0]?.numeroPedido).toBe(pedido.number);
  });

  it('sin la referencia del proveedor no se cierra', async () => {
    // Sin ella el pedido quedaría dado por comprado sin forma de comprobarlo ni
    // de seguir el paquete.
    const { token } = await entorno.personal(['orders:fulfill']);

    const respuesta = await entorno.peticion({
      metodo: 'POST',
      ruta: '/api/v1/orders/incidencias/inventado/resolver',
      cuerpo: { referencia: '' },
      token,
    });

    expect(respuesta.estado).toBe(400);
  });
});

/**
 * Lo que se puede leer con el enlace del pedido, y nada más.
 *
 * La página de seguimiento no pide contraseña: quien tenga el enlace, entra.
 * El historial se servía con la descripción del evento interno tal cual, y esas
 * descripciones son el cuaderno del negocio. Con un pedido real se leía a qué
 * proveedor se había mandado y con qué referencia, lo que ese proveedor nos
 * cobró frente a lo previsto —o sea, el margen— y con qué pasarela se lanzó el
 * cobro.
 *
 * Esta prueba va contra la respuesta entera, no contra un campo. Es a propósito:
 * el fallo original no fue escribir un dato donde no tocaba, fue que un campo
 * pensado para dentro salió por una puerta pública. Comprobar campo a campo
 * volvería a dejar pasar el siguiente.
 */
describe('Seguimiento público', () => {
  /** Un pedido con el historial interno más comprometedor que se puede tener. */
  const pedidoConTrapos = async (): Promise<string> => {
    await vaciarBase(entorno);
    await sembrarEnvios();
    const { variantId } = await sembrarCatalogo();

    const creado = await entorno.peticion<PedidoCreado>({
      metodo: 'POST',
      ruta: '/api/v1/orders',
      cuerpo: {
        email: 'cliente@ejemplo.es',
        locale: 'es',
        cartId: `carrito-${newId().slice(0, 8)}`,
        lineas: [{ variantId, quantity: 1 }],
        phone: '600123456',
        shippingAddress: direccion,
      },
    });
    expect(creado.estado).toBe(201);

    // Los mismos eventos que escribe la aplicación de verdad, copiados de los
    // que había en la base de desarrollo.
    await entorno.prisma.client.orderEvent.createMany({
      data: [
        {
          id: newId(),
          orderId: creado.datos.id,
          type: 'payment.created',
          description: 'Cobro iniciado con Stripe',
          actorType: 'system',
        },
        {
          id: newId(),
          orderId: creado.datos.id,
          type: 'order.status_changed',
          description: 'Pago confirmado → Enviado al proveedor',
          actorType: 'system',
          metadata: { desde: 'PAID', hasta: 'SENT_TO_SUPPLIER' },
        },
        {
          id: newId(),
          orderId: creado.datos.id,
          type: 'supplier_order.placed',
          description: 'Enviado a AliExpress · referencia AE-88231190',
          actorType: 'system',
        },
        {
          id: newId(),
          orderId: creado.datos.id,
          type: 'supplier.cost_reconciled',
          description: 'El proveedor ha cobrado 12,40 € (se esperaban 9,90 €).',
          actorType: 'system',
        },
      ],
    });

    // El pedido se deja donde dice su historial: si el evento cuenta que pasó
    // a «enviado al proveedor», el estado tiene que ser ese. Con el pedido en
    // otro estado la prueba comprobaría una respuesta que no existe.
    const pedido = await entorno.prisma.client.order.update({
      where: { id: creado.datos.id },
      data: { status: 'SENT_TO_SUPPLIER' },
      select: { publicToken: true },
    });

    return pedido.publicToken;
  };

  const seguir = (token: string) =>
    entorno.peticion<Record<string, unknown>>({
      metodo: 'GET',
      ruta: `/api/v1/orders/track/${token}`,
    });

  it('no dice quién nos sirve, cuánto nos cuesta ni con quién cobramos', async () => {
    const respuesta = await seguir(await pedidoConTrapos());

    expect(respuesta.estado).toBe(200);
    const entera = JSON.stringify(respuesta.datos).toLowerCase();

    for (const secreto of [
      'aliexpress',
      'ae-88231190',
      'stripe',
      'proveedor',
      'supplier',
      '12,40',
      'cobrado',
    ]) {
      expect(entera, `"${secreto}" no puede salir de aquí`).not.toContain(secreto);
    }
  });

  it('cuenta el pedido en hitos, no en frases nuestras', async () => {
    const respuesta = await seguir(await pedidoConTrapos());

    const historial = respuesta.datos['historial'] as { clave: string }[];

    // El pedido se creó y pasó a «enviado al proveedor»: para el cliente son
    // dos cosas, «realizado» y «preparando».
    expect(historial.map((h) => h.clave)).toEqual(['realizado', 'preparando']);

    // Y ni rastro del campo por el que salía todo.
    expect(Object.keys(historial[0] ?? {})).toEqual(['clave', 'createdAt']);
  });

  it('el estado que se publica tampoco nombra al proveedor', async () => {
    const respuesta = await seguir(await pedidoConTrapos());

    // Por dentro está en SENT_TO_SUPPLIER; hacia fuera, en preparación.
    expect(respuesta.datos['estado']).toBe('PREPARING');
  });
});
