import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { crearEntorno, vaciarBase, type EntornoPruebas } from './entorno.js';
import { CABECERA_BUSCADOR, firmaBuscador } from '../src/modules/age/buscador.js';

// El aviso de buscador se firma con este secreto; sin él no se abre nunca.
process.env['REVALIDATE_SECRET'] ??= 'secreto-de-pruebas-para-revalidar';

/** Ficha pública de producto, o el error que la sustituye si falta verificar la edad. */
interface FichaOError {
  error?: string;
  name?: string;
  variants?: unknown[];
}

/**
 * La puerta del catálogo +18.
 *
 * Es la comprobación que el proyecto no puede permitirse fallar: vender
 * productos para adultos sin verificar la edad es una infracción, y el aviso
 * modal de la tienda se cierra desde la consola del navegador en dos segundos.
 * Por eso quien decide es el servidor, y por eso se prueba aquí y no en la
 * interfaz: lo que hay que demostrar es que la ficha no se sirve, no que el
 * aviso se pinta.
 */

let entorno: EntornoPruebas;

const ANIO_ACTUAL = new Date().getFullYear();

/** Producto publicado, marcado o no como +18. */
async function producto(adulto: boolean, slugPropio?: string): Promise<{ slug: string }> {
  const productId = newId();
  const slug = slugPropio ?? `producto-${productId.slice(0, 8)}`;

  await entorno.prisma.client.product.create({
    data: {
      id: productId,
      handle: slug,
      status: 'ACTIVE',
      publishedAt: new Date(),
      taxRate: 21,
      isAdult: adulto,
      translations: {
        create: { id: newId(), locale: 'es', name: 'Artículo de prueba', slug },
      },
      variants: {
        create: {
          id: newId(),
          sku: `SKU-${productId.slice(0, 8)}`,
          priceCents: 2500,
          stock: 5,
          isDefault: true,
        },
      },
    },
  });

  return { slug };
}

const verVistaPrevia = (slug: string) =>
  entorno.peticion<{ name?: string; imagen?: unknown; variants?: unknown; priceCents?: unknown }>({
    metodo: 'GET',
    ruta: `/api/v1/catalog/products/preview/es/${slug}`,
  });

const verFicha = (slug: string, cookie?: string) =>
  entorno.peticion<FichaOError>({
    metodo: 'GET',
    ruta: `/api/v1/catalog/products/by-slug/es/${slug}`,
    ...(cookie ? { cabeceras: { cookie } } : {}),
  });

/** Declara una edad y devuelve la cookie que responda el servidor, si la hay. */
async function declararEdad(anioNacimiento: number): Promise<string | undefined> {
  const respuesta = await entorno.peticion<{ verificado: boolean }>({
    metodo: 'POST',
    ruta: '/api/v1/age/verify',
    cuerpo: { anioNacimiento },
  });

  const puesta = respuesta.cabeceras['set-cookie'];
  const cabecera = Array.isArray(puesta) ? puesta[0] : puesta;

  return typeof cabecera === 'string' ? cabecera.split(';')[0] : undefined;
}

beforeAll(async () => {
  entorno = await crearEntorno();
});

afterAll(async () => {
  await entorno.app.close();
});

beforeEach(async () => {
  await vaciarBase(entorno);
});

describe('Sin verificar la edad', () => {
  it('un producto normal se ve sin más', async () => {
    const { slug } = await producto(false);

    const respuesta = await verFicha(slug);

    expect(respuesta.estado).toBe(200);
  });

  it('un slug largo de AliExpress se sirve igual', async () => {
    /*
     * Esta prueba viene de una tienda caída.
     *
     * Fastify limita a 100 caracteres cada parámetro de ruta, y los slugs
     * salen del título del vendedor: 136 caracteres en el producto real que lo
     * destapó. La API respondía 414 y la ficha de la tienda, un 500. Con un
     * catálogo de un único producto publicado, eso era toda la tienda.
     *
     * No lo detectó ninguna prueba porque el entorno de pruebas creaba el
     * adaptador de Fastify vacío, sin el límite del servidor real. Ahora
     * comparten opciones, así que esta prueba falla si alguien lo baja.
     */
    const largo =
      'plug-anal-largo-dildos-de-caballo-estimulacion-de-prostata-consolador-' +
      'realista-para-mujeres-y-hombres-juguetes-sexuales-1005006318301766';
    expect(largo.length).toBeGreaterThan(100);

    const { slug } = await producto(false, largo);
    const respuesta = await verFicha(slug);

    expect(respuesta.estado).toBe(200);
  });

  it('un producto +18 no se sirve', async () => {
    const { slug } = await producto(true);

    const respuesta = await verFicha(slug);

    // 403 y no 404: el visitante tiene que poder saber que solo le falta
    // verificar la edad, o no habría forma de llegar nunca al catálogo.
    expect(respuesta.estado).toBe(403);
    expect(respuesta.datos.error).toBe('AgeVerificationRequired');
    // Se dice que hace falta verificar la edad y nada más: ni el nombre, ni el
    // precio, ni las fotos del producto.
    expect(respuesta.datos.variants).toBeUndefined();
    expect(respuesta.datos.name).toBeUndefined();
  });

  it('una cookie inventada no sirve de nada', async () => {
    // La cookie es solo un identificador; quien está verificado se guarda en
    // el servidor. Inventarse un valor no abre nada.
    const { slug } = await producto(true);

    const respuesta = await verFicha(slug, 'age_id=identificador-inventado-por-el-visitante');

    expect(respuesta.estado).toBe(403);
  });
});

describe('Declarando la edad', () => {
  it('un menor no recibe cookie y sigue sin ver el producto', async () => {
    const { slug } = await producto(true);

    const respuesta = await entorno.peticion<{ verificado: boolean }>({
      metodo: 'POST',
      ruta: '/api/v1/age/verify',
      cuerpo: { anioNacimiento: ANIO_ACTUAL - 15 },
    });

    expect(respuesta.datos.verificado).toBe(false);
    // Sin cookie no hay identificador con el que reintentar cambiando el año.
    expect(respuesta.cabeceras['set-cookie']).toBeUndefined();
    expect((await verFicha(slug)).estado).toBe(403);
  });

  it('un mayor de edad ya puede ver la ficha', async () => {
    const { slug } = await producto(true);

    const cookie = await declararEdad(ANIO_ACTUAL - 30);
    expect(cookie).toBeDefined();

    const respuesta = await verFicha(slug, cookie);

    expect(respuesta.estado).toBe(200);
  });

  it('la verificación se puede retirar, y entonces vuelve a cerrarse', async () => {
    // Un dispositivo compartido: quien lo verificó tiene que poder deshacerlo
    // antes de dejárselo a alguien de casa.
    const { slug } = await producto(true);
    const cookie = await declararEdad(ANIO_ACTUAL - 30);

    expect((await verFicha(slug, cookie)).estado).toBe(200);

    await entorno.peticion({
      metodo: 'DELETE',
      ruta: '/api/v1/age',
      ...(cookie ? { cabeceras: { cookie } } : {}),
    });

    // Se manda la MISMA cookie a propósito: si la retirada solo la borrara del
    // navegador, quien ya la tuviera copiada seguiría entrando.
    expect((await verFicha(slug, cookie)).estado).toBe(403);
  });
});

/**
 * La tarjeta que sale al compartir el enlace de un producto +18.
 *
 * Tiene que servirse SIN verificar la edad, y no es una excepción caprichosa:
 * el robot de WhatsApp o de Telegram no tiene forma de verificar nada, así que
 * con la ficha completa —que responde 403— la vista previa de todo el catálogo
 * salía con el nombre genérico de la tienda y sin foto. Lo que se enseña ahí es
 * justo lo que quien comparte quiere enseñar; comprar sigue exigiendo la
 * puerta, y eso es lo que comprueban las pruebas de arriba.
 */
describe('Vista previa del enlace', () => {
  it('se sirve sin verificar la edad, también de un producto +18', async () => {
    const { slug } = await producto(true);

    const respuesta = await verVistaPrevia(slug);

    expect(respuesta.estado).toBe(200);
    expect(respuesta.datos.name).toBe('Artículo de prueba');
  });

  it('no publica el precio ni las variantes', async () => {
    // Es una lista blanca: solo sale lo que acaba dentro de la tarjeta. La
    // ficha completa, con precio y stock, sigue detrás de la puerta.
    const { slug } = await producto(true);

    const { datos } = await verVistaPrevia(slug);

    expect(datos.variants).toBeUndefined();
    expect(datos.priceCents).toBeUndefined();
    expect(Object.keys(datos).sort()).toEqual(['descripcion', 'imagen', 'name']);
  });

  it('un borrador no tiene vista previa', async () => {
    // Su nombre y su foto son justo lo que no puede salir antes de tiempo.
    const { slug } = await producto(true);
    await entorno.prisma.client.product.updateMany({ where: {}, data: { status: 'DRAFT' } });

    expect((await verVistaPrevia(slug)).estado).toBe(404);
  });
});

describe('Buscador verificado (Google y Bing, comprobados por IP en la tienda)', () => {
  /*
   * Las fichas +18 se indexan por decisión de negocio (16-11-2026). Antes la
   * tienda dejaba pasar a Google por la puerta, pero la API le respondía 403 y
   * el robot acababa recibiendo la verificación con `noindex`: el catálogo
   * entero estaba fuera del buscador.
   */
  const avisoBuscador = () => ({
    [CABECERA_BUSCADOR]: firmaBuscador(process.env['REVALIDATE_SECRET'] as string),
  });

  it('con el aviso firmado de la tienda, la ficha +18 se sirve completa', async () => {
    const { slug } = await producto(true);

    const respuesta = await entorno.peticion<FichaOError>({
      metodo: 'GET',
      ruta: `/api/v1/catalog/products/by-slug/es/${slug}`,
      cabeceras: avisoBuscador(),
    });

    expect(respuesta.estado).toBe(200);
    expect(respuesta.datos.variants?.length).toBeGreaterThan(0);
    // Y nunca a una caché compartida: un CDN se la daría a un anónimo.
    expect(respuesta.cabeceras['cache-control']).toBe('private, no-store');
  });

  it('con una firma falsa, sigue sin servirse', async () => {
    const { slug } = await producto(true);

    const respuesta = await entorno.peticion<FichaOError>({
      metodo: 'GET',
      ruta: `/api/v1/catalog/products/by-slug/es/${slug}`,
      cabeceras: { [CABECERA_BUSCADOR]: firmaBuscador('un-secreto-que-no-es-el-bueno') },
    });

    expect(respuesta.estado).toBe(403);
  });

  it('el sitemap incluye las fichas +18', async () => {
    const { slug } = await producto(true);

    const respuesta = await entorno.peticion<{ productos: { slug: string }[] }>({
      metodo: 'GET',
      ruta: '/api/v1/content/sitemap/es',
    });

    expect(respuesta.estado).toBe(200);
    expect(respuesta.datos.productos.map((p) => p.slug)).toContain(slug);
  });
});
