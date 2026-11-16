import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { crearEntorno, vaciarBase, type EntornoPruebas } from './entorno.js';

/**
 * El bloque de categorías de la portada.
 *
 * Es la primera puerta al catálogo de quien entra a mirar sin saber qué quiere,
 * y las dos formas de romperlo son simétricas: enseñar una categoría vacía
 * —que lleva a un listado sin nada y no se vuelve a pulsar— o esconder una
 * llena. Aquí se prueba la segunda, que es la que se coló: los productos
 * cuelgan de la hoja más concreta, así que las secciones grandes tienen cero
 * productos suyos y miles por debajo.
 */

let entorno: EntornoPruebas;

interface Coleccion {
  id: string;
  tipo: string;
  categorias?: { id: string; slug: string }[];
  productos?: { id: string; name: string; slug: string }[];
}

const portada = (locale = 'es') =>
  entorno.peticion<{ bloques: Coleccion[] }>({
    metodo: 'GET',
    ruta: `/api/v1/content/home/${locale}`,
  });

const categoriasDeLaPortada = async (): Promise<string[]> => {
  const { datos } = await portada();
  const bloque = datos.bloques.find((b) => b.tipo === 'colecciones');
  return (bloque?.categorias ?? []).map((c) => c.slug);
};

const productosDeLaPortada = async (locale = 'es') => {
  const { datos } = await portada(locale);
  return datos.bloques.find((b) => b.tipo === 'destacados')?.productos ?? [];
};

/** Una categoría con su ruta materializada, colgando de otra si se le dice. */
async function categoria(
  handle: string,
  padre?: { id: string; path: string },
): Promise<{
  id: string;
  path: string;
}> {
  const id = newId();
  const path = `${padre?.path ?? '/'}${handle}/`;

  await entorno.prisma.client.category.create({
    data: {
      id,
      handle,
      path,
      depth: padre ? path.split('/').filter(Boolean).length - 1 : 0,
      parentId: padre?.id ?? null,
      isActive: true,
      translations: {
        create: { id: newId(), locale: 'es', name: handle, slug: handle },
      },
    },
  });

  return { id, path };
}

/** Un producto publicado, traducido solo al español salvo que se diga otra cosa. */
async function productoEn(
  categoryId: string,
  { nombre = 'Producto', slug }: { nombre?: string; slug?: string } = {},
): Promise<{ slug: string }> {
  const id = newId();
  const suSlug = slug ?? `producto-${id.slice(0, 6)}`;

  await entorno.prisma.client.product.create({
    data: {
      id,
      handle: `handle-${id.slice(0, 6)}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      categoryId,
      taxRate: 21,
      translations: { create: { id: newId(), locale: 'es', name: nombre, slug: suSlug } },
    },
  });

  return { slug: suSlug };
}

beforeAll(async () => {
  entorno = await crearEntorno();
});

afterAll(async () => {
  await entorno.app.close();
});

beforeEach(async () => {
  await vaciarBase(entorno);
  await entorno.redis.client.flushdb();
});

describe('Categorías de la portada', () => {
  it('una raíz sin productos propios sale si los tiene una nieta', async () => {
    const moda = await categoria('moda');
    const calzado = await categoria('calzado', moda);
    const botas = await categoria('botas', calzado);
    await productoEn(botas.id);

    expect(await categoriasDeLaPortada()).toEqual(['moda']);
  });

  it('una raíz sin nada en toda su rama no sale', async () => {
    const vacia = await categoria('vacia');
    await categoria('tampoco', vacia);

    expect(await categoriasDeLaPortada()).toEqual([]);
  });

  it('las vacías no se comen el sitio de las llenas', async () => {
    /*
     * El fallo que esto vigila.
     *
     * La consulta pedía 60 categorías y de esas se quedaba con las que tenían
     * algo dentro. Con el árbol de un proveedor —318 ramas, casi todas con la
     * misma posición— esas 60 eran las que quisiera devolver Postgres, así que
     * la sección con producto se quedaba fuera de la ventana y la portada salía
     * sin ella. El tope tiene que ir DESPUÉS del filtro.
     */
    for (let i = 0; i < 80; i++) await categoria(`vacia-${String(i).padStart(3, '0')}`);

    const conProducto = await categoria('zzz-la-buena');
    await productoEn(conProducto.id);

    expect(await categoriasDeLaPortada()).toContain('zzz-la-buena');
  });
});

describe('Productos destacados sin traducir', () => {
  /*
   * El fallo que esto vigila, y que llegó a producción.
   *
   * Un catálogo importado viene en un idioma. La portada pedía a la base solo
   * la traducción del idioma que se estaba viendo y, al no haberla, caía al
   * `handle` del producto: en la tienda en inglés salía una tarjeta titulada
   * «handle-a1b2c3» que enlazaba a esa misma cadena como si fuera un slug. Al
   * pulsarla, 404 — y encima el 404 pelado de Next, sin cabecera ni salida.
   */
  it('sale con su nombre en el idioma que haya, no con el identificador', async () => {
    const seccion = await categoria('novedades');
    await productoEn(seccion.id, { nombre: 'Auriculares', slug: 'auriculares' });

    const [producto] = await productosDeLaPortada('en');

    expect(producto?.name).toBe('Auriculares');
    expect(producto?.slug).toBe('auriculares');
  });

  it('y el enlace que ofrece abre la ficha en ese idioma', async () => {
    // Lo que de verdad importa: que el enlace de la portada no lleve a un 404.
    // La ficha se pide en inglés con un slug que solo existe en español.
    const seccion = await categoria('novedades');
    const { slug } = await productoEn(seccion.id, { nombre: 'Auriculares', slug: 'auriculares' });

    const respuesta = await entorno.peticion({
      metodo: 'GET',
      ruta: `/api/v1/catalog/products/by-slug/en/${slug}`,
    });

    expect(respuesta.estado).toBe(200);
  });

  it('un enlace antiguo con el handle del producto también abre', async () => {
    // Los listados ya no generan esos enlaces, pero siguen vivos en Google y en
    // los favoritos de quien los guardó, y eso no se arregla desplegando.
    const seccion = await categoria('novedades');
    await productoEn(seccion.id, { nombre: 'Auriculares', slug: 'auriculares' });

    const producto = await entorno.prisma.client.product.findFirst({ select: { handle: true } });

    const respuesta = await entorno.peticion({
      metodo: 'GET',
      ruta: `/api/v1/catalog/products/by-slug/es/${producto?.handle ?? ''}`,
    });

    expect(respuesta.estado).toBe(200);
  });
});
