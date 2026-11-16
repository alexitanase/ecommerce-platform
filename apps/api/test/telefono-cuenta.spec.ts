import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { crearEntorno, vaciarBase, CONTRASENA_DE_PRUEBAS, type EntornoPruebas } from './entorno.js';

/**
 * El teléfono del cliente: que se guarde y que se vea.
 *
 * Se daba por roto —«el teléfono no se guarda»— y en realidad se guardaba: lo
 * que faltaba eran los dos extremos del viaje.
 *
 *  · **De vuelta.** `PATCH /users/me` escribía `users.phone` sin problema, pero
 *    el teléfono no viajaba en la sesión, así que el formulario de perfil
 *    aparecía vacío al volver a entrar. Quien lo había guardado veía el campo en
 *    blanco y concluía, con razón, que no se había guardado.
 *  · **Del checkout a la ficha.** El pedido guardaba su propio teléfono y ahí se
 *    quedaba. Quien compraba y luego entraba en «mi cuenta» no lo encontraba.
 *
 * Ninguno de los dos lo ve un test unitario: el primero depende de qué campos
 * selecciona la consulta de sesión y el segundo de una escritura dentro de la
 * transacción del pedido.
 */

let entorno: EntornoPruebas;

/** Lo que devuelven registro, login y refresco. */
interface Sesion {
  accessToken: string;
  user: { id: string; email: string; phone: string | null };
}

/** Catálogo mínimo para poder comprar: un producto activo con stock. */
async function sembrarCatalogo(): Promise<string> {
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

  return variantId;
}

/** Zona de envío para España; sin ella el checkout rechaza cualquier dirección. */
async function sembrarEnvios(): Promise<void> {
  await entorno.prisma.client.shippingZone.create({
    data: {
      id: newId(),
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

/** Un cliente recién registrado, con su sesión abierta. */
async function cliente(): Promise<{ id: string; email: string; token: string }> {
  const email = `cliente-${newId().slice(0, 8)}@ejemplo.es`;

  const registro = await entorno.peticion<Sesion>({
    metodo: 'POST',
    ruta: '/api/v1/auth/register',
    cuerpo: { email, password: CONTRASENA_DE_PRUEBAS, marketingConsent: false },
  });

  expect(registro.estado, JSON.stringify(registro.datos)).toBe(201);

  return { id: registro.datos.user.id, email, token: registro.datos.accessToken };
}

/** El teléfono que tiene guardado la cuenta ahora mismo. */
async function telefonoGuardado(userId: string): Promise<string | null> {
  const usuario = await entorno.prisma.client.user.findUniqueOrThrow({
    where: { id: userId },
    select: { phone: true },
  });

  return usuario.phone;
}

const comprar = (token: string, variantId: string, phone: string) =>
  entorno.peticion<{ id: string }>({
    metodo: 'POST',
    ruta: '/api/v1/orders',
    token,
    cuerpo: {
      email: 'cliente@ejemplo.es',
      locale: 'es',
      cartId: `carrito-${newId().slice(0, 8)}`,
      lineas: [{ variantId, quantity: 1 }],
      phone,
      shippingAddress: direccion,
    },
  });

beforeAll(async () => {
  entorno = await crearEntorno();
}, 60_000);

afterAll(async () => {
  await entorno.app.close();
});

beforeEach(async () => {
  await vaciarBase(entorno);
});

describe('Guardar el teléfono desde «mi cuenta»', () => {
  it('lo escribe y lo devuelve en la sesión, para que el formulario pueda mostrarlo', async () => {
    const { email, token } = await cliente();

    const guardado = await entorno.peticion({
      metodo: 'PATCH',
      ruta: '/api/v1/users/me',
      token,
      cuerpo: { phone: '600111222' },
    });

    expect(guardado.estado).toBe(200);

    // La parte que faltaba: al volver a entrar, la sesión tiene que traer el
    // teléfono. Sin esto el campo salía vacío y parecía no haberse guardado.
    const sesion = await entorno.peticion<Sesion>({
      metodo: 'POST',
      ruta: '/api/v1/auth/login',
      cuerpo: { email, password: CONTRASENA_DE_PRUEBAS },
    });

    expect(sesion.estado).toBe(200);
    expect(sesion.datos.user.phone).toBe('600111222');
  });
});

describe('El teléfono del checkout', () => {
  it('rellena el de la cuenta cuando estaba vacío', async () => {
    await sembrarEnvios();
    const variantId = await sembrarCatalogo();
    const { id, token } = await cliente();

    expect(await telefonoGuardado(id)).toBeNull();

    const pedido = await comprar(token, variantId, '600123456');
    expect(pedido.estado, JSON.stringify(pedido.datos)).toBe(201);

    expect(await telefonoGuardado(id)).toBe('600123456');
  });

  it('no sobrescribe el que la cuenta ya tenía', async () => {
    // Un pedido enviado a la dirección del trabajo lleva el teléfono de la
    // oficina. Ese número vale para ese envío y no debe cambiar el de la cuenta.
    await sembrarEnvios();
    const variantId = await sembrarCatalogo();
    const { id, token } = await cliente();

    await entorno.peticion({
      metodo: 'PATCH',
      ruta: '/api/v1/users/me',
      token,
      cuerpo: { phone: '600111222' },
    });

    const pedido = await comprar(token, variantId, '699999999');
    expect(pedido.estado, JSON.stringify(pedido.datos)).toBe(201);

    expect(await telefonoGuardado(id)).toBe('600111222');
  });

  it('queda guardado en el pedido, que es la copia que vale para ese envío', async () => {
    await sembrarEnvios();
    const variantId = await sembrarCatalogo();
    const { token } = await cliente();

    const pedido = await comprar(token, variantId, '600123456');
    expect(pedido.estado).toBe(201);

    const guardado = await entorno.prisma.client.order.findUniqueOrThrow({
      where: { id: pedido.datos.id },
      select: { phone: true },
    });

    expect(guardado.phone).toBe('600123456');
  });
});
