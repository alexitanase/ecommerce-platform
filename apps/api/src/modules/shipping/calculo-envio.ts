/**
 * Cálculo puro de zonas y tarifas de envío.
 *
 * Separado del servicio a propósito: aquí están las reglas que, si fallan,
 * hacen perder dinero en cada pedido o cobrar IVA donde no toca. Sin base de
 * datos de por medio se pueden probar todas las combinaciones de verdad.
 */

export type TipoTarifa = 'FLAT' | 'WEIGHT' | 'ORDER_VALUE';

export interface TarifaEnvio {
  id: string;
  name: string;
  carrier: string | null;
  type: TipoTarifa;
  priceCents: number;
  freeFromCents: number | null;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
  minOrderCents: number | null;
  maxOrderCents: number | null;
  minDays: number;
  maxDays: number;
}

export interface ZonaEnvio {
  id: string;
  name: string;
  countries: string[];
  postalPrefixes: string[];
  excludedPostalPrefixes: string[];
  outsideVatTerritory: boolean;
  customsWarning: boolean;
  priority: number;
  rates: TarifaEnvio[];
}

/** Normaliza un código postal: sin espacios, sin guiones, en mayúsculas. */
export function normalizarCP(codigo: string): string {
  return codigo.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * ¿Cubre esta zona el destino indicado?
 *
 * Reglas, en orden:
 *  1. El país tiene que estar en la lista.
 *  2. Si el CP empieza por un prefijo excluido, la zona NO aplica aunque el
 *     país coincida. Es lo que permite definir "Península" como España menos
 *     Canarias, Ceuta, Melilla y Baleares.
 *  3. Si hay prefijos incluidos, el CP tiene que empezar por alguno.
 *     Sin prefijos, la zona cubre el país entero.
 */
export function zonaCubre(zona: ZonaEnvio, countryCode: string, postalCode: string): boolean {
  if (!zona.countries.includes(countryCode.toUpperCase())) return false;

  const cp = normalizarCP(postalCode);

  if (zona.excludedPostalPrefixes.some((p) => cp.startsWith(p))) return false;

  if (zona.postalPrefixes.length === 0) return true;

  return zona.postalPrefixes.some((p) => cp.startsWith(p));
}

/**
 * Elige la zona que se aplica a un destino.
 *
 * Gana la de mayor prioridad. Con prioridades iguales, gana la que define
 * prefijos concretos sobre la que cubre el país entero: si alguien crea
 * "Canarias" y "España" con la misma prioridad, un envío a Las Palmas debe
 * irse a Canarias, no a la genérica, o se le cobraría IVA indebidamente.
 */
export function elegirZona(
  zonas: ZonaEnvio[],
  countryCode: string,
  postalCode: string,
): ZonaEnvio | null {
  const candidatas = zonas.filter((z) => zonaCubre(z, countryCode, postalCode));
  if (candidatas.length === 0) return null;

  return candidatas.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    // Más específica primero: la que declara prefijos gana a la que no.
    const espA = a.postalPrefixes.length > 0 ? 1 : 0;
    const espB = b.postalPrefixes.length > 0 ? 1 : 0;
    return espB - espA;
  })[0]!;
}

/** ¿Encaja la tarifa con el peso y el importe del carrito? */
export function tarifaAplica(
  tarifa: TarifaEnvio,
  subtotalCents: number,
  pesoGramos: number,
): boolean {
  if (tarifa.type === 'WEIGHT') {
    // Un producto sin peso declarado no puede caer en un tramo de peso: se
    // descarta la tarifa en vez de suponer cero, que sería el tramo más
    // barato y regalaría el envío de un paquete pesado.
    if (pesoGramos <= 0) return false;
    if (tarifa.minWeightGrams !== null && pesoGramos < tarifa.minWeightGrams) return false;
    // El máximo es exclusivo para que tramos contiguos (0-1000, 1000-5000) no
    // se solapen justo en el límite.
    if (tarifa.maxWeightGrams !== null && pesoGramos >= tarifa.maxWeightGrams) return false;
    return true;
  }

  if (tarifa.type === 'ORDER_VALUE') {
    if (tarifa.minOrderCents !== null && subtotalCents < tarifa.minOrderCents) return false;
    if (tarifa.maxOrderCents !== null && subtotalCents >= tarifa.maxOrderCents) return false;
    return true;
  }

  return true;
}

/**
 * Precio final de una tarifa, aplicando el umbral de envío gratis.
 *
 * El umbral se compara contra el subtotal SIN envío. Compararlo con el total
 * (envío incluido) haría que el propio coste del envío ayudara a superar el
 * umbral que lo hace gratis, que es una contradicción y regala portes.
 */
export function precioTarifa(tarifa: TarifaEnvio, subtotalCents: number): number {
  if (tarifa.freeFromCents !== null && subtotalCents >= tarifa.freeFromCents) return 0;
  return tarifa.priceCents;
}

export interface OpcionCalculada {
  tarifa: TarifaEnvio;
  precioCents: number;
}

/**
 * Opciones de envío de una zona para un carrito concreto, de más barata a más cara.
 */
export function opcionesAplicables(
  zona: ZonaEnvio,
  subtotalCents: number,
  pesoGramos: number,
): OpcionCalculada[] {
  return zona.rates
    .filter((t) => tarifaAplica(t, subtotalCents, pesoGramos))
    .map((tarifa) => ({ tarifa, precioCents: precioTarifa(tarifa, subtotalCents) }))
    .sort((a, b) => a.precioCents - b.precioCents || a.tarifa.minDays - b.tarifa.minDays);
}
