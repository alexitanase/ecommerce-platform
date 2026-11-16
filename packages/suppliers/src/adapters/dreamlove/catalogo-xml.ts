import { StringDecoder } from 'node:string_decoder';
import { SaxesParser, type SaxesTagPlain } from 'saxes';
import { toCents } from '@ecom/shared';
import type { ArticuloDreamlove, CategoriaDreamlove, ResumenLectura } from './tipos.js';

/**
 * Lectura del catálogo XML de Dreamlove.
 *
 * El fichero pesa unos 340 MB para 12.913 productos: la descripción larga de
 * cada uno viene repetida en nueve idiomas. Cargarlo entero con un parser
 * normal son varios gigas de RAM y el proceso de la API muerto, así que se lee
 * en streaming y se va entregando producto a producto.
 *
 * Se construye el árbol de UN solo `<product>` cada vez y se descarta en
 * cuanto se convierte: en memoria nunca hay más de un artículo, pese al tamaño
 * del fichero.
 */

const IDIOMA = 'es-ES';

/** Nodo del árbol mínimo que se levanta para cada producto. */
interface Nodo {
  nombre: string;
  atributos: Record<string, string>;
  texto: string;
  hijos: Nodo[];
}

const hijo = (nodo: Nodo | undefined, nombre: string): Nodo | undefined =>
  nodo?.hijos.find((h) => h.nombre === nombre);

const hijos = (nodo: Nodo | undefined, nombre: string): Nodo[] =>
  nodo?.hijos.filter((h) => h.nombre === nombre) ?? [];

const texto = (nodo: Nodo | undefined, nombre: string): string =>
  hijo(nodo, nombre)?.texto.trim() ?? '';

const numero = (nodo: Nodo | undefined, nombre: string): number => {
  const valor = Number.parseFloat(texto(nodo, nombre));
  return Number.isFinite(valor) ? valor : 0;
};

/** `<sale value="1" />` y compañía: el dato va en el atributo, no en el texto. */
const bandera = (nodo: Nodo | undefined, nombre: string): boolean =>
  hijo(nodo, nombre)?.atributos['value'] === '1';

/**
 * El texto en español, con el idioma por defecto como red de seguridad.
 *
 * El `<title>` suelto del producto viene en inglés —«HYDRO 7 HERCULES
 * TRANSPARENT»— y la traducción española está dentro de
 * `<internationalization>`. Importar el de fuera llenaría una tienda española
 * de títulos en inglés teniendo el castellano en el mismo fichero.
 */
function enEspanol(producto: Nodo, campo: string): string {
  const bloque = hijo(hijo(producto, 'internationalization'), campo);
  const valor = hijos(bloque, 'value').find((v) => v.atributos['lang'] === IDIOMA);
  const traducido = valor?.texto.trim();
  return traducido && traducido.length > 0 ? traducido : texto(producto, campo);
}

/**
 * «2-3 días» → { min: 2, max: 3 }.
 *
 * Se lee del texto porque es lo único que dan. Si algún día cambian la forma
 * de escribirlo, se devuelve null y la ficha simplemente no promete plazo, que
 * es mejor que prometer uno inventado.
 */
function plazoDeEntrega(descripcion: string): { min: number; max: number } | null {
  const rango = /(\d+)\s*-\s*(\d+)/.exec(descripcion);
  if (rango?.[1] && rango[2]) return { min: Number(rango[1]), max: Number(rango[2]) };

  const suelto = /(\d+)/.exec(descripcion);
  return suelto?.[1] ? { min: Number(suelto[1]), max: Number(suelto[1]) } : null;
}

/**
 * La marca de verdad, sacada de la jerarquía.
 *
 * «SATISFYER |SATISFYER VIBRATOR» son dos cosas: el fabricante y una gama
 * suya. En la tienda interesa el primero. Se parte por la barra y se limpia el
 * espacio de sobra que traen algunas —«SATISFYER » viene así en el fichero—.
 *
 * Sin jerarquía se usa la marca suelta, que es lo único que hay.
 */
function raizDeLaMarca(jerarquia: string, marca: string): string | null {
  const raiz = jerarquia.split('|')[0]?.trim();
  return raiz || marca.trim() || null;
}

/**
 * Las opciones de variante que declara la fila.
 *
 * Vienen en pares numerados —`var_name_1`/`var_value_1`, `var_name_2`/…— y no
 * en una lista, así que se recorren hasta que dejan de existir. Los valores
 * vacíos se descartan: en un artículo sin tallas mandan «Talla» sin valor, y
 * una opción sin valores deja el producto sin poder comprarse.
 */
function opcionesDeVariante(variante: Nodo | undefined): Record<string, string> {
  const opciones: Record<string, string> = {};
  if (!variante) return opciones;

  for (let i = 1; i <= 6; i++) {
    const nombre = texto(variante, `var_name_${i}`);
    const valor = texto(variante, `var_value_${i}`);
    if (nombre && valor) opciones[nombre] = valor;
  }

  return opciones;
}

/** Una categoría del proveedor: su ruta en inglés y su nombre en español. */
function categoriaDeNodo(nodo: Nodo): CategoriaDreamlove | null {
  // El texto trae la ruta en inglés separada por barras: «LOVETOYS|Vibrators».
  const ruta = nodo.texto
    .split('|')
    .map((t) => t.trim())
    .filter(Boolean);
  if (ruta.length === 0) return null;

  // Y el atributo `ref`, el nombre en español de la hoja: «Vibradores».
  const nombreEs = nodo.atributos['ref']?.trim();
  return { ruta, nombreEs: nombreEs || (ruta[ruta.length - 1] ?? '') };
}

/**
 * Todas las categorías del artículo, y cuál es la suya de verdad.
 *
 * Un producto viene en varias y **no son alternativas: son su cadena de
 * ancestros**. Un vibrador realista trae las tres —`LOVETOYS`,
 * `LOVETOYS|Vibrators`, `LOVETOYS|Vibrators|Realistic Vibrators`—, cada una con
 * su propio nombre en español en el atributo `ref`.
 *
 * Por eso se devuelven todas y no solo la principal. Es la única forma de
 * construir el árbol en español: de las 311 rutas del catálogo de julio de
 * 2026, 18 no son la categoría principal de ningún artículo y solo aparecen
 * como escalón de otras. Quedándonos con la principal, esas 18 se quedarían sin
 * nombre y el árbol tendría ramas llamadas «SEX DRUGSTORE».
 *
 * La principal es la que lleva `maincategory="1"`. Cuando ninguna lo declara
 * —pasa en la mayoría— se usa la última, que es la más específica.
 */
function categoriasDelProducto(producto: Nodo): {
  todas: CategoriaDreamlove[];
  principal: CategoriaDreamlove | null;
} {
  // Se conserva el nodo junto a su categoría: si alguna se descarta por venir
  // vacía, buscar la principal por índice apuntaría a otra distinta.
  const pares = hijos(hijo(producto, 'categories'), 'category')
    .map((nodo) => ({ nodo, categoria: categoriaDeNodo(nodo) }))
    .filter((p): p is { nodo: Nodo; categoria: CategoriaDreamlove } => p.categoria !== null);

  const todas = pares.map((p) => p.categoria);
  if (todas.length === 0) return { todas, principal: null };

  const marcada = pares.find((p) => p.nodo.atributos['maincategory'] === '1');
  const principal = marcada?.categoria ?? todas[todas.length - 1] ?? null;

  return { todas, principal };
}

/**
 * Fotos del artículo, con la preferida delante.
 *
 * El orden del XML no es el de importancia: la que ellos marcan como
 * `preferred="1"` puede venir en tercer lugar, y esa es justo la que acaba de
 * portada en la tienda.
 */
function imagenes(producto: Nodo): string[] {
  const lista = hijos(hijo(producto, 'images'), 'image')
    .map((img) => ({
      url: texto(img, 'src'),
      preferida: img.atributos['preferred'] === '1',
    }))
    .filter((i) => i.url.startsWith('http'));

  return [
    ...lista.filter((i) => i.preferida).map((i) => i.url),
    ...lista.filter((i) => !i.preferida).map((i) => i.url),
  ];
}

/** Convierte el árbol de un `<product>` en el artículo que guardamos. */
export function articuloDesdeNodo(producto: Nodo): ArticuloDreamlove | null {
  const externalId = texto(producto, 'id');
  const titulo = enEspanol(producto, 'title');

  // Sin identificador no se puede ni guardar ni volver a encontrar, y sin
  // título no se puede publicar. Una fila así se descarta y se sigue: abortar
  // la importación entera por un producto roto dejaría la tienda sin catálogo.
  if (!externalId || !titulo) return null;

  const variante = hijo(producto, 'variant');
  const grupoId = texto(variante, 'item_group_id') || null;
  const stock = hijos(hijo(producto, 'stock'), 'location').reduce(
    (suma, l) => suma + (Number.parseInt(l.texto.trim(), 10) || 0),
    0,
  );

  const medidas = hijo(producto, 'size');
  const peso = hijo(producto, 'shipping_weight');
  const categorias = categoriasDelProducto(producto);
  const actualizado = new Date(texto(producto, 'updated').replace(' ', 'T'));

  return {
    externalId,
    codigo: texto(producto, 'public_id') || externalId,
    // Los ceros a la izquierda del grupo («0000046116») se conservan: es el
    // valor con el que agrupa el proveedor y normalizarlo por nuestra cuenta
    // sería inventarnos una clave que no es la suya.
    grupoId,
    claveGrupo: grupoId ?? externalId,

    titulo,
    // El título común llega en `common_title`, y su versión española en un
    // campo aparte de `internationalization` con otro nombre.
    tituloGrupo:
      enEspanol(producto, 'variant_common_title') || texto(variante, 'common_title') || null,
    descripcion: enEspanol(producto, 'description'),
    descripcionHtml: enEspanol(producto, 'html_description'),

    marca: texto(producto, 'brand') || null,
    marcaJerarquia: texto(producto, 'brand_hierarchy') || null,
    marcaRaiz: raizDeLaMarca(texto(producto, 'brand_hierarchy'), texto(producto, 'brand')),

    costeCents: toCents(numero(producto, 'cost_price')),
    pvpRecomendadoCents: toCents(numero(producto, 'recommended_retail_price_with_taxes')),
    // El catálogo trae 21, 10 y 4. Sin valor se asume el general: equivocarse
    // hacia arriba deja margen; hacia abajo, factura mal.
    ivaPct: numero(producto, 'vat') || 21,
    moneda: 'EUR',
    portesPedidoCents: toCents(numero(producto, 'default_shipping_cost')),

    stock,
    // Las dos condiciones: ellos pueden marcar un artículo como no disponible
    // aunque figure stock —descatalogado a medias, reservado— y venderlo
    // entonces significa un pedido que no nos podrán servir.
    disponible: texto(producto, 'available') === '1' && stock > 0,

    imagenes: imagenes(producto),
    categoria: categorias.principal?.ruta ?? [],
    categoriaEs: categorias.principal?.nombreEs ?? null,
    categorias: categorias.todas,

    eans: hijos(hijo(producto, 'barcodes'), 'barcode')
      .map((b) => b.texto.trim())
      .filter(Boolean),

    pesoGramos: peso ? Number.parseInt(peso.texto.trim(), 10) || null : null,
    medidasMm: medidas
      ? {
          ancho: numero(medidas, 'width'),
          alto: numero(medidas, 'height'),
          fondo: numero(medidas, 'depth'),
        }
      : null,

    opciones: opcionesDeVariante(variante),

    minUnidades: Math.max(1, numero(producto, 'min_units_per_order')),
    maxUnidades: Math.max(1, numero(producto, 'max_units_per_order') || 1),

    plazoDias: plazoDeEntrega(texto(producto, 'delivery_desc')),

    urlProveedor: texto(producto, 'product_url') || null,
    codigoArancelario: texto(producto, 'hs_intrastat_code') || null,

    enOferta: bandera(producto, 'sale'),
    esNovedad: bandera(producto, 'new'),
    liquidacion: texto(producto, 'destocking') === '1',
    refrigerado: bandera(producto, 'refrigerated'),

    actualizadoEn: Number.isNaN(actualizado.getTime()) ? null : actualizado,
  };
}

/**
 * Recorre el XML entregando los artículos según van saliendo.
 *
 * `alLeer` puede ser asíncrono y se espera antes de seguir leyendo: eso es lo
 * que da control de flujo. Si guardar en base de datos va más lento que leer
 * el fichero —y va más lento—, sin esa espera se acumularían miles de
 * artículos pendientes en memoria y el proceso acabaría muriendo por donde
 * queríamos evitarlo.
 */
export async function recorrerCatalogoDreamlove(
  entrada: AsyncIterable<Buffer | string>,
  alLeer: (articulo: ArticuloDreamlove) => void | Promise<void>,
): Promise<ResumenLectura> {
  const resumen: ResumenLectura = { articulos: 0, descartados: 0, erroresXml: 0 };

  const parser = new SaxesParser<object>();
  const decodificador = new StringDecoder('utf8');

  /** Pila del producto que se está construyendo; vacía fuera de `<product>`. */
  let pila: Nodo[] = [];
  let listos: ArticuloDreamlove[] = [];

  parser.on('error', () => {
    // No se aborta: un fichero de 340 MB con una entidad mal escrita en la
    // descripción de un artículo no puede tirar la importación de los otros
    // 12.912. saxes se recupera solo y sigue leyendo.
    resumen.erroresXml++;
  });

  parser.on('opentag', (etiqueta: SaxesTagPlain) => {
    if (etiqueta.name !== 'product' && pila.length === 0) return;

    const atributos: Record<string, string> = {};
    for (const [clave, valor] of Object.entries(etiqueta.attributes)) {
      atributos[clave] = String(valor);
    }

    const nodo: Nodo = { nombre: etiqueta.name, atributos, texto: '', hijos: [] };
    pila[pila.length - 1]?.hijos.push(nodo);
    // También las vacías (`<name />`, `<sale value="0" />`): saxes emite su
    // cierre igual que el de cualquier otra. Al no apilarlas, ese cierre se
    // llevaba por delante al PADRE y a partir de ahí el árbol se construía
    // mal: el producto se daba por terminado en mitad de la ficha y se perdían
    // las imágenes, los códigos de barras y las variantes.
    pila.push(nodo);
  });

  const acumular = (contenido: string): void => {
    const actual = pila[pila.length - 1];
    if (actual) actual.texto += contenido;
  };

  parser.on('text', acumular);
  // El CDATA llega aparte del texto normal, y casi todo lo que nos interesa
  // —títulos, descripciones, marcas— viaja dentro de CDATA. Sin escuchar este
  // evento, el catálogo se leía entero con los campos en blanco.
  parser.on('cdata', acumular);

  parser.on('closetag', () => {
    const cerrado = pila.pop();
    if (!cerrado || cerrado.nombre !== 'product' || pila.length > 0) return;

    const articulo = articuloDesdeNodo(cerrado);
    if (articulo) listos.push(articulo);
    else resumen.descartados++;

    // El árbol del producto se suelta aquí: es lo que mantiene la memoria plana.
    pila = [];
  });

  const entregar = async (): Promise<void> => {
    for (const articulo of listos) {
      await alLeer(articulo);
      resumen.articulos++;
    }
    listos = [];
  };

  for await (const trozo of entrada) {
    parser.write(
      // Un carácter multibyte partido entre dos trozos del stream se
      // reconstruye aquí. Decodificando cada trozo por su cuenta, cada
      // acento a caballo entre dos lecturas salía como «».
      typeof trozo === 'string' ? trozo : decodificador.write(trozo),
    );
    await entregar();
  }

  parser.write(decodificador.end());
  parser.close();
  await entregar();

  return resumen;
}
