/**
 * Cómputo del plazo de desistimiento.
 *
 * Reglas del texto refundido de la Ley General para la Defensa de los
 * Consumidores y Usuarios (arts. 71, 102-108). Están aquí, en funciones puras,
 * porque cada una tiene una consecuencia legal concreta y equivocarse no da un
 * error visible: da una devolución mal denegada o un reembolso a destiempo.
 *
 * Lo que más se falla en las tiendas españolas:
 *
 *  · Contar desde la fecha del PEDIDO en vez de desde la ENTREGA.
 *  · Contar días hábiles. Son naturales, incluidos domingos y festivos.
 *  · No devolver el envío de ida, que sí hay que devolver.
 *  · Denegarlo por el motivo que dé el cliente. No tiene que motivarlo.
 */

/** Días naturales desde la entrega. */
export const DIAS_DESISTIMIENTO = 14;

/**
 * Si no se informó del derecho, el plazo se alarga doce meses.
 *
 * Art. 105: es la sanción por no informar, y por eso la información aparece en
 * la ficha, en el checkout y en el correo de confirmación.
 */
export const DIAS_SIN_INFORMAR = 365 + DIAS_DESISTIMIENTO;

/** Días para reembolsar desde que el cliente comunica que desiste. */
export const DIAS_PARA_REEMBOLSAR = 14;

export type MotivoExencion =
  'HYGIENE_UNSEALED' | 'CUSTOM_MADE' | 'PERISHABLE' | 'SEALED_MEDIA' | 'MIXED_INSEPARABLE';

/**
 * Fecha límite para desistir.
 *
 * Se cuenta desde la ENTREGA, no desde el pedido: un paquete que tarda tres
 * semanas en llegar de China daría cero días de derecho si se contara desde la
 * compra. Sin entrega registrada, el plazo aún no ha empezado.
 */
export function fechaLimite(entregadoEn: Date | null, seInformó = true): Date | null {
  if (!entregadoEn) return null;

  const limite = new Date(entregadoEn);
  limite.setDate(limite.getDate() + (seInformó ? DIAS_DESISTIMIENTO : DIAS_SIN_INFORMAR));

  // Hasta el final del último día: quien recibe el paquete a las 18:00 tiene
  // los 14 días completos, no 13 días y 6 horas.
  limite.setHours(23, 59, 59, 999);

  return limite;
}

/**
 * ¿Sigue en plazo?
 *
 * Sin entrega registrada devuelve `true`: el plazo no ha empezado a correr,
 * así que desistir es válido —de hecho se puede desistir incluso antes de
 * recibir el pedido.
 */
export function enPlazo(entregadoEn: Date | null, ahora = new Date(), seInformó = true): boolean {
  const limite = fechaLimite(entregadoEn, seInformó);
  if (!limite) return true;
  return ahora.getTime() <= limite.getTime();
}

/**
 * Días naturales que le quedan. 0 el último día; null si aún no ha empezado.
 *
 * Se cuentan días de CALENDARIO, no milisegundos redondeados al alza. El
 * límite son las 23:59 del día 14, así que el mismo día de la entrega quedan
 * casi 15 días de reloj: redondear eso hacia arriba le diría al cliente que
 * tiene 15 días de plazo cuando la ley le da 14, y acabaría con una
 * devolución legítima denegada por confiar en lo que le dijimos.
 */
export function diasRestantes(entregadoEn: Date | null, ahora = new Date()): number | null {
  const limite = fechaLimite(entregadoEn);
  if (!limite) return null;
  if (ahora.getTime() > limite.getTime()) return 0;

  const aMedianoche = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

  return Math.max(0, Math.round((aMedianoche(limite) - aMedianoche(ahora)) / 86_400_000));
}

export interface LineaDesistible {
  orderItemId: string;
  quantity: number;
  totalCents: number;
  /** Excepción del art. 103, si el producto encaja en alguna. */
  exencion: MotivoExencion | null;
}

export interface LineaSolicitada {
  orderItemId: string;
  quantity: number;
}

export interface ResultadoDesistimiento {
  aceptadas: { orderItemId: string; quantity: number; refundCents: number }[];
  rechazadas: { orderItemId: string; motivo: 'EXENTO' | 'CANTIDAD' | 'NO_EXISTE' }[];
  /** Importe de los productos a devolver. */
  reembolsoProductosCents: number;
}

/**
 * Decide qué líneas se pueden devolver y por cuánto.
 *
 * El reembolso de cada línea es proporcional a las unidades devueltas: quien
 * compró tres y devuelve una recupera un tercio, no el total.
 */
export function evaluarLineas(
  disponibles: LineaDesistible[],
  solicitadas: LineaSolicitada[],
): ResultadoDesistimiento {
  const aceptadas: ResultadoDesistimiento['aceptadas'] = [];
  const rechazadas: ResultadoDesistimiento['rechazadas'] = [];
  let total = 0;

  for (const solicitud of solicitadas) {
    const linea = disponibles.find((d) => d.orderItemId === solicitud.orderItemId);

    if (!linea) {
      rechazadas.push({ orderItemId: solicitud.orderItemId, motivo: 'NO_EXISTE' });
      continue;
    }

    if (linea.exencion) {
      rechazadas.push({ orderItemId: solicitud.orderItemId, motivo: 'EXENTO' });
      continue;
    }

    if (solicitud.quantity < 1 || solicitud.quantity > linea.quantity) {
      rechazadas.push({ orderItemId: solicitud.orderItemId, motivo: 'CANTIDAD' });
      continue;
    }

    // Proporcional a las unidades devueltas, redondeando al céntimo.
    const reembolso =
      solicitud.quantity === linea.quantity
        ? linea.totalCents
        : Math.round((linea.totalCents / linea.quantity) * solicitud.quantity);

    aceptadas.push({
      orderItemId: solicitud.orderItemId,
      quantity: solicitud.quantity,
      refundCents: reembolso,
    });
    total += reembolso;
  }

  return { aceptadas, rechazadas, reembolsoProductosCents: total };
}

/**
 * Cuánto del envío de ida hay que devolver.
 *
 * Art. 107.2: se devuelve el coste del envío ordinario. Si el cliente eligió
 * una modalidad más cara (urgente), la diferencia NO se reembolsa. Y solo se
 * devuelve si desiste del pedido entero: en una devolución parcial el envío se
 * consumió para traer lo que se queda.
 */
export function reembolsoDeEnvio(
  envioPagadoCents: number,
  envioEstandarCents: number,
  esDevolucionTotal: boolean,
): number {
  if (!esDevolucionTotal) return 0;
  return Math.min(envioPagadoCents, envioEstandarCents);
}

/** Fecha límite para tener el dinero devuelto. */
export function fechaLimiteReembolso(comunicadoEn: Date): Date {
  const limite = new Date(comunicadoEn);
  limite.setDate(limite.getDate() + DIAS_PARA_REEMBOLSAR);
  return limite;
}
