import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { crearEntorno, vaciarBase, type EntornoPruebas, type ErrorApi } from './entorno.js';

/**
 * Cambiar el precio de un producto.
 *
 * Hasta ahora no se podía: se creaba con su precio y no había forma de
 * tocarlo. En dropshipping el precio es la palanca principal —el proveedor
 * sube el suyo, entra la competencia, se lanza una promoción— y la única
 * salida era borrar el producto y reimportarlo, perdiendo su histórico y su
 * URL.
 *
 * Lo que se comprueba aquí no es que el `UPDATE` funcione, sino las tres
 * barreras que impiden que un cambio de precio haga daño: que no se pueda
 * anunciar un descuento falso, que un producto publicado no se quede a cero, y
 * que cada cambio deje rastro en el histórico —de ahí sale el precio más bajo
 * de los últimos 30 días, que es lo único que la ley permite anunciar como
 * precio anterior—.
 */

let entorno: EntornoPruebas;

interface VarianteGuardada {
  id: string;
  sku: string;
  priceCents: number;
  compareAtCents: number | null;
  costCents: number | null;
}

/** Producto con una variante, en el estado que se pida. */
async function sembrarProducto(
  estado: 'DRAFT' | 'ACTIVE' = 'DRAFT',
): Promise<{ productId: string; variantId: string }> {
  const productId = newId();
  const variantId = newId();

  await entorno.prisma.client.product.create({
    data: {
      id: productId,
      handle: `producto-${productId.slice(0, 8)}`,
      status: estado,
      ...(estado === 'ACTIVE' ? { publishedAt: new Date() } : {}),
      taxRate: 21,
      translations: {
        create: {
          id: newId(),
          locale: 'es',
          name: 'Botas de prueba',
          slug: `botas-${productId.slice(0, 8)}`,
        },
      },
      variants: {
        create: {
          id: variantId,
          sku: `SKU-${productId.slice(0, 8)}`,
          priceCents: 4999,
          costCents: 2000,
          stock: 10,
          isDefault: true,
        },
      },
    },
  });

  return { productId, variantId };
}

const cambiar = <T>(variantId: string, cambios: unknown, token: string) =>
  entorno.peticion<T>({
    metodo: 'PATCH',
    ruta: `/api/v1/catalog/products/variants/${variantId}`,
    token,
    cuerpo: cambios,
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

describe('Cambiar el precio', () => {
  it('lo guarda y lo anota en el histórico', async () => {
    const { token } = await entorno.personal(['products:write']);
    const { variantId } = await sembrarProducto();

    const respuesta = await cambiar<VarianteGuardada>(variantId, { priceCents: 5999 }, token);

    expect(respuesta.estado).toBe(200);
    expect(respuesta.datos.priceCents).toBe(5999);

    // Sin este registro no se puede acreditar el precio anterior, y anunciar
    // una rebaja sin poder acreditarlo es una infracción.
    const historico = await entorno.prisma.client.priceHistory.findMany({
      where: { variantId },
      orderBy: { validFrom: 'desc' },
    });

    expect(historico[0]?.priceCents).toBe(5999);
    expect(historico[0]?.source).toBe('manual');
  });

  it('guardar el mismo precio no ensucia el histórico', async () => {
    // Registrar cada guardado movería la fecha de inicio del precio vigente y
    // desplazaría la ventana de 30 días con cada clic.
    const { token } = await entorno.personal(['products:write']);
    const { variantId } = await sembrarProducto();

    await cambiar(variantId, { priceCents: 4999 }, token);

    expect(await entorno.prisma.client.priceHistory.count({ where: { variantId } })).toBe(0);
  });

  it('cambiar solo el coste no toca el precio ni el histórico', async () => {
    const { token } = await entorno.personal(['products:write']);
    const { variantId } = await sembrarProducto();

    const respuesta = await cambiar<VarianteGuardada>(variantId, { costCents: 2500 }, token);

    expect(respuesta.datos.costCents).toBe(2500);
    expect(respuesta.datos.priceCents).toBe(4999);
    expect(await entorno.prisma.client.priceHistory.count({ where: { variantId } })).toBe(0);
  });
});

describe('Lo que no se deja hacer', () => {
  it('un precio tachado menor que el real se rechaza', async () => {
    // Anunciar un "antes" más barato que el "ahora" no confunde: engaña, y con
    // la directiva Omnibus tiene sanción.
    const { token } = await entorno.personal(['products:write']);
    const { variantId } = await sembrarProducto();

    const respuesta = await cambiar<ErrorApi>(variantId, { compareAtCents: 1000 }, token);

    expect(respuesta.estado).toBe(400);
    expect(respuesta.datos.message).toContain('mayor');
  });

  it('tampoco si es igual al precio de venta', async () => {
    const { token } = await entorno.personal(['products:write']);
    const { variantId } = await sembrarProducto();

    expect((await cambiar<ErrorApi>(variantId, { compareAtCents: 4999 }, token)).estado).toBe(400);
  });

  it('un producto publicado no puede quedarse a cero euros', async () => {
    // Sería regalarlo, y además pagando el envío.
    const { token } = await entorno.personal(['products:write']);
    const { variantId } = await sembrarProducto('ACTIVE');

    const respuesta = await cambiar<ErrorApi>(variantId, { priceCents: 0 }, token);

    expect(respuesta.estado).toBe(400);
    expect(respuesta.datos.message).toContain('cero');
  });

  it('en borrador sí se admite el cero, que es un paso intermedio', async () => {
    const { token } = await entorno.personal(['products:write']);
    const { variantId } = await sembrarProducto('DRAFT');

    expect((await cambiar(variantId, { priceCents: 0 }, token)).estado).toBe(200);
  });

  it('un SKU que ya usa otra variante se rechaza', async () => {
    // El SKU identifica la variante en los pedidos y frente al proveedor:
    // repetido, dos productos distintos se confundirían al sincronizar.
    const { token } = await entorno.personal(['products:write']);
    const primero = await sembrarProducto();
    const segundo = await sembrarProducto();

    const ocupado = await entorno.prisma.client.productVariant.findUniqueOrThrow({
      where: { id: primero.variantId },
      select: { sku: true },
    });

    const respuesta = await cambiar<ErrorApi>(segundo.variantId, { sku: ocupado.sku }, token);

    expect(respuesta.estado).toBe(400);
    expect(respuesta.datos.message).toContain('SKU');
  });

  it('conservar su propio SKU no se toma por duplicado', async () => {
    const { token } = await entorno.personal(['products:write']);
    const { variantId } = await sembrarProducto();

    const actual = await entorno.prisma.client.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { sku: true },
    });

    expect((await cambiar(variantId, { sku: actual.sku, priceCents: 5500 }, token)).estado).toBe(
      200,
    );
  });

  it('sin permiso de escritura no se puede tocar el precio', async () => {
    const { token } = await entorno.personal(['products:read']);
    const { variantId } = await sembrarProducto();

    expect((await cambiar(variantId, { priceCents: 1 }, token)).estado).toBe(403);
  });

  it('una variante que no existe da 404, no un 500', async () => {
    const { token } = await entorno.personal(['products:write']);

    expect((await cambiar(newId(), { priceCents: 1000 }, token)).estado).toBe(404);
  });
});

/**
 * El panel tiene que poder volver a leer lo que acaba de escribir.
 *
 * Este es el fallo que se reportó como «el precio tachado no se guarda». Se
 * guardaba: lo que no se podía era volver a leerlo. `detalleCompleto` lo
 * comparten la tienda y el panel, y sustituía el precio tachado guardado por el
 * que la directiva Ómnibus permite anunciar —que es `null` mientras no haya
 * descuento anunciable—. El editor leía ese `null`, pintaba el campo vacío, y
 * desde el otro lado de la pantalla eso es indistinguible de no haberse guardado.
 */
describe('El precio tachado que ve el panel', () => {
  it('se devuelve aunque la ley no permita anunciarlo todavía', async () => {
    const { productId, variantId } = await sembrarProducto();
    const admin = await entorno.personal(['products:read', 'products:write']);

    // 59,99 € tachando 49,99 €: guardado válido y mayor que el precio de venta.
    expect((await cambiar(variantId, { compareAtCents: 5999 }, admin.token)).estado).toBe(200);

    const ficha = await entorno.peticion<{
      variants: {
        id: string;
        compareAtCents: number | null;
        compareAtGuardadoCents: number | null;
      }[];
    }>({
      metodo: 'GET',
      ruta: `/api/v1/catalog/products/${productId}`,
      token: admin.token,
    });

    expect(ficha.estado).toBe(200);
    const variante = ficha.datos.variants.find((v) => v.id === variantId);

    // Lo guardado vuelve tal cual: es lo que el editor tiene que poder editar.
    expect(variante?.compareAtGuardadoCents).toBe(5999);

    /*
     * Y lo anunciable sigue decidiéndolo la ley, no este campo. Sin histórico de
     * bajadas no hay descuento que anunciar, así que la tienda no tacha nada.
     * Los dos números conviven y significan cosas distintas.
     */
    expect(variante?.compareAtCents).toBeNull();
  });

  it('vaciarlo lo deja vacío, y eso también se puede leer', async () => {
    const { productId, variantId } = await sembrarProducto();
    const admin = await entorno.personal(['products:read', 'products:write']);

    await cambiar(variantId, { compareAtCents: 5999 }, admin.token);
    expect((await cambiar(variantId, { compareAtCents: null }, admin.token)).estado).toBe(200);

    const ficha = await entorno.peticion<{
      variants: { id: string; compareAtGuardadoCents: number | null }[];
    }>({
      metodo: 'GET',
      ruta: `/api/v1/catalog/products/${productId}`,
      token: admin.token,
    });

    expect(ficha.datos.variants.find((v) => v.id === variantId)?.compareAtGuardadoCents).toBeNull();
  });

  it('no se le filtra al visitante, que solo debe ver el precio tachado legal', async () => {
    const { productId, variantId } = await sembrarProducto('ACTIVE');
    const admin = await entorno.personal(['products:read', 'products:write']);

    await cambiar(variantId, { compareAtCents: 5999 }, admin.token);

    const producto = await entorno.prisma.client.product.findUniqueOrThrow({
      where: { id: productId },
      select: { translations: { select: { slug: true } } },
    });
    const slug = producto.translations[0]?.slug ?? '';

    const publica = await entorno.peticion<Record<string, unknown>>({
      metodo: 'GET',
      ruta: `/api/v1/catalog/products/by-slug/es/${slug}`,
    });

    expect(publica.estado).toBe(200);
    // `fichaPublica` proyecta por lista blanca; el campo del panel no aparece.
    expect(JSON.stringify(publica.datos)).not.toContain('compareAtGuardadoCents');
  });
});
