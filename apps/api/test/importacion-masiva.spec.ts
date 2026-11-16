import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEntorno, vaciarBase, type EntornoPruebas } from './entorno.js';

/**
 * El botón que sube el catálogo entero del proveedor a la tienda.
 *
 * Procesar el fichero de Dreamlove deja su catálogo guardado, pero no pone ni
 * un producto a la venta: eso había que hacerlo artículo por artículo desde el
 * buscador, y con 945 familias significa que la tienda no se llena nunca.
 *
 * Lo que se comprueba aquí es la cadena entera contra una base de datos de
 * verdad, que es donde viven los fallos de esto: que cada producto acabe en su
 * categoría y con su marca, que el precio sea el que recomienda el proveedor
 * —salvo cuando ese precio da pérdidas—, y que volver a pulsar el botón
 * actualice en vez de duplicar media tienda.
 */

let entorno: EntornoPruebas;
let token: string;
let supplierId: string;

/**
 * Un catálogo con la forma exacta del que mandan, recortado a lo que importa.
 *
 * Tres artículos y tres casos: un suelto con IVA reducido, una familia de dos
 * colores —que en la tienda es UN producto— y un chollo cuyo PVP recomendado
 * no llega ni a cubrir lo que cuesta comprarlo.
 */
function catalogo({ pvprFamilia = '33.95', stockAzul = 7 } = {}): string {
  const suelto = `<product><id>5856</id><public_id>D-196690</public_id><updated>2026-07-30 14:09:35</updated><available>1</available><cost_price>33.14</cost_price><recommended_retail_price_with_taxes>84.99</recommended_retail_price_with_taxes><default_shipping_cost>18.66</default_shipping_cost><min_units_per_order>1</min_units_per_order><max_units_per_order>999</max_units_per_order><vat>4.00</vat><title><![CDATA[BATHMATE - HYDRO 7 HERCULES TRANSPARENT]]></title><html_description><![CDATA[<p>Hydraulic pump</p>]]></html_description><brand><![CDATA[BATHMATE]]></brand><categories><category gesioid="2" ref="Juguetes Sexuales XXX" maincategory="1"><![CDATA[LOVETOYS]]></category></categories><internationalization><title><value lang="es-ES"><![CDATA[BATHMATE - HYDRO 7 HÉRCULES TRANSPARENTE]]></value></title></internationalization><images scope="all"><image preferred="1"><name /><src>https://store.dreamlove.es/bathmate.jpg</src></image></images><stock><location path="General">50</location></stock></product>`;

  const color = (id: string, codigo: string, nombre: string, stock: number): string =>
    `<product><id>${id}</id><public_id>${codigo}</public_id><updated>2026-07-30 14:11:45</updated><available>${stock > 0 ? 1 : 0}</available><cost_price>10.67</cost_price><recommended_retail_price_with_taxes>${pvprFamilia}</recommended_retail_price_with_taxes><default_shipping_cost>18.66</default_shipping_cost><min_units_per_order>1</min_units_per_order><max_units_per_order>99</max_units_per_order><vat>21.00</vat><title>SATISFYER - DOUBLE BALL-R ${nombre}</title><html_description><![CDATA[<p>Dildo de silicona</p>]]></html_description><brand>SATISFYER</brand><categories><category gesioid="14" ref="Dildos" maincategory="1">LOVETOYS|Dildos without Vibration</category></categories><internationalization><title><value lang="es-ES">SATISFYER - DOUBLE BALL-R SILICONA ${nombre}</value></title><variant_common_title><value lang="es-ES">SATISFYER - DOUBLE BALL-R</value></variant_common_title></internationalization><images scope="all"><image preferred="1"><name /><src>https://store.dreamlove.es/${id}.jpg</src></image></images><variant><item_group_id>0000046116</item_group_id><common_title>SATISFYER - DOUBLE BALL-R</common_title><var_name_1>Color</var_name_1><var_value_1>${nombre}</var_value_1></variant><stock><location path="General">${stock}</location></stock></product>`;

  // 10,00 € de coste y 10,50 € de PVP recomendado: la base son 8,68 €, así que
  // venderlo a lo que dice el proveedor es perder 1,32 € por unidad.
  const chollo = `<product><id>7001</id><public_id>D-700001</public_id><updated>2026-07-30 14:12:00</updated><available>1</available><cost_price>10.00</cost_price><recommended_retail_price_with_taxes>10.50</recommended_retail_price_with_taxes><default_shipping_cost>18.66</default_shipping_cost><min_units_per_order>1</min_units_per_order><max_units_per_order>99</max_units_per_order><vat>21.00</vat><title>DREAMLOVE - PACK LUBRICANTE</title><html_description><![CDATA[<p>Pack</p>]]></html_description><brand>DREAMLOVE</brand><categories><category gesioid="2" ref="Juguetes Sexuales XXX" maincategory="1"><![CDATA[LOVETOYS]]></category></categories><images scope="all"><image preferred="1"><name /><src>https://store.dreamlove.es/pack.jpg</src></image></images><stock><location path="General">12</location></stock></product>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog batchnumber="1">
${suelto}
${color('46116', 'D-237594', 'GRANATE', 4)}
${color('46117', 'D-237595', 'AZUL', stockAzul)}
${chollo}
</catalog>`;
}

/** Sube el catálogo por el mismo camino que el panel: multipart. */
async function subirCatalogo(xml: string): Promise<void> {
  const limite = '----pruebasmasiva';

  const cuerpo = Buffer.concat([
    Buffer.from(
      `--${limite}\r\nContent-Disposition: form-data; name="fichero"; filename="dreamlove.xml"\r\n` +
        `Content-Type: application/xml\r\n\r\n`,
    ),
    Buffer.from(xml, 'utf8'),
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

  await esperar(async () => {
    const ultima = await entorno.prisma.client.supplierCatalogImport.findFirst({
      where: { supplierId },
      orderBy: { startedAt: 'desc' },
    });
    if (ultima?.status === 'FAILED') throw new Error(`Catálogo fallido: ${ultima.errorDetail}`);
    return ultima?.status === 'COMPLETED';
  }, 'El catálogo no ha terminado de procesarse');
}

async function esperar(condicion: () => Promise<boolean>, queja: string): Promise<void> {
  for (let intento = 0; intento < 150; intento++) {
    if (await condicion()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(queja);
}

interface TrabajoMasivo {
  status: string;
  total: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  pricedFromRrp: number;
  belowMinMargin: number;
  pricesKept: number;
  pricedByMargin: number;
  failures: { referencia: string; motivo: string }[];
}

/**
 * Lanza la importación masiva y espera a que termine.
 *
 * Sin fotos: descargarlas saldría a internet desde una prueba, y lo que se
 * comprueba aquí es lo que se crea, no cómo se baja un JPEG.
 */
async function importarTodo(opciones: Record<string, unknown> = {}): Promise<TrabajoMasivo> {
  const { estado, datos } = await entorno.peticion<{ jobId: string }>({
    metodo: 'POST',
    ruta: `/api/v1/suppliers/${supplierId}/catalog-file/import-all`,
    token,
    cuerpo: { descargarImagenes: false, ...opciones },
  });
  expect(estado, JSON.stringify(datos)).toBe(202);

  let ultimo: TrabajoMasivo | null = null;
  await esperar(async () => {
    const respuesta = await entorno.peticion<TrabajoMasivo>({
      metodo: 'GET',
      ruta: `/api/v1/suppliers/${supplierId}/catalog-file/import-all/status`,
      token,
    });
    ultimo = respuesta.datos;
    return ultimo.status !== 'RUNNING';
  }, 'La importación masiva no ha terminado a tiempo');

  return ultimo as unknown as TrabajoMasivo;
}

/** El producto que salió de una familia del proveedor, con todo lo que interesa. */
async function productoDe(externalProductId: string) {
  const enlace = await entorno.prisma.client.supplierProduct.findFirstOrThrow({
    where: { supplierId, externalProductId },
    select: { productId: true },
  });

  return entorno.prisma.client.product.findUniqueOrThrow({
    where: { id: enlace.productId },
    include: {
      variants: { orderBy: { position: 'asc' } },
      brand: true,
      category: { include: { translations: { where: { locale: 'es' } } } },
    },
  });
}

beforeAll(async () => {
  entorno = await crearEntorno();
  await vaciarBase(entorno);

  ({ token } = await entorno.personal([
    'suppliers:read',
    'suppliers:write',
    'products:import',
    'products:write',
  ]));

  const alta = await entorno.peticion<{ id: string }>({
    metodo: 'POST',
    ruta: '/api/v1/suppliers',
    token,
    cuerpo: { key: 'dreamlove', name: 'Dreamlove', defaultMarginPct: 60, minMarginPct: 25 },
  });
  expect(alta.estado, JSON.stringify(alta.datos)).toBe(201);
  supplierId = alta.datos.id;

  await subirCatalogo(catalogo());

  // El árbol del proveedor, creado como lo crea el panel antes de importar.
  const categorias = await entorno.peticion({
    metodo: 'POST',
    ruta: `/api/v1/suppliers/${supplierId}/categories/sync`,
    token,
    cuerpo: {},
  });
  expect(categorias.estado).toBe(200);

  // Es una tienda +18 entera: se marca la raíz, y lo que cuelgue de ella
  // hereda. Sirve para comprobar que el producto importado también lo hace.
  await entorno.prisma.client.category.updateMany({ data: { isAdult: true } });
});

afterAll(async () => {
  await entorno.app.close();
});

describe('subir el catálogo entero a la tienda', () => {
  it('crea un producto por familia, publicado y sin duplicar los colores', async () => {
    const trabajo = await importarTodo();

    expect(trabajo.status).toBe('COMPLETED');
    expect(trabajo.failures).toEqual([]);
    expect(trabajo.errors).toBe(0);
    // Cuatro artículos, tres productos: los dos colores son uno solo.
    expect(trabajo.total).toBe(3);
    expect(trabajo.created).toBe(3);
    expect(trabajo.updated).toBe(0);

    const familia = await productoDe('0000046116');
    expect(familia.variants).toHaveLength(2);
    expect(familia.status).toBe('ACTIVE');
    expect(familia.publishedAt).not.toBeNull();
  });

  it('cada producto va a su categoría y con su marca', async () => {
    /*
     * El objeto de todo esto. Antes había que elegir las dos cosas a mano
     * producto a producto, así que en la práctica el catálogo entraba sin
     * categoría —y sin categoría no se puede navegar la tienda— y sin marca.
     */
    const familia = await productoDe('0000046116');
    expect(familia.category?.translations[0]?.name).toBe('Dildos');
    expect(familia.brand?.name).toBe('SATISFYER');

    const suelto = await productoDe('5856');
    expect(suelto.category?.translations[0]?.name).toBe('Juguetes Sexuales XXX');
    expect(suelto.brand?.name).toBe('BATHMATE');
  });

  it('el precio es el PVP que recomienda el proveedor', async () => {
    const familia = await productoDe('0000046116');

    // 33,95 € es lo que el proveedor recomienda y lo que cobra el resto del
    // sector. Calcularlo por margen daría otro número, y sería el nuestro
    // contra el del mercado.
    expect(familia.variants.map((v) => v.priceCents)).toEqual([3395, 3395]);

    const suelto = await productoDe('5856');
    expect(suelto.variants[0]?.priceCents).toBe(8499);
    // Y con el IVA que declara el artículo, que aquí es el reducido.
    expect(Number(suelto.taxRate)).toBe(4);
  });

  it('el PVPR manda aunque deje menos del margen mínimo', async () => {
    const chollo = await productoDe('7001');

    /*
     * 10,50 € de PVP sobre 10 € de coste: a ese precio se pierde dinero, y aun
     * así se publica a 10,50 €.
     *
     * Es la regla de la casa: el precio lo pone el proveedor. Subirlo hasta
     * que la cuenta cuadre lo deja por encima de lo que cobra cualquier otra
     * tienda y no se vende ninguno. Lo que se hace con un artículo así es
     * dejar de venderlo, y para eso está el recuento de abajo.
     */
    expect(chollo.variants[0]?.priceCents).toBe(1050);
  });

  it('cuenta de dónde ha salido cada precio', async () => {
    const trabajo = await entorno.peticion<TrabajoMasivo>({
      metodo: 'GET',
      ruta: `/api/v1/suppliers/${supplierId}/catalog-file/import-all/status`,
      token,
    });

    // Las cuatro variantes van al precio del proveedor. Ninguna se ha
    // calculado por margen porque todas traen PVPR.
    expect(trabajo.datos.pricedFromRrp).toBe(4);
    expect(trabajo.datos.pricedByMargin).toBe(0);

    // Y una de ellas queda por debajo del margen mínimo: no se ha corregido,
    // se ha señalado. Es lo que permite decidir si merece la pena venderla.
    expect(trabajo.datos.belowMinMargin).toBe(1);
  });

  it('hereda el +18 de su categoría', async () => {
    // De esto depende que el producto pase por la puerta de edad y que se
    // quede fuera del feed de Google. Marcarlo «después» con novecientos
    // productos publicados no llega nunca.
    const familia = await productoDe('0000046116');
    expect(familia.isAdult).toBe(true);
  });

  it('volver a pulsarlo actualiza precios y stock en vez de duplicar', async () => {
    // Catálogo nuevo: el color azul baja de 7 a 2 unidades y la familia sube
    // de 33,95 € a 39,95 €.
    await subirCatalogo(catalogo({ pvprFamilia: '39.95', stockAzul: 2 }));

    const trabajo = await importarTodo();

    expect(trabajo.created).toBe(0);
    expect(trabajo.updated).toBe(3);
    expect(trabajo.errors).toBe(0);

    const familia = await productoDe('0000046116');
    expect(familia.variants.map((v) => v.priceCents)).toEqual([3995, 3995]);

    // Y el catálogo de la tienda no ha crecido: sigue habiendo tres productos.
    const productos = await entorno.prisma.client.product.count({ where: { deletedAt: null } });
    expect(productos).toBe(3);

    const azul = await entorno.prisma.client.supplierProduct.findFirstOrThrow({
      where: { supplierId, externalVariantId: '46117' },
    });
    expect(azul.stock).toBe(2);
  });

  it('la sincronización sigue el PVP del proveedor en vez de repreciar por margen', async () => {
    /*
     * Esta es la mitad que faltaba de «el precio lo pone el proveedor».
     *
     * Al procesar un catálogo nuevo se sincroniza solo lo que ya vendemos, sin
     * pasar por el botón de importar. Antes esa sincronización solo miraba
     * costes: en cuanto el margen se estrechaba recalculaba el PVP con el
     * margen objetivo y deshacía cada noche lo que había hecho la importación.
     */
    await subirCatalogo(catalogo({ pvprFamilia: '29.95', stockAzul: 6 }));

    await esperar(async () => {
      const enlace = await entorno.prisma.client.supplierProduct.findFirstOrThrow({
        where: { supplierId, externalVariantId: '46117' },
      });
      if (!enlace.variantId) return false;

      const variante = await entorno.prisma.client.productVariant.findUniqueOrThrow({
        where: { id: enlace.variantId },
      });
      return variante.priceCents === 2995;
    }, 'La sincronización no ha trasladado el PVP nuevo del proveedor');

    // Y el del chollo, que va por debajo del mínimo, sigue intacto: se avisa,
    // no se corrige.
    const chollo = await productoDe('7001');
    expect(chollo.variants[0]?.priceCents).toBe(1050);
  });

  it('el precio nuevo queda en el histórico, que es lo que mide un descuento', async () => {
    const familia = await productoDe('0000046116');
    const variantId = familia.variants[0]?.id ?? '';

    const historico = await entorno.prisma.client.priceHistory.findMany({
      where: { variantId },
      orderBy: { validFrom: 'asc' },
      select: { priceCents: true },
    });

    // Sin estos puntos no hay forma de calcular el mínimo de los últimos 30
    // días, que es contra lo que la ley mide un descuento anunciado. Cada
    // cambio de precio del proveedor deja el suyo, venga de la importación o
    // de la sincronización.
    expect(historico.map((h) => h.priceCents)).toEqual([3395, 3995, 2995]);
  });

  it('con el interruptor apagado no toca los precios, pero sí el resto', async () => {
    /*
     * Arreglar categorías, marcas o existencias sin mover el escaparate.
     *
     * Es lo que hacía falta para poder pasar el importador en mitad de una
     * campaña: hasta ahora repreciaba todo lo que ya existía sin preguntar, así
     * que tocar cualquier otra cosa significaba aceptar un cambio de precios en
     * la tienda entera.
     */
    // Un precio puesto a mano en la tienda, distinto del que manda el
    // proveedor: es lo que el interruptor tiene que proteger.
    const familia = await productoDe('0000046116');
    await entorno.prisma.client.productVariant.updateMany({
      where: { productId: familia.id },
      data: { priceCents: 9999 },
    });

    const trabajo = await importarTodo({ actualizarPrecios: false });

    expect(trabajo.status).toBe('COMPLETED');
    expect(trabajo.errors).toBe(0);
    // Ha recorrido y actualizado los tres productos igualmente.
    expect(trabajo.updated).toBe(3);

    const despues = await productoDe('0000046116');
    expect(despues.variants.map((v) => v.priceCents)).toEqual([9999, 9999]);

    // Y no se atribuye un trabajo que no ha hecho: cero puestos al PVP del
    // proveedor, y contados los que se han dejado como estaban.
    expect(trabajo.pricedFromRrp).toBe(0);
    expect(trabajo.pricesKept).toBe(2);
  });

  it('con el interruptor encendido vuelve a mandar el precio del proveedor', async () => {
    const trabajo = await importarTodo({ actualizarPrecios: true });

    // El catálogo vigente lo publica a 29,95 €, así que el precio puesto a mano
    // en la prueba anterior se pierde: es exactamente lo que se pide al
    // encender el interruptor.
    const familia = await productoDe('0000046116');
    expect(familia.variants.map((v) => v.priceCents)).toEqual([2995, 2995]);
    expect(trabajo.pricesKept).toBe(0);
    expect(trabajo.pricedFromRrp).toBeGreaterThan(0);
  });

  it('se puede probar con unas pocas antes de soltar el catálogo entero', async () => {
    const trabajo = await importarTodo({ limite: 1 });

    // El tope cuenta productos, no artículos: es lo que dice el botón.
    expect(trabajo.total).toBe(1);
    expect(trabajo.processed).toBe(1);
  });

  it('no deja lanzar dos a la vez', async () => {
    /*
     * Dos pasadas simultáneas crearían el mismo producto dos veces: ninguna
     * vería el enlace de la otra hasta tenerlo escrito, y la tienda acabaría
     * con medio catálogo duplicado.
     *
     * Se siembra el trabajo en curso en lugar de lanzar dos peticiones a la
     * vez: con este catálogo de tres productos la primera termina antes de que
     * salga la segunda, y la prueba pasaría o fallaría según lo rápido que
     * vaya la máquina.
     */
    const enCurso = await entorno.prisma.client.supplierBulkImport.create({
      data: { id: `prueba-${supplierId}`, supplierId, status: 'RUNNING' },
    });

    const segunda = await entorno.peticion<{ message: string }>({
      metodo: 'POST',
      ruta: `/api/v1/suppliers/${supplierId}/catalog-file/import-all`,
      token,
      cuerpo: { descargarImagenes: false },
    });

    expect(segunda.estado).toBe(400);
    expect(segunda.datos.message).toContain('en curso');

    // Y se puede desbloquear cancelando, sin esperar a que caduque.
    const cancelacion = await entorno.peticion<{ cancelando: boolean }>({
      metodo: 'POST',
      ruta: `/api/v1/suppliers/${supplierId}/catalog-file/import-all/cancel`,
      token,
      cuerpo: {},
    });
    expect(cancelacion.datos.cancelando).toBe(true);

    const marcado = await entorno.prisma.client.supplierBulkImport.findUniqueOrThrow({
      where: { id: enCurso.id },
    });
    expect(marcado.cancelRequested).toBe(true);
  });
});
