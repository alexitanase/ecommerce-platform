/**
 * Reglas de los reembolsos.
 *
 * En cripto un reembolso no es "deshacer el cobro": no existe tal cosa. Es un
 * **envío nuevo de dinero** a una dirección que facilita el cliente, y tiene
 * dos consecuencias que no tiene una tarjeta:
 *
 *  1. **Es irreversible.** Una dirección mal escrita son fondos perdidos, sin
 *     nadie a quien reclamar. Por eso hay aprobación manual entre pedir el
 *     reembolso y ejecutarlo.
 *  2. **La cotización se mueve.** Entre el cobro y la devolución el cambio ha
 *     variado, así que "devolver lo mismo" es ambiguo.
 *
 * Sobre lo segundo se devuelve el **importe en euros**, convertido al cambio
 * del día del reembolso. La venta se pactó en euros, la factura está en euros y
 * es el importe en euros el que la ley obliga a devolver; la cripto fue solo el
 * medio de pago. Devolver la misma cantidad de moneda sería regalar la
 * revalorización —o quedársela— según hacia dónde se haya movido el mercado.
 */

export type EstadoReembolso =
  'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | 'FAILED';

/**
 * Transiciones permitidas.
 *
 * `COMPLETED` no lleva a ningún sitio: el dinero ya salió de la cuenta y no
 * hay operación que lo traiga de vuelta. `FAILED` sí puede reintentarse, que es
 * lo que pasa cuando la pasarela se queda sin saldo o la red rechaza el envío.
 */
const TRANSICIONES: Record<EstadoReembolso, EstadoReembolso[]> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSING', 'REJECTED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  REJECTED: [],
  FAILED: ['APPROVED', 'REJECTED'],
};

export function puedeTransicionar(desde: EstadoReembolso, hasta: EstadoReembolso): boolean {
  return (TRANSICIONES[desde] ?? []).includes(hasta);
}

/** Estados en los que el reembolso todavía cuenta contra el importe cobrado. */
export const VIVOS: EstadoReembolso[] = ['REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED'];

export type MotivoRechazo =
  | 'PAGO_NO_COBRADO'
  | 'IMPORTE_CERO'
  | 'SUPERA_LO_COBRADO'
  | 'FALTA_DIRECCION'
  | 'DIRECCION_INVALIDA'
  | 'YA_EN_CURSO';

/**
 * Cuánto queda por reembolsar de un cobro.
 *
 * Los reembolsos ya pedidos cuentan aunque no se hayan ejecutado: si solo se
 * descontaran los completados, pedir dos veces el mismo reembolso mientras el
 * primero espera aprobación pasaría las dos veces y se devolvería el doble.
 */
export function importeReembolsable(
  cobradoCents: number,
  reembolsos: { amountCents: number; status: EstadoReembolso }[],
): number {
  const comprometido = reembolsos
    .filter((r) => VIVOS.includes(r.status))
    .reduce((a, r) => a + r.amountCents, 0);

  return Math.max(0, cobradoCents - comprometido);
}

/**
 * Comprueba de forma superficial que una dirección tiene la forma de la red.
 *
 * No valida el checksum ni consulta la cadena: eso lo hace la pasarela, que es
 * quien tiene la implementación buena de cada red. Lo que se ataja aquí son los
 * errores que llegan de un formulario —espacios pegados, la dirección de otra
 * red, un texto cualquiera—, porque en cripto un envío mal dirigido no se puede
 * deshacer.
 */
export function pareceDireccionValida(direccion: string, moneda: string): boolean {
  const limpia = direccion.trim();
  if (limpia !== direccion || limpia.length < 20 || limpia.length > 120) return false;
  if (/\s/.test(limpia)) return false;

  const red = moneda.toUpperCase();

  // TRON: empiezan por T y son 34 caracteres en base58.
  if (red.includes('TRC20') || red === 'TRX') {
    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(limpia);
  }

  // Ethereum y compatibles: 0x y 40 hexadecimales.
  if (red.includes('ERC20') || red.includes('BEP20') || ['ETH', 'BNB', 'MATIC'].includes(red)) {
    return /^0x[0-9a-fA-F]{40}$/.test(limpia);
  }

  if (red === 'BTC') {
    return /^(bc1[023456789acdefghjklmnpqrstuvwxyz]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(
      limpia,
    );
  }

  // Red que no conocemos: se acepta la forma general y decide la pasarela.
  return /^[0-9A-Za-z:_-]+$/.test(limpia);
}

export interface SolicitudValidable {
  importeCents: number;
  cobradoCents: number;
  pagoCobrado: boolean;
  reembolsosPrevios: { amountCents: number; status: EstadoReembolso }[];
  /** Falso en pasarelas que devuelven al origen sin pedir destino. */
  requiereDireccion: boolean;
  direccion?: string | undefined;
  moneda?: string | undefined;
}

/** Devuelve el motivo por el que no se puede pedir, o null si se puede. */
export function motivoNoReembolsable(s: SolicitudValidable): MotivoRechazo | null {
  if (!s.pagoCobrado) return 'PAGO_NO_COBRADO';
  if (s.importeCents <= 0) return 'IMPORTE_CERO';

  const disponible = importeReembolsable(s.cobradoCents, s.reembolsosPrevios);
  if (disponible === 0) return 'YA_EN_CURSO';
  if (s.importeCents > disponible) return 'SUPERA_LO_COBRADO';

  if (s.requiereDireccion) {
    if (!s.direccion) return 'FALTA_DIRECCION';
    if (!pareceDireccionValida(s.direccion, s.moneda ?? '')) return 'DIRECCION_INVALIDA';
  }

  return null;
}

/** Explicación para quien lo lea en el panel o en la respuesta de la API. */
export function explicarRechazo(motivo: MotivoRechazo, disponibleCents?: number): string {
  switch (motivo) {
    case 'PAGO_NO_COBRADO':
      return 'Ese cobro no llegó a completarse: no hay nada que devolver.';
    case 'IMPORTE_CERO':
      return 'El importe a devolver tiene que ser mayor que cero.';
    case 'SUPERA_LO_COBRADO':
      return disponibleCents === undefined
        ? 'No se puede devolver más de lo cobrado.'
        : `Solo quedan ${(disponibleCents / 100).toFixed(2).replace('.', ',')} € por devolver de este cobro.`;
    case 'YA_EN_CURSO':
      return 'Este cobro ya tiene reembolsos por todo su importe.';
    case 'FALTA_DIRECCION':
      return 'Hace falta la dirección a la que enviar los fondos: en cripto no existe la devolución al origen.';
    case 'DIRECCION_INVALIDA':
      return 'Esa dirección no tiene el formato de la red elegida. Compruébala: un envío mal dirigido no se puede deshacer.';
  }
}

/**
 * Cantidad de moneda a enviar para devolver un importe en euros.
 *
 * Se convierte al cambio del **día del reembolso**, no al del cobro. Con el del
 * cobro, una subida de la moneda haría que devolver 100 € costara 180 € reales,
 * y una bajada dejaría al cliente cobrando menos de lo que pagó.
 *
 * Se devuelve como texto y no como número: las cantidades en cripto tienen
 * hasta dieciocho decimales y un `number` de JavaScript los pierde en silencio.
 *
 * @param cambioPorEuro unidades de la moneda que vale un euro
 */
export function cantidadADevolver(
  importeCents: number,
  cambioPorEuro: number,
  decimales = 8,
): string {
  if (cambioPorEuro <= 0 || !Number.isFinite(cambioPorEuro)) {
    throw new Error('El tipo de cambio para el reembolso no es válido');
  }

  const cantidad = (importeCents / 100) * cambioPorEuro;

  // Redondeo hacia arriba en el último decimal: la diferencia es despreciable
  // para la tienda y evita devolver un céntimo de menos, que es lo que genera
  // la reclamación.
  const factor = 10 ** decimales;
  return (Math.ceil(cantidad * factor) / factor).toFixed(decimales);
}
