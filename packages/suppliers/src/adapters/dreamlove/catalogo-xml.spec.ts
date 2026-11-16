import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { recorrerCatalogoDreamlove } from './catalogo-xml.js';
import type { ArticuloDreamlove } from './tipos.js';

/**
 * Fragmento reducido del catálogo real.
 *
 * Se han recortado las descripciones largas y los idiomas que no usamos, pero
 * la FORMA es exactamente la del fichero que manda Dreamlove: CDATA en los
 * textos, el título en inglés fuera y el español dentro de
 * `internationalization`, las banderas en atributos y cada color como producto
 * suelto unido por `item_group_id`.
 */
const CATALOGO = `<?xml version="1.0" encoding="UTF-8"?>
<catalog batchnumber="1">
	<product><id>5856</id><public_id>D-196690</public_id><updated>2026-07-30 14:09:35</updated><available>1</available><cost_price>33.14</cost_price><price>70.24</price><price_with_taxes>84.99</price_with_taxes><recommended_retail_price>70.24</recommended_retail_price><recommended_retail_price_with_taxes>84.99</recommended_retail_price_with_taxes><product_url>https://store.dreamlove.es/bathmate-p-1-51-5856</product_url><default_shipping_cost>18.66</default_shipping_cost><delivery_desc>2-3 días</delivery_desc><min_units_per_order>1</min_units_per_order><max_units_per_order>999</max_units_per_order><vat>21.00</vat><title><![CDATA[BATHMATE - HYDRO 7 HERCULES TRANSPARENT]]></title>
<description><![CDATA[BATHMATE - HYDRO 7 HERCULES CLEAR]]></description><html_description><![CDATA[<p>Hydraulic pump</p>]]></html_description><release_date>2025-12-04</release_date><destocking>0</destocking><brand><![CDATA[BATHMATE]]></brand><brand_hierarchy><![CDATA[BATHMATE]]></brand_hierarchy><shipping_weight unit="g">326</shipping_weight><sale value="0" /><size unit="mm"><width>96</width><height>306</height><depth>93</depth></size><refrigerated value="0" /><new value="1" /><barcodes><barcode type="EAN-13"><![CDATA[5060140209928]]></barcode></barcodes><categories><category gesioid="2" ref="Juguetes Sexuales XXX"><![CDATA[LOVETOYS]]></category></categories><internationalization><title><value lang="en-UK"><![CDATA[BATHMATE - HYDRO 7 HERCULES TRANSPARENT]]></value><value lang="es-ES"><![CDATA[BATHMATE - HYDRO 7 HÉRCULES TRANSPARENTE]]></value></title><description><value lang="es-ES"><![CDATA[Bomba de vacío hidráulica]]></value></description><html_description><value lang="es-ES"><![CDATA[<p>Desarrollador con tecnología hidráulica</p>]]></value></html_description></internationalization><images scope="all"><image preferred="0"><name><![CDATA[]]></name><src>https://store.dreamlove.es/img_164589_a.jpg</src></image><image preferred="1"><name><![CDATA[]]></name><src>https://store.dreamlove.es/img_164590_b.jpg</src></image></images><stock><location path="General">50</location></stock><hs_intrastat_code>84138100</hs_intrastat_code></product>
	<product><id>46116</id><public_id>D-237594</public_id><updated>2026-07-30 14:11:45</updated><available>0</available><cost_price>10.67</cost_price><price>28.06</price><price_with_taxes>33.95</price_with_taxes><recommended_retail_price_with_taxes>33.95</recommended_retail_price_with_taxes><product_url>https://store.dreamlove.es/satisfyer-p-1-51-46116</product_url><default_shipping_cost>18.66</default_shipping_cost><delivery_desc>2-3 días</delivery_desc><min_units_per_order>1</min_units_per_order><max_units_per_order>99999999</max_units_per_order><vat>4.00</vat><title>SATISFYER - DOUBLE BALL-R SILICONE DILDO GARNET</title>
<destocking>1</destocking><brand>SATISFYER PLUGS</brand><brand_hierarchy>SATISFYER |SATISFYER PLUGS</brand_hierarchy><shipping_weight unit="g">462</shipping_weight><sale value="1" /><refrigerated value="0" /><new value="0" /><barcodes><barcode type="EAN-13">4061504048680</barcode></barcodes><categories><category gesioid="2" ref="Juguetes Sexuales XXX">LOVETOYS</category><category gesioid="14" ref="Dildos" maincategory="1">LOVETOYS|Dildos without Vibration</category></categories><internationalization><title><value lang="es-ES">SATISFYER - DOUBLE BALL-R DILDO SILICONA GRANATE</value></title></internationalization><images scope="all"><image preferred="1"><name /><src>https://store.dreamlove.es/img_161200_a.jpg</src></image></images><variant><item_group_id>0000046116</item_group_id><common_title>SATISFYER - DOUBLE BALL-R</common_title><var_groupname_1>TALLA</var_groupname_1><var_name_1>Talla</var_name_1><var_value_1 /><var_groupname_2>COLOR</var_groupname_2><var_name_2>Color</var_name_2><var_value_2>GRANATE</var_value_2><var_value_2_hex>670000</var_value_2_hex></variant><stock><location path="General">0</location></stock><hs_intrastat_code>39269097</hs_intrastat_code></product>
	<product><id>46117</id><public_id>D-237595</public_id><updated>2026-07-30 14:11:45</updated><available>1</available><cost_price>10.67</cost_price><recommended_retail_price_with_taxes>33.95</recommended_retail_price_with_taxes><default_shipping_cost>18.66</default_shipping_cost><delivery_desc>2-3 días</delivery_desc><min_units_per_order>1</min_units_per_order><max_units_per_order>99999999</max_units_per_order><vat>21.00</vat><title>SATISFYER - DOUBLE BALL-R SILICONE DILDO BLUE</title><internationalization><title><value lang="es-ES">SATISFYER - DOUBLE BALL-R DILDO SILICONA AZUL</value></title></internationalization><images scope="all"><image preferred="1"><name /><src>https://store.dreamlove.es/img_161204_a.jpg</src></image></images><variant><item_group_id>0000046116</item_group_id><var_name_1>Talla</var_name_1><var_value_1 /><var_name_2>Color</var_name_2><var_value_2>AZUL</var_value_2></variant><stock><location path="General">7</location></stock></product>
	<product><id></id><title>FILA SIN IDENTIFICADOR</title><cost_price>1.00</cost_price><stock><location path="General">3</location></stock></product>
</catalog>`;

async function leer(xml: string, tamanoTrozo?: number) {
  const articulos: ArticuloDreamlove[] = [];

  const fuente = tamanoTrozo
    ? Readable.from(trocear(Buffer.from(xml, 'utf8'), tamanoTrozo))
    : Readable.from([Buffer.from(xml, 'utf8')]);

  const resumen = await recorrerCatalogoDreamlove(fuente, (a) => {
    articulos.push(a);
  });

  return { articulos, resumen };
}

function* trocear(datos: Buffer, tamano: number): Generator<Buffer> {
  for (let i = 0; i < datos.length; i += tamano) yield datos.subarray(i, i + tamano);
}

describe('lectura del catálogo de Dreamlove', () => {
  it('lee todos los productos válidos y descarta los que no lo son', async () => {
    const { articulos, resumen } = await leer(CATALOGO);

    expect(articulos).toHaveLength(3);
    // La fila sin `id` no se puede guardar ni volver a encontrar: se cuenta y
    // se sigue, porque abortar dejaría la tienda sin las otras 12.912.
    expect(resumen.descartados).toBe(1);
    expect(resumen.articulos).toBe(3);
    expect(resumen.erroresXml).toBe(0);
  });

  it('se queda con el texto en español y no con el inglés de fuera', async () => {
    const [bathmate] = (await leer(CATALOGO)).articulos;

    // El `<title>` suelto dice TRANSPARENT; el español está dentro de
    // internationalization. Coger el de fuera llenaría de inglés una tienda
    // española teniendo la traducción en el mismo fichero.
    expect(bathmate?.titulo).toBe('BATHMATE - HYDRO 7 HÉRCULES TRANSPARENTE');
    expect(bathmate?.descripcion).toBe('Bomba de vacío hidráulica');
    expect(bathmate?.descripcionHtml).toContain('tecnología hidráulica');
  });

  it('se queda con la marca raíz y no con la línea de producto', async () => {
    const { articulos } = await leer(CATALOGO);

    // «SATISFYER |SATISFYER PLUGS» son un fabricante y una gama suya. En la
    // tienda interesa el fabricante: importar por la hoja llenaría el catálogo
    // de marcas inventadas y partiría a SATISFYER en seis trozos.
    expect(articulos[1]?.marca).toBe('SATISFYER PLUGS');
    expect(articulos[1]?.marcaRaiz).toBe('SATISFYER');

    // Sin jerarquía, la marca suelta es lo único que hay.
    expect(articulos[0]?.marcaRaiz).toBe('BATHMATE');
  });

  it('cae al idioma por defecto cuando no hay traducción', async () => {
    const [bathmate] = (await leer(CATALOGO)).articulos;
    expect(bathmate?.marca).toBe('BATHMATE');

    // El tercero no trae descripción en ningún idioma: queda vacía, no rota.
    const tercero = (await leer(CATALOGO)).articulos[2];
    expect(tercero?.descripcion).toBe('');
  });

  it('convierte los importes a céntimos enteros', async () => {
    const [bathmate] = (await leer(CATALOGO)).articulos;

    expect(bathmate?.costeCents).toBe(3314);
    expect(bathmate?.pvpRecomendadoCents).toBe(8499);
    expect(Number.isInteger(bathmate?.costeCents)).toBe(true);
  });

  it('lee el IVA de cada artículo, que no siempre es el 21 %', async () => {
    const { articulos } = await leer(CATALOGO);

    expect(articulos[0]?.ivaPct).toBe(21);
    // Facturar al 21 % lo que va al 4 % es cobrar de más al cliente y declarar
    // de más a Hacienda.
    expect(articulos[1]?.ivaPct).toBe(4);
  });

  it('guarda los portes como dato del pedido, no como coste de la línea', async () => {
    const { articulos } = await leer(CATALOGO);

    // Los 18,66 € son iguales en los 12.913 productos del catálogo: son el
    // porte del pedido. Sumarlos a cada artículo subiría todos los PVP.
    expect(articulos.every((a) => a.portesPedidoCents === 1866)).toBe(true);
  });

  it('pone delante la imagen que el proveedor marca como preferida', async () => {
    const [bathmate] = (await leer(CATALOGO)).articulos;

    // En el XML la preferida va segunda; en la tienda es la de portada.
    expect(bathmate?.imagenes[0]).toContain('img_164590_b.jpg');
    expect(bathmate?.imagenes).toHaveLength(2);
  });

  it('agrupa las variantes por item_group_id y lee sus opciones', async () => {
    const { articulos } = await leer(CATALOGO);
    const [, granate, azul] = articulos;

    expect(granate?.grupoId).toBe('0000046116');
    expect(azul?.grupoId).toBe('0000046116');

    // La clave de agrupación: el grupo si lo hay, y si no el propio artículo.
    expect(granate?.claveGrupo).toBe('0000046116');
    expect(azul?.claveGrupo).toBe('0000046116');
    expect(articulos[0]?.claveGrupo).toBe('5856');

    // El título común no lleva el color, que es lo que distingue a los
    // hermanos: titular la ficha «… GRANATE» dejaría el azul vendiéndose bajo
    // el nombre del granate.
    expect(granate?.tituloGrupo).toBe('SATISFYER - DOUBLE BALL-R');
    expect(articulos[0]?.tituloGrupo).toBeNull();

    // «Talla» viene sin valor: crear esa opción obligaría al cliente a elegir
    // entre nada.
    expect(granate?.opciones).toEqual({ Color: 'GRANATE' });
    expect(azul?.opciones).toEqual({ Color: 'AZUL' });
  });

  it('no da por disponible lo que el proveedor no sirve', async () => {
    const { articulos } = await leer(CATALOGO);
    const [bathmate, granate, azul] = articulos;

    expect(bathmate?.disponible).toBe(true);
    // available=0 y stock 0: ni una cosa ni la otra.
    expect(granate?.disponible).toBe(false);
    expect(granate?.stock).toBe(0);
    expect(azul?.stock).toBe(7);
    expect(azul?.disponible).toBe(true);
  });

  it('elige la categoría principal y guarda su nombre en español', async () => {
    const { articulos } = await leer(CATALOGO);

    // El segundo está en dos categorías; la buena es la que lleva maincategory.
    expect(articulos[1]?.categoria).toEqual(['LOVETOYS', 'Dildos without Vibration']);
    expect(articulos[1]?.categoriaEs).toBe('Dildos');
    // Con una sola, esa.
    expect(articulos[0]?.categoriaEs).toBe('Juguetes Sexuales XXX');
  });

  it('se queda con TODAS, que son la cadena de ancestros', async () => {
    /*
     * No son alternativas entre las que elegir: el artículo declara su rama
     * entera y cada escalón trae su nombre en español. Es de donde sale el
     * árbol del proveedor, y quedarse solo con la principal dejaba sin nombre
     * a los niveles que ningún artículo tiene como principal.
     */
    const { articulos } = await leer(CATALOGO);

    expect(articulos[1]?.categorias).toEqual([
      { ruta: ['LOVETOYS'], nombreEs: 'Juguetes Sexuales XXX' },
      { ruta: ['LOVETOYS', 'Dildos without Vibration'], nombreEs: 'Dildos' },
    ]);

    // Y la principal sigue siendo la marcada, no la última de la lista.
    expect(articulos[1]?.categoriaEs).toBe('Dildos');
  });

  it('lee las banderas, que viajan en atributos y no en el texto', async () => {
    const { articulos } = await leer(CATALOGO);

    expect(articulos[0]?.esNovedad).toBe(true);
    expect(articulos[0]?.enOferta).toBe(false);
    expect(articulos[1]?.enOferta).toBe(true);
    expect(articulos[1]?.liquidacion).toBe(true);
  });

  it('lee el resto de datos de la ficha', async () => {
    const [bathmate] = (await leer(CATALOGO)).articulos;

    expect(bathmate?.codigo).toBe('D-196690');
    expect(bathmate?.eans).toEqual(['5060140209928']);
    expect(bathmate?.pesoGramos).toBe(326);
    expect(bathmate?.medidasMm).toEqual({ ancho: 96, alto: 306, fondo: 93 });
    expect(bathmate?.plazoDias).toEqual({ min: 2, max: 3 });
    expect(bathmate?.codigoArancelario).toBe('84138100');
    expect(bathmate?.actualizadoEn?.getFullYear()).toBe(2026);
  });

  it('lee igual aunque el fichero llegue partido en trozos diminutos', async () => {
    // Es la situación real: 340 MB llegan en trozos de 64 KB y un acento puede
    // quedar partido entre dos. Con 7 bytes se fuerza el peor caso.
    const { articulos, resumen } = await leer(CATALOGO, 7);

    expect(resumen.articulos).toBe(3);
    expect(articulos[0]?.titulo).toBe('BATHMATE - HYDRO 7 HÉRCULES TRANSPARENTE');
    expect(articulos[0]?.descripcion).toBe('Bomba de vacío hidráulica');
  });

  it('espera a que se guarde cada artículo antes de seguir leyendo', async () => {
    // Sin esta espera, leer va mucho más rápido que guardar y los artículos
    // pendientes se acumulan en memoria hasta tumbar el proceso.
    let enVuelo = 0;
    let maximoEnVuelo = 0;

    await recorrerCatalogoDreamlove(Readable.from([Buffer.from(CATALOGO, 'utf8')]), async () => {
      enVuelo++;
      maximoEnVuelo = Math.max(maximoEnVuelo, enVuelo);
      await new Promise((r) => setTimeout(r, 1));
      enVuelo--;
    });

    expect(maximoEnVuelo).toBe(1);
  });

  it('sigue adelante cuando el XML trae un error de sintaxis', async () => {
    // Un fichero de 340 MB con una entidad mal escrita en la descripción de un
    // artículo no puede tirar la importación de los demás.
    const roto = CATALOGO.replace('<p>Hydraulic pump</p>', '<p>Hydraulic & pump</p>');
    const { articulos } = await leer(roto);

    expect(articulos).toHaveLength(3);
  });
});
