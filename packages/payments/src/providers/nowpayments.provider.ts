import crypto from 'node:crypto';
import { numero, texto, textoOpcional } from '../core/coercion.js';
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
 * NOWPayments · pasarela principal de la plataforma.
 *
 * Particularidades que condicionan la implementación:
 *
 *  · **Tasa fija.** Con `fixed_rate: true` el tipo de cambio queda bloqueado
 *    durante ~20 minutos. Sin esto, entre que el cliente ve el importe y envía
 *    la transacción, el precio del bitcoin puede moverse un 3% y recibiríamos
 *    menos de lo vendido.
 *
 *  · **Pagos parciales.** Es el caso más frecuente y el que más soporte genera:
 *    el cliente envía el importe justo, la red le descuenta la comisión, y
 *    llega de menos. NOWPayments lo notifica como `partially_paid`.
 *
 *  · **Firma de los callbacks.** HMAC-SHA512 sobre el JSON con las claves
 *    ordenadas alfabéticamente. Si no se verifica, cualquiera puede enviarnos
 *    un "pago confirmado" falso y llevarse la mercancía sin pagar. Es la
 *    comprobación más importante de todo el módulo.
 *
 *  · **Reembolsos.** No existen como tales: hay que hacer un envío nuevo a una
 *    dirección que facilite el cliente. Una dirección mal escrita son fondos
 *    perdidos sin recuperación posible.
 *
 * Estado: implementado contra la documentación pública. PENDIENTE DE VALIDAR
 * con credenciales reales (ver BLOQUEOS.md).
 */

const URL_PRODUCCION = 'https://api.nowpayments.io/v1';
const URL_SANDBOX = 'https://api-sandbox.nowpayments.io/v1';

/** Tolerancia por defecto a pagos de menos, en porcentaje del total. */
const TOLERANCIA_PAGO_PARCIAL_PCT = 1;

interface CredencialesNowPayments {
  apiKey?: string;
  ipnSecret?: string;
}

export class NowPaymentsProvider implements PaymentProvider {
  readonly key = 'nowpayments';
  readonly nombre = 'NOWPayments';

  readonly capacidades: CapacidadesPasarela = {
    // El precio se bloquea y caduca: hay que enseñar un contador al cliente.
    cobroCaduca: true,
    admitePagoParcial: true,
    reembolsoAutomatico: false,
    // No hay "devolver a la tarjeta": hace falta una dirección de destino.
    requiereDireccionReembolso: true,
    reembolsoParcial: true,
    // Sin chargebacks: es la gran ventaja frente a la tarjeta.
    admiteDisputas: false,
    monedasDePago: [],
  };

  private readonly baseUrl: string;

  constructor(
    private readonly credenciales: CredencialesNowPayments,
    private readonly sandbox = true,
  ) {
    this.baseUrl = sandbox ? URL_SANDBOX : URL_PRODUCCION;
  }

  // ── Llamadas ──────────────────────────────────────────────

  private async llamar<T>(
    ruta: string,
    opciones: { method?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const apiKey = this.credenciales.apiKey;
    if (!apiKey) {
      throw new ErrorPasarela('CREDENCIALES', 'Falta la API key de NOWPayments', {
        pasarela: this.nombre,
        reintentable: false,
      });
    }

    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.baseUrl}${ruta}`, {
        method: opciones.method ?? 'GET',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          ...(opciones.idempotencyKey ? { 'x-idempotency-key': opciones.idempotencyKey } : {}),
        },
        ...(opciones.body ? { body: JSON.stringify(opciones.body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new ErrorPasarela('RED', `No se ha podido contactar con NOWPayments`, {
        pasarela: this.nombre,
        reintentable: true,
        detalleOriginal: error,
      });
    }

    const texto = await respuesta.text();

    if (!respuesta.ok) {
      throw this.traducirError(respuesta.status, texto);
    }

    return (texto ? JSON.parse(texto) : {}) as T;
  }

  private traducirError(status: number, cuerpo: string): ErrorPasarela {
    if (status === 401 || status === 403) {
      return new ErrorPasarela('CREDENCIALES', 'NOWPayments ha rechazado la API key', {
        pasarela: this.nombre,
        reintentable: false,
      });
    }
    if (status === 404) {
      return new ErrorPasarela('NO_ENCONTRADO', 'Cobro no encontrado en NOWPayments', {
        pasarela: this.nombre,
        reintentable: false,
      });
    }
    if (status === 429) {
      return new ErrorPasarela('RED', 'NOWPayments ha limitado nuestras peticiones', {
        pasarela: this.nombre,
        reintentable: true,
      });
    }
    if (status >= 500) {
      return new ErrorPasarela('PASARELA_CAIDA', `NOWPayments devuelve error ${status}`, {
        pasarela: this.nombre,
        reintentable: true,
      });
    }

    // Los 400 suelen traer el motivo en el cuerpo.
    let mensaje = cuerpo.slice(0, 300);
    try {
      const json = JSON.parse(cuerpo) as { message?: string };
      if (json.message) mensaje = json.message;
    } catch {
      // El cuerpo no era JSON; se deja el texto tal cual.
    }

    if (/currency|coin/i.test(mensaje)) {
      return new ErrorPasarela('MONEDA_NO_SOPORTADA', mensaje, { pasarela: this.nombre });
    }
    if (/amount|minimum/i.test(mensaje)) {
      return new ErrorPasarela('IMPORTE_INVALIDO', mensaje, { pasarela: this.nombre });
    }

    return new ErrorPasarela('DESCONOCIDO', `NOWPayments: ${mensaje}`, { pasarela: this.nombre });
  }

  // ── Contrato ──────────────────────────────────────────────

  async verificar(): Promise<{ ok: boolean; mensaje?: string }> {
    try {
      const r = await this.llamar<{ message?: string }>('/status');
      return { ok: r.message === 'OK', mensaje: r.message };
    } catch (error) {
      return { ok: false, mensaje: error instanceof Error ? error.message : 'Error desconocido' };
    }
  }

  async monedasDisponibles(): Promise<string[]> {
    const r = await this.llamar<{ currencies?: string[] }>('/currencies');
    return r.currencies ?? [];
  }

  async estimar(amountCents: number, currency: string, payCurrency: string): Promise<string> {
    const r = await this.llamar<{ estimated_amount?: string | number }>(
      `/estimate?amount=${amountCents / 100}&currency_from=${currency.toLowerCase()}&currency_to=${payCurrency.toLowerCase()}`,
    );
    return String(r.estimated_amount ?? '0');
  }

  async crearCobro(solicitud: SolicitudCobro): Promise<RespuestaCobro> {
    // Sin moneda de pago concreta se usa la página de checkout alojada, donde
    // el cliente elige. Con moneda concreta se genera la dirección directa.
    const usarInvoice = !solicitud.payCurrency;

    if (usarInvoice) {
      const r = await this.llamar<{
        id?: string | number;
        invoice_url?: string;
        order_id?: string;
      }>('/invoice', {
        method: 'POST',
        idempotencyKey: solicitud.idempotencyKey,
        body: {
          price_amount: solicitud.amountCents / 100,
          price_currency: solicitud.currency.toLowerCase(),
          order_id: solicitud.orderNumber,
          order_description: solicitud.description,
          ipn_callback_url: solicitud.callbackUrl,
          success_url: solicitud.successUrl,
          cancel_url: solicitud.cancelUrl,
          is_fixed_rate: true,
          is_fee_paid_by_user: true,
        },
      });

      if (!r.id) {
        throw new ErrorPasarela('DESCONOCIDO', 'NOWPayments no ha devuelto identificador', {
          pasarela: this.nombre,
        });
      }

      return {
        externalId: String(r.id),
        estado: 'PENDIENTE',
        ...(r.invoice_url ? { checkoutUrl: r.invoice_url } : {}),
      };
    }

    const r = await this.llamar<{
      payment_id?: string | number;
      payment_status?: string;
      pay_address?: string;
      pay_amount?: number | string;
      pay_currency?: string;
      price_amount?: number;
      valid_until?: string;
      expiration_estimate_date?: string;
    }>('/payment', {
      method: 'POST',
      idempotencyKey: solicitud.idempotencyKey,
      body: {
        price_amount: solicitud.amountCents / 100,
        price_currency: solicitud.currency.toLowerCase(),
        pay_currency: solicitud.payCurrency?.toLowerCase(),
        order_id: solicitud.orderNumber,
        order_description: solicitud.description,
        ipn_callback_url: solicitud.callbackUrl,
        // Tasa fija: bloquea el cambio para que la volatilidad no se coma
        // el margen entre que el cliente ve el importe y lo envía.
        is_fixed_rate: true,
        // La comisión de red la paga el cliente; si no, llegaría de menos y
        // todos los pagos entrarían como parciales.
        is_fee_paid_by_user: true,
      },
    });

    if (!r.payment_id) {
      throw new ErrorPasarela('DESCONOCIDO', 'NOWPayments no ha devuelto identificador de pago', {
        pasarela: this.nombre,
      });
    }

    const caducidad = r.valid_until ?? r.expiration_estimate_date;
    const importePagado = r.pay_amount !== undefined ? String(r.pay_amount) : undefined;

    return {
      externalId: String(r.payment_id),
      estado: this.traducirEstado(r.payment_status ?? 'waiting'),
      ...(r.pay_address ? { payAddress: r.pay_address } : {}),
      ...(importePagado ? { payAmount: importePagado } : {}),
      ...(r.pay_currency ? { payCurrency: r.pay_currency.toUpperCase() } : {}),
      ...(caducidad ? { expiresAt: new Date(caducidad) } : {}),
      ...(importePagado && r.price_amount
        ? { exchangeRate: String(r.price_amount / Number(importePagado)) }
        : {}),
    };
  }

  async consultarCobro(externalId: string): Promise<EstadoCobro | null> {
    try {
      const r = await this.llamar<{
        payment_id?: string | number;
        payment_status?: string;
        price_amount?: number;
        actually_paid?: number;
        pay_amount?: number;
        pay_currency?: string;
        outcome_amount?: number;
        purchase_id?: string;
        created_at?: string;
        updated_at?: string;
        payin_hash?: string;
      }>(`/payment/${externalId}`);

      if (!r.payment_id) return null;

      const esperado = Math.round((r.price_amount ?? 0) * 100);
      // `actually_paid` viene en la moneda de pago; se convierte proporcional.
      const proporcion =
        r.pay_amount && r.actually_paid ? r.actually_paid / r.pay_amount : r.actually_paid ? 1 : 0;
      const recibido = Math.round(esperado * proporcion);

      return {
        externalId: String(r.payment_id),
        estado: this.traducirEstado(r.payment_status ?? 'waiting'),
        amountCents: esperado,
        receivedCents: recibido,
        ...(r.pay_currency ? { payCurrency: r.pay_currency.toUpperCase() } : {}),
        ...(r.actually_paid !== undefined ? { payAmount: String(r.actually_paid) } : {}),
        ...(r.payin_hash ? { txHash: r.payin_hash } : {}),
        ...(r.updated_at ? { paidAt: new Date(r.updated_at) } : {}),
      };
    } catch (error) {
      if (error instanceof ErrorPasarela && error.tipo === 'NO_ENCONTRADO') return null;
      throw error;
    }
  }

  /**
   * Verifica la firma HMAC-SHA512 del callback.
   *
   * NOWPayments firma el JSON con las claves ordenadas alfabéticamente. El
   * orden importa: serializar el objeto tal cual llega produce una firma
   * distinta y todos los pagos legítimos se rechazarían.
   *
   * Se compara en tiempo constante: una comparación normal filtra información
   * sobre la firma correcta a través del tiempo de respuesta.
   */
  verificarWebhook(cuerpo: string, cabeceras: Record<string, string>): EventoWebhook | null {
    const secreto = this.credenciales.ipnSecret;
    if (!secreto) return null;

    const firmaRecibida = cabeceras['x-nowpayments-sig'] ?? cabeceras['X-Nowpayments-Sig'] ?? '';
    if (!firmaRecibida) return null;

    let datos: Record<string, unknown>;
    try {
      datos = JSON.parse(cuerpo) as Record<string, unknown>;
    } catch {
      return null;
    }

    const firmaEsperada = crypto
      .createHmac('sha512', secreto)
      .update(this.serializarOrdenado(datos))
      .digest('hex');

    const a = Buffer.from(firmaRecibida);
    const b = Buffer.from(firmaEsperada);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    const paymentId = datos['payment_id'];
    if (paymentId === undefined || texto(paymentId) === '') return null;

    const precio = numero(datos['price_amount']);
    const pagado = numero(datos['actually_paid']);
    const importePago = numero(datos['pay_amount']);
    const proporcion = importePago > 0 ? pagado / importePago : pagado > 0 ? 1 : 0;

    // Todo pasa por los conversores seguros: el cuerpo lo envía un tercero y
    // un objeto donde esperamos texto acabaría guardado como "[object Object]"
    // en el hash de transacción, dejando el pago sin poder auditarse.
    const idCobro = texto(paymentId);
    const estadoTexto = texto(datos['payment_status'], 'waiting');

    return {
      externalId: idCobro,
      estado: this.traducirEstado(estadoTexto),
      receivedCents: Math.round(precio * 100 * proporcion),
      ...(textoOpcional(datos['actually_paid'])
        ? { payAmount: texto(datos['actually_paid']) }
        : {}),
      ...(textoOpcional(datos['payin_hash']) ? { txHash: texto(datos['payin_hash']) } : {}),
      // El id del cobro más su estado sirve para deduplicar reenvíos: la
      // pasarela puede repetir el mismo callback varias veces.
      eventId: `${idCobro}-${estadoTexto}`,
      raw: datos,
    };
  }

  /** Serialización con claves ordenadas, tal y como firma NOWPayments. */
  private serializarOrdenado(valor: unknown): string {
    if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
    if (Array.isArray(valor)) {
      return `[${valor.map((v) => this.serializarOrdenado(v)).join(',')}]`;
    }

    const entradas = Object.entries(valor as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${this.serializarOrdenado(v)}`);

    return `{${entradas.join(',')}}`;
  }

  /**
   * Reembolso.
   *
   * En cripto no existe: se envía dinero nuevo a la dirección que da el
   * cliente. Por eso se exige dirección y por eso el flujo de la aplicación
   * pide aprobación manual antes de llegar aquí.
   */
  async reembolsar(solicitud: SolicitudReembolso): Promise<RespuestaReembolso> {
    if (!solicitud.payoutAddress) {
      throw new ErrorPasarela(
        'DIRECCION_INVALIDA',
        'NOWPayments necesita una dirección de destino para devolver los fondos: ' +
          'no existe el reembolso automático en cripto.',
        { pasarela: this.nombre, reintentable: false },
      );
    }

    const moneda = (solicitud.payoutCurrency ?? 'usdttrc20').toLowerCase();

    // El importe a devolver está en euros, pero la API de payouts espera la
    // cantidad **en la moneda de destino**. Hay que convertirlo antes: enviar
    // los euros tal cual funcionaría de casualidad con una moneda estable
    // (50 € ≈ 50 USDT) y sería catastrófico con cualquier otra, porque un
    // reembolso de 50 € pediría enviar 50 BTC.
    const cantidad = await this.estimar(solicitud.amountCents, solicitud.currency, moneda);

    if (!(Number(cantidad) > 0)) {
      throw new ErrorPasarela(
        'MONEDA_NO_SOPORTADA',
        `No se ha podido calcular cuánto ${moneda.toUpperCase()} equivale a ` +
          `${(solicitud.amountCents / 100).toFixed(2)} ${solicitud.currency}. ` +
          'No se envía el reembolso a ciegas.',
        { pasarela: this.nombre, reintentable: true },
      );
    }

    const r = await this.llamar<{ id?: string; withdrawals?: { id?: string; status?: string }[] }>(
      '/payout',
      {
        method: 'POST',
        idempotencyKey: solicitud.idempotencyKey,
        body: {
          ipn_callback_url: undefined,
          withdrawals: [
            {
              address: solicitud.payoutAddress,
              currency: moneda,
              amount: Number(cantidad),
              ...(solicitud.payoutNetwork ? { extra_id: solicitud.payoutNetwork } : {}),
            },
          ],
        },
      },
    );

    const retirada = r.withdrawals?.[0];
    return {
      externalId: String(retirada?.id ?? r.id ?? ''),
      estado: retirada?.status === 'FINISHED' ? 'COMPLETADO' : 'PROCESANDO',
      cantidadEnviada: cantidad,
      monedaEnviada: moneda,
      mensaje:
        `Reembolso enviado: ${cantidad} ${moneda.toUpperCase()} por ` +
        `${(solicitud.amountCents / 100).toFixed(2)} ${solicitud.currency}. ` +
        'La confirmación en red puede tardar unos minutos.',
    };
  }

  // ── Estados ───────────────────────────────────────────────

  /**
   * Traduce los estados de NOWPayments a los nuestros.
   *
   * `confirming` es clave: la transacción está en la cadena pero sin
   * confirmaciones suficientes. Tratarla como pagada significaría enviar
   * mercancía por un pago que todavía puede revertirse.
   */
  private traducirEstado(estado: string): EstadoPago {
    const mapa: Record<string, EstadoPago> = {
      waiting: 'PENDIENTE',
      confirming: 'ESPERANDO_CONFIRMACION',
      confirmed: 'ESPERANDO_CONFIRMACION',
      sending: 'ESPERANDO_CONFIRMACION',
      partially_paid: 'PAGADO_PARCIAL',
      finished: 'PAGADO',
      failed: 'FALLIDO',
      refunded: 'REEMBOLSADO',
      expired: 'CADUCADO',
    };
    return mapa[estado.toLowerCase()] ?? 'DESCONOCIDO';
  }

  /**
   * ¿Un pago parcial cubre el pedido?
   *
   * Se admite una diferencia mínima porque las comisiones de red hacen que casi
   * nunca llegue el importe exacto. Rechazar por dos céntimos generaría más
   * coste de soporte que la propia diferencia.
   */
  static cubreElPedido(
    recibidoCents: number,
    esperadoCents: number,
    toleranciaPct = TOLERANCIA_PAGO_PARCIAL_PCT,
  ): boolean {
    if (esperadoCents <= 0) return false;
    const minimo = esperadoCents * (1 - toleranciaPct / 100);
    return recibidoCents >= minimo;
  }
}
