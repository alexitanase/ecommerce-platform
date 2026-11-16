/**
 * Lo que la tienda puede ver de un producto.
 *
 * Hasta ahora la ficha pública era exactamente la del panel: la misma consulta,
 * el mismo objeto. Eso publicaba en abierto lo que cuesta el artículo en el
 * proveedor (`costCents`), cuánto ganamos con él (`margenPorcentaje`), de qué
 * proveedor sale y con qué identificador. Cualquiera podía leerlo con un `curl`
 * a la ficha —comprobado en producción—, y con eso se replica el catálogo, se
 * negocia a la baja o simplemente se publica el margen en una reseña.
 *
 * Así que la proyección es por **lista blanca**: se enumera lo que sale, no lo
 * que se quita. Con una lista negra, cualquier campo nuevo del modelo se
 * publicaría solo, que es precisamente cómo llegó a pasar esto.
 *
 * De paso se traduce aquí lo único que la tienda sí necesita de los
 * proveedores: **cuánto tarda en llegar y desde dónde sale**. Informar del
 * plazo de entrega es obligatorio (art. 97.1.f TRLGDCU) y en dropshipping es lo
 * que más se reclama, así que sale calculado del servidor y no lo improvisa la
 * tienda.
 */

/** Plazo típico por país de origen, en días naturales. */
const PLAZOS: Record<string, readonly [number, number]> = {
  ES: [2, 5],
  PT: [3, 7],
  FR: [4, 8],
  IT: [4, 8],
  DE: [4, 8],
  NL: [4, 8],
  BE: [4, 8],
  PL: [5, 10],
  CZ: [5, 10],
  GB: [5, 12],
  TR: [6, 12],
  US: [8, 16],
  RU: [10, 20],
  HK: [10, 20],
  TW: [10, 20],
  CN: [12, 22],
};

/**
 * Cuando no se sabe de dónde sale.
 *
 * Deliberadamente pesimista. El proveedor casi siempre es China y quedarse
 * corto en el plazo es la reclamación más habitual del dropshipping: es peor
 * prometer diez días y tardar veinte que anunciar veinte y entregar en doce.
 */
const PLAZO_DESCONOCIDO: readonly [number, number] = [12, 25];

/**
 * Nombres con los que los proveedores escriben el país de origen.
 *
 * No hay un código ISO en ninguna parte: llega el texto tal cual lo puso el
 * vendedor, en su idioma y con la ortografía que quiso («China Mainland»,
 * «CHINA», «Espana»). Se normaliza y se busca aquí; lo que no esté se enseña
 * literal, que sigue siendo información útil para quien compra.
 */
const PAISES: Record<string, string> = {
  china: 'CN',
  'china mainland': 'CN',
  'mainland china': 'CN',
  cn: 'CN',
  espana: 'ES',
  spain: 'ES',
  es: 'ES',
  'hong kong': 'HK',
  hk: 'HK',
  taiwan: 'TW',
  tw: 'TW',
  'estados unidos': 'US',
  'united states': 'US',
  usa: 'US',
  us: 'US',
  alemania: 'DE',
  germany: 'DE',
  de: 'DE',
  francia: 'FR',
  france: 'FR',
  fr: 'FR',
  italia: 'IT',
  italy: 'IT',
  it: 'IT',
  portugal: 'PT',
  pt: 'PT',
  'paises bajos': 'NL',
  netherlands: 'NL',
  nl: 'NL',
  belgica: 'BE',
  belgium: 'BE',
  be: 'BE',
  polonia: 'PL',
  poland: 'PL',
  pl: 'PL',
  chequia: 'CZ',
  czechia: 'CZ',
  'czech republic': 'CZ',
  cz: 'CZ',
  'reino unido': 'GB',
  'united kingdom': 'GB',
  uk: 'GB',
  gb: 'GB',
  turquia: 'TR',
  turkey: 'TR',
  tr: 'TR',
  rusia: 'RU',
  russia: 'RU',
  ru: 'RU',
};

/** Minúsculas, sin acentos y sin puntuación, para poder comparar textos libres. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Formas en las que llega la opción «de dónde se envía». */
const CLAVES_ENVIO = new Set([
  'envios desde',
  'envio desde',
  'enviado desde',
  'enviar desde',
  'expedicion desde',
  'ships from',
  'ship from',
  'shipping from',
  'shipped from',
  'send from',
  'origen',
  'pais de origen',
]);

/**
 * ¿Esta opción dice de dónde sale el paquete?
 *
 * Importa porque no es una opción como el color: no se elige por gusto, y
 * pintarla como una pastilla más deja al cliente decidiendo entre «China
 * Mainland» y nada, sin saber qué implica. Marcada, la tienda puede enseñarla
 * como lo que es —el plazo de entrega— en lugar de como un botón.
 *
 * Se mira la clave y también el nombre traducido: la clave la genera el
 * importador a partir del nombre del proveedor, y ese nombre depende del idioma
 * en el que respondió su API.
 */
export function esOpcionDeEnvio(opcion: {
  key: string;
  translations?: { name: string }[];
}): boolean {
  if (CLAVES_ENVIO.has(normalizar(opcion.key))) return true;
  return (opcion.translations ?? []).some((t) => CLAVES_ENVIO.has(normalizar(t.name)));
}

/** Código ISO del país que dice el proveedor, o `null` si no lo reconocemos. */
export function paisDeOrigen(valor: string): string | null {
  return PAISES[normalizar(valor)] ?? null;
}

export interface Entrega {
  minDias: number;
  maxDias: number;
  /** `false` solo si el plazo lo ha dado el proveedor para esta variante. */
  estimado: boolean;
  /** Código ISO del país de origen, si se ha podido identificar. */
  pais: string | null;
  /** Lo que dijo el proveedor, para enseñarlo cuando no hay código. */
  origen: string | null;
}

/**
 * Plazo de entrega de una variante.
 *
 * Manda lo que diga el proveedor para esa variante concreta; si no lo dice
 * —hoy, en producción, no lo dice en ninguna— se estima por el país de origen.
 * Se marca cuál de las dos cosas es (`estimado`) porque la tienda no debe
 * anunciar como dato lo que es un cálculo nuestro.
 *
 * Devuelve `null` cuando el producto no viene de ningún proveedor y no dice de
 * dónde sale: entonces no se sabe nada del plazo, y estimar «entre 12 y 25 días
 * desde el extranjero» un artículo que quizá esté en un almacén de Madrid sería
 * inventárselo. Sin dato, la ficha no enseña el bloque.
 */
export function entregaDeVariante(
  variante: { id: string; optionValues?: { optionValue: { id: string; value: string } }[] },
  opcionEnvio: { values: { id: string }[] } | null,
  enlaces: {
    variantId: string | null;
    leadTimeMinDays: number | null;
    leadTimeMaxDays: number | null;
  }[],
): Entrega | null {
  // El valor de «Envíos desde» de ESTA variante, no el de la primera: en un
  // producto con origen España y China cada variante tiene el suyo.
  let origen: string | null = null;
  if (opcionEnvio) {
    const suyos = new Set(opcionEnvio.values.map((v) => v.id));
    origen =
      variante.optionValues?.find((ov) => suyos.has(ov.optionValue.id))?.optionValue.value ?? null;
  }

  if (enlaces.length === 0 && !origen) return null;

  const pais = origen ? paisDeOrigen(origen) : null;

  /*
   * El enlace de la variante primero y el del producto después. Un producto
   * puede tener varios proveedores y solo alguno con plazo declarado; se coge
   * el primero que lo tenga en lugar de descartar el dato por no ser exacto.
   */
  const suyo = enlaces.find((e) => e.variantId === variante.id && e.leadTimeMaxDays !== null);
  const cualquiera = enlaces.find((e) => e.leadTimeMaxDays !== null);
  const declarado = suyo ?? cualquiera;

  if (declarado?.leadTimeMaxDays != null) {
    const max = declarado.leadTimeMaxDays;
    // Si solo hay máximo, el mínimo se deduce en lugar de enseñar «0 a 20
    // días», que no informa de nada.
    const min = declarado.leadTimeMinDays ?? Math.max(1, Math.round(max * 0.6));
    return { minDias: Math.min(min, max), maxDias: max, estimado: false, pais, origen };
  }

  const [min, max] = (pais ? PLAZOS[pais] : undefined) ?? PLAZO_DESCONOCIDO;
  return { minDias: min, maxDias: max, estimado: true, pais, origen };
}

// ── Entrada: lo que devuelve `detalleCompleto` ──────────────

interface ValorEntrada {
  id: string;
  value: string;
  labels: unknown;
  hexColor: string | null;
}

interface OpcionEntrada {
  id: string;
  key: string;
  translations: { locale: string; name: string }[];
  values: ValorEntrada[];
}

interface VarianteEntrada {
  id: string;
  sku: string;
  priceCents: number;
  compareAtCents: number | null;
  descuentoPorcentaje?: number | null;
  stock: number;
  allowBackorder: boolean;
  optionValues: { optionValue: ValorEntrada }[];
  media: { id: string; url: string }[];
}

interface FichaEntrada {
  id: string;
  handle: string;
  status: string;
  isAdult: boolean;
  requiresShipping: boolean;
  withdrawalExemption: string | null;
  taxRate: unknown;
  translations: {
    locale: string;
    name: string;
    slug: string;
    shortDescription: string | null;
    description: string | null;
    metaTitle: string | null;
    metaDescription: string | null;
  }[];
  media: {
    id: string;
    url: string;
    alt: unknown;
    blurhash: string | null;
    width: number | null;
    height: number | null;
  }[];
  options: OpcionEntrada[];
  variants: VarianteEntrada[];
  category: { translations: { locale: string; name: string; slug: string }[] } | null;
  brand: { handle: string; name: string; logoUrl: string | null; isActive: boolean } | null;
  proveedores: {
    variantId: string | null;
    leadTimeMinDays: number | null;
    leadTimeMaxDays: number | null;
  }[];
  locale: string;
}

/**
 * Proyecta la ficha completa a lo que la tienda puede ver.
 *
 * Nada de `...producto`: cada campo se nombra. Es más largo de escribir y es el
 * único modo de que añadir una columna al modelo no la publique sola.
 */
export function fichaPublica(producto: FichaEntrada) {
  const opcionEnvio = producto.options.find((o) => esOpcionDeEnvio(o)) ?? null;

  return {
    id: producto.id,
    handle: producto.handle,
    status: producto.status,
    isAdult: producto.isAdult,
    requiresShipping: producto.requiresShipping,
    /*
     * La exención del derecho de desistimiento sale aunque la tienda todavía no
     * la pinte.
     *
     * Cuando está puesta —artículos de higiene o sellados, que es media tienda—
     * hay obligación de informar ANTES de comprar de que no habrá devolución
     * (art. 103 TRLGDCU). Es un dato público y legalmente exigible, así que se
     * publica: quitarlo obligaría a volver aquí el día que se enseñe.
     */
    withdrawalExemption: producto.withdrawalExemption,
    taxRate: producto.taxRate,
    locale: producto.locale,

    translations: producto.translations.map((t) => ({
      locale: t.locale,
      name: t.name,
      slug: t.slug,
      shortDescription: t.shortDescription,
      description: t.description,
      metaTitle: t.metaTitle,
      metaDescription: t.metaDescription,
    })),

    media: producto.media.map((m) => ({
      id: m.id,
      url: m.url,
      alt: m.alt,
      blurhash: m.blurhash,
      // Las medidas salen porque las necesita la vista previa del enlace:
      // WhatsApp y Twitter piden `og:image:width` y `og:image:height` y, sin
      // ellos, unos enseñan la foto recortada y otros no la enseñan.
      width: m.width,
      height: m.height,
    })),

    options: producto.options.map((o) => ({
      id: o.id,
      key: o.key,
      // La tienda no tiene que volver a adivinar cuál es la de envío: se
      // decide en un sitio, aquí, y con los mismos datos que el plazo.
      esEnvio: o.id === opcionEnvio?.id,
      translations: o.translations.map((t) => ({ locale: t.locale, name: t.name })),
      values: o.values.map((v) => ({
        id: v.id,
        value: v.value,
        labels: v.labels,
        hexColor: v.hexColor,
      })),
    })),

    variants: producto.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      priceCents: v.priceCents,
      compareAtCents: v.compareAtCents,
      descuentoPorcentaje: v.descuentoPorcentaje ?? null,
      stock: v.stock,
      allowBackorder: v.allowBackorder,
      entrega: entregaDeVariante(v, opcionEnvio, producto.proveedores),
      optionValues: v.optionValues.map((ov) => ({
        optionValue: {
          id: ov.optionValue.id,
          value: ov.optionValue.value,
          labels: ov.optionValue.labels,
          hexColor: ov.optionValue.hexColor,
        },
      })),
      media: v.media.map((m) => ({ id: m.id, url: m.url })),
    })),

    category: producto.category
      ? {
          translations: producto.category.translations.map((t) => ({
            locale: t.locale,
            name: t.name,
            slug: t.slug,
          })),
        }
      : null,

    /*
     * La marca, solo si está activa.
     *
     * Desactivar una marca es la forma de retirarla de la tienda sin borrarla
     * ni perder de qué fabricante era cada producto; si saliera igualmente en
     * la ficha, desactivarla no serviría de nada.
     */
    brand:
      producto.brand && producto.brand.isActive
        ? {
            handle: producto.brand.handle,
            name: producto.brand.name,
            logoUrl: producto.brand.logoUrl,
          }
        : null,
  };
}

export type FichaPublica = ReturnType<typeof fichaPublica>;
