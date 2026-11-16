import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId, type EnlaceMenu, type EnlaceResuelto } from '@ecom/shared';
import { crearEntorno, vaciarBase, type EntornoPruebas } from './entorno.js';

/**
 * El menú de la sub-barra.
 *
 * Lo que se prueba aquí no es que se guarde una lista: es la **resolución**, que
 * es donde está todo el riesgo. Un enlace guardado dice «la página X»; lo que
 * llega a la tienda tiene que ser la dirección de esa página *en el idioma del
 * visitante*, con su nombre real, y desaparecer si la página se despublica.
 *
 * Se prueba contra la base de datos porque eso es precisamente lo que resuelve:
 * sin páginas y categorías de verdad no hay nada que comprobar.
 */

let entorno: EntornoPruebas;

interface Menu {
  enlaces: EnlaceResuelto[];
}

/** Una página publicada con slug distinto en cada idioma, como las de verdad. */
async function pagina(publicada = true): Promise<string> {
  const id = newId();

  await entorno.prisma.client.page.create({
    data: {
      id,
      handle: `envios-${id.slice(0, 6)}`,
      status: publicada ? 'PUBLISHED' : 'DRAFT',
      publishedAt: publicada ? new Date() : null,
      translations: {
        create: [
          {
            id: newId(),
            locale: 'es',
            title: 'Envíos y plazos',
            slug: `envios-${id.slice(0, 6)}`,
            content: 'Contenido',
          },
          {
            id: newId(),
            locale: 'ca',
            title: 'Enviaments i terminis',
            slug: `enviaments-${id.slice(0, 6)}`,
            content: 'Contingut',
          },
        ],
      },
    },
  });

  return id;
}

/**
 * Una categoría, con un producto publicado dentro salvo que se pida vacía.
 *
 * Lleva producto por defecto porque una categoría vacía **no sale en el menú**
 * a propósito, y sin esto las pruebas de enlaces estarían comprobando el caso
 * raro sin querer.
 */
async function categoria({ activa = true, conProducto = true } = {}): Promise<string> {
  const id = newId();

  await entorno.prisma.client.category.create({
    data: {
      id,
      handle: `juguetes-${id.slice(0, 6)}`,
      path: `/${id}/`,
      isActive: activa,
      translations: {
        create: [
          { id: newId(), locale: 'es', name: 'Juguetes', slug: `juguetes-${id.slice(0, 6)}` },
          { id: newId(), locale: 'ca', name: 'Joguines', slug: `joguines-${id.slice(0, 6)}` },
        ],
      },
    },
  });

  if (conProducto) {
    const productId = newId();
    await entorno.prisma.client.product.create({
      data: {
        id: productId,
        handle: `producto-${productId.slice(0, 6)}`,
        status: 'ACTIVE',
        publishedAt: new Date(),
        categoryId: id,
        taxRate: 21,
        translations: {
          create: {
            id: newId(),
            locale: 'es',
            name: 'Juguete de prueba',
            slug: `juguete-${productId.slice(0, 6)}`,
          },
        },
      },
    });
  }

  return id;
}

const guardar = async (enlaces: unknown[], token: string) =>
  entorno.peticion({
    metodo: 'POST',
    ruta: '/api/v1/content/admin/menu',
    cuerpo: { enlaces },
    token,
  });

const verMenu = (locale: string) =>
  entorno.peticion<Menu>({ metodo: 'GET', ruta: `/api/v1/content/menu/${locale}` });

async function editor(): Promise<string> {
  const { token } = await entorno.personal(['content:write']);
  return token;
}

/** El menú se cachea cinco minutos; entre pruebas hay que empezar de cero. */
async function limpiarCache(): Promise<void> {
  await entorno.redis.client.flushdb();
}

beforeAll(async () => {
  entorno = await crearEntorno();
});

afterAll(async () => {
  await entorno.app.close();
});

beforeEach(async () => {
  await vaciarBase(entorno);
  await limpiarCache();
});

describe('Sin configurar', () => {
  it('trae el menú de fábrica, con el catálogo', async () => {
    // Si naciera vacío, la sub-barra no se pintaría y nadie sabría que existe.
    const respuesta = await verMenu('es');

    expect(respuesta.estado).toBe(200);
    // El catálogo y el índice de categorías: las dos puertas al producto que
    // tiene que haber desde el primer día, antes de que nadie toque el panel.
    expect(respuesta.datos.enlaces.map((e) => e.href)).toEqual(['/buscar', '/categorias']);
    expect(respuesta.datos.enlaces[0]).toMatchObject({
      href: '/buscar',
      etiqueta: 'Catálogo',
      externo: false,
    });
  });

  it('el de fábrica está traducido', async () => {
    expect((await verMenu('ca')).datos.enlaces[0]?.etiqueta).toBe('Catàleg');
    expect((await verMenu('en')).datos.enlaces[0]?.etiqueta).toBe('Catalogue');
  });
});

describe('Enlaces a páginas', () => {
  it('cada idioma recibe el slug de su idioma', async () => {
    const token = await editor();
    const pageId = await pagina();

    const guardado = await guardar([{ id: 'envios', tipo: 'pagina', destino: pageId }], token);
    expect(guardado.estado).toBeLessThan(300);
    await limpiarCache();

    const es = (await verMenu('es')).datos.enlaces[0];
    const ca = (await verMenu('ca')).datos.enlaces[0];

    expect(es?.href).toMatch(/^\/envios-/);
    expect(ca?.href).toMatch(/^\/enviaments-/);
    // Sin etiqueta propia se usa el título real de la página, en su idioma.
    expect(es?.etiqueta).toBe('Envíos y plazos');
    expect(ca?.etiqueta).toBe('Enviaments i terminis');
  });

  it('la etiqueta escrita a mano gana sobre el título', async () => {
    const token = await editor();
    const pageId = await pagina();

    await guardar(
      [{ id: 'envios', tipo: 'pagina', destino: pageId, etiqueta: { es: 'Cómo enviamos' } }],
      token,
    );
    await limpiarCache();

    expect((await verMenu('es')).datos.enlaces[0]?.etiqueta).toBe('Cómo enviamos');
  });

  it('una página sin publicar no sale en el menú', async () => {
    /*
     * Esto es lo que evita el peor fallo posible de esta pantalla: un enlace en
     * la barra de navegación de TODAS las páginas de la tienda llevando a un 404.
     */
    const token = await editor();
    const pageId = await pagina(false);

    await guardar([{ id: 'envios', tipo: 'pagina', destino: pageId }], token);
    await limpiarCache();

    expect((await verMenu('es')).datos.enlaces).toHaveLength(0);
  });

  it('una página borrada tampoco', async () => {
    const token = await editor();
    const pageId = await pagina();
    await guardar([{ id: 'envios', tipo: 'pagina', destino: pageId }], token);

    await entorno.prisma.client.page.update({
      where: { id: pageId },
      data: { deletedAt: new Date() },
    });
    await limpiarCache();

    expect((await verMenu('es')).datos.enlaces).toHaveLength(0);
  });
});

describe('Enlaces a categorías', () => {
  it('llevan al catálogo filtrado, con el slug del idioma', async () => {
    const token = await editor();
    const categoryId = await categoria();

    await guardar([{ id: 'juguetes', tipo: 'categoria', destino: categoryId }], token);
    await limpiarCache();

    const es = (await verMenu('es')).datos.enlaces[0];
    const ca = (await verMenu('ca')).datos.enlaces[0];

    expect(es?.href).toMatch(/^\/buscar\?categoria=juguetes-/);
    expect(es?.etiqueta).toBe('Juguetes');
    expect(ca?.href).toMatch(/^\/buscar\?categoria=joguines-/);
    expect(ca?.etiqueta).toBe('Joguines');
  });

  it('una categoría sin productos no se enseña', async () => {
    /*
     * Es un callejón sin salida: se pulsa, sale «no hay productos» y la
     * siguiente vez ya no se pulsa ninguna.
     *
     * Y vacías hay muchas: el árbol del proveedor se crea entero de una vez
     * —311 ramas en el de Dreamlove— mucho antes de que se publique un
     * producto en cada una.
     */
    const id = await categoria({ conProducto: false });
    await guardar([{ id: newId(), tipo: 'categoria', destino: id, visible: true }], await editor());

    const { datos } = await verMenu('es');

    expect(datos.enlaces).toHaveLength(0);
  });

  it('basta con que los productos estén en una subcategoría', async () => {
    /*
     * Los productos cuelgan de las hojas, así que una sección con las hijas
     * llenas no tiene ninguno propio. Mirando solo la categoría en sí, justo
     * las secciones que interesan en el menú serían las que desaparecerían.
     */
    const madreId = await categoria({ conProducto: false });
    const madre = await entorno.prisma.client.category.findUniqueOrThrow({
      where: { id: madreId },
    });

    const hijaId = newId();
    await entorno.prisma.client.category.create({
      data: {
        id: hijaId,
        handle: `hija-${hijaId.slice(0, 6)}`,
        parentId: madreId,
        path: `${madre.path}hija-${hijaId.slice(0, 6)}/`,
        depth: 1,
        translations: {
          create: {
            id: newId(),
            locale: 'es',
            name: 'Vibradores',
            slug: `vibr-${hijaId.slice(0, 6)}`,
          },
        },
      },
    });

    const productId = newId();
    await entorno.prisma.client.product.create({
      data: {
        id: productId,
        handle: `producto-${productId.slice(0, 6)}`,
        status: 'ACTIVE',
        publishedAt: new Date(),
        categoryId: hijaId,
        taxRate: 21,
        translations: {
          create: {
            id: newId(),
            locale: 'es',
            name: 'Vibrador de prueba',
            slug: `vib-${productId.slice(0, 6)}`,
          },
        },
      },
    });

    await guardar(
      [{ id: newId(), tipo: 'categoria', destino: madreId, visible: true }],
      await editor(),
    );

    const { datos } = await verMenu('es');

    expect(datos.enlaces).toHaveLength(1);
    expect(datos.enlaces[0]?.etiqueta).toBe('Juguetes');
  });

  it('un producto en borrador no cuenta', async () => {
    // Publicar es lo que decide. Un catálogo importado entero en borrador
    // llenaría el menú de secciones que el cliente ve vacías.
    const id = await categoria({ conProducto: false });
    const productId = newId();
    await entorno.prisma.client.product.create({
      data: {
        id: productId,
        handle: `borrador-${productId.slice(0, 6)}`,
        status: 'DRAFT',
        categoryId: id,
        taxRate: 21,
        translations: {
          create: {
            id: newId(),
            locale: 'es',
            name: 'Sin publicar',
            slug: `sinpub-${productId.slice(0, 6)}`,
          },
        },
      },
    });

    await guardar([{ id: newId(), tipo: 'categoria', destino: id, visible: true }], await editor());

    expect((await verMenu('es')).datos.enlaces).toHaveLength(0);
  });

  it('una categoría desactivada desaparece', async () => {
    const token = await editor();
    const categoryId = await categoria({ activa: false });

    await guardar([{ id: 'juguetes', tipo: 'categoria', destino: categoryId }], token);
    await limpiarCache();

    expect((await verMenu('es')).datos.enlaces).toHaveLength(0);
  });
});

describe('Enlaces a direcciones', () => {
  it('una dirección externa se marca como externa', async () => {
    const token = await editor();

    await guardar(
      [
        {
          id: 'insta',
          tipo: 'url',
          destino: 'https://instagram.com/tienda',
          etiqueta: { es: 'Instagram' },
        },
      ],
      token,
    );
    await limpiarCache();

    expect((await verMenu('es')).datos.enlaces[0]).toMatchObject({
      href: 'https://instagram.com/tienda',
      externo: true,
    });
  });

  it('la API rechaza un destino que ejecutaría código', async () => {
    /*
     * La validación está en el esquema y se comprueba AQUÍ, en la puerta de la
     * API, porque es la única que no se puede saltar: el formulario del panel
     * también valida, pero un `curl` con el token no pasa por el formulario.
     */
    const token = await editor();

    const respuesta = await guardar(
      [{ id: 'malo', tipo: 'url', destino: 'javascript:alert(1)', etiqueta: { es: 'Premio' } }],
      token,
    );

    expect(respuesta.estado).toBe(400);
  });

  it('un enlace oculto no llega a la tienda', async () => {
    const token = await editor();

    await guardar(
      [
        { id: 'a', tipo: 'url', destino: '/buscar', etiqueta: { es: 'Catálogo' } },
        { id: 'b', tipo: 'url', destino: '/blog', etiqueta: { es: 'Blog' }, visible: false },
      ],
      token,
    );
    await limpiarCache();

    const enlaces = (await verMenu('es')).datos.enlaces;
    expect(enlaces.map((e) => e.id)).toEqual(['a']);
  });

  it('el orden que se guarda es el que se sirve', async () => {
    const token = await editor();
    const enlaces: EnlaceMenu[] = ['uno', 'dos', 'tres'].map((id, i) => ({
      id,
      visible: true,
      tipo: 'url',
      destino: `/buscar?p=${String(i)}`,
      etiqueta: { es: id },
      destacado: false,
    }));

    await guardar(enlaces, token);
    await limpiarCache();

    expect((await verMenu('es')).datos.enlaces.map((e) => e.id)).toEqual(['uno', 'dos', 'tres']);
  });
});

describe('Permisos', () => {
  it('sin content:write no se puede tocar el menú', async () => {
    const { token } = await entorno.personal(['products:read']);

    const respuesta = await guardar(
      [{ id: 'a', tipo: 'url', destino: '/buscar', etiqueta: { es: 'Catálogo' } }],
      token,
    );

    expect(respuesta.estado).toBe(403);
  });

  it('el menú público se sirve sin sesión', async () => {
    expect((await verMenu('es')).estado).toBe(200);
  });
});
