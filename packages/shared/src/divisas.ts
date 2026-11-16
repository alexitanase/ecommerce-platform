import { decimalsFor, type Cents } from './money.js';

/**
 * Divisas en las que la tienda puede ENSEÑAR un precio.
 *
 * La tienda cobra siempre en euros. Esto solo decide en qué divisa se le muestra
 * el importe al visitante, y por eso vive aparte del dinero de verdad: el pedido,
 * la factura y la contabilidad siguen en euros, y ninguna de las tres depende de
 * este fichero.
 *
 * La distinción no es un detalle. Cobrar en otra divisa arrastra el IVA —los
 * umbrales de OSS e IOSS están fijados en euros—, la facturación, las
 * devoluciones parciales, el histórico de precios de la Ómnibus y la
 * conciliación con la pasarela. Nada de eso se toca aquí, y por eso esto se
 * puede activar sin miedo.
 */

/** La divisa en la que se cobra y se factura. No es configurable. */
export const DIVISA_BASE = 'EUR';

/**
 * Aquí NO hay catálogo de divisas, y es el cambio importante.
 *
 * Lo había: diez escritas a mano con su símbolo y su nombre. El problema no era
 * que fuesen pocas —el proveedor de tipo de cambio publica veintinueve— sino que
 * ampliar la lista obligaba a tocar código y desplegar para algo que es un dato
 * de un servicio externo.
 *
 * Ahora se reparte en dos:
 *
 *  · **Aquí, la forma.** Un código ISO 4217 son tres letras. Es lo único que se
 *    puede comprobar sin hablar con nadie.
 *  · **En la API, la disponibilidad.** Solo se puede activar lo que el proveedor
 *    publique de verdad, porque una divisa sin tasa no se puede convertir.
 *
 * Y los nombres los da `Intl.DisplayNames`, que los sabe en los tres idiomas del
 * panel y no se queda anticuado. Una tabla de nombres a mano era, además de
 * trabajo, una fuente de «Złoty polaco» mal escrito.
 */
export const esCodigoDivisa = (codigo: unknown): boolean =>
  typeof codigo === 'string' && /^[A-Za-z]{3}$/.test(codigo.trim());

/**
 * El nombre de una divisa en el idioma que se pida.
 *
 * `Intl.DisplayNames` cubre todas las de ISO 4217. Cuando no conoce un código
 * devuelve el código, que es exactamente lo que se quiere enseñar entonces: es
 * más útil ver «XYZ» que un hueco.
 */
export function nombreDivisa(codigo: string, locale = 'es'): string {
  const limpio = codigo.trim().toUpperCase();
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(limpio) ?? limpio;
  } catch {
    return limpio;
  }
}

/**
 * Convierte un importe en céntimos de euro a céntimos de otra divisa.
 *
 * `tasa` son unidades de la divisa destino por un euro, que es como las publican
 * el BCE y todos los proveedores que se apoyan en él.
 *
 * Se redondea al final y no por el camino: convertir cada línea de un pedido y
 * después sumar da un resultado distinto de convertir el total, y la diferencia
 * —uno o dos céntimos— es justo la que hace que un cliente escriba preguntando
 * por qué el total no cuadra con lo que ha sumado él.
 *
 * Devuelve `null` si la tasa no sirve. Un cero o un negativo daría un precio de
 * cero, y un precio de cero enseñado en una tienda es peor que no enseñar nada.
 */
export function convertirImporte(cents: Cents, tasa: number, divisa: string): Cents | null {
  if (!Number.isFinite(tasa) || tasa <= 0) return null;

  const decimalesBase = decimalsFor(DIVISA_BASE);
  const decimalesDestino = decimalsFor(divisa);

  // El salto de decimales importa: 1000 céntimos de euro (10,00 €) en una divisa
  // sin decimales son 10 unidades, no 1000.
  const factor = 10 ** (decimalesDestino - decimalesBase);

  return Math.round(cents * tasa * factor);
}

/**
 * Las tasas que la tienda puede usar, ya filtradas y validadas.
 *
 * Se separa de la conversión porque el proveedor de tipo de cambio devuelve
 * decenas de divisas y la tienda solo tiene activadas unas pocas: quedarse con
 * lo que hace falta evita mandar al navegador un diccionario de ciento sesenta
 * entradas en cada página.
 */
export function tasasUtiles(
  tasas: Record<string, unknown>,
  activas: readonly string[],
): Record<string, number> {
  const utiles: Record<string, number> = {};

  for (const codigo of activas) {
    if (codigo === DIVISA_BASE) continue;
    const tasa = tasas[codigo];
    if (typeof tasa === 'number' && Number.isFinite(tasa) && tasa > 0) {
      utiles[codigo] = tasa;
    }
  }

  return utiles;
}

/**
 * Deja una lista de divisas en algo con lo que se pueda operar.
 *
 * El euro siempre entra, esté o no en la lista: es la divisa en la que se cobra,
 * así que una tienda sin euro entre sus divisas no tiene sentido y desde el panel
 * se puede desmarcar sin darse cuenta.
 *
 * Aquí solo se filtra por FORMA, no por disponibilidad. Un `LMN` bien escrito
 * pasa este filtro y no llegará nunca al selector, porque más adelante hay que
 * tener una tasa para ofrecerlo. Es a propósito: esta función limpia un valor
 * guardado y no puede hablar con el proveedor de tipos de cambio, y una lista
 * que se vaciara sola cuando el proveedor está caído sería peor.
 */
export function normalizarDivisas(valor: unknown): string[] {
  const lista = Array.isArray(valor) ? valor : [];
  const codigos = lista
    .filter((c): c is string => typeof c === 'string')
    .filter(esCodigoDivisa)
    .map((c) => c.trim().toUpperCase());

  return [...new Set([DIVISA_BASE, ...codigos])];
}
