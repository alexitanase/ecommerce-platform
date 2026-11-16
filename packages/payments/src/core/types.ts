/**
 * Contrato común a todas las pasarelas de pago.
 *
 * Igual que con los proveedores: mientras el checkout y el motor de pedidos
 * hablen solo con esta interfaz, añadir Revolut, Stripe o PayPal es escribir un
 * adaptador, no reescribir el flujo de cobro.
 *
 * El contrato está pensado desde el caso más exigente —cripto— porque es el que
 * tiene más estados: importe parcial, caducidad, confirmaciones pendientes. Una
 * pasarela de tarjeta simplemente no usa esos campos, mientras que un contrato
 * diseñado para tarjeta no podría representar un pago cripto sin parches.
 */

export type Cents = number;

export type EstadoPago =
  | 'PENDIENTE' // creado, el cliente aún no ha pagado
  | 'ESPERANDO_CONFIRMACION' // transacción vista, sin confirmaciones suficientes
  | 'PAGADO_PARCIAL' // ha llegado menos de lo pedido
  | 'PAGADO'
  | 'SOBREPAGADO' // ha llegado de más
  | 'CADUCADO'
  | 'FALLIDO'
  | 'REEMBOLSADO'
  | 'DESCONOCIDO';

export interface SolicitudCobro {
  /** Nuestro identificador de pedido. */
  orderId: string;
  orderNumber: string;
  amountCents: Cents;
  currency: string;
  /** Email del cliente, para que la pasarela le avise. */
  customerEmail: string;
  description: string;
  /** A dónde vuelve el cliente tras pagar o cancelar. */
  successUrl: string;
  cancelUrl: string;
  /** URL a la que la pasarela nos notifica el resultado. */
  callbackUrl: string;
  /** Moneda en la que quiere pagar el cliente (cripto). */
  payCurrency?: string;
  /** Impide que un reintento cree un segundo cobro. */
  idempotencyKey: string;
  locale?: string;
}

export interface RespuestaCobro {
  /** Identificador del cobro en la pasarela. */
  externalId: string;
  estado: EstadoPago;
  /** URL a la que enviar al cliente para que pague. */
  checkoutUrl?: string;

  // ── Específico de cripto ──
  /** Dirección a la que el cliente debe enviar los fondos. */
  payAddress?: string;
  /** Importe exacto en la moneda de pago, como texto para no perder decimales. */
  payAmount?: string;
  payCurrency?: string;
  /** Tipo de cambio aplicado; necesario para la factura en euros. */
  exchangeRate?: string;
  /** Momento a partir del cual el precio bloqueado deja de valer. */
  expiresAt?: Date;
  /** QR listo para mostrar, si la pasarela lo proporciona. */
  qrCodeUrl?: string;

  metadata?: Record<string, unknown>;
}

export interface EstadoCobro {
  externalId: string;
  estado: EstadoPago;
  /** Importe realmente recibido, en la divisa del pedido. */
  receivedCents: Cents;
  amountCents: Cents;
  /** Comisión cobrada por la pasarela. */
  feeCents?: Cents;
  payCurrency?: string;
  payAmount?: string;
  /** Hash de la transacción en la cadena, para poder auditarla. */
  txHash?: string;
  confirmations?: number;
  exchangeRate?: string;
  paidAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface SolicitudReembolso {
  /** Identificador del cobro original. */
  externalPaymentId: string;
  amountCents: Cents;
  currency: string;
  reason: string;
  idempotencyKey: string;
  /**
   * Dirección de destino. Obligatoria en cripto: no existe el concepto de
   * "devolver a la tarjeta", hay que enviar los fondos a algún sitio.
   */
  payoutAddress?: string;
  payoutCurrency?: string;
  payoutNetwork?: string;
}

export interface RespuestaReembolso {
  externalId: string;
  estado: 'PENDIENTE' | 'PROCESANDO' | 'COMPLETADO' | 'FALLIDO';
  txHash?: string;
  /**
   * Cantidad realmente enviada en la moneda de destino, como texto.
   *
   * Se guarda porque es lo único que el cliente puede comprobar en la cadena:
   * el importe en euros no aparece en ninguna parte de la transacción, y sin
   * este dato una reclamación de "no me ha llegado lo que debía" no se puede
   * responder.
   */
  cantidadEnviada?: string;
  monedaEnviada?: string;
  mensaje?: string;
}

/**
 * Qué sabe hacer cada pasarela.
 *
 * El checkout consulta esto en lugar de asumir: no tiene sentido pedir una
 * dirección de devolución si la pasarela reembolsa a la tarjeta sola, ni
 * mostrar un contador de caducidad si el pago no caduca.
 */
export interface CapacidadesPasarela {
  /** El cobro tiene fecha de caducidad (típico en cripto por la volatilidad). */
  cobroCaduca: boolean;
  /** Puede llegar un importe distinto al pedido. */
  admitePagoParcial: boolean;
  /** Reembolsa automáticamente sin pedir destino. */
  reembolsoAutomatico: boolean;
  /** Necesita una dirección de destino para devolver el dinero. */
  requiereDireccionReembolso: boolean;
  /** Admite reembolsos por menos del importe total. */
  reembolsoParcial: boolean;
  /** El cliente puede iniciar una disputa (chargeback). */
  admiteDisputas: boolean;
  /** Divisas de pago admitidas; vacío = cualquiera. */
  monedasDePago: string[];
}

export interface EventoWebhook {
  /** Identificador del cobro al que se refiere. */
  externalId: string;
  estado: EstadoPago;
  receivedCents?: Cents;
  payAmount?: string;
  txHash?: string;
  confirmations?: number;
  /** Identificador único del evento, para deduplicar reenvíos. */
  eventId?: string;
  raw: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly key: string;
  readonly nombre: string;
  readonly capacidades: CapacidadesPasarela;

  /** Comprueba que las credenciales sirven. */
  verificar(): Promise<{ ok: boolean; mensaje?: string }>;

  /** Divisas en las que el cliente puede pagar (cripto disponibles). */
  monedasDisponibles(): Promise<string[]>;

  /** Estimación de cuánto tendría que enviar el cliente en su moneda. */
  estimar?(amountCents: Cents, currency: string, payCurrency: string): Promise<string>;

  crearCobro(solicitud: SolicitudCobro): Promise<RespuestaCobro>;
  consultarCobro(externalId: string): Promise<EstadoCobro | null>;

  /**
   * Verifica la firma del webhook y devuelve el evento normalizado.
   *
   * Devolver null significa firma inválida. Es la comprobación más importante
   * de toda la pasarela: sin ella, cualquiera puede enviarnos un "pago
   * confirmado" falso y llevarse la mercancía gratis.
   */
  verificarWebhook(cuerpo: string, cabeceras: Record<string, string>): EventoWebhook | null;

  reembolsar(solicitud: SolicitudReembolso): Promise<RespuestaReembolso>;
}

// ── Errores ─────────────────────────────────────────────────

export type TipoErrorPago =
  | 'CREDENCIALES'
  | 'IMPORTE_INVALIDO'
  | 'MONEDA_NO_SOPORTADA'
  | 'FIRMA_INVALIDA'
  | 'NO_ENCONTRADO'
  | 'YA_PROCESADO'
  | 'SALDO_INSUFICIENTE'
  | 'DIRECCION_INVALIDA'
  | 'RED'
  | 'PASARELA_CAIDA'
  | 'DESCONOCIDO';

export class ErrorPasarela extends Error {
  constructor(
    readonly tipo: TipoErrorPago,
    mensaje: string,
    readonly opciones: {
      pasarela?: string;
      reintentable?: boolean;
      detalleOriginal?: unknown;
    } = {},
  ) {
    super(mensaje);
    this.name = 'ErrorPasarela';
  }

  get reintentable(): boolean {
    if (this.opciones.reintentable !== undefined) return this.opciones.reintentable;
    return ['RED', 'PASARELA_CAIDA'].includes(this.tipo);
  }

  /** Mensaje apto para mostrar al cliente, sin detalles internos. */
  get mensajeCliente(): string {
    const mensajes: Record<TipoErrorPago, string> = {
      CREDENCIALES: 'No podemos procesar pagos en este momento. Inténtalo más tarde.',
      IMPORTE_INVALIDO: 'El importe del pedido no es válido.',
      MONEDA_NO_SOPORTADA: 'Esa moneda no está disponible ahora mismo. Elige otra.',
      FIRMA_INVALIDA: 'No hemos podido verificar el pago.',
      NO_ENCONTRADO: 'No encontramos ese pago.',
      YA_PROCESADO: 'Este pago ya se había procesado.',
      SALDO_INSUFICIENTE: 'El importe recibido no cubre el total del pedido.',
      DIRECCION_INVALIDA: 'La dirección indicada no es válida para esa red.',
      RED: 'Problema de conexión con la pasarela. Vuelve a intentarlo.',
      PASARELA_CAIDA: 'La pasarela no está disponible. Inténtalo en unos minutos.',
      DESCONOCIDO: 'No hemos podido completar el pago.',
    };
    return mensajes[this.tipo];
  }
}
