/**
 * Feed de productos para Google Merchant Center.
 *
 * Es un XML que Google descarga cada día para llenar Google Shopping. Dos
 * cosas hay que entender antes de tocar nada aquí:
 *
 * **1. Un solo producto +18 puede costar la cuenta.** Google prohíbe el
 * contenido adulto en Shopping, y la sanción no es rechazar ese producto: es
 * suspender la cuenta de Merchant entera, con lo que desaparece todo el
 * catálogo de Shopping y recuperarla es un proceso lento. Por eso la exclusión
 * está en el corazón de este módulo y tiene sus propias pruebas.
 *
 * **2. Un feed con errores no se rechaza entero: se rechaza a trozos.** Google
 * acepta el feed e ignora los productos incompletos, así que el síntoma es
 * «tengo 400 productos y en Shopping salen 120» sin ningún error a la vista.
 * De ahí que aquí se valide antes de generar y se devuelva la lista de
 * descartados con el motivo.
 *
 * Todo es lógica pura para poder probarlo: generar XML mal formado o dejar
 * escapar un producto restringido no da ningún error en tiempo de ejecución.
 */

export interface ProductoParaFeed {
  id: string;
  handle: string;
  isAdult: boolean;
  marca?: string | undefined;
  categoria?: string | undefined;
  /** Traducción en el idioma del feed. */
  nombre?: string | undefined;
  descripcion?: string | undefined;
  slug?: string | undefined;
  imagenes: string[];
  variantes: {
    id: string;
    sku: string;
    barcode?: string | undefined;
    priceCents: number;
    stock: number;
    allowBackorder: boolean;
  }[];
}

export interface ArticuloFeed {
  id: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  availability: 'in_stock' | 'out_of_stock';
  price: string;
  brand: string;
  condition: 'new';
  itemGroupId: string;
  gtin?: string | undefined;
  mpn: string;
  productType?: string | undefined;
}

export interface Descartado {
  productId: string;
  sku?: string;
  motivo: string;
}

export interface ResultadoFeed {
  articulos: ArticuloFeed[];
  descartados: Descartado[];
}

/**
 * Longitudes que impone Google.
 *
 * Pasarse no da error: Google trunca por su cuenta, y un título cortado a
 * mitad de palabra en un anuncio se ve mal y convierte peor. Se recorta aquí,
 * donde se puede hacer con cuidado.
 */
const MAX_TITULO = 150;
const MAX_DESCRIPCION = 5000;

/**
 * Escapa lo que XML no admite en el contenido de un elemento.
 *
 * Los títulos vienen del proveedor y traen de todo. Un `&` sin escapar rompe
 * el documento entero, y Google no dice «hay un ampersand en la línea 4.812»:
 * dice que el feed no se puede procesar.
 */
export function escaparXml(texto: string): string {
  return (
    texto
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      /*
       * Caracteres de control.
       *
       * Son inválidos en XML 1.0 aunque se escapen, y algunas descripciones de
       * proveedor los traen. Quitarlos es justo lo que hay que hacer aquí; la
       * regla de ESLint existe para cazar los que se cuelan sin querer en un
       * patrón, que no es el caso.
       *
       * Se escriben por código —`\u0000`— y no como literales: escritos tal
       * cual serían invisibles en el editor, y un carácter invisible dentro de
       * una expresión regular no hay quien lo revise.
       */
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  );
}

/** Recorta respetando palabras, para no cortar a mitad. */
function recortar(texto: string, maximo: number): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (limpio.length <= maximo) return limpio;

  const cortado = limpio.slice(0, maximo);
  const ultimoEspacio = cortado.lastIndexOf(' ');
  return (ultimoEspacio > maximo * 0.6 ? cortado.slice(0, ultimoEspacio) : cortado).trim();
}

/** Precio en el formato que Google espera: "49.99 EUR". */
export function precioParaGoogle(cents: number, moneda = 'EUR'): string {
  return `${(cents / 100).toFixed(2)} ${moneda}`;
}

/**
 * Convierte el catálogo en artículos del feed, descartando lo que no vale.
 *
 * Cada variante es un artículo: en Shopping se anuncia «botas negras del 42»,
 * no «botas». Se agrupan con `item_group_id` para que Google sepa que son el
 * mismo producto en distintas tallas y no las trate como competencia entre sí.
 */
export function construirFeed(
  productos: ProductoParaFeed[],
  opciones: { urlTienda: string; locale: string; moneda?: string },
): ResultadoFeed {
  const articulos: ArticuloFeed[] = [];
  const descartados: Descartado[] = [];
  const base = opciones.urlTienda.replace(/\/$/, '');

  for (const p of productos) {
    // Lo primero de todo, antes que cualquier otra comprobación.
    if (p.isAdult) {
      descartados.push({
        productId: p.id,
        motivo: 'Producto +18: Google Shopping no admite contenido adulto',
      });
      continue;
    }

    if (!p.nombre?.trim()) {
      descartados.push({ productId: p.id, motivo: `Sin nombre en ${opciones.locale}` });
      continue;
    }

    if (!p.descripcion?.trim()) {
      // Google la exige. Sin ella el producto se acepta y no se muestra.
      descartados.push({ productId: p.id, motivo: `Sin descripción en ${opciones.locale}` });
      continue;
    }

    const imagen = p.imagenes[0];
    if (!imagen) {
      descartados.push({ productId: p.id, motivo: 'Sin ninguna imagen' });
      continue;
    }

    const slug = p.slug ?? p.handle;

    for (const v of p.variantes) {
      if (v.priceCents <= 0) {
        descartados.push({
          productId: p.id,
          sku: v.sku,
          motivo: 'Precio a cero: Google rechaza los productos sin precio',
        });
        continue;
      }

      articulos.push({
        id: v.sku,
        title: recortar(p.nombre, MAX_TITULO),
        description: recortar(p.descripcion, MAX_DESCRIPCION),
        link: `${base}/${opciones.locale}/producto/${slug}`,
        imageLink: imagen,
        availability: v.stock > 0 || v.allowBackorder ? 'in_stock' : 'out_of_stock',
        price: precioParaGoogle(v.priceCents, opciones.moneda),
        // Google exige marca; sin ella el producto no se muestra. Se usa el
        // nombre de la tienda como marca propia, que es lo correcto en
        // dropshipping cuando el artículo se vende bajo marca blanca.
        brand: p.marca?.trim() || 'Genérico',
        condition: 'new',
        // Agrupa las variantes del mismo producto para que Google no las trate
        // como productos distintos compitiendo entre sí.
        itemGroupId: p.id,
        ...(v.barcode?.trim() ? { gtin: v.barcode.trim() } : {}),
        // Sin GTIN, Google exige marca + referencia del fabricante.
        mpn: v.sku,
        ...(p.categoria ? { productType: p.categoria } : {}),
      });
    }
  }

  return { articulos, descartados };
}

/**
 * Serializa el feed en el XML que espera Merchant Center (RSS 2.0 + namespace `g:`).
 */
export function feedAXml(
  articulos: ArticuloFeed[],
  meta: { titulo: string; enlace: string; descripcion: string },
): string {
  const elemento = (nombre: string, valor: string | undefined): string =>
    valor === undefined || valor === ''
      ? ''
      : `      <${nombre}>${escaparXml(valor)}</${nombre}>\n`;

  const items = articulos
    .map(
      (a) =>
        '    <item>\n' +
        elemento('g:id', a.id) +
        elemento('g:title', a.title) +
        elemento('g:description', a.description) +
        elemento('g:link', a.link) +
        elemento('g:image_link', a.imageLink) +
        elemento('g:availability', a.availability) +
        elemento('g:price', a.price) +
        elemento('g:brand', a.brand) +
        elemento('g:condition', a.condition) +
        elemento('g:item_group_id', a.itemGroupId) +
        elemento('g:gtin', a.gtin) +
        elemento('g:mpn', a.mpn) +
        elemento('g:product_type', a.productType) +
        '    </item>',
    )
    .join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
    '  <channel>\n' +
    `    <title>${escaparXml(meta.titulo)}</title>\n` +
    `    <link>${escaparXml(meta.enlace)}</link>\n` +
    `    <description>${escaparXml(meta.descripcion)}</description>\n` +
    (items ? `${items}\n` : '') +
    '  </channel>\n' +
    '</rss>\n'
  );
}
