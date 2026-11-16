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
 * Stripe · tercera pasarela, la que trae Bizum.
 *
 * Se integra por **Checkout Session alojada**, igual que Revolut y por el mismo
 * motivo: la tarjeta se teclea en la página de Stripe, no en la nuestra, y eso
 * mantiene el papeleo de PCI en el mínimo (SAQ A). La diferencia con Revolut es
 * lo que se puede ofrecer detrás de esa página: en España, Bizum —que para
 * mucha gente es *el* método de pago— más Apple Pay y Google Pay, sin escribir
 * una línea por cada uno.
 *
 * Cuatro cosas de Stripe que condicionan este fichero:
 *
 *  · **La API habla formularios, no JSON.** `application/x-www-form-urlencoded`
 *    con corchetes para lo anidado (`line_items[0][price_data][currency]`).
 *    Mandarle JSON devuelve un 400 que no dice nada útil.
 *
 *  · **Los métodos de pago no se listan aquí.** Se activan en el dashboard y
 *    Stripe decide cuáles enseñar según el importe, la divisa y el país del
 *    cliente. Fijarlos en el código —`payment_method_types[]=card,bizum`—
 *    parece más explícito y en la práctica es peor: el día que se active Bizum
 *    en el dashboard no aparecería, y si se declara sin tenerlo activado la
 *    creación de la sesión falla entera.
 *
 *  · **`completed` no siempre es `pagado`.** Bizum y los métodos diferidos
 *    cierran la sesión con `payment_status: unpaid` y confirman minutos —o
 *    días— después con `async_payment_succeeded`. Dar por cobrado el
 *    `completed` sin mirar el `payment_status` es enviar mercancía contra un
 *    pago que aún puede fallar.
 *
 *  · **Devolver no se hace contra la sesión, sino contra el PaymentIntent.**
 *    Nosotros guardamos el identificador de la sesión (`cs_…`), así que el
 *    reembolso lo resuelve primero.
 *
 * Estado: implementado contra la API de Stripe (versión fijada abajo).
 * PENDIENTE DE VALIDAR con credenciales reales; con `sk_test_…` se prueba el
 * recorrido entero sin mover dinero. Ojo con el aviso de BLOQUEOS.md: Stripe
 * restringe el contenido para adultos, así que conviene leer sus condiciones y
 * no depender solo de ella.
 */

const URL_BASE = 'https://api.stripe.com';

/**
 * Versión de la API que pedimos explícitamente.
 *
 * Stripe versiona por fecha y la cuenta tiene una asignada. Sin fijarla aquí,
 * el día que alguien pulse «actualizar» en el dashboard cambian las respuestas
 * bajo nuestros pies; fijándola, la ruptura ocurre cuando la subimos nosotros.
 */
const VERSION_API = '2024-06-20';

/**
 * Antigüedad máxima aceptada en la firma de un webhook.
 *
 * Es la tolerancia que recomienda Stripe. Sin ella, una notificación legítima
 * capturada del tráfico vale para siempre: basta reenviarla para volver a dar
 * por pagado un pedido.
 */
const TOLERANCIA_FIRMA_MS = 5 * 60_000;

interface CredencialesStripe {
  secretKey?: string;
  webhookSecret?: string;
}

/** Lo que se usa de una Checkout Session; el resto de campos se ignora. */
interface SesionStripe {
  id?: string;
  object?: string;
  url?: string;
  status?: string;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  client_reference_id?: string;
  expires_at?: number;
  customer_email?: string;
  metadata?: Record<string, string>;
  payment_intent?: string | IntentoStripe;
}

interface IntentoStripe {
  id?: string;
  status?: string;
  amount_received?: number;
  latest_charge?: string | CargoStripe;
}

interface CargoStripe {
  id?: string;
  paid?: boolean;
  amount_refunded?: number;
  payment_method_details?: { type?: string; card?: { brand?: string; last4?: string } };
  balance_transaction?: string | { fee?: number; currency?: string };
  created?: number;
}

interface ReembolsoStripe {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
}

export class StripeProvider implements PaymentProvider {
  readonly key = 'stripe';
  readonly nombre = 'Stripe';

  readonly capacidades: CapacidadesPasarela = {
    /*
     * La sesión sí caduca —24 horas por defecto—, pero se declara `false` a
     * propósito: `cobroCaduca` es lo que hace que el checkout pinte un contador
     * de cuenta atrás, y eso solo tiene sentido cuando lo que caduca es un tipo
     * de cambio bloqueado, como en cripto. Un cliente mirando un reloj de 24
     * horas no gana nada y se pone nervioso; si la sesión caduca, se crea otra.
     */
    cobroCaduca: false,
    // O se cobra el importe entero o no se cobra.
    admitePagoParcial: false,
    // Devuelve al mismo método con el que se pagó, sin pedirle nada al cliente.
    reembolsoAutomatico: true,
    requiereDireccionReembolso: false,
    reembolsoParcial: true,
    // Chargebacks: el precio de aceptar tarjeta. El cliente reclama a su banco
    // meses después y el dinero se va con la mercancía ya enviada.
    admiteDisputas: true,
    // Se cobra en la divisa del pedido; no hay selector que ofrecer.
    monedasDePago: [],
  };

  constructor(private readonly credenciales: CredencialesStripe) {}

  /**
   * ¿Estamos en modo de pruebas?
   *
   * Se deduce de la propia clave (`sk_test_…` frente a `sk_live_…`) en lugar de
   * pedir un interruptor aparte. Con dos ajustes independientes se puede tener
   * la casilla de «pruebas» marcada y la clave de producción puesta, que es
   * exactamente el error que mueve dinero real creyendo que no.
   */
  private get pruebas(): boolean {
    return (this.credenciales.secretKey ?? '').startsWith('sk_test_');
  }

  // ── Llamadas ──────────────────────────────────────────────

  /**
   * Convierte un objeto a la sintaxis de formulario de Stripe.
   *
   * `{ a: { b: 1 }, c: [ { d: 2 } ] }` → `a[b]=1&c[0][d]=2`. Los `undefined` se
   * caen por el camino: mandar `campo=` no es lo mismo que no mandarlo, y a
   * Stripe lo segundo le vale y lo primero a veces no.
   */
  private aFormulario(datos: Record<string, unknown>, prefijo = ''): string {
    const partes: string[] = [];

    /** Un par `clave=valor` ya escapado, o nada si el valor no es representable. */
    const par = (nombre: string, valor: unknown): string => {
      if (typeof valor === 'string')
        return `${encodeURIComponent(nombre)}=${encodeURIComponent(valor)}`;
      if (typeof valor === 'number' || typeof valor === 'boolean') {
        return `${encodeURIComponent(nombre)}=${encodeURIComponent(String(valor))}`;
      }
      // Cualquier otra cosa —una función, un símbolo— se cae en silencio: no
      // hay forma sensata de mandarla y `String(valor)` escribiría
      // «[object Object]» en el cuerpo de una petición de cobro.
      return '';
    };

    for (const [clave, valor] of Object.entries(datos)) {
      if (valor === undefined || valor === null) continue;

      const nombre = prefijo ? `${prefijo}[${clave}]` : clave;

      if (Array.isArray(valor)) {
        valor.forEach((elemento: unknown, i) => {
          if (typeof elemento === 'object' && elemento !== null) {
            partes.push(this.aFormulario(elemento as Record<string, unknown>, `${nombre}[${i}]`));
          } else {
            partes.push(par(`${nombre}[${i}]`, elemento));
          }
        });
      } else if (typeof valor === 'object') {
        partes.push(this.aFormulario(valor as Record<string, unknown>, nombre));
      } else {
        partes.push(par(nombre, valor));
      }
    }

    return partes.filter(Boolean).join('&');
  }

  private async llamar<T>(
    ruta: string,
    opciones: { method?: string; body?: Record<string, unknown>; idempotencyKey?: string } = {},
  ): Promise<T> {
    const secretKey = this.credenciales.secretKey;
    if (!secretKey) {
      throw new ErrorPasarela('CREDENCIALES', 'Falta la clave secreta de Stripe', {
        pasarela: this.nombre,
        reintentable: false,
      });
    }

    let respuesta: Response;
    try {
      respuesta = await fetch(`${URL_BASE}${ruta}`, {
        method: opciones.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Stripe-Version': VERSION_API,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          /*
           * Idempotencia nativa de Stripe.
           *
           * Con ella, un reintento por timeout devuelve la MISMA sesión en vez
           * de crear una segunda: el cliente no acaba con dos cobros abiertos
           * del mismo pedido y nosotros no tenemos que limpiarlos después.
           */
          ...(opciones.idempotencyKey ? { 'Idempotency-Key': opciones.idempotencyKey } : {}),
        },
        ...(opciones.body ? { body: this.aFormulario(opciones.body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new ErrorPasarela('RED', 'No se ha podido contactar con Stripe', {
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

  /**
   * Traduce un error de Stripe al nuestro.
   *
   * Sus 4xx traen `{ error: { type, code, message } }`, y el `code` es más
   * fiable que el texto para decidir: el mensaje está traducido y cambia.
   */
  private traducirError(status: number, cuerpo: string): ErrorPasarela {
    let codigo = '';
    let tipo = '';
    let mensaje = cuerpo.slice(0, 300);

    try {
      const json = JSON.parse(cuerpo) as {
        error?: { type?: string; code?: string; message?: string };
      };
      codigo = json.error?.code ?? '';
      tipo = json.error?.type ?? '';
      if (json.error?.message) mensaje = json.error.message;
    } catch {
      // No era JSON: se deja el texto tal cual.
    }

    if (status === 401 || status === 403) {
      return new ErrorPasarela('CREDENCIALES', 'Stripe ha rechazado la clave secreta', {
        pasarela: this.nombre,
        reintentable: false,
      });
    }
    if (status === 404 || codigo === 'resource_missing') {
      return new ErrorPasarela('NO_ENCONTRADO', 'Stripe no encuentra ese recurso', {
        pasarela: this.nombre,
        reintentable: false,
      });
    }
    if (status === 429 || tipo === 'rate_limit_error') {
      return new ErrorPasarela('RED', 'Stripe ha limitado nuestras peticiones', {
        pasarela: this.nombre,
        reintentable: true,
      });
    }
    if (status >= 500) {
      return new ErrorPasarela('PASARELA_CAIDA', `Stripe devuelve error ${String(status)}`, {
        pasarela: this.nombre,
        reintentable: true,
      });
    }
    if (codigo === 'amount_too_small' || codigo === 'amount_too_large') {
      return new ErrorPasarela('IMPORTE_INVALIDO', mensaje, { pasarela: this.nombre });
    }
    if (codigo === 'charge_already_refunded') {
      return new ErrorPasarela('YA_PROCESADO', mensaje, { pasarela: this.nombre });
    }
    if (/currency/i.test(codigo) || /currency/i.test(mensaje)) {
      return new ErrorPasarela('MONEDA_NO_SOPORTADA', mensaje, { pasarela: this.nombre });
    }

    return new ErrorPasarela('DESCONOCIDO', `Stripe: ${mensaje}`, { pasarela: this.nombre });
  }

  // ── Contrato ──────────────────────────────────────────────

  /**
   * Comprueba las credenciales.
   *
   * Se piden las sesiones con límite mínimo: es la llamada de solo lectura más
   * barata que existe y devuelve 401 si la clave no sirve, que es justo lo que
   * hay que distinguir. Y se dice en qué modo está la clave, porque la
   * confusión test/producción es la que hace creer que se cobra cuando no.
   */
  async verificar(): Promise<{ ok: boolean; mensaje?: string }> {
    try {
      await this.llamar('/v1/checkout/sessions?limit=1');
      return {
        ok: true,
        mensaje: this.pruebas
          ? 'Credenciales válidas (clave de pruebas: no se mueve dinero real)'
          : 'Credenciales válidas (clave de producción)',
      };
    } catch (error) {
      return { ok: false, mensaje: error instanceof Error ? error.message : 'Error desconocido' };
    }
  }

  /** Con tarjeta se cobra en la divisa del pedido: no hay nada que elegir. */
  monedasDisponibles(): Promise<string[]> {
    return Promise.resolve([]);
  }

  async crearCobro(solicitud: SolicitudCobro): Promise<RespuestaCobro> {
    const sesion = await this.llamar<SesionStripe>('/v1/checkout/sessions', {
      method: 'POST',
      idempotencyKey: solicitud.idempotencyKey,
      body: {
        mode: 'payment',
        /*
         * Una sola línea con el total del pedido, no el desglose del carrito.
         *
         * Stripe solo necesita saber cuánto cobrar, y el desglose ya vive en
         * nuestro pedido: duplicarlo aquí obliga a que cuadren dos fuentes con
         * sus propios redondeos —de portes, de descuentos y de IVA— y el día
         * que no cuadren, la sesión se crea por un importe distinto al del
         * pedido. Con una línea, el importe es el mismo por construcción.
         */
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: solicitud.currency.toLowerCase(),
              unit_amount: solicitud.amountCents,
              product_data: { name: solicitud.description },
            },
          },
        ],
        success_url: solicitud.successUrl,
        cancel_url: solicitud.cancelUrl,
        customer_email: solicitud.customerEmail,
        // Nuestra referencia, para poder cuadrar su panel con el nuestro
        // cuando haya que reclamar algo.
        client_reference_id: solicitud.orderNumber,
        metadata: { orderId: solicitud.orderId, orderNumber: solicitud.orderNumber },
        // La misma referencia en el cargo, que es lo que se ve en el extracto
        // bancario del cliente y en las disputas.
        payment_intent_data: {
          description: solicitud.description,
          metadata: { orderId: solicitud.orderId, orderNumber: solicitud.orderNumber },
        },
        ...(solicitud.locale ? { locale: this.idioma(solicitud.locale) } : {}),
      },
    });

    if (!sesion.id) {
      throw new ErrorPasarela('DESCONOCIDO', 'Stripe no ha devuelto identificador de sesión', {
        pasarela: this.nombre,
      });
    }

    if (!sesion.url) {
      // Sin URL no hay a dónde mandar al cliente: mejor fallar aquí que
      // dejarle mirando una pantalla de pago sin botón.
      throw new ErrorPasarela('DESCONOCIDO', 'Stripe no ha devuelto la URL de pago', {
        pasarela: this.nombre,
      });
    }

    return {
      externalId: sesion.id,
      estado: this.traducirSesion(sesion),
      checkoutUrl: sesion.url,
      metadata: {
        clientReferenceId: solicitud.orderNumber,
        modo: this.pruebas ? 'pruebas' : 'produccion',
        ...(sesion.expires_at
          ? { caducaEn: new Date(sesion.expires_at * 1000).toISOString() }
          : {}),
      },
    };
  }

  /**
   * Estado del cobro, con comisión incluida.
   *
   * Se expande la cadena entera —sesión → PaymentIntent → cargo → apunte
   * contable— en una sola llamada. La comisión solo vive en ese último escalón
   * y es lo que convierte «hemos cobrado 39,90 €» en lo que de verdad entra en
   * caja, que es el número con el que se mide el margen.
   */
  async consultarCobro(externalId: string): Promise<EstadoCobro | null> {
    let sesion: SesionStripe;
    try {
      sesion = await this.llamar<SesionStripe>(
        `/v1/checkout/sessions/${encodeURIComponent(externalId)}` +
          '?expand[]=payment_intent.latest_charge.balance_transaction',
      );
    } catch (error) {
      if (error instanceof ErrorPasarela && error.tipo === 'NO_ENCONTRADO') return null;
      throw error;
    }

    if (!sesion.id) return null;

    const estado = this.traducirSesion(sesion);
    const esperado = sesion.amount_total ?? 0;
    const intento = typeof sesion.payment_intent === 'object' ? sesion.payment_intent : null;
    const cargo =
      intento && typeof intento.latest_charge === 'object' ? intento.latest_charge : null;
    const apunte =
      cargo && typeof cargo.balance_transaction === 'object' ? cargo.balance_transaction : null;

    // Lo cobrado de verdad. `amount_received` del intento es el dato bueno; el
    // total de la sesión es solo lo que se pidió.
    const recibido = intento?.amount_received ?? (sesion.payment_status === 'paid' ? esperado : 0);

    return {
      externalId: sesion.id,
      estado,
      amountCents: esperado,
      receivedCents: recibido,
      ...(apunte?.fee !== undefined ? { feeCents: apunte.fee } : {}),
      ...(sesion.currency ? { payCurrency: sesion.currency.toUpperCase() } : {}),
      ...(estado === 'PAGADO' && cargo?.created ? { paidAt: new Date(cargo.created * 1000) } : {}),
      metadata: {
        status: sesion.status ?? null,
        paymentStatus: sesion.payment_status ?? null,
        ...(intento?.id ? { paymentIntentId: intento.id } : {}),
        ...(cargo?.payment_method_details
          ? {
              metodo: cargo.payment_method_details.type ?? null,
              tarjeta: cargo.payment_method_details.card?.brand ?? null,
              ultimosDigitos: cargo.payment_method_details.card?.last4 ?? null,
            }
          : {}),
        ...(cargo?.amount_refunded ? { reembolsado: cargo.amount_refunded } : {}),
      },
    };
  }

  /**
   * Verifica la firma del webhook.
   *
   * Stripe manda `Stripe-Signature: t={segundos},v1={hmac}` y firma la cadena
   * `{t}.{cuerpo crudo}` con HMAC-SHA256. Tres cosas que no se pueden saltar:
   *
   *  1. **El cuerpo tiene que ser el que llegó, byte a byte.** Reserializar el
   *     JSON cambia espaciado y orden de claves y ninguna notificación
   *     legítima verificaría. La API guarda el crudo por eso.
   *
   *  2. **El timestamp va firmado y se comprueba.** Sin eso, un aviso legítimo
   *     capturado una vez sirve para siempre.
   *
   *  3. **Puede venir más de una firma `v1=`.** Pasa mientras se rota el
   *     secreto, con el viejo y el nuevo conviviendo. Vale con que una cuadre.
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

    const firma = cabecera('stripe-signature');
    if (!firma) return null;

    const partes = firma.split(',').map((p) => p.trim());
    const marca = partes.find((p) => p.startsWith('t='))?.slice(2) ?? '';
    const recibidas = partes.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
    if (!marca || recibidas.length === 0) return null;

    // En segundos, no en milisegundos. Se rechaza lo viejo —reenvío— y también
    // lo que venga del futuro, que solo sale de un reloj mal puesto o de
    // alguien probando.
    const momento = Number(marca) * 1000;
    if (!Number.isFinite(momento)) return null;
    const desfase = Date.now() - momento;
    if (desfase > TOLERANCIA_FIRMA_MS || desfase < -TOLERANCIA_FIRMA_MS) return null;

    const esperada = crypto
      .createHmac('sha256', secreto)
      .update(`${marca}.${cuerpo}`)
      .digest('hex');

    const coincide = recibidas.some((recibida) => {
      const a = Buffer.from(recibida);
      const b = Buffer.from(esperada);
      // Longitudes distintas no se comparan: `timingSafeEqual` lanza. La
      // comparación va en tiempo constante para no filtrar la firma correcta a
      // través de lo que tarda en responder.
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });

    if (!coincide) return null;

    let datos: Record<string, unknown>;
    try {
      datos = JSON.parse(cuerpo) as Record<string, unknown>;
    } catch {
      return null;
    }

    const tipo = texto(datos['type'], '');
    const objeto = (datos['data'] as { object?: SesionStripe } | undefined)?.object ?? {};

    /*
     * Solo interesan los eventos de la sesión de checkout.
     *
     * Es lo que hay guardado como identificador del cobro, así que un
     * `payment_intent.succeeded` —que llega con un `pi_…`— no casaría con
     * ningún cobro nuestro. Ignorarlos aquí evita ese ruido; el endpoint del
     * webhook debe darse de alta en Stripe solo con los cuatro de abajo.
     */
    if (!tipo.startsWith('checkout.session.')) return null;

    const idSesion = textoOpcional(objeto.id);
    if (!idSesion) return null;

    const estado = this.traducirEvento(tipo, objeto);

    return {
      externalId: idSesion,
      estado,
      /*
       * El importe se toma del propio aviso cuando el pago está confirmado.
       *
       * Aquí sí se puede: el cuerpo viene firmado con nuestro secreto, así que
       * es una afirmación de Stripe y no de quien llama. Se ahorra una consulta
       * por cada cobro, que a mil pedidos son mil llamadas.
       */
      ...(estado === 'PAGADO' && objeto.amount_total !== undefined
        ? { receivedCents: objeto.amount_total }
        : {}),
      // El identificador del evento es el que deduplica los reenvíos: Stripe
      // reintenta durante tres días hasta recibir un 2xx.
      ...(textoOpcional(datos['id']) ? { eventId: texto(datos['id'], '') } : {}),
      raw: datos,
    };
  }

  /**
   * Reembolso.
   *
   * Vuelve al mismo método con el que se pagó. Se hace contra el
   * PaymentIntent, así que si lo que tenemos guardado es la sesión —lo
   * normal— hay que resolverlo antes.
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

    const intentId = await this.intentoDe(solicitud.externalPaymentId);

    const reembolso = await this.llamar<ReembolsoStripe>('/v1/refunds', {
      method: 'POST',
      idempotencyKey: solicitud.idempotencyKey,
      body: {
        payment_intent: intentId,
        amount: solicitud.amountCents,
        // Stripe solo acepta tres motivos suyos; el nuestro va en los
        // metadatos, que es donde se puede leer después sin perder el detalle.
        reason: 'requested_by_customer',
        metadata: { motivo: solicitud.reason.slice(0, 500) },
      },
    });

    const importe = (solicitud.amountCents / 100).toFixed(2);
    const estado = (reembolso.status ?? '').toLowerCase();

    return {
      externalId: reembolso.id ?? '',
      /*
       * `succeeded` es el único que significa dinero devuelto.
       *
       * `pending` es lo normal en métodos diferidos y `requires_action` pide
       * intervención; darlos por cerrados dejaría al cliente sin su dinero y a
       * nosotros creyendo que ya está.
       */
      estado:
        estado === 'succeeded' ? 'COMPLETADO' : estado === 'failed' ? 'FALLIDO' : 'PROCESANDO',
      cantidadEnviada: importe,
      monedaEnviada: solicitud.currency.toUpperCase(),
      mensaje:
        `Reembolso de ${importe} ${solicitud.currency.toUpperCase()} enviado al método de pago ` +
        'del cliente. Su banco puede tardar entre 5 y 10 días en abonarlo.',
    };
  }

  /**
   * El PaymentIntent al que pertenece un identificador.
   *
   * Acepta las dos formas porque las dos existen en la base: lo que guarda el
   * cobro es la sesión (`cs_…`), pero un reembolso reintentado o migrado puede
   * traer ya el intento (`pi_…`).
   */
  private async intentoDe(externalId: string): Promise<string> {
    if (externalId.startsWith('pi_')) return externalId;

    const sesion = await this.llamar<SesionStripe>(
      `/v1/checkout/sessions/${encodeURIComponent(externalId)}`,
    );

    const intento =
      typeof sesion.payment_intent === 'string' ? sesion.payment_intent : sesion.payment_intent?.id;

    if (!intento) {
      throw new ErrorPasarela(
        'NO_ENCONTRADO',
        'Esa sesión de Stripe no tiene ningún cobro que devolver',
        { pasarela: this.nombre, reintentable: false },
      );
    }

    return intento;
  }

  // ── Estados ───────────────────────────────────────────────

  /**
   * Traduce una sesión de checkout a nuestro estado.
   *
   * Manda `payment_status` sobre `status`: una sesión `complete` con
   * `payment_status: unpaid` es lo que deja Bizum o una transferencia mientras
   * el dinero está en camino. Tratarla como pagada es enviar la mercancía
   * contra un pago que todavía puede no llegar.
   */
  private traducirSesion(sesion: SesionStripe): EstadoPago {
    const estado = (sesion.status ?? 'open').toLowerCase();
    const pago = (sesion.payment_status ?? 'unpaid').toLowerCase();

    if (estado === 'expired') return 'CADUCADO';
    if (pago === 'paid' || pago === 'no_payment_required') return 'PAGADO';
    if (estado === 'complete') return 'ESPERANDO_CONFIRMACION';
    return 'PENDIENTE';
  }

  /** Traduce el tipo de evento del webhook al estado que implica. */
  private traducirEvento(tipo: string, sesion: SesionStripe): EstadoPago {
    switch (tipo) {
      case 'checkout.session.completed':
        // Pagado solo si el dinero está: con métodos diferidos, esto llega
        // antes de que el pago se confirme.
        return this.traducirSesion(sesion);
      case 'checkout.session.async_payment_succeeded':
        return 'PAGADO';
      case 'checkout.session.async_payment_failed':
        return 'FALLIDO';
      case 'checkout.session.expired':
        return 'CADUCADO';
      default:
        return 'DESCONOCIDO';
    }
  }

  /**
   * El idioma de la página de pago.
   *
   * Stripe acepta códigos de dos letras; el nuestro puede venir como `es-ES`.
   * Uno que no conozca hace fallar la creación de la sesión entera, así que
   * solo se mandan los que la tienda habla y para el resto decide él por el
   * navegador del cliente.
   */
  private idioma(locale: string): string | undefined {
    const corto = locale.slice(0, 2).toLowerCase();
    return ['es', 'en', 'ca'].includes(corto) ? corto : undefined;
  }

  /**
   * Firma un cuerpo como lo hace Stripe.
   *
   * Existe para las pruebas y para poder reproducir a mano una notificación
   * cuando haya que depurar una que llegó y no se aceptó.
   */
  static firmar(cuerpo: string, secreto: string, marcaSegundos: number): string {
    const firma = crypto
      .createHmac('sha256', secreto)
      .update(`${marcaSegundos}.${cuerpo}`)
      .digest('hex');
    return `t=${marcaSegundos},v1=${firma}`;
  }

  /**
   * ¿El importe cobrado cubre el pedido?
   *
   * En tarjeta la respuesta es exacta: o está entero o no está. Se expone con
   * la misma forma que en las otras pasarelas para que quien procesa el pago no
   * tenga que saber con cuál está tratando.
   */
  static cubreElPedido(recibidoCents: Cents, esperadoCents: Cents): boolean {
    if (esperadoCents <= 0) return false;
    return recibidoCents >= esperadoCents;
  }
}

/** Reexportado para que las pruebas puedan comprobar el número exacto. */
export const TOLERANCIA_FIRMA_STRIPE_MS = TOLERANCIA_FIRMA_MS;
