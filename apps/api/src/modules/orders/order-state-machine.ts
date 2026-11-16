import { BadRequestException } from '@nestjs/common';
import type { OrderStatus } from '@ecom/db';

/**
 * Máquina de estados del pedido.
 *
 * Las transiciones válidas están declaradas aquí y en ningún otro sitio. Sin
 * esta tabla, cualquier punto del código podría marcar como "entregado" un
 * pedido que nunca se pagó, o reabrir uno ya cerrado: son justo los errores
 * que descuadran la contabilidad y no se detectan hasta el cierre del mes.
 *
 * Importante para el flujo cripto: el pedido NO llega a PAID hasta que la red
 * confirma la transacción. Enviarlo al proveedor antes significaría pagar
 * mercancía con un cobro que todavía puede no llegar nunca.
 */

export const TRANSICIONES: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['AWAITING_PAYMENT', 'CANCELLED'],

  AWAITING_PAYMENT: ['PAYMENT_CONFIRMING', 'PAID', 'CANCELLED', 'FAILED'],

  // En cripto se ve la transacción antes de que sea firme.
  PAYMENT_CONFIRMING: ['PAID', 'AWAITING_PAYMENT', 'CANCELLED', 'FAILED'],

  PAID: ['PREPARING', 'CANCELLED', 'REFUNDED', 'FAILED'],

  PREPARING: ['SENT_TO_SUPPLIER', 'CANCELLED', 'FAILED'],

  SENT_TO_SUPPLIER: ['IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'FAILED'],

  IN_TRANSIT: ['DELIVERED', 'FAILED'],

  DELIVERED: ['PENDING_CLOSE', 'REFUNDED'],

  // El equipo confirma manualmente para que salga del Kanban.
  PENDING_CLOSE: ['CLOSED', 'REFUNDED'],

  // Se puede reabrir: una devolución tardía obliga a volver a tocarlo.
  CLOSED: ['REFUNDED'],

  CANCELLED: ['REFUNDED'],
  REFUNDED: [],

  // Desde el fallo se vuelve al punto anterior una vez resuelta la incidencia.
  FAILED: ['PAID', 'PREPARING', 'SENT_TO_SUPPLIER', 'CANCELLED', 'REFUNDED'],
};

/** Estados en los que el pedido ya no se mueve solo. */
export const ESTADOS_FINALES: OrderStatus[] = ['CLOSED', 'REFUNDED'];

/** Estados que se muestran en el tablero Kanban. */
export const ESTADOS_KANBAN: OrderStatus[] = [
  'AWAITING_PAYMENT',
  'PAYMENT_CONFIRMING',
  'PAID',
  'PREPARING',
  'SENT_TO_SUPPLIER',
  'IN_TRANSIT',
  'DELIVERED',
  'PENDING_CLOSE',
];

/** Nombre legible de cada estado, para la interfaz. */
export const ETIQUETAS: Record<OrderStatus, string> = {
  DRAFT: 'Borrador',
  AWAITING_PAYMENT: 'Esperando pago',
  PAYMENT_CONFIRMING: 'Confirmando en red',
  PAID: 'Pago confirmado',
  PREPARING: 'En preparación',
  SENT_TO_SUPPLIER: 'Enviado al proveedor',
  IN_TRANSIT: 'En tránsito',
  DELIVERED: 'Entregado',
  PENDING_CLOSE: 'Pendiente de cerrar',
  CLOSED: 'Cerrado',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Reembolsado',
  FAILED: 'Incidencia',
};

/**
 * Transiciones que solo puede hacer el sistema, nunca un humano arrastrando
 * una tarjeta en el Kanban.
 *
 * Marcar "enviado al proveedor" a mano un pedido que el proveedor nunca
 * recibió deja al cliente esperando un paquete que no existe, y el pedido
 * desaparece de la cola de trabajo pendiente. El sistema lo marca cuando el
 * proveedor confirma, no antes.
 */
export const SOLO_AUTOMATICAS: { desde: OrderStatus; hasta: OrderStatus }[] = [
  { desde: 'AWAITING_PAYMENT', hasta: 'PAID' },
  { desde: 'PAYMENT_CONFIRMING', hasta: 'PAID' },
  { desde: 'PREPARING', hasta: 'SENT_TO_SUPPLIER' },
];

/**
 * Estados a los que NO se llega moviendo el pedido de sitio.
 *
 * Los tres tienen detrás algo más que un cambio de estado, y llegar por el
 * atajo se salta justamente eso:
 *
 *  · `CANCELLED` avisa al proveedor para que no envíe, libera el stock
 *    reservado y arranca la devolución del dinero.
 *  · `CLOSED` anota quién y cuándo lo cerró, que es lo que responde después a
 *    «¿quién dio esto por bueno?».
 *  · `REFUNDED` significa que el dinero ha vuelto. Marcarlo sin devolverlo es
 *    la peor mentira posible en un pedido: cuadra en el panel y no en el banco.
 *
 * Siguen siendo transiciones válidas —el propio flujo las usa—; lo que no son
 * es destinos que ofrecer en un menú de «mover a».
 */
export const CON_FLUJO_PROPIO: OrderStatus[] = ['CANCELLED', 'CLOSED', 'REFUNDED'];

export function puedeTransicionar(desde: OrderStatus, hasta: OrderStatus): boolean {
  return TRANSICIONES[desde]?.includes(hasta) ?? false;
}

export function esTransicionManual(desde: OrderStatus, hasta: OrderStatus): boolean {
  return !SOLO_AUTOMATICAS.some((t) => t.desde === desde && t.hasta === hasta);
}

/**
 * A dónde puede mover el pedido una persona, sin más que decidirlo.
 *
 * Es lo que pintan el tablero y la ficha, y lo que acota el endpoint de cambio
 * de estado. Se calcula en un solo sitio para que las tres cosas no puedan
 * discrepar: el menú ofrecía pasos que la API rechaza —y otros que aceptaba
 * saltándose el aviso al proveedor y la devolución del dinero—.
 */
export function destinosManuales(desde: OrderStatus): OrderStatus[] {
  return (TRANSICIONES[desde] ?? []).filter(
    (hasta) => esTransicionManual(desde, hasta) && !CON_FLUJO_PROPIO.includes(hasta),
  );
}

/**
 * Valida una transición y lanza un error explicativo si no procede.
 * `origen` distingue quién la pide: el sistema puede más que una persona.
 */
export function exigirTransicionValida(
  desde: OrderStatus,
  hasta: OrderStatus,
  origen: 'sistema' | 'manual' = 'sistema',
): void {
  if (desde === hasta) {
    throw new BadRequestException(`El pedido ya está en estado "${ETIQUETAS[hasta]}"`);
  }

  if (!puedeTransicionar(desde, hasta)) {
    const permitidos = TRANSICIONES[desde]?.map((e) => ETIQUETAS[e]).join(', ') || 'ninguno';
    throw new BadRequestException(
      `No se puede pasar de "${ETIQUETAS[desde]}" a "${ETIQUETAS[hasta]}". ` +
        `Desde este estado solo se puede ir a: ${permitidos}.`,
    );
  }

  if (origen === 'manual' && !esTransicionManual(desde, hasta)) {
    throw new BadRequestException(
      `El paso a "${ETIQUETAS[hasta]}" lo realiza el sistema automáticamente y no puede forzarse a mano. ` +
        `Marcarlo manualmente dejaría el pedido fuera de la cola de trabajo sin haberse procesado.`,
    );
  }
}

/** ¿Admite reembolso? Solo si hubo cobro. */
export function esReembolsable(estado: OrderStatus): boolean {
  return [
    'PAID',
    'PREPARING',
    'SENT_TO_SUPPLIER',
    'IN_TRANSIT',
    'DELIVERED',
    'PENDING_CLOSE',
    'CLOSED',
    'CANCELLED',
    'FAILED',
  ].includes(estado);
}
