import crypto from 'node:crypto';
import { texto, textoOpcional } from '../core/coercion.js';
import {
  ErrorPasarela,
  type CapacidadesPasarela,
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
 * Payiad · pago con tarjeta en su página.
 *
 * Contra su API de comerciante (`https://payiad.com/openapi.yaml`, v1.0.0). Se
 * integra igual que Stripe y Revolut: se crea el cobro desde el servidor, se
 * manda al cliente a su `checkout_url` y el resultado llega por webhook. La
 * tarjeta se teclea en la página de Payiad, no en la nuestra.
 *
 * Lo que condiciona este fichero:
 *
 *  · **El modo lo decide la clave**: `sk_test_…` es sandbox y `sk_live_…`
 *    producción. No hay casilla de pruebas que se pueda dejar mal puesta.
 *
 *  · **`failed` no es definitivo.** El cliente puede reintentar con otra
 *    tarjeta en la misma página, así que tras un `payment.failed` puede llegar
 *    un `payment.succeeded`. El flujo de cobro ya lo admite: solo bloquea lo
 *    que ya está pagado.
 *
 *  · **Los avisos pueden llegar repetidos o desordenados.** Se deduplican por
 *    el `id` del evento y el estado se toma del objeto que viaja dentro, no del
 *    tipo del evento.
 *
 *  · **Reembolsos: todavía no hay API.** Payiad no la ha publicado; se completa
 *    cuando manden la documentación. Hasta entonces se devuelve desde su panel.
 *
 * Estado: implementado contra la especificación. PENDIENTE DE VALIDAR con una
 * clave real; con `sk_test_…` y la tarjeta 4242 4242 4242 4242 se prueba el
 * recorrido entero sin mover dinero.
 */

const URL_BASE = 'https://payiad.com';

/** Antigüedad máxima de la firma de un webhook: la que pide su documentación. */
const TOLERANCIA_FIRMA_MS = 5 * 60_000;

interface CredencialesPayiad {
  secretKey?: string;
  webhookSecret?: string;
}

/** Lo que se usa de un `Payment` de Payiad. */
interface PagoPayiad {
  id?: string;
  object?: string;
  mode?: string;
  amount?: number;
  currency?: string;
  status?: string;
  checkout_url?: string;
  metadata?: Record<string, string>;
  payment_method?: string | null;
  card_brand?: string | null;
  card_last4?: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
  attempts?: number;
  paid_at?: string | null;
  updated_at?: string;
}

export class PayiadProvider implements PaymentProvider {
  readonly key = 'payiad';
  readonly nombre = 'Payiad';

  readonly capacidades: CapacidadesPasarela = {
    // El cobro no caduca solo; no hay contador que enseñar.
    cobroCaduca: false,
    // O se cobra el importe entero o no se cobra.
    admitePagoParcial: false,
    /*
     * Sin API de reembolsos todavía. Se declara `false` para que nada dé por
     * hecho que el dinero vuelve solo: hasta que Payiad la publique, la
     * devolución se hace en su panel.
     */
    reembolsoAutomatico: false,
    requiereDireccionReembolso: false,
    reembolsoParcial: false,
    // Tarjeta: el cliente puede reclamar a su banco.
    admiteDisputas: true,
    // Se cobra en la divisa del pedido.
    monedasDePago: [],
  };

  constructor(private readonly credenciales: CredencialesPayiad) {}

  /** ¿Clave de sandbox? Se deduce de la propia clave, como en Stripe. */
  private get pruebas(): boolean {
    return (this.credenciales.secretKey ?? '').startsWith('sk_test_');
  }

  // ── Llamadas ──────────────────────────────────────────────

  private async llamar<T>(
    ruta: string,
    opciones: { method?: string; body?: Record<string, unknown>; idempotencyKey?: string } = {},
  ): Promise<T> {
    const secretKey = this.credenciales.secretKey;
    if (!secretKey) {
      throw new ErrorPasarela('CREDENCIALES', 'Falta la clave secreta de Payiad', {
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
          Accept: 'application/json',
          ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
          // Un reintento por timeout devuelve el MISMO cobro (200) en lugar
          // de abrir un segundo para el mismo pedido.
          ...(opciones.idempotencyKey ? { 'Idempotency-Key': opciones.idempotencyKey } : {}),
        },
        ...(opciones.body ? { body: JSON.stringify(opciones.body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new ErrorPasarela('RED', 'No se ha podido contactar con Payiad', {
        pasarela: this.nombre,
        reintentable: true,
        detalleOriginal: error,
      });
    }

    const cuerpo = await respuesta.text();
    if (!respuesta.ok) throw this.traducirError(respuesta.status, cuerpo);

    return (cuerpo ? JSON.parse(cuerpo) : {}) as T;
  }

  /**
   * Sus errores traen siempre `{ error: { code, message, field? } }`, y su
   * documentación pide decidir por el `code`, no por el texto.
   */
  private traducirError(status: number, cuerpo: string): ErrorPasarela {
    let codigo = '';
    let campo = '';
    let mensaje = cuerpo.slice(0, 300);

    try {
      const json = JSON.parse(cuerpo) as {
        error?: { code?: string; message?: string; field?: string };
      };
      codigo = json.error?.code ?? '';
      campo = json.error?.field ?? '';
      if (json.error?.message) mensaje = json.error.message;
    } catch {
      // No era JSON: se deja el texto tal cual.
    }

    const opciones = { pasarela: this.nombre, detalleOriginal: { status, codigo, mensaje } };

    if (status === 401 || codigo === 'invalid_api_key') {
      return new ErrorPasarela('CREDENCIALES', 'Payiad ha rechazado la clave secreta', {
        ...opciones,
        reintentable: false,
      });
    }
    if (status === 403 || codigo === 'insufficient_scope') {
      return new ErrorPasarela(
        'CREDENCIALES',
        'La clave de Payiad no tiene permiso para esta operación (necesita payments:read y payments:write)',
        { ...opciones, reintentable: false },
      );
    }
    if (status === 404 || codigo === 'not_found') {
      return new ErrorPasarela('NO_ENCONTRADO', 'Payiad no encuentra ese cobro', {
        ...opciones,
        reintentable: false,
      });
    }
    if (status === 429 || codigo === 'rate_limited') {
      return new ErrorPasarela('RED', 'Payiad ha limitado nuestras peticiones', {
        ...opciones,
        reintentable: true,
      });
    }
    if (status >= 500) {
      return new ErrorPasarela('PASARELA_CAIDA', `Payiad devuelve error ${String(status)}`, {
        ...opciones,
        reintentable: true,
      });
    }
    if (codigo === 'idempotency_key_reused') {
      // Mismo pedido, importe distinto: el carrito cambió con un cobro ya
      // abierto. No es reintentable con la misma clave.
      return new ErrorPasarela('YA_PROCESADO', `Payiad: ${mensaje}`, {
        ...opciones,
        reintentable: false,
      });
    }
    if (campo === 'amount') {
      return new ErrorPasarela('IMPORTE_INVALIDO', `Payiad: ${mensaje}`, opciones);
    }
    if (campo === 'currency') {
      return new ErrorPasarela('MONEDA_NO_SOPORTADA', `Payiad: ${mensaje}`, opciones);
    }

    return new ErrorPasarela('DESCONOCIDO', `Payiad: ${mensaje}`, opciones);
  }

  // ── Contrato ──────────────────────────────────────────────

  /**
   * Comprueba la clave con la lectura más barata que hay: un listado de un
   * elemento. Distingue clave mala (401) de clave sin permisos (403).
   */
  async verificar(): Promise<{ ok: boolean; mensaje?: string }> {
    try {
      await this.llamar('/v1/payments?limit=1');
      return {
        ok: true,
        mensaje: this.pruebas
          ? 'Credenciales válidas (clave de sandbox: no se mueve dinero real)'
          : 'Credenciales válidas (clave de producción)',
      };
    } catch (error) {
      return { ok: false, mensaje: error instanceof Error ? error.message : 'Error desconocido' };
    }
  }

  monedasDisponibles(): Promise<string[]> {
    return Promise.resolve([]);
  }

  async crearCobro(solicitud: SolicitudCobro): Promise<RespuestaCobro> {
    const pago = await this.llamar<PagoPayiad>('/v1/payments', {
      method: 'POST',
      idempotencyKey: solicitud.idempotencyKey.slice(0, 255),
      body: {
        amount: solicitud.amountCents,
        currency: solicitud.currency.toUpperCase(),
        description: solicitud.description.slice(0, 500),
        customer_email: solicitud.customerEmail,
        metadata: { orderId: solicitud.orderId, orderNumber: solicitud.orderNumber },
        /*
         * Payiad solo tiene una URL de vuelta, no una de éxito y otra de
         * cancelación. Se usa la de éxito: esa página consulta el estado real
         * del cobro y enseña lo que corresponda, haya pagado o no.
         */
        return_url: solicitud.successUrl,
      },
    });

    if (!pago.id) {
      throw new ErrorPasarela('DESCONOCIDO', 'Payiad no ha devuelto identificador de cobro', {
        pasarela: this.nombre,
      });
    }
    if (!pago.checkout_url) {
      throw new ErrorPasarela('DESCONOCIDO', 'Payiad no ha devuelto la URL de pago', {
        pasarela: this.nombre,
      });
    }

    return {
      externalId: pago.id,
      estado: this.traducirEstado(pago.status),
      checkoutUrl: pago.checkout_url,
      metadata: { modo: pago.mode ?? (this.pruebas ? 'sandbox' : 'live') },
    };
  }

  async consultarCobro(externalId: string): Promise<EstadoCobro | null> {
    let pago: PagoPayiad;
    try {
      pago = await this.llamar<PagoPayiad>(`/v1/payments/${encodeURIComponent(externalId)}`);
    } catch (error) {
      if (error instanceof ErrorPasarela && error.tipo === 'NO_ENCONTRADO') return null;
      throw error;
    }

    if (!pago.id) return null;

    const estado = this.traducirEstado(pago.status);
    const importe = pago.amount ?? 0;

    return {
      externalId: pago.id,
      estado,
      amountCents: importe,
      receivedCents: estado === 'PAGADO' ? importe : 0,
      ...(pago.currency ? { payCurrency: pago.currency.toUpperCase() } : {}),
      ...(estado === 'PAGADO' && pago.paid_at ? { paidAt: new Date(pago.paid_at) } : {}),
      metadata: this.detalle(pago),
    };
  }

  /**
   * Verifica la firma del webhook.
   *
   * `Payiad-Signature: t=<segundos>,v1=<hex>[,v1=<hex>…]`, donde cada `v1` es
   * HMAC-SHA256 de `"<t>.<cuerpo crudo>"` con el secreto del endpoint. Mismo
   * esquema que Stripe y mismas tres reglas: el cuerpo byte a byte, el
   * timestamp a menos de 5 minutos y vale con que cuadre una de las firmas
   * (durante la rotación del secreto llegan dos).
   */
  verificarWebhook(cuerpo: string, cabeceras: Record<string, string>): EventoWebhook | null {
    const secreto = this.credenciales.webhookSecret;
    if (!secreto) return null;

    let firma = '';
    for (const [clave, valor] of Object.entries(cabeceras)) {
      if (clave.toLowerCase() === 'payiad-signature') firma = valor;
    }
    if (!firma) return null;

    const partes = firma.split(',').map((p) => p.trim());
    const marca = partes.find((p) => p.startsWith('t='))?.slice(2) ?? '';
    const recibidas = partes.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
    if (!/^\d+$/.test(marca) || recibidas.length === 0) return null;

    const desfase = Date.now() - Number(marca) * 1000;
    if (Math.abs(desfase) > TOLERANCIA_FIRMA_MS) return null;

    const esperada = Buffer.from(
      crypto.createHmac('sha256', secreto).update(`${marca}.${cuerpo}`).digest('hex'),
    );
    const coincide = recibidas.some((r) => {
      const recibida = Buffer.from(r);
      return recibida.length === esperada.length && crypto.timingSafeEqual(recibida, esperada);
    });
    if (!coincide) return null;

    let datos: Record<string, unknown>;
    try {
      datos = JSON.parse(cuerpo) as Record<string, unknown>;
    } catch {
      return null;
    }

    // Solo interesan los eventos de cobros; `payment_link.created` no casa con
    // ningún cobro nuestro.
    const tipo = texto(datos['type'], '');
    if (!tipo.startsWith('payment.')) return null;

    const pago = (datos['data'] as { object?: PagoPayiad } | undefined)?.object ?? {};
    const id = textoOpcional(pago.id);
    if (!id) return null;

    // El estado sale del objeto y no del tipo del evento: pueden llegar
    // desordenados, y el objeto trae siempre el estado real en ese momento.
    const estado = this.traducirEstado(pago.status);

    return {
      externalId: id,
      estado,
      // Firmado con nuestro secreto: el importe es palabra de Payiad.
      ...(estado === 'PAGADO' && pago.amount !== undefined ? { receivedCents: pago.amount } : {}),
      ...(textoOpcional(datos['id']) ? { eventId: texto(datos['id'], '') } : {}),
      raw: datos,
    };
  }

  /**
   * Reembolsos: pendientes de que Payiad publique la API.
   *
   * Falla antes de mover nada, con un mensaje que dice qué hacer: el reembolso
   * queda como fallido en el panel y se devuelve a mano desde Payiad.
   */
  reembolsar(solicitud: SolicitudReembolso): Promise<RespuestaReembolso> {
    void solicitud;
    return Promise.reject(
      new ErrorPasarela(
        'DESCONOCIDO',
        'Payiad todavía no permite reembolsos desde la API. Haz la devolución desde el panel ' +
          'de Payiad; no se ha movido ningún dinero desde aquí.',
        { pasarela: this.nombre, reintentable: false },
      ),
    );
  }

  // ── Estados ───────────────────────────────────────────────

  /**
   * `requires_payment_method` → `processing` → `succeeded` | `failed`.
   *
   * `requires_action` es el 3-D Secure del banco: el cliente sigue en la
   * página, así que es pendiente. `canceled` solo pasa si se cancela el cobro,
   * y para el pedido equivale a que el plazo se acabó.
   */
  private traducirEstado(estado: string | undefined): EstadoPago {
    switch ((estado ?? '').toLowerCase()) {
      case 'requires_payment_method':
      case 'requires_action':
        return 'PENDIENTE';
      case 'processing':
        return 'ESPERANDO_CONFIRMACION';
      case 'succeeded':
        return 'PAGADO';
      case 'failed':
        return 'FALLIDO';
      case 'canceled':
        return 'CADUCADO';
      default:
        return 'DESCONOCIDO';
    }
  }

  private detalle(pago: PagoPayiad): Record<string, unknown> {
    return {
      status: pago.status ?? null,
      modo: pago.mode ?? null,
      metodo: pago.payment_method ?? null,
      tarjeta: pago.card_brand ?? null,
      ultimosDigitos: pago.card_last4 ?? null,
      intentos: pago.attempts ?? null,
      ...(pago.failure_code
        ? { error: pago.failure_code, errorMensaje: pago.failure_message ?? null }
        : {}),
    };
  }

  /** Firma un cuerpo como Payiad. Para las pruebas y para reproducir avisos. */
  static firmar(cuerpo: string, secreto: string, marcaSegundos: number): string {
    const firma = crypto
      .createHmac('sha256', secreto)
      .update(`${marcaSegundos}.${cuerpo}`)
      .digest('hex');
    return `t=${marcaSegundos},v1=${firma}`;
  }
}
