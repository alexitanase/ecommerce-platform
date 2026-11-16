/**
 * Reglas de cancelación de un pedido.
 *
 * Puras y probadas aparte porque cada rama tiene una consecuencia distinta con
 * dinero de por medio: cancelar tarde deja un paquete en camino que nadie va a
 * recoger, y cancelar sin devolver el stock deja unidades bloqueadas que no se
 * pueden vender.
 */

import type { OrderStatus } from '@ecom/db';

/**
 * Qué hay que deshacer al cancelar, según en qué punto esté el pedido.
 */
export interface PlanCancelacion {
  /** Devolver las unidades al stock. Solo si llegaron a descontarse. */
  devolverStock: boolean;
  /** Intentar cancelar en el proveedor antes de dar el pedido por cancelado. */
  cancelarEnProveedor: boolean;
  /** Reembolsar al cliente. */
  reembolsar: boolean;
  /**
   * El proveedor ya lo tiene y puede haberlo despachado: cancelar aquí no
   * detiene el paquete, así que exige revisión humana.
   */
  requiereRevision: boolean;
}

/**
 * Estados desde los que el CLIENTE puede cancelar por su cuenta.
 *
 * Se corta en cuanto el pedido sale hacia el proveedor: a partir de ahí puede
 * haber un paquete en movimiento y una cancelación automática dejaría el
 * dinero devuelto y la mercancía enviada. Después de ese punto queda el
 * derecho de desistimiento, que sí cubre al cliente y tiene su propio circuito.
 */
const CANCELABLES_POR_CLIENTE = new Set<OrderStatus>([
  'DRAFT',
  'AWAITING_PAYMENT',
  'PAYMENT_CONFIRMING',
  'PAID',
]);

/**
 * Estados desde los que el EQUIPO puede cancelar.
 *
 * Llega más lejos que el cliente porque una persona puede llamar al proveedor,
 * comprobar si el paquete ha salido y decidir con esa información.
 */
const CANCELABLES_POR_EQUIPO = new Set<OrderStatus>([
  ...CANCELABLES_POR_CLIENTE,
  'PREPARING',
  'SENT_TO_SUPPLIER',
  'FAILED',
]);

export function puedeCancelar(estado: OrderStatus, quien: 'cliente' | 'equipo'): boolean {
  return quien === 'cliente'
    ? CANCELABLES_POR_CLIENTE.has(estado)
    : CANCELABLES_POR_EQUIPO.has(estado);
}

/**
 * Qué hay que deshacer para cancelar un pedido.
 *
 * **Lo del dinero se decide por el estado del PAGO, no por el del pedido.** Con
 * una lista de estados «ya cobrados» quedaba fuera `FAILED`, y una incidencia
 * puede perfectamente venir de un pedido cobrado: cancelarlo devolvía el pedido
 * al cliente sin devolverle el dinero, en silencio y sin que nada fallara.
 *
 * Lo del stock, por el mismo motivo, se decide por si hubo movimiento de
 * verdad: devolver unidades que nunca se descontaron infla el inventario y
 * acaba vendiendo lo que no hay.
 *
 * El estado sigue decidiendo lo que sí depende de él: si hay que hablar con el
 * proveedor y si hace falta que alguien mire.
 */
export function planDeCancelacion(
  estado: OrderStatus,
  hechos: {
    /** El dinero está cobrado, según el estado del pago. */
    cobrado: boolean;
    /** Hubo un movimiento de stock por esta venta. */
    stockDescontado: boolean;
  },
): PlanCancelacion {
  /*
   * Se pregunta al proveedor también desde FAILED: una incidencia puede haberse
   * abierto DESPUÉS de que uno de los sub-pedidos se colocara, y dar por
   * cancelado sin preguntar sería devolver el dinero de un paquete que sale
   * igual. Si no hay ningún sub-pedido vivo, preguntar no cuesta nada.
   */
  const yaEnProveedor =
    estado === 'PREPARING' || estado === 'SENT_TO_SUPPLIER' || estado === 'FAILED';

  return {
    devolverStock: hechos.stockDescontado,
    cancelarEnProveedor: yaEnProveedor,
    reembolsar: hechos.cobrado,
    // SENT_TO_SUPPLIER significa que el proveedor aceptó el pedido: puede
    // haberlo despachado ya aunque todavía no haya número de seguimiento.
    requiereRevision: estado === 'SENT_TO_SUPPLIER',
  };
}

/** ¿Hay dinero cobrado que haya que devolver? */
export function hayDineroCobrado(estadoPago: string): boolean {
  return ['PAID', 'OVERPAID', 'PARTIALLY_PAID'].includes(estadoPago);
}

/**
 * Motivo por el que NO se puede cancelar, para decírselo al cliente.
 *
 * Un "no se puede" sin explicación genera un correo a soporte. Decir en qué
 * punto está y qué puede hacer en su lugar lo evita.
 */
export function motivoNoCancelable(
  estado: OrderStatus,
  quien: 'cliente' | 'equipo',
): string | null {
  if (puedeCancelar(estado, quien)) return null;

  if (estado === 'CANCELLED') return 'Este pedido ya está cancelado.';
  if (estado === 'REFUNDED') return 'Este pedido ya fue reembolsado.';

  if (estado === 'IN_TRANSIT') {
    return (
      'El paquete ya está en camino y no se puede cancelar. ' +
      'Cuando lo recibas puedes devolverlo: tienes 14 días desde la entrega.'
    );
  }

  if (estado === 'DELIVERED' || estado === 'PENDING_CLOSE' || estado === 'CLOSED') {
    return (
      'El pedido ya se ha entregado. Si quieres devolverlo, tienes 14 días ' +
      'naturales desde que lo recibiste.'
    );
  }

  if (quien === 'cliente' && (estado === 'PREPARING' || estado === 'SENT_TO_SUPPLIER')) {
    return (
      'Tu pedido ya está en preparación. Escríbenos y comprobaremos si todavía ' +
      'se puede detener; si no, podrás devolverlo al recibirlo.'
    );
  }

  return 'Este pedido no se puede cancelar en su estado actual.';
}

/**
 * Estados en los que todavía se puede cambiar la dirección de envío.
 *
 * Se corta antes de que salga al proveedor: una vez enviado, cambiar la
 * dirección aquí no cambia la etiqueta del paquete y el cliente creería que sí.
 */
const MODIFICABLES = new Set<OrderStatus>([
  'DRAFT',
  'AWAITING_PAYMENT',
  'PAYMENT_CONFIRMING',
  'PAID',
]);

export function puedeCambiarDireccion(estado: OrderStatus): boolean {
  return MODIFICABLES.has(estado);
}
