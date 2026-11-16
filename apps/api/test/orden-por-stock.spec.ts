import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { crearEntorno, vaciarBase, type EntornoPruebas } from './entorno.js';

/**
 * Lo agotado, al final, en todo lo que ve el cliente.
 *
 * Un producto sin stock en la primera fila es una venta que no ocurre: se
 * entra en la ficha, el botón está apagado y el cliente se va a otra tienda,
 * no a la fila siguiente. Con un catálogo de dropshipping donde el proveedor
 * deja sin existencias decenas de referencias cada semana, eso pasa a diario
 * sin que nadie toque nada.
 *
 * El buscador tiene sus propias pruebas —allí el orden lo aplica Meilisearch—;
 * aquí están los listados que salen de la base de datos, que son los que
 * siguen funcionando aunque el buscador esté caído: la portada, la lista de
 * deseos y los productos que enlaza un artículo del blog.
 */

let entorno: EntornoPruebas;
let token: string;
let clienteToken: string;

/** Identificadores de los productos sembrados, por su nombre. */
const productos = new Map<string, string>();

/**
 * Un producto publicado con una sola variante.
 *
 * `publicadoEl` se controla desde fuera porque los bloques de novedades
 * ordenan por esa fecha: para probar que lo agotado baja hay que poder poner
 * lo agotado arriba primero.
 */
async function sembrarProducto(opciones: {
  nombre: string;
  stock: number;
  publicadoEl: Date;
  categoryId?: string;
  allowBackorder?: boolean;
}): Promise<string> {
  const id = newId();
  const handle = opciones.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  await entorno.prisma.client.product.create({
    data: {
      id,
      handle,
      status: 'ACTIVE',
      publishedAt: opciones.publicadoEl,
      ...(opciones.categoryId ? { categoryId: opciones.categoryId } : {}),
      translations: {
        create: { id: newId(), locale: 'es', name: opciones.nombre, slug: handle },
      },
      variants: {
        create: {
          id: newId(),
          sku: `SKU-${handle}`,
          priceCents: 1999,
          stock: opciones.stock,
          allowBackorder: opciones.allowBackorder ?? false,
          isDefault: true,
        },
      },
    },
  });

  productos.set(opciones.nombre, id);
  return id;
}

const nombres = (lista: { name?: string; nombre?: string }[]): string[] =>
  lista.map((p) => p.name ?? p.nombre ?? '');

beforeAll(async () => {
  entorno = await crearEntorno();
  await vaciarBase(entorno);

  ({ token } = await entorno.personal(['content:write', 'products:write']));

  /*
   * Cuatro productos publicados en este orden, de más nuevo a más viejo:
   *
   *   Agotado nuevo · Disponible nuevo · Agotado viejo · Disponible viejo
   *
   * Está montado así a propósito: por fecha, los dos primeros de un bloque de
   * novedades serían «Agotado nuevo» y «Disponible nuevo», así que un bloque
   * de dos huecos enseñaría un agotado en primera posición. Es justo el caso
   * que hay que corregir.
   */
  const ahora = Date.now();
  await sembrarProducto({ nombre: 'Agotado nuevo', stock: 0, publicadoEl: new Date(ahora) });
  await sembrarProducto({
    nombre: 'Disponible nuevo',
    stock: 5,
    publicadoEl: new Date(ahora - 1000),
  });
  await sembrarProducto({ nombre: 'Agotado viejo', stock: 0, publicadoEl: new Date(ahora - 2000) });
  await sembrarProducto({
    nombre: 'Disponible viejo',
    stock: 3,
    publicadoEl: new Date(ahora - 3000),
  });
  // Sin unidades, pero se vende bajo pedido: en dropshipping es lo normal
  // cuando el proveedor repone, y cuenta como disponible.
  await sembrarProducto({
    nombre: 'Bajo pedido',
    stock: 0,
    allowBackorder: true,
    publicadoEl: new Date(ahora - 4000),
  });

  ({ token: clienteToken } = await entorno.personal([]));
});

afterAll(async () => {
  await entorno.app.close();
});

/** Cambia la portada a un único bloque de destacados y la pide. */
async function portadaCon(bloque: Record<string, unknown>) {
  const guardado = await entorno.peticion({
    metodo: 'POST',
    ruta: '/api/v1/content/admin/home',
    token,
    cuerpo: {
      bloques: [
        { id: 'prueba', tipo: 'destacados', titulo: { es: 'Prueba' }, visible: true, ...bloque },
      ],
    },
  });
  expect(guardado.estado, JSON.stringify(guardado.datos)).toBe(201);

  const { datos } = await entorno.peticion<{
    bloques: { productos: { name: string; disponible: boolean }[] }[];
  }>({ metodo: 'GET', ruta: '/api/v1/content/home/es' });

  return datos.bloques[0]?.productos ?? [];
}

describe('portada', () => {
  it('un bloque de novedades no empieza por lo agotado', async () => {
    const lista = await portadaCon({ origen: 'novedad', limite: 8 });

    // Los tres comprables primero, por fecha; los agotados detrás, también por
    // fecha. Sin esto, el primero de la portada era «Agotado nuevo».
    expect(nombres(lista)).toEqual([
      'Disponible nuevo',
      'Disponible viejo',
      'Bajo pedido',
      'Agotado nuevo',
      'Agotado viejo',
    ]);
  });

  it('con pocos huecos, los ocupa lo que se puede comprar', async () => {
    /*
     * El caso que obliga a hacerlo con dos consultas en vez de reordenando.
     *
     * Con dos huecos y ordenando por fecha, la consulta se trae «Agotado
     * nuevo» y «Disponible nuevo»; reordenar después solo los intercambia y el
     * bloque sigue enseñando un agotado. Hay que elegir distinto, no ordenar
     * distinto.
     */
    const lista = await portadaCon({ origen: 'novedad', limite: 2 });

    expect(nombres(lista)).toEqual(['Disponible nuevo', 'Disponible viejo']);
  });

  it('lo agotado no desaparece: sigue estando, detrás', async () => {
    // No es lo mismo ordenar que esconder. Un producto agotado se sigue
    // pudiendo encontrar —y sigue en Google—, simplemente deja de ocupar el
    // sitio de lo que sí se vende.
    const lista = await portadaCon({ origen: 'novedad', limite: 8 });

    expect(nombres(lista)).toContain('Agotado nuevo');
    expect(lista.filter((p) => !p.disponible)).toHaveLength(2);
  });

  it('en un bloque hecho a mano se respeta el orden del administrador, con lo agotado al final', async () => {
    const lista = await portadaCon({
      origen: 'manual',
      limite: 8,
      productIds: [
        productos.get('Agotado viejo'),
        productos.get('Disponible viejo'),
        productos.get('Agotado nuevo'),
        productos.get('Disponible nuevo'),
      ],
    });

    // Los eligió a dedo y en ese orden: dentro de cada grupo se conserva, pero
    // un escaparate cuya primera tarjeta no se puede comprar es peor que uno
    // con una tarjeta menos.
    expect(nombres(lista)).toEqual([
      'Disponible viejo',
      'Disponible nuevo',
      'Agotado viejo',
      'Agotado nuevo',
    ]);
  });
});

describe('lista de deseos', () => {
  it('lo comprable primero, sin perder el orden en que se guardó', async () => {
    // Se guardan en este orden y con el agotado en medio.
    for (const nombre of ['Disponible viejo', 'Agotado nuevo', 'Disponible nuevo']) {
      const respuesta = await entorno.peticion({
        metodo: 'POST',
        ruta: `/api/v1/wishlist/${productos.get(nombre) ?? ''}`,
        token: clienteToken,
        cuerpo: {},
      });
      expect(respuesta.estado).toBe(204);
    }

    const { datos } = await entorno.peticion<{ name: string; disponible: boolean }[]>({
      metodo: 'GET',
      ruta: '/api/v1/wishlist',
      token: clienteToken,
    });

    // La lista de deseos es de donde salen las compras aplazadas: enterrar
    // arriba lo que no se puede servir es esconder justo lo que sí.
    expect(nombres(datos)).toEqual(['Disponible nuevo', 'Disponible viejo', 'Agotado nuevo']);
  });
});

describe('productos enlazados desde el blog', () => {
  it('los agotados van al final y se dice que lo están', async () => {
    const creado = await entorno.peticion<{ id: string }>({
      metodo: 'POST',
      ruta: '/api/v1/content/admin/blog',
      token,
      cuerpo: {
        handle: 'guia-de-prueba',
        translations: [
          {
            locale: 'es',
            title: 'Guía de prueba',
            slug: 'guia-de-prueba',
            content: '<p>Contenido de la guía.</p>',
          },
        ],
        // En el orden en que los citó quien escribió el artículo.
        productIds: [
          productos.get('Agotado nuevo'),
          productos.get('Disponible viejo'),
          productos.get('Agotado viejo'),
          productos.get('Disponible nuevo'),
        ],
      },
    });
    expect(creado.estado, JSON.stringify(creado.datos)).toBe(201);

    const publicado = await entorno.peticion({
      metodo: 'PATCH',
      ruta: `/api/v1/content/admin/blog/${creado.datos.id}`,
      token,
      cuerpo: { status: 'PUBLISHED' },
    });
    expect(publicado.estado, JSON.stringify(publicado.datos)).toBe(200);

    const { datos } = await entorno.peticion<{
      productos: { nombre: string; disponible: boolean }[];
    }>({ metodo: 'GET', ruta: '/api/v1/content/blog/es/guia-de-prueba' });

    expect(nombres(datos.productos)).toEqual([
      'Disponible viejo',
      'Disponible nuevo',
      'Agotado nuevo',
      'Agotado viejo',
    ]);

    // Y la tarjeta puede decirlo: antes ni siquiera se devolvía, así que el
    // lector se enteraba al llegar a la ficha y encontrarse el botón apagado.
    expect(datos.productos.at(-1)?.disponible).toBe(false);
    expect(datos.productos[0]?.disponible).toBe(true);
  });
});
