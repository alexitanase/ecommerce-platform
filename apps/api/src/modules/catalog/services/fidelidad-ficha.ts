/**
 * Fidelidad de la ficha de producto.
 *
 * Antes de vender, el art. 97 del TRLGDCU obliga a informar de las
 * **características principales**, el precio total, los gastos de envío y el
 * plazo de entrega. La Ley de Competencia Desleal (art. 5 y 7) añade que no se
 * puede engañar ni por lo que se dice ni por lo que se calla.
 *
 * En dropshipping esto se incumple casi siempre por el mismo motivo: la ficha
 * la genera el proveedor y se publica tal cual. Sale una descripción traducida
 * a máquina, sin peso ni medidas, sin plazo real de entrega —que puede ser de
 * tres semanas— y a veces con fotos que no son del artículo que llega. Nada de
 * eso da un error: da una ficha publicada que incumple, y la reclamación llega
 * cuando el cliente abre el paquete.
 *
 * Por eso la comprobación es **bloqueante al publicar** y no un aviso: una
 * ficha incompleta en borrador no hace daño; publicada, sí.
 */

export type Gravedad = 'BLOQUEA' | 'AVISA';

export type CodigoProblema =
  | 'SIN_NOMBRE'
  | 'SIN_DESCRIPCION'
  | 'DESCRIPCION_INSUFICIENTE'
  | 'IDIOMA_INCOMPLETO'
  | 'SIN_IMAGEN'
  | 'SIN_PRECIO'
  | 'SIN_PESO'
  | 'SIN_PLAZO_ENTREGA'
  | 'PLAZO_LARGO_SIN_AVISO'
  | 'DESCUENTO_SIN_REFERENCIA'
  | 'ADULTO_SIN_MARCAR'
  | 'SIN_STOCK_NI_RESERVA';

export interface Problema {
  codigo: CodigoProblema;
  gravedad: Gravedad;
  mensaje: string;
  /** Idioma afectado, si el problema es de una traducción concreta. */
  locale?: string;
}

export interface TraduccionFicha {
  locale: string;
  name: string | null;
  shortDescription: string | null;
  description: string | null;
}

export interface VarianteFicha {
  sku: string;
  priceCents: number;
  compareAtCents: number | null;
  weightGrams: number | null;
  stock: number;
  allowBackorder: boolean;
  leadTimeMaxDays?: number | null;
}

export interface FichaProducto {
  isAdult: boolean;
  requiresShipping: boolean;
  traducciones: TraduccionFicha[];
  variantes: VarianteFicha[];
  imagenes: number;
  /** Existe precio de referencia de los últimos 30 días (Ómnibus). */
  tieneReferenciaOmnibus: boolean;
}

/**
 * Longitud mínima de la descripción.
 *
 * No mide calidad —eso no lo puede medir un programa— sino que exista algo
 * más que un titular. "Características principales" no se cumple con seis
 * palabras copiadas del proveedor, y ese es el caso real que se cuela.
 */
const MINIMO_DESCRIPCION = 120;

/**
 * Plazo a partir del cual la entrega deja de ser lo que el cliente espera.
 *
 * Con envío desde Asia son tres o cuatro semanas. No es ilegal, pero callarlo
 * sí: es la omisión engañosa del art. 7 de la Ley de Competencia Desleal, y la
 * causa número uno de las reclamaciones en dropshipping.
 */
const DIAS_PLAZO_LARGO = 15;

/** Idiomas en los que la tienda publica y en los que, por tanto, debe informar. */
export const IDIOMAS_PUBLICADOS = ['es', 'ca', 'en'] as const;

const vacio = (s: string | null | undefined): boolean => !s || s.trim().length === 0;

/**
 * Revisa una ficha y devuelve lo que impide publicarla y lo que conviene
 * corregir.
 *
 * @param idiomas idiomas en los que la tienda publica
 */
export function revisarFicha(
  ficha: FichaProducto,
  idiomas: readonly string[] = IDIOMAS_PUBLICADOS,
): Problema[] {
  const problemas: Problema[] = [];

  // ── Textos, idioma a idioma ──
  for (const locale of idiomas) {
    const t = ficha.traducciones.find((x) => x.locale === locale);

    if (!t || vacio(t.name)) {
      problemas.push({
        codigo: t ? 'SIN_NOMBRE' : 'IDIOMA_INCOMPLETO',
        gravedad: 'BLOQUEA',
        locale,
        mensaje: `Falta el nombre del producto en ${locale}. La tienda publica en ese idioma y no puede mostrar una ficha a medias.`,
      });
      continue;
    }

    const texto = [t.shortDescription, t.description].filter(Boolean).join(' ').trim();

    if (vacio(texto)) {
      problemas.push({
        codigo: 'SIN_DESCRIPCION',
        gravedad: 'BLOQUEA',
        locale,
        mensaje: `Falta la descripción en ${locale}. Informar de las características principales es obligatorio antes de vender (TRLGDCU art. 97).`,
      });
    } else if (texto.length < MINIMO_DESCRIPCION) {
      problemas.push({
        codigo: 'DESCRIPCION_INSUFICIENTE',
        gravedad: 'AVISA',
        locale,
        mensaje: `La descripción en ${locale} tiene ${String(texto.length)} caracteres: es demasiado corta para describir las características principales.`,
      });
    }
  }

  // ── Imagen ──
  if (ficha.imagenes === 0) {
    problemas.push({
      codigo: 'SIN_IMAGEN',
      gravedad: 'BLOQUEA',
      mensaje:
        'El producto no tiene ninguna imagen. Nadie compra lo que no puede ver, y la imagen forma parte de la información previa.',
    });
  }

  // ── Variantes ──
  if (ficha.variantes.length === 0) {
    problemas.push({
      codigo: 'SIN_PRECIO',
      gravedad: 'BLOQUEA',
      mensaje: 'El producto no tiene ninguna variante con precio.',
    });
    return problemas;
  }

  for (const v of ficha.variantes) {
    if (v.priceCents <= 0) {
      problemas.push({
        codigo: 'SIN_PRECIO',
        gravedad: 'BLOQUEA',
        mensaje: `La variante ${v.sku} no tiene precio.`,
      });
    }

    // El peso decide el porte. Sin él, el envío se calcula con el tramo por
    // defecto y el cliente ve un precio que puede no ser el real.
    if (ficha.requiresShipping && (v.weightGrams === null || v.weightGrams <= 0)) {
      problemas.push({
        codigo: 'SIN_PESO',
        gravedad: 'BLOQUEA',
        mensaje: `La variante ${v.sku} no tiene peso: los gastos de envío no se pueden calcular bien y el total mostrado sería aproximado.`,
      });
    }

    // Un "antes" que no corresponde a un precio realmente aplicado es
    // publicidad engañosa; la directiva Ómnibus exige el mínimo de 30 días.
    if (
      v.compareAtCents !== null &&
      v.compareAtCents > v.priceCents &&
      !ficha.tieneReferenciaOmnibus
    ) {
      problemas.push({
        codigo: 'DESCUENTO_SIN_REFERENCIA',
        gravedad: 'BLOQUEA',
        mensaje: `La variante ${v.sku} anuncia un precio anterior sin histórico que lo respalde. Anunciar una rebaja obliga a indicar el precio más bajo de los últimos 30 días.`,
      });
    }

    if (v.stock <= 0 && !v.allowBackorder) {
      problemas.push({
        codigo: 'SIN_STOCK_NI_RESERVA',
        gravedad: 'AVISA',
        mensaje: `La variante ${v.sku} no tiene stock y no admite reserva: se publicará como agotada.`,
      });
    }

    // ── Plazo de entrega ──
    if (v.leadTimeMaxDays === null || v.leadTimeMaxDays === undefined) {
      problemas.push({
        codigo: 'SIN_PLAZO_ENTREGA',
        gravedad: 'BLOQUEA',
        mensaje: `No se conoce el plazo de entrega de ${v.sku}. Indicarlo es obligatorio antes de vender, y en dropshipping es lo que más se reclama.`,
      });
    } else if (v.leadTimeMaxDays > DIAS_PLAZO_LARGO) {
      problemas.push({
        codigo: 'PLAZO_LARGO_SIN_AVISO',
        gravedad: 'AVISA',
        mensaje: `${v.sku} tarda hasta ${String(v.leadTimeMaxDays)} días. Un plazo así hay que anunciarlo bien visible: callarlo es una omisión engañosa.`,
      });
    }
  }

  return problemas;
}

/** ¿Se puede publicar? */
export function puedePublicarse(problemas: Problema[]): boolean {
  return !problemas.some((p) => p.gravedad === 'BLOQUEA');
}

/**
 * Problemas que NO se pueden saltar ni queriendo.
 *
 * Todo lo demás es una decisión de negocio de quien lleva la tienda: publicar
 * sin traducir al catalán o sin el peso exacto tiene consecuencias —una ficha
 * a medias, un porte aproximado— pero la tienda funciona y quien decide es
 * quien asume la responsabilidad.
 *
 * Estos dos no son opinables porque no dependen de asumir riesgo, sino de que
 * la tienda pueda operar:
 *
 *  · Sin precio, cada venta regala el producto y descuadra la contabilidad.
 *  · Un «antes» sin histórico que lo respalde es publicidad engañosa tipificada
 *    (directiva Ómnibus): no es un descuido, es una infracción con sanción, y
 *    se arregla quitando el precio tachado en dos segundos.
 */
const NO_ANULABLES: readonly CodigoProblema[] = ['SIN_PRECIO', 'DESCUENTO_SIN_REFERENCIA'];

/**
 * Bloqueos que sobreviven aunque se pida publicar de todas formas.
 *
 * Se devuelven aparte para que el mensaje de error diga exactamente qué es lo
 * que no se puede saltar, en vez de repetir la lista entera y dejar a quien
 * publica buscando cuál de los ocho es el que importa.
 */
export function bloqueosInsalvables(problemas: Problema[]): Problema[] {
  return problemas.filter((p) => p.gravedad === 'BLOQUEA' && NO_ANULABLES.includes(p.codigo));
}

/** Resumen en una frase para la respuesta de la API o el panel. */
export function resumirProblemas(problemas: Problema[]): string {
  const bloqueos = problemas.filter((p) => p.gravedad === 'BLOQUEA');
  const avisos = problemas.filter((p) => p.gravedad === 'AVISA');

  if (bloqueos.length === 0 && avisos.length === 0) {
    return 'La ficha está completa.';
  }

  const partes: string[] = [];
  if (bloqueos.length > 0) {
    partes.push(
      bloqueos.length === 1
        ? 'Falta 1 dato obligatorio para poder publicar'
        : `Faltan ${String(bloqueos.length)} datos obligatorios para poder publicar`,
    );
  }
  if (avisos.length > 0) {
    partes.push(
      avisos.length === 1 ? '1 aviso por revisar' : `${String(avisos.length)} avisos por revisar`,
    );
  }

  return `${partes.join(' y ')}.`;
}
