import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { crearEntorno, vaciarBase, CONTRASENA_DE_PRUEBAS, type EntornoPruebas } from './entorno.js';

/**
 * La ficha del cliente y su gestión desde el panel.
 *
 * Lo que se prueba aquí no es que la pantalla pinte: es lo que la pantalla no
 * puede comprobar por su cuenta y que, si se rompe, se rompe en silencio.
 *
 *  · **Que el hash de la contraseña no sale.** Hace falta leerlo para saber si
 *    la cuenta tiene acceso con contraseña, así que entra en la consulta y se
 *    descarta antes de responder. Un `...cliente` de más lo publicaría en la
 *    interfaz del panel, y de ahí a las herramientas de red de cualquiera.
 *  · **Que atención al cliente no llega al personal.** Los endpoints de cliente
 *    piden `customers:write`; si aceptaran el id de un administrador, ese
 *    permiso serviría para echarlo del panel o bloquearle la cuenta.
 */

let entorno: EntornoPruebas;

interface Ficha {
  password?: string;
  acceso: { directo: boolean; proveedores: string[] };
  sesiones: { id: string }[];
  carritos: { id: string; unidades: number; totalCents: number; lineas: { nombre: string }[] }[];
  isActive: boolean;
}

/** Una variante que poder meter en un carrito. */
async function sembrarVariante(): Promise<string> {
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
          stock: 10,
          isDefault: true,
        },
      },
    },
  });

  return variantId;
}

/** Un cliente con contraseña, y su sesión abierta. */
async function cliente(): Promise<{ id: string; email: string }> {
  const id = newId();
  const email = `cliente-${id.slice(0, 8)}@ejemplo.es`;

  await entorno.peticion({
    metodo: 'POST',
    ruta: '/api/v1/auth/register',
    cuerpo: { email, password: CONTRASENA_DE_PRUEBAS },
  });

  const creado = await entorno.prisma.client.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!creado) throw new Error('El registro de prueba no ha creado el cliente');

  return { id: creado.id, email };
}

const verFicha = (id: string, token: string) =>
  entorno.peticion<Ficha>({
    metodo: 'GET',
    ruta: `/api/v1/users/customers/${id}`,
    token,
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

describe('Ficha del cliente', () => {
  it('no publica el hash de la contraseña', async () => {
    const { id } = await cliente();
    const { token } = await entorno.personal(['customers:read']);

    const { estado, datos } = await verFicha(id, token);

    expect(estado).toBe(200);
    expect(datos.password).toBeUndefined();
    expect(JSON.stringify(datos)).not.toContain('$argon2');
  });

  it('dice cómo accede: con contraseña o por un acceso social', async () => {
    // «No me deja entrar con mi contraseña» tiene otra respuesta si la cuenta se
    // creó con Google y nunca tuvo contraseña. Antes no se podía saber desde el
    // panel.
    const { id } = await cliente();
    const { token } = await entorno.personal(['customers:read']);

    expect((await verFicha(id, token)).datos.acceso).toEqual({
      directo: true,
      proveedores: [],
      identidades: [],
    });

    await entorno.prisma.client.userIdentity.create({
      data: { id: newId(), userId: id, provider: 'google', providerUserId: 'g-123' },
    });

    expect((await verFicha(id, token)).datos.acceso.proveedores).toEqual(['google']);
  });

  it('trae los carritos que se quedaron sin comprar', async () => {
    const { id } = await cliente();
    const { token } = await entorno.personal(['customers:read']);

    const variantId = await sembrarVariante();

    await entorno.prisma.client.cart.create({
      data: {
        id: newId(),
        token: newId(),
        userId: id,
        locale: 'es',
        currency: 'EUR',
        expiresAt: new Date(Date.now() + 86_400_000),
        items: {
          create: { id: newId(), variantId, quantity: 3, priceWhenAddedCents: 1000 },
        },
      },
    });

    const { carritos } = (await verFicha(id, token)).datos;

    expect(carritos).toHaveLength(1);
    expect(carritos[0]?.unidades).toBe(3);
    // Con el precio al que se añadió, no con el de hoy: si ha cambiado, la
    // conversación de venta no cuadra.
    expect(carritos[0]?.totalCents).toBe(3000);
    // El nombre y no el SKU: `translations[0]` devolvía la traducción que
    // quisiera la base de datos y el panel enseñaba el nombre en otro idioma.
    expect(carritos[0]?.lineas[0]?.nombre).toBe('Botas de prueba');
  });

  it('un carrito ya convertido en pedido no cuenta como abandonado', async () => {
    const { id } = await cliente();
    const { token } = await entorno.personal(['customers:read']);
    const variantId = await sembrarVariante();

    await entorno.prisma.client.cart.create({
      data: {
        id: newId(),
        token: newId(),
        userId: id,
        locale: 'es',
        currency: 'EUR',
        expiresAt: new Date(Date.now() + 86_400_000),
        convertedAt: new Date(),
        items: {
          create: { id: newId(), variantId, quantity: 1, priceWhenAddedCents: 1000 },
        },
      },
    });

    expect((await verFicha(id, token)).datos.carritos).toHaveLength(0);
  });
});

describe('Gestión de la cuenta de un cliente', () => {
  it('cerrar sus sesiones las cierra de verdad', async () => {
    const { id } = await cliente();
    const { token } = await entorno.personal(['customers:read', 'customers:write']);

    expect((await verFicha(id, token)).datos.sesiones.length).toBeGreaterThan(0);

    const cerrar = await entorno.peticion<{ cerradas: number }>({
      metodo: 'DELETE',
      ruta: `/api/v1/users/customers/${id}/sessions`,
      token,
    });

    expect(cerrar.estado).toBe(200);
    expect(cerrar.datos.cerradas).toBeGreaterThan(0);
    expect((await verFicha(id, token)).datos.sesiones).toHaveLength(0);
  });

  it('bloquear la cuenta la desactiva y echa a quien esté dentro', async () => {
    // Sin cerrar las sesiones, quien esté dentro sigue comprando hasta que
    // caduque su token.
    const { id } = await cliente();
    const { token } = await entorno.personal(['customers:read', 'customers:write']);

    const respuesta = await entorno.peticion({
      metodo: 'PATCH',
      ruta: `/api/v1/users/customers/${id}/status`,
      cuerpo: { isActive: false },
      token,
    });

    expect(respuesta.estado).toBe(200);

    const ficha = (await verFicha(id, token)).datos;
    expect(ficha.isActive).toBe(false);
    expect(ficha.sesiones).toHaveLength(0);
  });

  it('con `customers:write` no se puede tocar una cuenta del personal', async () => {
    /*
     * El cerrojo que mantiene separadas las dos gestiones.
     *
     * Sin él, quien atiende a clientes podría cerrarle la sesión —o bloquear la
     * cuenta— a un administrador usando su id en el endpoint de clientes: es
     * justo la escalada de privilegios que la separación de permisos existe
     * para impedir.
     */
    const atencion = await entorno.personal(['customers:read', 'customers:write']);
    const otroAdmin = await entorno.personal(['orders:read']);

    const sesiones = await entorno.peticion({
      metodo: 'DELETE',
      ruta: `/api/v1/users/customers/${otroAdmin.userId}/sessions`,
      token: atencion.token,
    });
    expect(sesiones.estado).toBe(404);

    const estado = await entorno.peticion({
      metodo: 'PATCH',
      ruta: `/api/v1/users/customers/${otroAdmin.userId}/status`,
      cuerpo: { isActive: false },
      token: atencion.token,
    });
    expect(estado.estado).toBe(404);

    // Y sigue dentro: lo que se ha rechazado es la acción, no solo la respuesta.
    const sigue = await entorno.prisma.client.user.findUnique({
      where: { id: otroAdmin.userId },
      select: { isActive: true },
    });
    expect(sigue?.isActive).toBe(true);
  });

  it('sin `customers:write` no se cierran sesiones de nadie', async () => {
    const { id } = await cliente();
    const soloLectura = await entorno.personal(['customers:read']);

    const respuesta = await entorno.peticion({
      metodo: 'DELETE',
      ruta: `/api/v1/users/customers/${id}/sessions`,
      token: soloLectura.token,
    });

    expect(respuesta.estado).toBe(403);
  });
});
