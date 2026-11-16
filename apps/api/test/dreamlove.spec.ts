import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { crearEntorno, vaciarBase, type EntornoPruebas } from './entorno.js';
import { crearZip } from '../src/modules/suppliers/dreamlove/zip-de-prueba.js';
import { FulfillmentService } from '../src/modules/orders/fulfillment.service.js';

/**
 * Integración con un proveedor SIN API.
 *
 * Dreamlove no tiene endpoints: manda un XML con su catálogo y los pedidos se
 * hacen a mano en su web. Lo que se comprueba aquí es que ese caso encaja
 * entero en la maquinaria que ya existía —buscar, previsualizar, importar,
 * sincronizar— sin que ninguna otra parte del sistema tenga que saber que al
 * otro lado no hay nadie escuchando.
 *
 * Y sobre todo las tres cosas que solo fallan contra una base de datos de
 * verdad: que los colores de un mismo artículo se agrupen en UN producto, que
 * la búsqueda encuentre por código y por nombre, y que un catálogo nuevo
 * detecte lo que el proveedor ha dejado de mandar.
 */

let entorno: EntornoPruebas;
let token: string;
let supplierId: string;

/** Catálogo mínimo con la forma exacta del que mandan: un suelto y una familia. */
function catalogo(opciones: { incluirSuelto?: boolean; stockAzul?: number } = {}): string {
  const { incluirSuelto = true, stockAzul = 7 } = opciones;

  const suelto = `<product><id>5856</id><public_id>D-196690</public_id><updated>2026-07-30 14:09:35</updated><available>1</available><cost_price>33.14</cost_price><recommended_retail_price_with_taxes>84.99</recommended_retail_price_with_taxes><product_url>https://store.dreamlove.es/bathmate-5856</product_url><default_shipping_cost>18.66</default_shipping_cost><delivery_desc>2-3 días</delivery_desc><min_units_per_order>1</min_units_per_order><max_units_per_order>999</max_units_per_order><vat>4.00</vat><title><![CDATA[BATHMATE - HYDRO 7 HERCULES TRANSPARENT]]></title><description><![CDATA[BATHMATE CLEAR]]></description><html_description><![CDATA[<p>Hydraulic pump</p>]]></html_description><brand><![CDATA[BATHMATE]]></brand><shipping_weight unit="g">326</shipping_weight><sale value="0" /><new value="0" /><barcodes><barcode type="EAN-13"><![CDATA[5060140209928]]></barcode></barcodes><categories><category gesioid="2" ref="Juguetes Sexuales XXX" maincategory="1"><![CDATA[LOVETOYS]]></category></categories><internationalization><title><value lang="es-ES"><![CDATA[BATHMATE - HYDRO 7 HÉRCULES TRANSPARENTE]]></value></title><html_description><value lang="es-ES"><![CDATA[<p>Bomba de vacío con tecnología hidráulica</p>]]></value></html_description></internationalization><images scope="all"><image preferred="1"><name /><src>https://store.dreamlove.es/bathmate.jpg</src></image></images><stock><location path="General">50</location></stock></product>`;

  const color = (id: string, codigo: string, nombre: string, stock: number): string =>
    `<product><id>${id}</id><public_id>${codigo}</public_id><updated>2026-07-30 14:11:45</updated><available>${stock > 0 ? 1 : 0}</available><cost_price>10.67</cost_price><recommended_retail_price_with_taxes>33.95</recommended_retail_price_with_taxes><default_shipping_cost>18.66</default_shipping_cost><delivery_desc>2-3 días</delivery_desc><min_units_per_order>1</min_units_per_order><max_units_per_order>99</max_units_per_order><vat>21.00</vat><title>SATISFYER - DOUBLE BALL-R ${nombre}</title><html_description><![CDATA[<p>Dildo de silicona</p>]]></html_description><brand>SATISFYER</brand><categories><category gesioid="14" ref="Dildos" maincategory="1">LOVETOYS|Dildos without Vibration</category></categories><internationalization><title><value lang="es-ES">SATISFYER - DOUBLE BALL-R SILICONA ${nombre}</value></title><variant_common_title><value lang="es-ES">SATISFYER - DOUBLE BALL-R</value></variant_common_title></internationalization><images scope="all"><image preferred="1"><name /><src>https://store.dreamlove.es/${id}.jpg</src></image></images><variant><item_group_id>0000046116</item_group_id><common_title>SATISFYER - DOUBLE BALL-R</common_title><var_name_1>Color</var_name_1><var_value_1>${nombre}</var_value_1></variant><stock><location path="General">${stock}</location></stock></product>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog batchnumber="1">
${incluirSuelto ? suelto : ''}
${color('46116', 'D-237594', 'GRANATE', 0)}
${color('46117', 'D-237595', 'AZUL', stockAzul)}
${color('46118', 'D-237596', 'NEGRO', 40)}
</catalog>`;
}

/** Cómo llega el catálogo: suelto, comprimido o —lo habitual— dentro de un ZIP. */
type Envoltorio = 'xml' | 'gz' | 'zip';

const ENVOLTORIOS: Record<Envoltorio, { nombre: string; tipo: string }> = {
  xml: { nombre: 'dreamlove.xml', tipo: 'application/xml' },
  gz: { nombre: 'dreamlove.xml.gz', tipo: 'application/gzip' },
  zip: { nombre: 'dreamlove.zip', tipo: 'application/zip' },
};

function envolver(xml: string, envoltorio: Envoltorio): Buffer {
  const crudo = Buffer.from(xml, 'utf8');

  if (envoltorio === 'gz') return gzipSync(crudo);
  if (envoltorio === 'xml') return crudo;

  // Con la basura que mete un Mac al comprimir, que es lo que llega de verdad
  // cuando alguien reenvía el catálogo desde su portátil.
  return crearZip([
    { nombre: '__MACOSX/._dreamlove.xml', contenido: 'metadatos' },
    { nombre: 'dreamlove.xml', contenido: crudo },
  ]);
}

/** Sube un catálogo por el mismo camino que el panel: multipart. */
async function subirCatalogo(xml: string, envoltorio: Envoltorio = 'xml'): Promise<void> {
  const limite = '----pruebasdreamlove';
  const { nombre, tipo } = ENVOLTORIOS[envoltorio];

  const cuerpo = Buffer.concat([
    Buffer.from(
      `--${limite}\r\nContent-Disposition: form-data; name="fichero"; filename="${nombre}"\r\n` +
        `Content-Type: ${tipo}\r\n\r\n`,
    ),
    envolver(xml, envoltorio),
    Buffer.from(`\r\n--${limite}--\r\n`),
  ]);

  const respuesta = await entorno.app.inject({
    method: 'POST',
    url: `/api/v1/suppliers/${supplierId}/catalog/upload`,
    payload: cuerpo,
    headers: {
      'content-type': `multipart/form-data; boundary=${limite}`,
      authorization: `Bearer ${token}`,
    },
  });

  expect(respuesta.statusCode, respuesta.body).toBe(201);

  await esperarAQueTermine();
}

/**
 * El procesado va por detrás de la petición: se espera a que la fila diga que
 * ha terminado, que es exactamente lo que hace la pantalla.
 */
async function esperarAQueTermine(): Promise<void> {
  for (let intento = 0; intento < 100; intento++) {
    const ultima = await entorno.prisma.client.supplierCatalogImport.findFirst({
      where: { supplierId },
      orderBy: { startedAt: 'desc' },
    });

    if (ultima?.status === 'COMPLETED') return;
    if (ultima?.status === 'FAILED') throw new Error(`Importación fallida: ${ultima.errorDetail}`);

    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error('La importación del catálogo no ha terminado a tiempo');
}

/** Igual, pero para los casos en que se espera que falle. */
async function esperarAImportacionFallida() {
  for (let intento = 0; intento < 100; intento++) {
    const ultima = await entorno.prisma.client.supplierCatalogImport.findFirst({
      where: { supplierId },
      orderBy: { startedAt: 'desc' },
    });

    if (ultima?.status === 'FAILED') return ultima;
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error('Se esperaba que la importación fallara y no lo ha hecho');
}

/**
 * Un pedido pagado con dos unidades del color azul.
 *
 * Se siembra directamente en la base y no por el carrito porque lo que se
 * prueba aquí es lo que pasa DESPUÉS de cobrar: cómo se reparte el pedido
 * entre proveedores cuando uno de ellos no tiene API.
 */
async function sembrarPedidoPagado(
  // El correo distingue un pedido de otro dentro del fichero: las pruebas que
  // vienen después buscan «el último de este cliente», y sembrar dos con el
  // mismo correo les cambiaba el pedido bajo los pies.
  email = 'cliente@ejemplo.es',
): Promise<{ orderId: string }> {
  const enlace = await entorno.prisma.client.supplierProduct.findFirstOrThrow({
    where: { supplierId, externalVariantId: '46117' },
  });

  const orderId = newId();
  await entorno.prisma.client.order.create({
    data: {
      id: orderId,
      number: `ES-2026-${Math.floor(Math.random() * 899999 + 100000)}`,
      publicToken: newId(),
      email,
      status: 'PAID',
      paymentStatus: 'PAID',
      totalCents: 5990,
      shippingAddress: {
        firstName: 'Ana',
        lastName: 'García',
        line1: 'Calle Mayor 1',
        city: 'Madrid',
        province: 'Madrid',
        postalCode: '28001',
        countryCode: 'ES',
      },
      items: {
        create: {
          id: newId(),
          variantId: enlace.variantId,
          productId: enlace.productId,
          name: 'SATISFYER - DOUBLE BALL-R',
          sku: 'DRE-0000046116-2',
          quantity: 2,
          unitPriceCents: 2995,
          unitCostCents: enlace.costCents,
          totalCents: 5990,
          taxRate: 21,
        },
      },
    },
  });

  return { orderId };
}

interface Candidato {
  externalId: string;
  titulo: string;
  costeCents: number;
  envioCents: number;
  pvpPropuestoCents: number;
  variantes: number;
  imagenes: number;
  yaImportado: boolean;
}

beforeAll(async () => {
  entorno = await crearEntorno();
  await vaciarBase(entorno);

  ({ token } = await entorno.personal([
    'suppliers:read',
    'suppliers:write',
    'products:import',
    'products:write',
    'orders:read',
    'orders:fulfill',
    'orders:write',
    'orders:close',
    'categories:write',
  ]));

  const alta = await entorno.peticion<{ id: string }>({
    metodo: 'POST',
    ruta: '/api/v1/suppliers',
    token,
    // Sin credenciales: no las tiene, y por eso el alta no debe exigirlas.
    cuerpo: { key: 'dreamlove', name: 'Dreamlove', defaultMarginPct: 60, minMarginPct: 25 },
  });

  expect(alta.estado, JSON.stringify(alta.datos)).toBe(201);
  supplierId = alta.datos.id;
});

afterAll(async () => {
  await entorno.app.close();
});

describe('proveedor sin API · catálogo por fichero', () => {
  it('no está listo mientras no se suba su catálogo', async () => {
    const { datos } = await entorno.peticion<{ listo: boolean; motivoNoListo: string }[]>({
      metodo: 'GET',
      ruta: '/api/v1/suppliers',
      token,
    });

    // Es la trampa que tenía el importador: un proveedor sin credenciales
    // parecía listo y todas sus búsquedas salían vacías sin decir por qué.
    expect(datos[0]?.listo).toBe(false);
    expect(datos[0]?.motivoNoListo).toContain('catálogo');
  });

  it('procesa el catálogo subido y cuenta lo que ha entrado', async () => {
    await subirCatalogo(catalogo());

    const { datos } = await entorno.peticion<{
      articulos: number;
      disponibles: number;
      productos: number;
    }>({ metodo: 'GET', ruta: `/api/v1/suppliers/${supplierId}/catalog-file/status`, token });

    expect(datos.articulos).toBe(4);
    // El granate está agotado.
    expect(datos.disponibles).toBe(3);
    // Cuatro filas, dos productos: el suelto y la familia de tres colores.
    expect(datos.productos).toBe(2);
  });

  it('guarda el árbol de categorías que trae el catálogo', async () => {
    // El fichero clasifica sus artículos y esa clasificación es lo único que
    // hay: sin quedársela, cada producto habría que categorizarlo a mano.
    const { datos } = await entorno.peticion<{
      total: number;
      enlazadas: number;
      ramas: { path: string; nombre: string; articulos: number; categoryId: string | null }[];
    }>({ metodo: 'GET', ruta: `/api/v1/suppliers/${supplierId}/categories`, token });

    expect(datos.total).toBe(2);
    // Todavía no existe ninguna categoría nuestra: solo está apuntado.
    expect(datos.enlazadas).toBe(0);

    const porRuta = new Map(datos.ramas.map((r) => [r.path, r]));
    expect(porRuta.get('LOVETOYS')?.nombre).toBe('Juguetes Sexuales XXX');
    expect(porRuta.get('LOVETOYS|Dildos without Vibration')?.nombre).toBe('Dildos');

    // El recuento es de artículos que la tienen como PRINCIPAL: el suelto en
    // la raíz y los tres colores en la hoja.
    expect(porRuta.get('LOVETOYS')?.articulos).toBe(1);
    expect(porRuta.get('LOVETOYS|Dildos without Vibration')?.articulos).toBe(3);
  });

  it('crea el árbol entero de una vez, con los padres antes que las hijas', async () => {
    const { estado, datos } = await entorno.peticion<{
      total: number;
      creadas: number;
      fallidas: { path: string; motivo: string }[];
    }>({
      metodo: 'POST',
      ruta: `/api/v1/suppliers/${supplierId}/categories/sync`,
      cuerpo: {},
      token,
    });

    expect(estado, JSON.stringify(datos)).toBe(200);
    expect(datos.creadas).toBe(2);
    expect(datos.fallidas).toEqual([]);

    // Y quedan colgadas una de otra, no las dos en la raíz.
    const madre = await entorno.prisma.client.category.findFirstOrThrow({
      where: { translations: { some: { name: 'Juguetes Sexuales XXX' } } },
    });
    const hija = await entorno.prisma.client.category.findFirstOrThrow({
      where: { translations: { some: { name: 'Dildos' } } },
    });

    expect(hija.parentId).toBe(madre.id);
    expect(madre.depth).toBe(0);
    expect(hija.depth).toBe(1);
    // La ruta materializada se construye sola y es la que usa la tienda para
    // saber si una rama tiene algo debajo.
    expect(hija.path.startsWith(madre.path)).toBe(true);

    // El nombre en inglés sale de la propia ruta del proveedor, gratis.
    const enIngles = await entorno.prisma.client.categoryTranslation.findFirst({
      where: { categoryId: hija.id, locale: 'en' },
    });
    expect(enIngles?.name).toBe('Dildos without Vibration');
  });

  it('repetirlo no duplica nada', async () => {
    // Se ejecuta después de cada catálogo nuevo, así que tiene que ser
    // inofensivo: lo que ya está enlazado se deja como está.
    const antes = await entorno.prisma.client.category.count();

    const { datos } = await entorno.peticion<{ creadas: number; yaEnlazadas: number }>({
      metodo: 'POST',
      ruta: `/api/v1/suppliers/${supplierId}/categories/sync`,
      cuerpo: {},
      token,
    });

    expect(datos.creadas).toBe(0);
    expect(datos.yaEnlazadas).toBe(2);
    expect(await entorno.prisma.client.category.count()).toBe(antes);
  });

  it('dos ramas que dan el mismo slug se crean las dos', async () => {
    /*
     * Pasó con el catálogo real y tumbó una rama entera.
     *
     * Una rama se llama «Anal» en inglés y otra «Anal-» en español —con el
     * guión de más, tal cual lo manda el proveedor—: las dos dan el slug
     * «anal», que es único por idioma. La segunda reventaba al crearse y esa
     * parte del árbol se quedaba fuera.
     *
     * Aquí se reproduce inyectando las dos ramas a mano, porque en el fichero
     * de pruebas no hay nombres que choquen.
     */
    await entorno.prisma.client.supplierCategory.createMany({
      data: [
        {
          id: newId(),
          supplierId,
          path: 'SEX DRUGSTORE',
          name: 'Droguería',
          depth: 1,
          itemCount: 0,
        },
        {
          id: newId(),
          supplierId,
          path: 'SEX DRUGSTORE|Anal',
          name: 'Anal-',
          depth: 2,
          itemCount: 0,
        },
      ],
    });

    // Una categoría cuya traducción inglesa ya ocupa el slug «anal».
    const ocupante = newId();
    await entorno.prisma.client.category.create({
      data: {
        id: ocupante,
        handle: `juegos-anales-${ocupante.slice(0, 6)}`,
        path: `/juegos-anales-${ocupante.slice(0, 6)}/`,
        translations: {
          create: [
            {
              id: newId(),
              locale: 'es',
              name: 'Juguetería anal',
              slug: `jug-${ocupante.slice(0, 6)}`,
            },
            { id: newId(), locale: 'en', name: 'Anal', slug: 'anal' },
          ],
        },
      },
    });

    const { datos } = await entorno.peticion<{
      creadas: number;
      fallidas: { path: string; motivo: string }[];
    }>({
      metodo: 'POST',
      ruta: `/api/v1/suppliers/${supplierId}/categories/sync`,
      cuerpo: {},
      token,
    });

    expect(datos.fallidas, JSON.stringify(datos.fallidas)).toEqual([]);
    expect(datos.creadas).toBe(2);

    // La rama existe y cuelga de la suya, no se ha quedado por el camino.
    const creada = await entorno.prisma.client.supplierCategory.findFirstOrThrow({
      where: { supplierId, path: 'SEX DRUGSTORE|Anal' },
    });
    expect(creada.categoryId).not.toBeNull();
  });

  it('ya está listo, y la búsqueda cuenta productos y no filas', async () => {
    const { datos } = await entorno.peticion<{ items: Candidato[]; total: number }>({
      metodo: 'GET',
      ruta: `/api/v1/suppliers/${supplierId}/catalog?q=&porPagina=20`,
      token,
    });

    expect(datos.total).toBe(2);
    expect(datos.items).toHaveLength(2);
  });

  it('busca por nombre sin tildes y por marca', async () => {
    const porNombre = await entorno.peticion<{ items: Candidato[]; total: number }>({
      metodo: 'GET',
      ruta: `/api/v1/suppliers/${supplierId}/catalog?q=hercules`,
      token,
    });

    const porMarca = await entorno.peticion<{ items: Candidato[]; total: number }>({
      metodo: 'GET',
      ruta: `/api/v1/suppliers/${supplierId}/catalog?q=satisfyer%20ball`,
      token,
    });

    // «HÉRCULES» va con tilde en el catálogo y nadie la escribe al buscar.
    expect(porNombre.datos.total).toBe(1);
    // Dos palabras: tienen que aparecer las dos, no cualquiera de ellas.
    expect(porMarca.datos.total).toBe(1);
    expect(porMarca.datos.items[0]?.variantes).toBe(3);
  });

  it('encuentra la familia por el código de cualquiera de sus colores', async () => {
    const { estado, datos } = await entorno.peticion<Candidato>({
      metodo: 'GET',
      ruta: `/api/v1/suppliers/${supplierId}/catalog/D-237595`,
      token,
    });

    expect(estado).toBe(200);
    // Se ha pedido el azul y contesta la familia entera: es lo que se importa.
    expect(datos.variantes).toBe(3);
    expect(datos.titulo).toBe('SATISFYER - DOUBLE BALL-R');
  });

  it('no reparte los portes del pedido entre los artículos', async () => {
    const { datos } = await entorno.peticion<Candidato>({
      metodo: 'GET',
      ruta: `/api/v1/suppliers/${supplierId}/catalog/D-196690`,
      token,
    });

    // Los 18,66 € son de un envío, no de cada cosa: como coste de línea
    // subirían todos los PVP y sacarían el catálogo del mercado.
    expect(datos.envioCents).toBe(0);
    expect(datos.costeCents).toBe(3314);
  });

  it('importa la familia entera como un producto con tres colores', async () => {
    const { estado, datos } = await entorno.peticion<{ productId: string; variantes: number }>({
      metodo: 'POST',
      ruta: `/api/v1/suppliers/${supplierId}/import`,
      token,
      // Sin imágenes: descargarlas saldría a internet desde una prueba.
      cuerpo: { externalId: '0000046116', descargarImagenes: false },
    });

    expect(estado, JSON.stringify(datos)).toBe(201);
    expect(datos.variantes).toBe(3);

    const producto = await entorno.prisma.client.product.findUniqueOrThrow({
      where: { id: datos.productId },
      include: {
        variants: { orderBy: { position: 'asc' } },
        options: { include: { values: true } },
        translations: true,
      },
    });

    // Una sola opción, «Color», con sus tres valores: es lo que hace que sea
    // un producto y no tres fichas casi iguales.
    expect(producto.options).toHaveLength(1);
    expect(producto.options[0]?.values).toHaveLength(3);
    // Nace en borrador: la ficha del proveedor siempre necesita repaso.
    expect(producto.status).toBe('DRAFT');
    expect(producto.translations[0]?.name).toBe('SATISFYER - DOUBLE BALL-R');

    // Cada variante queda enlazada al artículo CONCRETO del proveedor, no al
    // grupo: es lo que permite saber después qué color hay que pedirle.
    const enlaces = await entorno.prisma.client.supplierProduct.findMany({
      where: { supplierId, productId: datos.productId },
    });
    expect(enlaces).toHaveLength(3);
    expect(enlaces.map((e) => e.externalVariantId).sort()).toEqual(['46116', '46117', '46118']);
    expect(enlaces.every((e) => e.externalProductId === '0000046116')).toBe(true);
  });

  it('respeta el IVA que declara el proveedor y no el general', async () => {
    const { datos } = await entorno.peticion<{ productId: string }>({
      metodo: 'POST',
      ruta: `/api/v1/suppliers/${supplierId}/import`,
      token,
      cuerpo: { externalId: '5856', descargarImagenes: false },
    });

    const producto = await entorno.prisma.client.product.findUniqueOrThrow({
      where: { id: datos.productId },
    });

    // Este artículo va al 4 %. Facturarlo al 21 % es cobrar de más al cliente
    // y declarar de más a Hacienda.
    expect(Number(producto.taxRate)).toBe(4);
  });

  it('el producto importado entra en la categoría que dice el proveedor', async () => {
    /*
     * El objeto de todo esto. Antes había que elegirla a mano producto a
     * producto en un desplegable, así que en la práctica los productos
     * entraban sin categoría y no se podía navegar la tienda.
     *
     * Cada uno va a la suya: el suelto a la raíz y la familia a la hoja.
     */
    const categoriaDe = async (externalId: string): Promise<string | null> => {
      // `SupplierProduct` guarda el productId suelto, sin relación declarada.
      const enlace = await entorno.prisma.client.supplierProduct.findFirstOrThrow({
        where: { supplierId, externalProductId: externalId },
        select: { productId: true },
      });
      const producto = await entorno.prisma.client.product.findUniqueOrThrow({
        where: { id: enlace.productId },
        select: { category: { select: { translations: { where: { locale: 'es' } } } } },
      });
      return producto.category?.translations[0]?.name ?? null;
    };

    expect(await categoriaDe('5856')).toBe('Juguetes Sexuales XXX');
    expect(await categoriaDe('0000046116')).toBe('Dildos');
  });

  it('detecta lo que el proveedor deja de mandar en el catálogo siguiente', async () => {
    await subirCatalogo(catalogo({ incluirSuelto: false, stockAzul: 3 }));

    const ultima = await entorno.prisma.client.supplierCatalogImport.findFirstOrThrow({
      where: { supplierId },
      orderBy: { startedAt: 'desc' },
    });

    // El suelto ya no viene: se marca, no se borra —está importado y hay que
    // poder saber de dónde salió—.
    expect(ultima.itemsRemoved).toBe(1);
    expect(ultima.itemsRead).toBe(3);
    expect(ultima.stockChanges).toBe(1);

    const retirado = await entorno.prisma.client.supplierCatalogItem.findFirstOrThrow({
      where: { supplierId, externalId: '5856' },
    });
    expect(retirado.removed).toBe(true);

    // Y deja de ofrecerse para importar: dar de alta un producto retirado es
    // publicar algo que nace sin poder servirse.
    const busqueda = await entorno.peticion<{ total: number }>({
      metodo: 'GET',
      ruta: `/api/v1/suppliers/${supplierId}/catalog?q=hercules`,
      token,
    });
    expect(busqueda.datos.total).toBe(0);
  });

  it('traslada el stock nuevo a lo que ya vendemos', async () => {
    // La sincronización posterior al catálogo va por detrás: el fichero ya
    // está guardado y trasladarlo a los productos lleva su tiempo.
    for (let intento = 0; intento < 100; intento++) {
      const enlace = await entorno.prisma.client.supplierProduct.findFirstOrThrow({
        where: { supplierId, externalVariantId: '46117' },
      });

      // El azul ha bajado de 7 a 3 en el catálogo nuevo. Sin este traslado, la
      // tienda seguiría vendiendo con el stock de ayer.
      if (enlace.stock === 3) return;
      await new Promise((r) => setTimeout(r, 100));
    }

    throw new Error('El stock del catálogo nuevo no ha llegado a los productos importados');
  });

  it('guarda el historial de catálogos procesados', async () => {
    const { datos } = await entorno.peticion<{ status: string; itemsRead: number }[]>({
      metodo: 'GET',
      ruta: `/api/v1/suppliers/${supplierId}/catalog-file/history`,
      token,
    });

    expect(datos).toHaveLength(2);
    expect(datos.every((i) => i.status === 'COMPLETED')).toBe(true);
  });

  it('un pedido de este proveedor pide comprar a mano, no falla', async () => {
    const { orderId } = await sembrarPedidoPagado();

    const fulfillment = entorno.app.get(FulfillmentService);
    const resultado = await fulfillment.procesar(orderId);

    // Lo importante: NO cuenta como fallo. Un proveedor sin API no es una
    // avería, y marcarlo como fallido dispararía los avisos de cada pedido.
    expect(resultado.fallidos).toBe(0);
    expect(resultado.enviados).toBe(0);
    expect(resultado.requierenRevision).toBe(1);

    const sub = await entorno.prisma.client.supplierOrder.findFirstOrThrow({
      where: { orderId },
    });
    expect(sub.status).toBe('PENDING');
    expect(sub.needsReview).toBe(true);
    expect(sub.lastErrorType).toBe('COMPRA_MANUAL');
    // Sin error: no ha pasado nada malo, falta hacer un recado.
    expect(sub.lastError).toBeNull();

    // Y el pedido NO queda marcado como fallido. Con un proveedor sin API,
    // eso pintaría de rojo el tablero entero todos los días y escondería los
    // fallos de verdad entre los que no lo son.
    const pedido = await entorno.prisma.client.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(pedido.status).toBe('PREPARING');
  });

  it('la cola de incidencias trae la lista de la compra con sus códigos', async () => {
    const { datos } = await entorno.peticion<
      {
        tipo: string;
        proveedor: string;
        accionSugerida: string;
        compra?: {
          codigo: string;
          titulo: string;
          url: string | null;
          cantidad: number;
          disponible: boolean;
        }[];
      }[]
    >({ metodo: 'GET', ruta: '/api/v1/orders/incidencias', token });

    const manual = datos.find((i) => i.tipo === 'compra_manual');
    expect(manual).toBeDefined();
    expect(manual?.proveedor).toBe('Dreamlove');
    expect(manual?.accionSugerida).toContain('su web');

    // Lo que se compra: el código con el que se busca en la web del proveedor
    // y no nuestro identificador interno. Sin esto hay que buscar el color a
    // mano entre 12.913 artículos.
    expect(manual?.compra).toHaveLength(1);
    expect(manual?.compra?.[0]?.codigo).toBe('D-237595');
    expect(manual?.compra?.[0]?.cantidad).toBe(2);
    expect(manual?.compra?.[0]?.disponible).toBe(true);
  });

  it('al anotar la referencia de la compra, el pedido avanza', async () => {
    const sub = await entorno.prisma.client.supplierOrder.findFirstOrThrow({
      where: { lastErrorType: 'COMPRA_MANUAL' },
    });

    const { estado, datos } = await entorno.peticion<{ ok: boolean }>({
      metodo: 'POST',
      ruta: `/api/v1/orders/incidencias/${sub.id}/resolver`,
      token,
      cuerpo: { referencia: 'DL-2026-99887', nota: 'Comprado en su web' },
    });

    expect(estado, JSON.stringify(datos)).toBe(200);
    expect(datos.ok).toBe(true);

    const despues = await entorno.prisma.client.supplierOrder.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(despues.status).toBe('PLACED');
    expect(despues.externalOrderId).toBe('DL-2026-99887');
    expect(despues.needsReview).toBe(false);

    // Y sale de la cola: si siguiera ahí, cada mañana habría que volver a
    // decidir sobre un pedido ya comprado.
    const cola = await entorno.peticion<{ supplierOrderId: string }[]>({
      metodo: 'GET',
      ruta: '/api/v1/orders/incidencias',
      token,
    });
    expect(cola.datos.some((i) => i.supplierOrderId === sub.id)).toBe(false);
  });

  it('acepta el catálogo comprimido, que es la única vía en producción', async () => {
    /*
     * 342 MB no pasan por Cloudflare —su límite de subida son 100 MB— y
     * comprimido el mismo fichero se queda en 61. Sin este camino, el catálogo
     * solo se podría cargar entrando en el servidor, que es justo lo que la
     * pantalla del panel existe para evitar.
     */
    await subirCatalogo(catalogo({ stockAzul: 11 }), 'gz');

    const ultima = await entorno.prisma.client.supplierCatalogImport.findFirstOrThrow({
      where: { supplierId },
      orderBy: { startedAt: 'desc' },
    });

    expect(ultima.status).toBe('COMPLETED');
    expect(ultima.itemsRead).toBe(4);
    // Y el suelto, que había desaparecido en el catálogo anterior, vuelve:
    // los proveedores reponen referencias que habían retirado.
    expect(ultima.itemsRemoved).toBe(0);

    const recuperado = await entorno.prisma.client.supplierCatalogItem.findFirstOrThrow({
      where: { supplierId, externalId: '5856' },
    });
    expect(recuperado.removed).toBe(false);
  });

  it('acepta el ZIP tal cual lo manda el proveedor', async () => {
    // Es la forma normal de recibirlo, así que el panel no debe pedir que
    // nadie lo descomprima antes: se lee la entrada de dentro del ZIP sin
    // dejar los 342 MB en el disco del servidor.
    await subirCatalogo(catalogo({ stockAzul: 5 }), 'zip');

    const ultima = await entorno.prisma.client.supplierCatalogImport.findFirstOrThrow({
      where: { supplierId },
      orderBy: { startedAt: 'desc' },
    });

    expect(ultima.status).toBe('COMPLETED');
    expect(ultima.itemsRead).toBe(4);
    // Queda anotado qué se leyó de dentro: el ZIP de la prueba trae además la
    // basura que mete un Mac al comprimir, y saber cuál se cogió es lo que
    // explica después un recuento raro.
    expect(ultima.fileName).toBe('dreamlove.zip › dreamlove.xml');

    const azul = await entorno.prisma.client.supplierCatalogItem.findFirstOrThrow({
      where: { supplierId, externalId: '46117' },
    });
    expect(azul.stock).toBe(5);
  });

  it('rechaza un ZIP sin catálogo dentro diciendo qué llevaba', async () => {
    const limite = '----pruebasdreamlove';
    const cuerpo = Buffer.concat([
      Buffer.from(
        `--${limite}\r\nContent-Disposition: form-data; name="fichero"; filename="tarifas.zip"\r\n` +
          `Content-Type: application/zip\r\n\r\n`,
      ),
      crearZip([
        { nombre: 'tarifas.pdf', contenido: 'pdf' },
        { nombre: 'condiciones.docx', contenido: 'doc' },
      ]),
      Buffer.from(`\r\n--${limite}--\r\n`),
    ]);

    const respuesta = await entorno.app.inject({
      method: 'POST',
      url: `/api/v1/suppliers/${supplierId}/catalog/upload`,
      payload: cuerpo,
      headers: {
        'content-type': `multipart/form-data; boundary=${limite}`,
        authorization: `Bearer ${token}`,
      },
    });

    // La subida se acepta —el fichero es un ZIP legítimo— y lo que falla es el
    // procesado, así que el motivo aparece en la importación y no en la
    // respuesta. Es donde lo va a leer quien suba el fichero equivocado.
    expect(respuesta.statusCode).toBe(201);

    const ultima = await esperarAImportacionFallida();
    expect(ultima.errorDetail).toContain('tarifas.pdf');

    // Y lo importante: un ZIP equivocado NO retira el catálogo bueno.
    const articulos = await entorno.prisma.client.supplierCatalogItem.count({
      where: { supplierId, removed: false },
    });
    expect(articulos).toBe(4);
  });

  it('se puede lanzar la compra a mano si la cola no llegó a hacerlo', async () => {
    /*
     * El callejón sin salida que esto cierra: un pedido cobrado cuyo procesado
     * nunca arrancó —worker caído, trabajo perdido— se quedaba pagado y sin
     * comprar, y no había ningún botón que lo empujara. «Reintentar» vive en la
     * cola de incidencias, y esa lista mira sub-pedidos: si no llegó a crearse
     * ninguno, el pedido no salía en ninguna pantalla.
     */
    const { orderId } = await sembrarPedidoPagado('sin-procesar@ejemplo.es');

    const { estado, datos } = await entorno.peticion<{ requierenRevision: number }>({
      metodo: 'POST',
      ruta: `/api/v1/orders/${orderId}/procesar`,
      token,
    });

    expect(estado, JSON.stringify(datos)).toBe(200);
    // Con Dreamlove queda pendiente de comprar a mano, que es lo correcto.
    expect(datos.requierenRevision).toBe(1);

    const sub = await entorno.prisma.client.supplierOrder.findFirstOrThrow({
      where: { orderId },
    });
    expect(sub.lastErrorType).toBe('COMPRA_MANUAL');

    // Y repetirlo no duplica la compra: la clave de idempotencia es la misma.
    await entorno.peticion({ metodo: 'POST', ruta: `/api/v1/orders/${orderId}/procesar`, token });
    const subs = await entorno.prisma.client.supplierOrder.count({ where: { orderId } });
    expect(subs).toBe(1);
  });

  it('el pedido avanza a «enviado al proveedor» al cerrar la compra', async () => {
    const pedido = await entorno.prisma.client.order.findFirstOrThrow({
      where: { email: 'cliente@ejemplo.es' },
      orderBy: { createdAt: 'desc' },
    });

    expect(pedido.status).toBe('SENT_TO_SUPPLIER');
  });

  it('anota el seguimiento a mano y construye el enlace', async () => {
    const sub = await entorno.prisma.client.supplierOrder.findFirstOrThrow({
      where: { supplierId, status: 'PLACED' },
    });

    const { estado, datos } = await entorno.peticion<{ ok: boolean; url: string }>({
      metodo: 'POST',
      ruta: `/api/v1/orders/sub-pedidos/${sub.id}/seguimiento`,
      token,
      // Escrito como lo escribe una persona con prisa, que es como llega.
      cuerpo: { transportista: 'correos exprés', numero: 'CE123456789ES' },
    });

    expect(estado, JSON.stringify(datos)).toBe(200);
    expect(datos.ok).toBe(true);
    // El enlace se construye solo: mandarle al cliente un número suelto que no
    // sabe dónde pegar es justo lo que provoca el «¿dónde está lo mío?».
    expect(datos.url).toContain('correosexpress');

    const despues = await entorno.prisma.client.supplierOrder.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(despues.status).toBe('SHIPPED');
    // Y el nombre queda bien escrito, que acaba en el correo del cliente.
    expect(despues.trackingCarrier).toBe('Correos Express');
    expect(despues.shippedAt).not.toBeNull();
  });

  it('con el envío anotado, el pedido pasa a «en tránsito» solo', async () => {
    const pedido = await entorno.prisma.client.order.findFirstOrThrow({
      where: { email: 'cliente@ejemplo.es' },
      orderBy: { createdAt: 'desc' },
    });

    // Es el paso que no daba nadie con un proveedor sin API: sin seguimiento,
    // el pedido se quedaba en «enviado al proveedor» para siempre.
    expect(pedido.status).toBe('IN_TRANSIT');

    const eventos = await entorno.prisma.client.orderEvent.findMany({
      where: { orderId: pedido.id },
    });
    expect(eventos.some((e) => e.type === 'supplier_order.tracking_manual')).toBe(true);
    // El aviso al cliente queda registrado: es el correo que evita el soporte.
    expect(eventos.some((e) => e.type === 'order.shipped')).toBe(true);
  });

  it('la ficha ofrece los pasos siguientes y no los que tienen flujo propio', async () => {
    const pedido = await entorno.prisma.client.order.findFirstOrThrow({
      where: { email: 'cliente@ejemplo.es' },
      orderBy: { createdAt: 'desc' },
    });

    const { datos } = await entorno.peticion<{
      transicionesPermitidas: { estado: string }[];
    }>({ metodo: 'GET', ruta: `/api/v1/orders/${pedido.id}`, token });

    const destinos = datos.transicionesPermitidas.map((x) => x.estado);

    expect(destinos).toContain('DELIVERED');
    // Cancelar avisa al proveedor y devuelve el dinero; reembolsar mueve dinero
    // de verdad. Ninguno de los dos es «mover la tarjeta».
    expect(destinos).not.toContain('CANCELLED');
    expect(destinos).not.toContain('REFUNDED');
    expect(destinos).not.toContain('CLOSED');
  });

  it('no deja marcar un pedido como reembolsado sin reembolsar nada', async () => {
    const pedido = await entorno.prisma.client.order.findFirstOrThrow({
      where: { email: 'cliente@ejemplo.es' },
      orderBy: { createdAt: 'desc' },
    });

    const { estado } = await entorno.peticion({
      metodo: 'POST',
      ruta: `/api/v1/orders/${pedido.id}/status`,
      token,
      cuerpo: { status: 'REFUNDED' },
    });

    // Cuadraría en el panel y no cuadraría en el banco.
    expect(estado).toBe(400);
  });

  it('entregar el pedido entrega también la compra al proveedor', async () => {
    const pedido = await entorno.prisma.client.order.findFirstOrThrow({
      where: { email: 'cliente@ejemplo.es' },
      orderBy: { createdAt: 'desc' },
    });

    const { estado } = await entorno.peticion({
      metodo: 'POST',
      ruta: `/api/v1/orders/${pedido.id}/status`,
      token,
      cuerpo: { status: 'DELIVERED' },
    });
    expect(estado).toBe(200);

    const sub = await entorno.prisma.client.supplierOrder.findFirstOrThrow({
      where: { orderId: pedido.id },
    });

    /*
     * Sin esto el sub-pedido se quedaba en ENVIADO para siempre: el pedido
     * constaba entregado mientras la compra constaba en camino, y a las tres
     * semanas el paquete aparecía como posible perdido estando ya en casa del
     * cliente.
     */
    expect(sub.status).toBe('DELIVERED');
    expect(sub.deliveredAt).not.toBeNull();
  });

  it('cierra el pedido por su propia acción, que anota quién lo cerró', async () => {
    const pedido = await entorno.prisma.client.order.findFirstOrThrow({
      where: { email: 'cliente@ejemplo.es' },
      orderBy: { createdAt: 'desc' },
    });

    await entorno.peticion({
      metodo: 'POST',
      ruta: `/api/v1/orders/${pedido.id}/status`,
      token,
      cuerpo: { status: 'PENDING_CLOSE' },
    });

    const { estado } = await entorno.peticion({
      metodo: 'POST',
      ruta: `/api/v1/orders/${pedido.id}/close`,
      token,
    });
    expect(estado).toBe(200);

    const cerrado = await entorno.prisma.client.order.findUniqueOrThrow({
      where: { id: pedido.id },
    });
    expect(cerrado.status).toBe('CLOSED');
    // Es lo que responde después a «¿quién dio esto por bueno?».
    expect(cerrado.closedBy).not.toBeNull();
    expect(cerrado.closedAt).not.toBeNull();
  });

  it('crea la marca del proveedor y se la asigna al producto', async () => {
    /*
     * Dreamlove manda el fabricante de cada artículo y hasta ahora se tiraba.
     * Se comprueba con la RAÍZ de su jerarquía: el fichero dice «SATISFYER
     * |SATISFYER PLUGS», donde lo segundo es una gama y no una marca.
     */
    const producto = await entorno.prisma.client.product.findFirstOrThrow({
      where: { translations: { some: { name: 'SATISFYER - DOUBLE BALL-R' } } },
      include: { brand: true },
    });

    expect(producto.brand?.name).toBe('SATISFYER');
    expect(producto.brand?.handle).toBe('satisfyer');
  });

  it('no duplica la marca al importar un segundo producto suyo', async () => {
    const marcas = await entorno.prisma.client.brand.findMany({ where: { handle: 'satisfyer' } });

    // El importador crea la marca si no existe; con dos productos de la misma
    // habría dos filas y el catálogo partiría al fabricante en dos.
    expect(marcas).toHaveLength(1);
  });

  it('la marca se puede cambiar a mano desde la ficha del producto', async () => {
    // Es el fallo que había: la API aceptaba `categoryId` y `brandId` desde
    // siempre y el panel no los pintaba, así que no había forma de asignarlos.
    const otra = await entorno.peticion<{ id: string }>({
      metodo: 'POST',
      ruta: '/api/v1/brands',
      token,
      cuerpo: { name: 'Marca Elegida A Mano' },
    });
    expect(otra.estado).toBe(201);

    const producto = await entorno.prisma.client.product.findFirstOrThrow({
      where: { translations: { some: { name: 'SATISFYER - DOUBLE BALL-R' } } },
    });

    const categoria = await entorno.prisma.client.category.create({
      data: {
        id: newId(),
        handle: `cat-${newId().slice(0, 6)}`,
        path: '/prueba/',
        depth: 0,
        translations: { create: { id: newId(), locale: 'es', name: 'Prueba', slug: 'prueba' } },
      },
    });

    const guardado = await entorno.peticion({
      metodo: 'PATCH',
      ruta: `/api/v1/catalog/products/${producto.id}`,
      token,
      cuerpo: { brandId: otra.datos.id, categoryId: categoria.id },
    });
    expect(guardado.estado, JSON.stringify(guardado.datos)).toBe(200);

    const despues = await entorno.prisma.client.product.findUniqueOrThrow({
      where: { id: producto.id },
    });
    expect(despues.brandId).toBe(otra.datos.id);
    expect(despues.categoryId).toBe(categoria.id);
  });

  it('no deja borrar una marca con productos', async () => {
    // BATHMATE y no SATISFYER: a esa acaban de cambiarle la marca en la prueba
    // anterior, así que se quedó sin productos y sí se podría borrar.
    const marca = await entorno.prisma.client.brand.findFirstOrThrow({
      where: { handle: 'bathmate' },
    });

    const { estado, datos } = await entorno.peticion<{ message: string }>({
      metodo: 'DELETE',
      ruta: `/api/v1/brands/${marca.id}`,
      token,
    });

    // Borrarla dejaría sus productos sin marca y sin forma de saber cuál era.
    expect(estado).toBe(400);
    expect(datos.message).toContain('producto');
  });

  it('rechaza un fichero que no es un catálogo', async () => {
    const limite = '----pruebasdreamlove';
    const cuerpo = Buffer.concat([
      Buffer.from(
        `--${limite}\r\nContent-Disposition: form-data; name="fichero"; filename="notas.txt"\r\n\r\n`,
      ),
      Buffer.from('esto no es un catálogo'),
      Buffer.from(`\r\n--${limite}--\r\n`),
    ]);

    const respuesta = await entorno.app.inject({
      method: 'POST',
      url: `/api/v1/suppliers/${supplierId}/catalog/upload`,
      payload: cuerpo,
      headers: {
        'content-type': `multipart/form-data; boundary=${limite}`,
        authorization: `Bearer ${token}`,
      },
    });

    expect(respuesta.statusCode).toBe(400);
  });
});
