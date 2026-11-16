/**
 * De «tarda entre 12 y 22 días» a «llega entre el 11 y el 21 de agosto».
 *
 * Un plazo en días obliga a quien compra a hacer la cuenta, y en dropshipping la
 * cuenta sale mal casi siempre porque el plazo es largo. Dos fechas se entienden
 * de un vistazo y son lo que de verdad quiere saber: si llega antes del sábado.
 *
 * Las fechas se calculan SIEMPRE en el servidor. Si las calculara el navegador,
 * la ficha diría una cosa al pintarse y otra al hidratarse cada vez que el reloj
 * del visitante no coincidiera con el nuestro, y a las 00:00 cambiaría de día a
 * mitad de render.
 */

import { localeIntl } from './formato';

const DIA_MS = 86_400_000;

/**
 * Empuja una fecha al siguiente día laborable.
 *
 * Los reparto casi nunca se entrega en fin de semana, así que una estimación que
 * cae en sábado es una estimación que se va a incumplir. Empujar al lunes
 * alarga el plazo anunciado, que es el lado por el que conviene equivocarse.
 */
function aLaborable(fecha: Date): Date {
  const d = new Date(fecha);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Las dos fechas del rango de entrega.
 *
 * `ahora` entra por parámetro para que sea comprobable y para que la ficha use
 * un único instante: con dos llamadas a la hora del sistema, un producto pedido
 * a las 23:59:59 podría anunciar un rango que empieza después de acabar.
 */
export function fechasDeEntrega(
  minDias: number,
  maxDias: number,
  ahora: Date,
): { desde: Date; hasta: Date } {
  const desde = aLaborable(new Date(ahora.getTime() + Math.max(1, minDias) * DIA_MS));
  const hasta = aLaborable(new Date(ahora.getTime() + Math.max(minDias, maxDias) * DIA_MS));

  // Si al empujar el mínimo se ha pasado del máximo, el rango se convierte en un
  // solo día en lugar de quedar del revés.
  return { desde, hasta: hasta < desde ? desde : hasta };
}

/**
 * Las dos fechas escritas para meterlas en «Llega entre el {desde} y el {hasta}».
 *
 * El día suelto cuando las dos caen en el mismo mes —«entre el 17 y el 27 de
 * agosto»— y la fecha completa cuando no —«entre el 29 de agosto y el 3 de
 * septiembre»—. `Intl.formatRange` daría «17–27 de agosto» de una pieza, que no
 * se puede encajar en la frase sin que quede «entre el 17–27 de agosto».
 *
 * El mes lo escribe `Intl` junto con el día y no por separado, porque en catalán
 * la preposición se contrae según el mes: «17 d'agost» pero «3 de setembre».
 */
export function rangoEscrito(
  desde: Date,
  hasta: Date,
  locale: string,
): { desde: string; hasta: string; unSoloDia: boolean } {
  const completa = new Intl.DateTimeFormat(localeIntl(locale), {
    day: 'numeric',
    month: 'long',
  });
  const soloDia = new Intl.DateTimeFormat(localeIntl(locale), { day: 'numeric' });

  const mismoMes =
    desde.getMonth() === hasta.getMonth() && desde.getFullYear() === hasta.getFullYear();
  const mismoDia = mismoMes && desde.getDate() === hasta.getDate();

  return {
    desde: mismoMes && !mismoDia ? soloDia.format(desde) : completa.format(desde),
    hasta: completa.format(hasta),
    unSoloDia: mismoDia,
  };
}

/**
 * Nombre del país en el idioma del visitante.
 *
 * `Intl.DisplayNames` lo trae hecho para los tres idiomas de la tienda, así que
 * no hay una tabla de países que mantener traducida. Si el entorno viniera con
 * ICU recortado devolvería el propio código («CN»), y en ese caso es mejor
 * enseñar lo que dijo el proveedor: «China Mainland» informa y «CN» no.
 */
export function nombreDePais(codigo: string | null, locale: string): string | null {
  if (!codigo) return null;

  try {
    const nombre = new Intl.DisplayNames([locale], { type: 'region' }).of(codigo);
    return nombre && nombre !== codigo ? nombre : null;
  } catch {
    return null;
  }
}
