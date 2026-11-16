import type { OrderStatus } from '@ecom/db';

/**
 * El historial del pedido, contado como se le puede contar al cliente.
 *
 * El historial interno de un pedido es un cuaderno de bitácora del negocio:
 * a qué proveedor se mandó y con qué referencia, cuánto nos cobró de verdad
 * frente a lo previsto, con qué pasarela se lanzó el cobro, por qué se paró un
 * pedido. Todo eso se escribía en el campo `description` y ese campo salía tal
 * cual en la página de seguimiento, que es pública: basta el enlace.
 *
 * Es decir, cualquiera con el enlace de su pedido leía «Enviado a AliExpress ·
 * referencia …» y «El proveedor ha cobrado 12,40 € (se esperaban 9,90 €)».
 * Lo primero cuenta a quién le compramos; lo segundo, el margen.
 *
 * Se filtraba por `actorType`, que es una lista negra: sirve mientras nadie
 * añada un evento nuevo, y ya se escapaban cuatro. Aquí se hace al revés. Del
 * evento interno solo se mira **el tipo**, y el texto que ve el cliente lo pone
 * la tienda a partir de una clave de esta lista. Un evento que no esté en la
 * lista no se enseña, así que un tipo nuevo nace invisible y no hay forma de
 * filtrar un dato que nunca sale.
 */

/** Los hitos que se le cuentan al cliente. Cerrada a propósito. */
export type ClavePublica =
  | 'realizado'
  | 'pagado'
  | 'preparando'
  | 'en_camino'
  | 'entregado'
  | 'cancelado'
  | 'reembolsado'
  | 'incidencia'
  | 'devolucion'
  | 'desistimiento';

export interface HitoPublico {
  clave: ClavePublica;
  createdAt: Date;
}

/** Lo que ha pasado a ser el pedido, cuando el evento es un cambio de estado. */
const POR_ESTADO: Partial<Record<OrderStatus, ClavePublica>> = {
  PAID: 'pagado',
  // «En preparación» y «enviado al proveedor» son la misma cosa vistas desde
  // fuera: su pedido se está preparando. Que en medio haya un tercero es
  // asunto nuestro.
  PREPARING: 'preparando',
  SENT_TO_SUPPLIER: 'preparando',
  IN_TRANSIT: 'en_camino',
  DELIVERED: 'entregado',
  CANCELLED: 'cancelado',
  REFUNDED: 'reembolsado',
  FAILED: 'incidencia',
  /*
   * Los que faltan no son un olvido.
   *
   * DRAFT, AWAITING_PAYMENT y PAYMENT_CONFIRMING pasan antes de que haya nada
   * que contar, y PENDING_CLOSE y CLOSED son archivo nuestro: para quien
   * compró, el pedido terminó cuando llegó a su casa. Enseñar «cerrado» días
   * después solo genera la duda de qué se ha cerrado y por qué.
   */
};

/** Lo que ha pasado, cuando el propio tipo del evento ya lo dice. */
const POR_TIPO: Record<string, ClavePublica> = {
  'order.created': 'realizado',
  'order.paid': 'pagado',
  // A mano lo marca una persona del equipo —una transferencia recibida, por
  // ejemplo—, pero para quien compró es exactamente lo mismo: está pagado.
  'order.paid_manually': 'pagado',
  'order.shipped': 'en_camino',
  'order.return_requested': 'devolucion',
  'order.withdrawal_requested': 'desistimiento',
};

/**
 * Los tipos que pueden llegar a decir algo. Sirve para no traerse de la base
 * eventos que se van a descartar, y sobre todo para no traerse su `description`.
 */
export const TIPOS_PUBLICOS = [...Object.keys(POR_TIPO), 'order.status_changed'];

/**
 * El estado del pedido, con el nombre que puede leerse fuera.
 *
 * De los trece estados internos solo uno se delata a sí mismo:
 * `SENT_TO_SUPPLIER`. Va en el JSON de una página pública, así que cualquiera
 * que lo mire aprende que aquí hay un tercero enviando los paquetes. Para
 * quien compró es «en preparación» —es lo mismo que ya hace la barra de
 * progreso de la tienda—, y así se llama de puertas afuera.
 *
 * Los demás se quedan como están: «pendiente de cerrar» o «reembolsado» serán
 * vocabulario nuestro, pero no cuentan nada del negocio que no se pueda contar.
 */
export function estadoPublico(estado: OrderStatus): string {
  return estado === 'SENT_TO_SUPPLIER' ? 'PREPARING' : estado;
}

interface EventoInterno {
  type: string;
  metadata: unknown;
  createdAt: Date;
}

/** El estado destino que guarda un `order.status_changed` en su metadata. */
function estadoDestino(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const hasta: unknown = (metadata as Record<string, unknown>)['hasta'];
  return typeof hasta === 'string' ? hasta : null;
}

/** Qué hito público es este evento, si es alguno. */
export function clavePublica(evento: EventoInterno): ClavePublica | null {
  if (evento.type === 'order.status_changed') {
    const hasta = estadoDestino(evento.metadata);
    return hasta ? (POR_ESTADO[hasta as OrderStatus] ?? null) : null;
  }

  return POR_TIPO[evento.type] ?? null;
}

/**
 * El historial que se le enseña al cliente.
 *
 * Se quitan los hitos repetidos seguidos porque un mismo paso deja varias
 * huellas internas: pagar escribe un `order.paid` y además un cambio de estado
 * a PAID, y preparar pasa por «en preparación» y por «enviado al proveedor».
 * Sin agrupar, el cliente ve «Pago confirmado» dos veces seguidas y piensa que
 * le han cobrado dos veces.
 *
 * Se conserva la primera de cada tanda, que es cuando ocurrió de verdad. Y solo
 * se agrupan las **seguidas**: si un pedido vuelve a ponerse en camino después
 * de una incidencia, eso es algo que pasó dos veces y hay que contarlo.
 */
export function historialPublico(eventos: EventoInterno[]): HitoPublico[] {
  const hitos: HitoPublico[] = [];

  for (const evento of eventos) {
    const clave = clavePublica(evento);
    if (!clave) continue;
    if (hitos[hitos.length - 1]?.clave === clave) continue;
    hitos.push({ clave, createdAt: evento.createdAt });
  }

  return hitos;
}
