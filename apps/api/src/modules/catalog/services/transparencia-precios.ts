/**
 * Transparencia de precios (directiva Ómnibus).
 *
 * Real Decreto-ley 24/2021, que traspone la Directiva (UE) 2019/2161. La regla
 * que importa, y que incumple la mayoría de tiendas españolas:
 *
 *   **Al anunciar una reducción de precio hay que indicar el precio más bajo
 *   aplicado durante los 30 días anteriores.**
 *
 * No vale el PVP recomendado, ni el precio "de tarifa", ni el que tenía antes
 * de una subida hecha la semana pasada para poder tacharlo. El truco de subir
 * el precio y bajarlo enseguida para simular un descuento es exactamente lo que
 * la norma persigue.
 *
 * Consecuencia práctica: si el precio actual NO es inferior al mínimo de los
 * últimos 30 días, no hay descuento que anunciar y no se debe tachar nada.
 */

/** Ventana de referencia fijada por la norma. */
export const DIAS_REFERENCIA = 30;

export interface PuntoPrecio {
  priceCents: number;
  validFrom: Date;
}

export interface Descuento {
  /** Precio que se cobra ahora. */
  actualCents: number;
  /**
   * Precio de referencia que se puede tachar legalmente: el mínimo de los
   * últimos 30 días. `null` cuando no hay descuento que anunciar.
   */
  referenciaCents: number | null;
  /** Porcentaje de bajada respecto a la referencia, redondeado. */
  porcentaje: number | null;
  /** Texto obligatorio junto al precio tachado. */
  anunciable: boolean;
}

/**
 * Precio más bajo aplicado en los 30 días ANTERIORES a la rebaja.
 *
 * Dos precisiones que definen el resultado:
 *
 * 1. La ventana no son "los últimos 30 días desde hoy", sino los 30 días
 *    previos a que empezara a regir el precio actual. La norma habla del
 *    precio anterior a la reducción, así que el propio precio rebajado no
 *    puede formar parte de su propia referencia — incluirlo haría que nunca
 *    hubiera descuento, porque el mínimo sería siempre él mismo.
 *
 * 2. Cuenta el precio **vigente** durante la ventana, no solo los cambios
 *    hechos dentro de ella: si se fijó hace tres meses y no se ha tocado, ese
 *    era el precio. Mirar solo los registros recientes daría "sin historial" y
 *    dejaría anunciar cualquier descuento.
 *
 * Devuelve `null` cuando no hay ningún precio anterior con el que comparar:
 * un producto recién publicado no puede anunciarse como rebajado.
 */
export function minimoUltimos30Dias(historico: PuntoPrecio[], ahora = new Date()): number | null {
  const ordenado = [...historico]
    .filter((p) => p.validFrom <= ahora)
    .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());

  if (ordenado.length === 0) return null;

  // Cuándo empezó a regir el precio vigente: fin de la ventana de referencia.
  const inicioActual = ordenado.at(-1)!.validFrom;
  const anteriores = ordenado.slice(0, -1);

  if (anteriores.length === 0) return null;

  const desde = new Date(inicioActual.getTime() - DIAS_REFERENCIA * 86_400_000);

  // Los que empezaron dentro de la ventana…
  const dentro = anteriores.filter((p) => p.validFrom >= desde);
  // …más el que ya regía cuando se abrió.
  const alAbrirse = anteriores.filter((p) => p.validFrom < desde).at(-1);

  const candidatos = [
    ...dentro.map((p) => p.priceCents),
    ...(alAbrirse ? [alAbrirse.priceCents] : []),
  ];

  return candidatos.length > 0 ? Math.min(...candidatos) : null;
}

/**
 * Qué descuento se puede anunciar legalmente.
 *
 * Devuelve `referenciaCents: null` cuando no hay ninguno: el precio actual no
 * es el más bajo de los últimos 30 días, así que tachar un importe superior
 * sería publicidad engañosa.
 */
export function descuentoAnunciable(
  historico: PuntoPrecio[],
  precioActual: number,
  ahora = new Date(),
): Descuento {
  const minimo = minimoUltimos30Dias(historico, ahora);

  // Sin precio anterior con el que comparar, o si el actual no está por debajo
  // de él, no hay descuento que anunciar.
  if (minimo === null || precioActual >= minimo) {
    return {
      actualCents: precioActual,
      referenciaCents: null,
      porcentaje: null,
      anunciable: false,
    };
  }

  return {
    actualCents: precioActual,
    referenciaCents: minimo,
    porcentaje: Math.round(((minimo - precioActual) / minimo) * 100),
    anunciable: true,
  };
}

/**
 * Valida un precio tachado introducido a mano en el admin.
 *
 * Impide anunciar "antes 119,99 €" cuando en los últimos 30 días nunca costó
 * tanto. Se corrige en vez de rechazar: bloquear el guardado de un producto
 * por esto entorpece el trabajo del equipo, y el precio de referencia correcto
 * se puede calcular solo.
 */
export function corregirPrecioTachado(
  historico: PuntoPrecio[],
  precioActual: number,
  tachadoPropuesto: number | null,
  ahora = new Date(),
): { tachadoCents: number | null; corregido: boolean; motivo?: string } {
  if (tachadoPropuesto === null) {
    return { tachadoCents: null, corregido: false };
  }

  if (tachadoPropuesto <= precioActual) {
    return {
      tachadoCents: null,
      corregido: true,
      motivo: 'El precio tachado no era superior al actual: no hay descuento que anunciar.',
    };
  }

  const minimo = minimoUltimos30Dias(historico, ahora);

  if (minimo === null || precioActual >= minimo) {
    return {
      tachadoCents: null,
      corregido: true,
      motivo:
        'En los últimos 30 días el producto no costó más que ahora, así que no se puede ' +
        'anunciar como rebajado.',
    };
  }

  if (tachadoPropuesto > minimo) {
    return {
      tachadoCents: minimo,
      corregido: true,
      motivo:
        `El precio tachado se ha ajustado a ${(minimo / 100).toFixed(2)} €, que es el más bajo ` +
        'de los últimos 30 días. Anunciar uno superior sería publicidad engañosa.',
    };
  }

  return { tachadoCents: tachadoPropuesto, corregido: false };
}

/**
 * Plazo de entrega que se enseña al cliente.
 *
 * En dropshipping el plazo real es el del proveedor más el del transporte, y
 * ocultarlo es la primera causa de reclamación. Se da un rango, no una fecha
 * exacta que no se puede garantizar.
 */
export function plazoEntrega(
  diasProveedor: number,
  diasEnvioMin: number,
  diasEnvioMax: number,
): { min: number; max: number } {
  return {
    min: Math.max(1, diasProveedor + diasEnvioMin),
    max: Math.max(1, diasProveedor + diasEnvioMax),
  };
}

/**
 * ¿Hay que avisar de aduanas?
 *
 * Un envío desde fuera de la UE puede llevar aranceles e IVA de importación
 * que paga el destinatario. No advertirlo antes de comprar es una omisión
 * relevante: el cliente descubre un coste extra al recibir el paquete.
 */
export function requiereAvisoAduanas(paisOrigen: string, paisDestino: string): boolean {
  const UE = new Set([
    'AT',
    'BE',
    'BG',
    'CY',
    'CZ',
    'DE',
    'DK',
    'EE',
    'ES',
    'FI',
    'FR',
    'GR',
    'HR',
    'HU',
    'IE',
    'IT',
    'LT',
    'LU',
    'LV',
    'MT',
    'NL',
    'PL',
    'PT',
    'RO',
    'SE',
    'SI',
    'SK',
  ]);

  return UE.has(paisDestino.toUpperCase()) && !UE.has(paisOrigen.toUpperCase());
}
