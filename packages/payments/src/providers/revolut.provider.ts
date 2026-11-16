import crypto from 'node:crypto';
import { texto, textoOpcional } from '../core/coercion.js';
import {
  ErrorPasarela,
  type CapacidadesPasarela,
  type Cents,
  type EstadoCobro,
  type EstadoPago,
  type EventoWebhook,
  type PaymentProvider,
  type RespuestaCobro,
  type RespuestaReembolso,
  type SolicitudCobro,
  type SolicitudReembolso,
} from '../core/types.js';

/**
 * Revolut Merchant API · segunda pasarela, la de tarjeta.
 *
 * Cubre el hueco que deja NOWPayments: un cliente que llega al checkout y no
 * tiene —ni quiere tener— criptomonedas. Se integra por **checkout alojado**:
 * creamos el pedido, Revolut devuelve una URL y el cliente paga en su página.
 * Es la vía que no nos mete los datos de la tarjeta por el servidor y por tanto
 * la que deja el alcance de PCI en el mínimo (SAQ A).
 *
 * Diferencias con NOWPayments que condicionan el código:
 *
 *  · **La firma se calcula sobre el cuerpo crudo**, no sobre un JSON
 *    reserializado. Revolut firma `v1.{timestamp}.{cuerpo}` con HMAC-SHA256, y
 *    cualquier cambio de espaciado o de orden de claves invalida la firma. Por
 *    eso la API guarda el cuerpo tal y como llegó (ver `main.ts`).
 *
 *  · **El aviso no trae el importe.** El webhook solo dice «el pedido X se ha
 *    completado». El importe real, las comisiones y el método de pago hay que
 *    pedirlos con `consultarCobro`. Es a propósito por su parte: obliga a que
 *    el importe venga siempre de una llamada autenticada nuestra y no de un
 *    cuerpo que nos manda un tercero.
 *
 *  · **Los importes van en unidades menores** (céntimos), igual que aquí
 *    dentro. No hay conversión a euros con decimales por medio, que es de
 *    donde salen los errores de redondeo de un céntimo en las conciliaciones.
 *
 *  · **`authorised` no es `completed`.** Con captura automática pasa solo,
 *    pero un pedido autorizado y no capturado es dinero retenido en la tarjeta
 *    del cliente que todavía no es nuestro: enviar mercancía ahí es enviarla
 *    contra un pago que puede no llegar nunca.
 *
 * Estado: implementado contra la documentación pública de la Merchant API
 * (versión 2024-09-01). PENDIENTE DE VALIDAR con credenciales reales de una
 * cuenta Revolut Business (ver BLOQUEOS.md).
 */

const URL_PRODUCCION = 'https://merchant.revolut.com/api';
const URL_SANDBOX = 'https://sandbox-merchant.revolut.com/api';

/**
 * Versión de la API que pedimos explícitamente.
 *
 * Revolut versiona por fecha en una cabecera. Sin fijarla, la cuenta usa la
 * versión que tuviera asignada y una actualización suya cambia las respuestas
 * bajo nuestros pies. Al fijarla, la ruptura ocurre cuando nosotros decidimos
 * subirla, no cuando ellos publican.
 */
const VERSION_API = '2024-09-01';

/**
 * Antigüedad máxima aceptada en la firma de un webhook.
 *
 * Sin esto, una firma válida capturada del tráfico sirve para siempre: basta
 * con reenviar un «pedido completado» legítimo para volver a dar por pagado un
 * pedido. Cinco minutos es lo que Revolut recomienda y da margen de sobra para
 * sus reintentos.
 */
const TOLERANCIA_FIRMA_MS = 5 * 60_000;

interface CredencialesRevolut {
  apiKey?: string;
  webhookSecret?: string;
}

/** Un pago concreto dentro de un pedido de Revolut. */
interface PagoRevolut {
  id?: string;
  state?: string;
  amount?: number;
  currency?: string;
  settled_amount?: number;
  settled_currency?: string;
  fees?: { amount?: number; currency?: string; type?: string }[];
  payment_method?: { type?: string; card_brand?: string; card_last_four?: string };
  created_at?: string;
  updated_at?: string;
}

interface PedidoRevolut {
  id?: string;
  token?: string;
  type?: string;
  state?: string;
  amount?: number;
  currency?: string;
  outstanding_amount?: number;
  checkout_url?: string;
  merchant_order_ext_ref?: string;
  created_at?: string;
  updated_at?: string;
  payments?: PagoRevolut[];
}

export class RevolutProvider implements PaymentProvider {
  readonly key = 'revolut';
  readonly nombre = 'Revolut Pay';

  readonly capacidades: CapacidadesPasarela = {
    // La tarjeta no bloquea un tipo de cambio: no hay contador que enseñar.
    cobroCaduca: false,
    // O se cobra el importe entero o no se cobra. No existe el «ha llegado de
    // menos» de las redes cripto.
    admitePagoParcial: false,
    // Devuelve al mismo método de pago; no hay que pedirle nada al cliente.
    reembolsoAutomatico: true,
    requiereDireccionReembolso: false,
    reembolsoParcial: true,
    // Chargebacks: el precio de aceptar tarjeta. El cliente puede reclamar a su
    // banco meses después y el dinero se va con la mercancía ya enviada.
    admiteDisputas: true,
    // No hay elección de divisa por parte del cliente: se cobra en la del
    // pedido. Lista vacía = el checkout no ofrece selector.
    monedasDePago: [],
  };

  private readonly baseUrl: string;

  constructor(
    private readonly credenciales: CredencialesRevolut,
    private readonly sandbox = true,
  ) {
    this.baseUrl = sandbox ? URL_SANDBOX : URL_PRODUCCION;
  }

  // ── Llamadas ──────────────────────────────────────────────

  private async llamar<T>(
    ruta: string,
    opciones: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const apiKey = this.credenciales.apiKey;
    if (!apiKey) {
      throw new ErrorPasarela('CREDENCIALES', 'Falta la clave de API de Revolut', {
        pasarela: this.nombre,
        reintentable: false,
      });
    }

    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.baseUrl}${ruta}`, {
        method: opciones.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Revolut-Api-Version': VERSION_API,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(opciones.body ? { body: JSON.stringify(opciones.body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new ErrorPasarela('RED', 'No se ha podido contactar con Revolut', {
        pasarela: this.nombre,
        reintentable: true,
        detalleOriginal: error,
      });
    }

    const cuerpo = await respuesta.text();

    if (!respuesta.ok) {
      throw this.traducirError(respuesta.status, cuerpo);
    }

    return (cuerpo ? JSON.parse(cuerpo) : {}) as T;
  }

  private traducirError(status: number, cuerpo: string): ErrorPasarela {
    if (status === 401 || status === 403) {
      return new ErrorPasarela('CREDENCIALES', 'Revolut ha rechazado la clave de API', {
        pasarela: this.nombre,
        reintentable: false,
      });
    }
    if (status === 404) {
      return new ErrorPasarela('NO_ENCONTRADO', 'Pedido no encontrado en Revolut', {
        pasarela: this.nombre,
        reintentable: false,
      });
    }
    if (status === 429) {
      return new ErrorPasarela('RED', 'Revolut ha limitado nuestras peticiones', {
        pasarela: this.nombre,
        reintentable: true,
      });
    }
    if (status >= 500) {
      return new ErrorPasarela('PASARELA_CAIDA', `Revolut devuelve error ${status}`, {
        pasarela: this.nombre,
        reintentable: true,
      });
    }

    // Los 4xx traen `{ code, message }`; el mensaje es el que sirve para saber
    // qué campo del pedido ha rechazado.
    let mensaje = cuerpo.slice(0, 300);
    try {
      const json = JSON.parse(cuerpo) as { message?: string; code?: number | string };
      if (json.message) mensaje = json.message;
    } catch {
      // No era JSON; se deja el texto tal cual.
    }

    if (/currency/i.test(mensaje)) {
      return new ErrorPasarela('MONEDA_NO_SOPORTADA', mensaje, { pasarela: this.nombre });
    }
    if (/amount|minimum|maximum/i.test(mensaje)) {
      return new ErrorPasarela('IMPORTE_INVALIDO', mensaje, { pasarela: this.nombre });
    }

    return new ErrorPasarela('DESCONOCIDO', `Revolut: ${mensaje}`, { pasarela: this.nombre });
  }

  // ── Contrato ──────────────────────────────────────────────

  /**
   * Comprueba las credenciales.
   *
   * No hay endpoint de «ping», así que se pide la lista de pedidos con límite
   * mínimo: es la llamada de solo lectura más barata que existe y falla con
   * 401 si la clave no vale, que es justo lo que se quiere distinguir.
   */
  async verificar(): Promise<{ ok: boolean; mensaje?: string }> {
    try {
      await this.llamar<PedidoRevolut[]>('/orders?limit=1');
      return {
        ok: true,
        mensaje: this.sandbox
          ? 'Credenciales válidas (entorno de pruebas)'
          : 'Credenciales válidas (producción)',
      };
    } catch (error) {
      return { ok: false, mensaje: error instanceof Error ? error.message : 'Error desconocido' };
    }
  }

  /**
   * Divisas en las que puede pagar el cliente.
   *
   * Ninguna a elegir: con tarjeta se cobra en la divisa del pedido y Revolut
   * hace la conversión en su lado si la tarjeta es de otra. Devolver una lista
   * vacía es lo que hace que el checkout no pinte un selector inútil.
   */
  monedasDisponibles(): Promise<string[]> {
    return Promise.resolve([]);
  }

  async crearCobro(solicitud: SolicitudCobro): Promise<RespuestaCobro> {
    const pedido = await this.llamar<PedidoRevolut>('/orders', {
      method: 'POST',
      body: {
        // En unidades menores, como lo guardamos nosotros. Sin división por
        // 100 no hay decimales de por medio ni redondeos que cuadrar después.
        amount: solicitud.amountCents,
        currency: solicitud.currency.toUpperCase(),
        // Captura automática: el cobro se consolida sin un segundo paso. Con
        // captura manual el pedido se quedaría autorizado y el dinero sin
        // ingresar hasta que alguien lo capturase a mano desde el panel.
        capture_mode: 'automatic',
        // Nuestra referencia, para poder cuadrar su panel con el nuestro
        // cuando haya que reclamar algo.
        merchant_order_ext_ref: solicitud.orderNumber,
        description: solicitud.description,
        customer: { email: solicitud.customerEmail },
        // A dónde vuelve el cliente al terminar. Revolut usa una sola URL para
        // éxito y cancelación; la página de gracias distingue por el estado
        // real del pedido, que es lo único fiable: el cliente puede volver por
        // aquí sin haber pagado.
        redirect_url: solicitud.successUrl,
        ...(solicitud.locale ? { locale: solicitud.locale } : {}),
      },
    });

    if (!pedido.id) {
      throw new ErrorPasarela('DESCONOCIDO', 'Revolut no ha devuelto identificador de pedido', {
        pasarela: this.nombre,
      });
    }

    if (!pedido.checkout_url) {
      // Sin URL no hay a dónde mandar al cliente: mejor fallar aquí que
      // dejarle mirando una pantalla de pago sin botón.
      throw new ErrorPasarela('DESCONOCIDO', 'Revolut no ha devuelto la URL de pago', {
        pasarela: this.nombre,
      });
    }

    return {
      externalId: pedido.id,
      estado: this.traducirEstado(pedido.state ?? 'pending'),
      checkoutUrl: pedido.checkout_url,
      metadata: {
        ...(pedido.token ? { token: pedido.token } : {}),
        merchantOrderExtRef: solicitud.orderNumber,
      },
    };
  }

  async consultarCobro(externalId: string): Promise<EstadoCobro | null> {
    let pedido: PedidoRevolut;
    try {
      pedido = await this.llamar<PedidoRevolut>(`/orders/${encodeURIComponent(externalId)}`);
    } catch (error) {
      if (error instanceof ErrorPasarela && error.tipo === 'NO_ENCONTRADO') return null;
      throw error;
    }

    if (!pedido.id) return null;

    return this.aEstadoCobro(pedido);
  }

  /** Convierte un pedido de Revolut a nuestro estado de cobro. */
  private aEstadoCobro(pedido: PedidoRevolut): EstadoCobro {
    const esperado = pedido.amount ?? 0;
    const estado = this.traducirEstado(pedido.state ?? 'pending');

    // Solo cuentan los pagos efectivamente completados. Sumar los que están en
    // curso daría por cobrado un pedido cuya tarjeta todavía puede rechazarse.
    const completados = (pedido.payments ?? []).filter(
      (p) => (p.state ?? '').toLowerCase() === 'completed',
    );

    const recibido =
      completados.length > 0
        ? completados.reduce((suma, p) => suma + (p.amount ?? 0), 0)
        : // Sin detalle de pagos, un pedido completado ha cobrado su importe:
          // es lo que significa `completed` en su API. Cualquier otro estado no
          // ha cobrado nada todavía.
          estado === 'PAGADO'
          ? esperado
          : 0;

    const comisiones = completados
      .flatMap((p) => p.fees ?? [])
      .reduce((suma, f) => suma + (f.amount ?? 0), 0);

    const ultimo = completados.at(-1);
    const momento = ultimo?.updated_at ?? ultimo?.created_at ?? pedido.updated_at;

    return {
      externalId: pedido.id ?? '',
      estado,
      amountCents: esperado,
      receivedCents: recibido,
      ...(comisiones > 0 ? { feeCents: comisiones } : {}),
      ...(pedido.currency ? { payCurrency: pedido.currency.toUpperCase() } : {}),
      ...(estado === 'PAGADO' && momento ? { paidAt: new Date(momento) } : {}),
      metadata: {
        state: pedido.state ?? null,
        outstandingAmount: pedido.outstanding_amount ?? null,
        ...(ultimo?.payment_method
          ? {
              metodo: ultimo.payment_method.type ?? null,
              tarjeta: ultimo.payment_method.card_brand ?? null,
              ultimosDigitos: ultimo.payment_method.card_last_four ?? null,
            }
          : {}),
      },
    };
  }

  /**
   * Verifica la firma del webhook.
   *
   * Revolut firma con HMAC-SHA256 la cadena `v1.{timestamp}.{cuerpo crudo}`, y
   * manda el resultado en `Revolut-Signature` con el prefijo `v1=`. Dos cosas
   * que no se pueden saltar:
   *
   *  1. **El cuerpo tiene que ser el que llegó, byte a byte.** Reserializar el
   *     JSON parseado cambia espaciado y orden de claves, y entonces ninguna
   *     notificación legítima verifica. La API guarda el crudo por eso.
   *
   *  2. **El timestamp forma parte de lo firmado y se comprueba.** Sin ese
   *     control, una notificación válida capturada una vez vale para siempre y
   *     se puede reenviar para dar por pagado el mismo pedido otra vez.
   *
   * Puede llegar más de una firma separada por comas: ocurre mientras se rota
   * el secreto, cuando conviven el viejo y el nuevo. Vale con que una cuadre.
   */
  verificarWebhook(cuerpo: string, cabeceras: Record<string, string>): EventoWebhook | null {
    const secreto = this.credenciales.webhookSecret;
    if (!secreto) return null;

    const cabecera = (nombre: string): string => {
      const buscado = nombre.toLowerCase();
      for (const [clave, valor] of Object.entries(cabeceras)) {
        if (clave.toLowerCase() === buscado) return valor;
      }
      return '';
    };

    const marca = cabecera('revolut-request-timestamp');
    const firmas = cabecera('revolut-signature');
    if (!marca || !firmas) return null;

    // El timestamp viene en milisegundos. Se rechaza lo viejo —reenvío de una
    // notificación antigua— y también lo que venga del futuro, que solo puede
    // salir de un reloj mal puesto o de alguien probando.
    const momento = Number(marca);
    if (!Number.isFinite(momento)) return null;
    const desfase = Date.now() - momento;
    if (desfase > TOLERANCIA_FIRMA_MS || desfase < -TOLERANCIA_FIRMA_MS) return null;

    const esperada = crypto
      .createHmac('sha256', secreto)
      .update(`v1.${marca}.${cuerpo}`)
      .digest('hex');

    const coincide = firmas
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.startsWith('v1='))
      .map((f) => f.slice(3))
      .some((recibida) => {
        const a = Buffer.from(recibida);
        const b = Buffer.from(esperada);
        // Longitudes distintas no se comparan: `timingSafeEqual` lanza. La
        // comparación en sí va en tiempo constante para no filtrar la firma
        // correcta a través de lo que tarda en responder.
        return a.length === b.length && crypto.timingSafeEqual(a, b);
      });

    if (!coincide) return null;

    let datos: Record<string, unknown>;
    try {
      datos = JSON.parse(cuerpo) as Record<string, unknown>;
    } catch {
      return null;
    }

    const idPedido = textoOpcional(datos['order_id']);
    if (!idPedido) return null;

    const evento = texto(datos['event'], '');

    return {
      externalId: idPedido,
      estado: this.traducirEvento(evento),
      // A propósito sin `receivedCents`: el aviso de Revolut no trae importe.
      // Quien lo procesa consulta el pedido para saber cuánto se cobró de
      // verdad, en lugar de dar por bueno un número que no viene firmado por
      // nadie más que por este mismo cuerpo.
      eventId: `${idPedido}-${evento}`,
      raw: datos,
    };
  }

  /**
   * Reembolso.
   *
   * Vuelve al mismo método de pago con el que se cobró; no hay que pedirle
   * nada al cliente. Admite parciales, y Revolut se encarga de que la suma de
   * los parciales no supere lo cobrado.
   */
  async reembolsar(solicitud: SolicitudReembolso): Promise<RespuestaReembolso> {
    if (solicitud.amountCents <= 0) {
      throw new ErrorPasarela(
        'IMPORTE_INVALIDO',
        'El importe a devolver tiene que ser mayor que 0',
        {
          pasarela: this.nombre,
          reintentable: false,
        },
      );
    }

    const r = await this.llamar<PedidoRevolut>(
      `/orders/${encodeURIComponent(solicitud.externalPaymentId)}/refund`,
      {
        method: 'POST',
        body: {
          amount: solicitud.amountCents,
          currency: solicitud.currency.toUpperCase(),
          description: solicitud.reason,
        },
      },
    );

    const estadoRevolut = (r.state ?? '').toLowerCase();
    const importe = (solicitud.amountCents / 100).toFixed(2);

    return {
      externalId: r.id ?? '',
      // `completed` es el único que significa dinero devuelto. El resto sigue
      // en marcha: darlo por cerrado dejaría al cliente sin su dinero y a
      // nosotros creyendo que ya está.
      estado: estadoRevolut === 'completed' ? 'COMPLETADO' : 'PROCESANDO',
      cantidadEnviada: importe,
      monedaEnviada: solicitud.currency.toUpperCase(),
      mensaje:
        `Reembolso de ${importe} ${solicitud.currency.toUpperCase()} enviado a la tarjeta ` +
        'del cliente. Su banco puede tardar entre 3 y 5 días en abonarlo.',
    };
  }

  // ── Estados ───────────────────────────────────────────────

  /**
   * Traduce el estado de un pedido de Revolut al nuestro.
   *
   * `authorised` es el que hay que mirar con cuidado: el dinero está retenido
   * en la tarjeta pero todavía no es nuestro. Con captura automática el paso a
   * `completed` es inmediato, pero si alguien cambiara el modo a manual, tratar
   * `authorised` como pagado significaría enviar mercancía contra un cobro que
   * puede caducar sin capturarse.
   */
  private traducirEstado(estado: string): EstadoPago {
    const mapa: Record<string, EstadoPago> = {
      pending: 'PENDIENTE',
      processing: 'ESPERANDO_CONFIRMACION',
      authorised: 'ESPERANDO_CONFIRMACION',
      authorized: 'ESPERANDO_CONFIRMACION',
      completed: 'PAGADO',
      cancelled: 'CADUCADO',
      canceled: 'CADUCADO',
      failed: 'FALLIDO',
    };
    return mapa[estado.toLowerCase()] ?? 'DESCONOCIDO';
  }

  /** Traduce el tipo de evento del webhook al estado que implica. */
  private traducirEvento(evento: string): EstadoPago {
    const mapa: Record<string, EstadoPago> = {
      ORDER_COMPLETED: 'PAGADO',
      ORDER_AUTHORISED: 'ESPERANDO_CONFIRMACION',
      ORDER_PAYMENT_AUTHENTICATED: 'ESPERANDO_CONFIRMACION',
      ORDER_CANCELLED: 'CADUCADO',
      ORDER_PAYMENT_DECLINED: 'FALLIDO',
      ORDER_PAYMENT_FAILED: 'FALLIDO',
      REFUND_COMPLETED: 'REEMBOLSADO',
      // `REFUND_FAILED` no se traduce a un estado del cobro: el pago sigue
      // cobrado. Lo que ha fallado es la devolución, y eso lo lleva el flujo
      // de reembolsos, no el del pago.
    };
    return mapa[evento.toUpperCase()] ?? 'DESCONOCIDO';
  }

  /**
   * Firma un cuerpo como lo hace Revolut.
   *
   * Existe para las pruebas y para poder reproducir a mano una notificación
   * cuando haya que depurar una que llegó y no se aceptó.
   */
  static firmar(cuerpo: string, secreto: string, marcaMs: number): string {
    return (
      'v1=' + crypto.createHmac('sha256', secreto).update(`v1.${marcaMs}.${cuerpo}`).digest('hex')
    );
  }

  /**
   * ¿El importe cobrado cubre el pedido?
   *
   * En tarjeta no hay comisiones de red que se coman parte del envío, así que
   * la respuesta es exacta: o está entero o no está. Se expone con la misma
   * forma que en NOWPayments para que quien procesa el pago no tenga que saber
   * con qué pasarela está tratando.
   */
  static cubreElPedido(recibidoCents: Cents, esperadoCents: Cents): boolean {
    if (esperadoCents <= 0) return false;
    return recibidoCents >= esperadoCents;
  }
}

/** Reexportado para que las pruebas puedan comprobar el número exacto. */
export const TOLERANCIA_FIRMA_REVOLUT_MS = TOLERANCIA_FIRMA_MS;
