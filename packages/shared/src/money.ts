/**
 * Dinero en céntimos, siempre en entero.
 *
 * Regla del proyecto: ningún importe se guarda ni se opera como `float`.
 * 0.1 + 0.2 !== 0.3 en coma flotante, y en una plataforma que factura eso
 * acaba en un descuadre de un céntimo en la factura de alguien.
 */

export type Cents = number;

/** Códigos ISO 4217 que maneja la plataforma y sus decimales. */
const DECIMALES: Record<string, number> = { EUR: 2, USD: 2, GBP: 2, JPY: 0 };

export function decimalsFor(currency: string): number {
  return DECIMALES[currency.toUpperCase()] ?? 2;
}

/** Convierte un importe legible (12.99) a céntimos (1299). */
export function toCents(amount: number, currency = 'EUR'): Cents {
  const factor = 10 ** decimalsFor(currency);
  return Math.round(amount * factor);
}

/** Convierte céntimos (1299) a importe legible (12.99). */
export function fromCents(cents: Cents, currency = 'EUR'): number {
  const factor = 10 ** decimalsFor(currency);
  return cents / factor;
}

/**
 * Lo que ha escrito una persona en un campo de importe.
 *
 * Son **tres** estados y no dos, y esa es toda la razón de que este tipo exista.
 * Confundir «lo he dejado en blanco» con «no he sabido interpretarlo» es un fallo
 * silencioso y caro: en el editor de productos, el precio tachado y el coste
 * mandaban `null` en los dos casos, así que escribir `31,23 €` —con el símbolo,
 * que es lo natural— no daba ningún error: **borraba el precio tachado que ya
 * estaba guardado**. Quien lo hacía veía el campo vacío y concluía que no se
 * guardaba, cuando lo que pasaba es que se guardaba un vacío.
 */
export type ImporteLeido =
  { estado: 'vacio' } | { estado: 'importe'; cents: Cents } | { estado: 'invalido' };

/**
 * Interpreta un importe escrito a mano y devuelve céntimos.
 *
 * Acepta lo que de verdad se teclea en España, no solo el formato canónico:
 * `31,23`, `31.23`, `31,23 €`, `1.299,00`, `1 299,00`. La coma y el punto se
 * resuelven por el ÚLTIMO separador que aparece —es el decimal— y los anteriores
 * se tratan como separadores de miles. Sin eso, `1.299,00` se convertía en
 * `1.299.00`, que no es un número, y el campo se borraba.
 *
 * Lo que NO acepta se dice: negativos, letras y cualquier cosa que no encaje
 * salen como `invalido` para que quien llama lo rechace en vez de guardarlo.
 */
export function leerImporte(texto: string, currency = 'EUR'): ImporteLeido {
  // Se quitan el símbolo y el código de moneda. El espacio irrompible se cambia
  // por uno normal antes de nada: es el que aparece al copiar y pegar un precio
  // de una web o de Excel, no se distingue a simple vista de un espacio normal, y
  // sin esto «49,99 €» se quedaba sin interpretar.
  const limpio = texto
    .replace(/\u00A0/g, ' ')
    .replace(/€|EUR|USD|GBP/gi, '')
    .trim();

  if (limpio === '') return { estado: 'vacio' };

  /*
   * La forma se valida ANTES de normalizar, y de ahí que sean tres expresiones.
   *
   * El primer intento resolvía el decimal como «el último separador que
   * aparezca» y quitaba los demás, lo cual convertía `12.3.4.5.6` en 12.345,6 —
   * un número perfectamente válido salido de una errata evidente—. Un separador
   * de miles agrupa de tres en tres o no es un separador de miles.
   */
  const SIMPLE = /^\d+(?:[.,]\d+)?$/; //            31,23 · 31.23 · 1299
  const MILES_ES = /^\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?$/; // 1.299,00 · 1 299,00
  const MILES_EN = /^\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?$/; // 1,299.00 · 1 299.00

  let normalizado: string;

  if (SIMPLE.test(limpio)) {
    normalizado = limpio.replace(',', '.');
  } else if (MILES_ES.test(limpio)) {
    normalizado = limpio.replace(/[.\s]/g, '').replace(',', '.');
  } else if (MILES_EN.test(limpio)) {
    normalizado = limpio.replace(/[,\s]/g, '');
  } else {
    return { estado: 'invalido' };
  }

  const numero = Number(normalizado);
  if (!Number.isFinite(numero)) return { estado: 'invalido' };

  return { estado: 'importe', cents: toCents(numero, currency) };
}

/**
 * Formatea para mostrar al cliente, respetando el idioma.
 * `formatMoney(1299, 'EUR', 'es')` → "12,99 €"
 */
export function formatMoney(cents: Cents, currency = 'EUR', locale = 'es'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimalsFor(currency),
  }).format(fromCents(cents, currency));
}

/**
 * Reparte un importe entre N partes sin perder ni un céntimo por redondeo.
 * Los céntimos sobrantes se asignan a las primeras partes.
 * Se usa para prorratear descuentos y gastos de envío entre las líneas del pedido.
 */
export function allocate(total: Cents, ratios: number[]): Cents[] {
  const suma = ratios.reduce((a, b) => a + b, 0);
  if (suma <= 0) throw new Error('Los ratios de reparto deben sumar más de cero');

  const partes = ratios.map((r) => Math.floor((total * r) / suma));
  let resto = total - partes.reduce((a, b) => a + b, 0);

  for (let i = 0; resto > 0; i = (i + 1) % partes.length) {
    partes[i] = (partes[i] ?? 0) + 1;
    resto--;
  }
  return partes;
}

/** Aplica un porcentaje de IVA a una base imponible. `addTax(1000, 21)` → 1210 */
export function addTax(base: Cents, taxRate: number): Cents {
  return Math.round(base * (1 + taxRate / 100));
}

/** Extrae la base imponible de un precio con impuestos incluidos. */
export function extractBase(gross: Cents, taxRate: number): Cents {
  return Math.round(gross / (1 + taxRate / 100));
}

/** La cuota de IVA contenida en un precio con impuestos incluidos. */
export function taxAmount(gross: Cents, taxRate: number): Cents {
  return gross - extractBase(gross, taxRate);
}

/**
 * Redondeo psicológico al alza para el motor de precios: 1243 → 1299.
 * `ending` es la terminación deseada en céntimos (99 por defecto).
 */
export function psychologicalRound(cents: Cents, ending = 99): Cents {
  const euros = Math.floor(cents / 100);
  const candidato = euros * 100 + ending;
  return candidato >= cents ? candidato : (euros + 1) * 100 + ending;
}
