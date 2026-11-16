/**
 * Formateo de importes.
 *
 * Todos los precios llegan de la API en céntimos como entero. Aquí es el único
 * sitio donde se convierten para mostrar, así que si algún día cambia la
 * divisa o el formato, se toca una sola función.
 */
import { fromCents } from '@ecom/shared';

/**
 * Del idioma de la tienda al de `Intl`.
 *
 * `en` sin región formatea las fechas al modo estadounidense («August 27») y los
 * precios con el símbolo delante; la tienda vende en España, así que el inglés
 * es el británico.
 */
export function localeIntl(locale: string): string {
  return locale === 'ca' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES';
}

/**
 * Un importe en la unidad pequeña de su divisa, formateado.
 *
 * Divide por los decimales que tenga la divisa y no siempre por cien, que es lo
 * que hacía. En euros da igual, y por eso no se notaba; en yenes —que no tienen
 * decimales— un precio de 3.997 ¥ salía como «4 ¥», cien veces más barato. El
 * fallo no se podía ver hasta que hubo divisas de verdad que enseñar, y es el
 * peor de los precios equivocados: parece perfectamente normal.
 *
 * `fromCents` es la misma función con la que se convirtió el importe, así que
 * los dos lados usan los mismos decimales por construcción.
 */
export function precio(centimos: number, locale = 'es', moneda = 'EUR'): string {
  return new Intl.NumberFormat(localeIntl(locale), {
    style: 'currency',
    currency: moneda,
  }).format(fromCents(centimos, moneda));
}

export function fecha(valor: string | Date, locale = 'es'): string {
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  return new Intl.DateTimeFormat(localeIntl(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/**
 * Fecha con la hora, para las cronologías.
 *
 * En el historial de un pedido la fecha sola no dice nada: casi todo pasa el
 * mismo día, así que cuatro líneas repitiendo «25 de julio de 2026» ocupan
 * sitio sin informar. Con la hora se ve el recorrido —se pagó a las 12:01 y
 * salió a las 12:02— que es justo lo que se viene a mirar.
 *
 * El mes va abreviado porque aquí la línea compite con el texto del hito y en
 * un móvil «25 de julio de 2026, 12:01» no cabe sin romperse.
 */
export function fechaHora(valor: string | Date, locale = 'es'): string {
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  return new Intl.DateTimeFormat(localeIntl(locale), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Cuenta atrás en formato mm:ss, para el contador del pago en cripto. */
export function cuentaAtras(segundos: number): string {
  const s = Math.max(0, segundos);
  const min = Math.floor(s / 60);
  const seg = s % 60;
  return `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
}

export function descuento(precioActual: number, precioAntes: number | null): number | null {
  if (!precioAntes || precioAntes <= precioActual) return null;
  return Math.round(((precioAntes - precioActual) / precioAntes) * 100);
}
