import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  crearPasarela,
  ErrorPasarela,
  NowPaymentsProvider,
  PASARELAS_DISPONIBLES,
  type ClavePasarela,
  type EstadoPago,
  type EventoWebhook,
  type PaymentProvider,
} from '@ecom/payments';
import { idempotencyKey, newId, type Env } from '@ecom/shared';
import type { PaymentStatus, Prisma } from '@ecom/db';
import { ENV } from '../../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../queue/outbox.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { IntegracionesService } from '../integrations/integraciones.service.js';
import { StorefrontCacheService } from '../cache/storefront-cache.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { urlsDeVuelta } from './urls-vuelta.js';
import {
  aplicables,
  dejaLaTiendaSinCobrar,
  motivoNoDisponible,
  normalizar,
  ordenar,
  validar,
  type ConfigPasarela,
  type EstadoPasarela,
} from './configuracion-pasarelas.js';

/** Traducción del estado de la pasarela al de nuestra base de datos. */
const A_ESTADO_BD: Record<EstadoPago, PaymentStatus> = {
  PENDIENTE: 'PENDING',
  ESPERANDO_CONFIRMACION: 'AWAITING_CONFIRMATION',
  PAGADO_PARCIAL: 'PARTIALLY_PAID',
  PAGADO: 'PAID',
  SOBREPAGADO: 'OVERPAID',
  CADUCADO: 'EXPIRED',
  FALLIDO: 'FAILED',
  REEMBOLSADO: 'REFUNDED',
  DESCONOCIDO: 'PENDING',
};

/** Prefijo Redis para deduplicar webhooks reenviados. */
const CLAVE_WEBHOOK = 'pago:webhook:';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly orders: OrdersService,
    private readonly integraciones: IntegracionesService,
    private readonly storefront: StorefrontCacheService,
  ) {}

  pasarelasDisponibles() {
    return PASARELAS_DISPONIBLES;
  }

  /** Configuración guardada, ya normalizada y completa. */
  private async configuracion(): Promise<ConfigPasarela[]> {
    const ajuste = await this.prisma.client.setting.findUnique({
      where: { namespace_key: { namespace: 'checkout', key: 'paymentProviders' } },
    });

    return normalizar(ajuste?.value ?? null);
  }

  /**
   * Contexto para las funciones puras de `configuracion-pasarelas`.
   *
   * Se resuelven ANTES las credenciales de las cuatro pasarelas y se pasa un
   * mapa ya calculado: las funciones que deciden qué se ofrece en el checkout
   * son puras y síncronas a propósito —así se prueban sin base de datos— y no
   * pueden ponerse a consultar la configuración a mitad.
   */
  private async construirContexto() {
    const estados = await Promise.all(
      PASARELAS_DISPONIBLES.map(async (p) => {
        const config = await this.integraciones.configuracion(p.key);

        return [
          p.key,
          {
            // `operativa` y no solo "tiene las claves puestas": incluye que la
            // integración esté encendida. Apagarla desde Integraciones tiene
            // que sacarla del checkout, no dejarla ofreciéndose porque las
            // credenciales sigan guardadas.
            usable: config?.operativa ?? false,
            faltan: config?.faltan ?? [],
            configurada: Boolean(config && config.faltan.length === 0),
          },
        ] as const;
      }),
    );

    const porClave = new Map(estados);

    return {
      implementada: (key: ClavePasarela) =>
        Boolean(PASARELAS_DISPONIBLES.find((p) => p.key === key)?.implementada),
      tieneCredenciales: (key: ClavePasarela) => porClave.get(key)?.usable ?? false,
      faltanDe: (key: ClavePasarela) => porClave.get(key)?.faltan ?? [],
      configuradaDe: (key: ClavePasarela) => porClave.get(key)?.configurada ?? false,
    };
  }

  /**
   * Pasarelas ofrecibles en el checkout, en orden.
   *
   * @param totalCents importe del pedido, para aplicar los límites por importe
   */
  async pasarelasActivas(
    totalCents?: number,
    orderId?: string,
  ): Promise<{ key: string; nombre: string }[]> {
    const configs = await this.configuracion();

    let importe = totalCents;
    if (importe === undefined && orderId) {
      const pedido = await this.prisma.client.order.findUnique({
        where: { id: orderId },
        select: { totalCents: true },
      });
      importe = pedido?.totalCents;
    }

    return aplicables(configs, {
      ...(await this.construirContexto()),
      ...(importe !== undefined ? { totalCents: importe } : {}),
    }).map((c) => ({
      key: c.key,
      nombre: PASARELAS_DISPONIBLES.find((p) => p.key === c.key)?.nombre ?? c.key,
    }));
  }

  /** Estado completo de cada pasarela, para el panel. */
  async estadoPasarelas(): Promise<EstadoPasarela[]> {
    const configs = await this.configuracion();
    const contexto = await this.construirContexto();

    return ordenar(configs).map((c) => {
      const catalogo = PASARELAS_DISPONIBLES.find((p) => p.key === c.key);
      const implementada = Boolean(catalogo?.implementada);
      const tieneCredenciales = contexto.tieneCredenciales(c.key);

      return {
        ...c,
        nombre: catalogo?.nombre ?? c.key,
        implementada,
        // Para el panel se distingue "tiene las claves" de "está encendida":
        // ver "sin credenciales" cuando lo que pasa es que está apagada manda
        // a buscar el problema al sitio equivocado.
        tieneCredenciales: contexto.configuradaDe(c.key),
        // Se dice qué falta exactamente, no solo que falta: con "faltan
        // credenciales" a secas, quien configura la tienda tiene que adivinar
        // cuál de los dos campos se dejó.
        faltan: contexto.faltanDe(c.key),
        operativa: motivoNoDisponible(c, { implementada, tieneCredenciales }) === null,
      };
    });
  }

  /**
   * Guarda la configuración de pasarelas.
   *
   * Se valida antes de escribir porque el error caro —dejar el checkout sin
   * ninguna forma de pago— no da síntoma alguno hasta que un cliente intenta
   * pagar, y para entonces la venta ya se ha perdido.
   */
  async guardarPasarelas(entrada: unknown, ctx: ContextoActor): Promise<EstadoPasarela[]> {
    const configs = normalizar(entrada);
    const problemas = validar(configs, await this.construirContexto());

    // Se frena solo el caso que el panel puede provocar y arreglar: apagar la
    // última pasarela que sí podía cobrar. Que no haya ninguna operativa por
    // falta de credenciales en el servidor se avisa, pero no bloquea: si no,
    // la pantalla sería inservible justo mientras se pone la tienda en marcha.
    if (dejaLaTiendaSinCobrar(configs, await this.construirContexto())) {
      throw new BadRequestException(
        'Ese cambio dejaría la tienda sin ninguna forma de pago: los clientes no podrían completar la compra.',
      );
    }

    const antes = await this.configuracion();

    await this.prisma.client.setting.upsert({
      where: { namespace_key: { namespace: 'checkout', key: 'paymentProviders' } },
      create: {
        id: newId(),
        namespace: 'checkout',
        key: 'paymentProviders',
        value: configs as unknown as Prisma.InputJsonValue,
      },
      update: { value: configs as unknown as Prisma.InputJsonValue },
    });

    await this.audit.registrar({
      action: 'payments.gateways.update',
      resource: 'setting',
      resourceId: 'checkout.paymentProviders',
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { pasarelas: antes },
      after: { pasarelas: configs },
    });

    for (const aviso of problemas) this.logger.warn(`Configuración de pagos: ${aviso}`);

    /*
     * La tienda anuncia en el pie qué formas de pago se aceptan, y ese dato lo
     * cachea una hora: entra en todas las páginas y cambia cuando alguien
     * configura una pasarela, no cuando alguien navega. Sin purgar aquí,
     * encender Bizum se vería en la caja al momento y en el pie al cabo de una
     * hora, que es justo la incoherencia que hace dudar de si el cambio se ha
     * guardado.
     */
    await this.storefront.purgar(['pagos']);

    return this.estadoPasarelas();
  }

  /**
   * Comprueba contra la pasarela que las credenciales sirven.
   *
   * Vale la pena tener el botón: unas credenciales mal copiadas no fallan al
   * guardarlas, fallan con el primer cliente que intenta pagar.
   */
  async probarPasarela(key: ClavePasarela): Promise<{ ok: boolean; mensaje?: string }> {
    const config = await this.integraciones.configuracion(key);

    if (!config || config.faltan.length > 0) {
      const resultado = {
        ok: false,
        mensaje: `Falta configurar: ${(config?.faltan ?? ['todo']).join(', ')}.`,
      };
      await this.integraciones.anotarComprobacion(key, resultado);
      return resultado;
    }

    try {
      const pasarela = await this.pasarela(key);
      const resultado = await pasarela.verificar();
      // Queda anotado en la integración: el panel enseña cuándo se comprobó por
      // última vez y con qué resultado, que es lo que se mira cuando los cobros
      // empiezan a fallar.
      await this.integraciones.anotarComprobacion(key, resultado);
      return resultado;
    } catch (error) {
      const mensaje =
        error instanceof ErrorPasarela ? error.message : 'No se pudo contactar con la pasarela';
      await this.integraciones.anotarComprobacion(key, { ok: false, mensaje });
      return { ok: false, mensaje };
    }
  }

  /** Qué sabe hacer una pasarela: si reembolsa sola o necesita destino. */
  async capacidadesDe(key: ClavePasarela) {
    return (await this.pasarela(key)).capacidades;
  }

  /**
   * Envía un reembolso a través de la pasarela.
   *
   * Deliberadamente tonto: no decide nada. Quién puede pedirlo, por cuánto y
   * con qué aprobación lo resuelve `RefundsService`, porque son reglas de
   * negocio y aquí solo está el trato con el proveedor.
   */
  async ejecutarReembolso(datos: {
    provider: ClavePasarela;
    externalPaymentId: string;
    amountCents: number;
    currency: string;
    reason: string;
    idempotencyKey: string;
    payoutAddress?: string;
    payoutCurrency?: string;
    payoutNetwork?: string;
  }) {
    const { provider, ...solicitud } = datos;
    return (await this.pasarela(provider)).reembolsar(solicitud);
  }

  /**
   * Credenciales y ajustes de una pasarela, desde el panel.
   *
   * Se consulta en cada uso en lugar de guardarse al arrancar: cambiar una
   * clave desde el panel tiene que surtir efecto en el cobro siguiente, no en
   * el próximo reinicio del servidor.
   */
  private async configuracionDe(key: ClavePasarela) {
    return this.integraciones.configuracion(key);
  }

  private async tieneCredenciales(key: ClavePasarela): Promise<boolean> {
    const config = await this.configuracionDe(key);
    return Boolean(config && config.faltan.length === 0);
  }

  /**
   * Cliente de la pasarela, montado con lo configurado en el panel.
   *
   * Si no está operativa no se devuelve un cliente a medias: se falla aquí. Un
   * cliente sin credenciales no da error hasta que llama al servicio, y para
   * entonces el cliente de la tienda ya está mirando una pantalla de pago rota.
   */
  private async pasarela(key: ClavePasarela): Promise<PaymentProvider> {
    const config = await this.configuracionDe(key);

    if (!config || config.faltan.length > 0) {
      throw new BadRequestException(
        `La pasarela "${key}" no está configurada. Complétala en Ajustes → Integraciones.`,
      );
    }

    return crearPasarela(key, config.credenciales, {
      sandbox: config.ajustes['sandbox'] === true,
    });
  }

  /**
   * Inicia el cobro de un pedido.
   *
   * La clave de idempotencia se deriva del pedido y la pasarela: si el cliente
   * pulsa "pagar" dos veces, se reutiliza el cobro ya creado en lugar de
   * generar dos y confundirle con dos direcciones distintas.
   */
  async iniciarCobro(
    orderId: string,
    opciones: { provider?: ClavePasarela; payCurrency?: string } = {},
  ) {
    const pedido = await this.prisma.client.order.findUnique({ where: { id: orderId } });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (pedido.paymentStatus === 'PAID') {
      throw new BadRequestException('Este pedido ya está pagado');
    }
    if (pedido.status !== 'AWAITING_PAYMENT' && pedido.status !== 'DRAFT') {
      throw new BadRequestException(
        `El pedido está en estado "${pedido.status}" y no admite un cobro nuevo`,
      );
    }

    // Con el importe del pedido: los límites por importe se comprueban aquí y
    // no solo al pintar los botones. La pasarela llega en el cuerpo de una
    // petición pública, así que fiarse de que el cliente solo pida las que se
    // le mostraron es dejar el límite a un `fetch` desde la consola.
    const activas = await this.pasarelasActivas(pedido.totalCents);
    const key = (opciones.provider ?? activas[0]?.key) as ClavePasarela | undefined;

    if (!key) {
      throw new BadRequestException(
        'No hay ninguna pasarela de pago configurada. Añade las credenciales en los ajustes.',
      );
    }

    if (!activas.some((a) => a.key === key)) {
      throw new BadRequestException(
        'Esa forma de pago no está disponible para este pedido. Elige otra.',
      );
    }

    const clave = idempotencyKey('pay', orderId, key, opciones.payCurrency ?? 'auto');

    // ¿Ya existe un cobro vivo con esta misma clave? Se reutiliza.
    const existente = await this.prisma.client.payment.findUnique({
      where: { idempotencyKey: clave },
    });

    if (existente && ['PENDING', 'AWAITING_CONFIRMATION'].includes(existente.status)) {
      const caducado = existente.expiresAt && existente.expiresAt < new Date();
      if (!caducado) {
        this.logger.log(`Reutilizando el cobro ${existente.id} del pedido ${pedido.number}`);
        return this.formatearCobro(existente);
      }
    }

    const proveedor = await this.pasarela(key);

    try {
      const respuesta = await proveedor.crearCobro({
        orderId,
        orderNumber: pedido.number,
        amountCents: pedido.totalCents,
        currency: pedido.currency,
        customerEmail: pedido.email,
        description: `Pedido ${pedido.number}`,
        ...urlsDeVuelta(this.env.STOREFRONT_URL, pedido),
        callbackUrl: `${this.env.API_URL}/api/v1/payments/webhook/${key}`,
        ...(opciones.payCurrency ? { payCurrency: opciones.payCurrency } : {}),
        idempotencyKey: clave,
        locale: pedido.locale,
      });

      const pago = await this.prisma.client.payment.create({
        data: {
          id: newId(),
          orderId,
          provider: key,
          externalId: respuesta.externalId,
          status: A_ESTADO_BD[respuesta.estado],
          amountCents: pedido.totalCents,
          currency: pedido.currency,
          idempotencyKey: clave,
          payCurrency: respuesta.payCurrency ?? null,
          payAmount: respuesta.payAmount ?? null,
          payAddress: respuesta.payAddress ?? null,
          exchangeRate: respuesta.exchangeRate ?? null,
          // Momento en que se fijó el cambio: a partir de aquí corre el reloj.
          rateLockedAt: respuesta.expiresAt ? new Date() : null,
          expiresAt: respuesta.expiresAt ?? null,
          rawPayload: (respuesta.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });

      await this.prisma.client.orderEvent.create({
        data: {
          id: newId(),
          orderId,
          type: 'payment.created',
          description: `Cobro iniciado con ${proveedor.nombre}${
            respuesta.payCurrency ? ` en ${respuesta.payCurrency}` : ''
          }`,
          actorType: 'system',
        },
      });

      return { ...this.formatearCobro(pago), checkoutUrl: respuesta.checkoutUrl };
    } catch (error) {
      if (error instanceof ErrorPasarela) {
        this.logger.error(`Fallo al crear el cobro con ${key}: ${error.message}`);
        // Al cliente se le da el mensaje neutro; el detalle queda en el log.
        throw new BadRequestException(error.mensajeCliente);
      }
      throw error;
    }
  }

  /**
   * Procesa un webhook de la pasarela.
   *
   * Tres defensas en orden: firma válida, deduplicación del evento, y
   * comprobación de que el importe recibido cubre el pedido. Saltarse
   * cualquiera de las tres permite llevarse mercancía sin pagar.
   */
  async procesarWebhook(
    key: ClavePasarela,
    cuerpo: string,
    cabeceras: Record<string, string>,
  ): Promise<{ procesado: boolean; motivo?: string }> {
    const proveedor = await this.pasarela(key);
    const evento = proveedor.verificarWebhook(cuerpo, cabeceras);

    if (!evento) {
      // No se da detalle a quien llama: si es un atacante probando, no
      // conviene decirle si falló la firma o el formato.
      this.logger.warn(`Webhook de ${key} con firma inválida; descartado`);
      return { procesado: false, motivo: 'firma_invalida' };
    }

    // Deduplicación: las pasarelas reenvían el mismo callback varias veces.
    const claveEvento = `${CLAVE_WEBHOOK}${key}:${evento.eventId ?? evento.externalId}`;
    const nuevo = await this.redis.client.set(claveEvento, '1', 'EX', 86_400, 'NX');
    if (nuevo === null) {
      this.logger.debug(`Webhook duplicado de ${key} (${evento.externalId}); ignorado`);
      return { procesado: true, motivo: 'duplicado' };
    }

    const pago = await this.prisma.client.payment.findFirst({
      where: { provider: key, externalId: evento.externalId },
    });

    if (!pago) {
      this.logger.warn(`Webhook de ${key} para un cobro desconocido: ${evento.externalId}`);
      return { procesado: false, motivo: 'cobro_desconocido' };
    }

    return this.aplicarEvento(pago.id, await this.completarImporte(proveedor, evento));
  }

  /**
   * Rellena el importe de un aviso que no lo trae, preguntándoselo a la pasarela.
   *
   * Revolut avisa de que «el pedido X se ha completado» y nada más: ni importe,
   * ni comisión, ni método de pago. Sin este paso el cobro quedaría marcado
   * como pagado con 0 € recibidos, y a partir de ahí cuadran mal los informes,
   * la conciliación y el importe máximo que se puede devolver.
   *
   * Pedirlo en una llamada nuestra autenticada es además más seguro que
   * fiarnos del número que venga en el cuerpo: aunque la firma garantiza que el
   * cuerpo no se ha manipulado, el estado bueno es siempre el de la pasarela.
   */
  private async completarImporte(
    proveedor: PaymentProvider,
    evento: EventoWebhook,
  ): Promise<EventoWebhook> {
    if (evento.receivedCents !== undefined) return evento;

    // Solo se consulta cuando el estado implica dinero movido. Un «pago
    // rechazado» no tiene importe que buscar y la llamada sería puro gasto.
    const conImporte: EstadoPago[] = ['PAGADO', 'SOBREPAGADO', 'PAGADO_PARCIAL', 'REEMBOLSADO'];
    if (!conImporte.includes(evento.estado)) return evento;

    try {
      const estado = await proveedor.consultarCobro(evento.externalId);
      if (!estado) return evento;

      return {
        ...evento,
        receivedCents: estado.receivedCents,
        ...(estado.txHash ? { txHash: estado.txHash } : {}),
        raw: { ...evento.raw, consultado: estado.metadata ?? {} },
      };
    } catch (error) {
      // Que falle la consulta no puede tirar el webhook: se aplica el estado
      // con lo que hay y el reconciliador lo corrige después. Perder el aviso
      // sería peor —el pedido se quedaría sin procesar—.
      this.logger.warn(
        `No se ha podido consultar el importe de ${evento.externalId} en ${proveedor.key}: ` +
          `${error instanceof Error ? error.message : 'error desconocido'}`,
      );
      return evento;
    }
  }

  private async aplicarEvento(
    paymentId: string,
    evento: EventoWebhook,
  ): Promise<{ procesado: boolean; motivo?: string }> {
    const pago = await this.prisma.client.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { order: true },
    });

    // Un cobro ya pagado no se reabre: un callback tardío no puede revertir
    // un pedido que ya se envió al proveedor.
    if (pago.status === 'PAID' && evento.estado !== 'REEMBOLSADO') {
      return { procesado: true, motivo: 'ya_pagado' };
    }

    // Un "pagado" sin importe es lo que llega de una pasarela de tarjeta cuyo
    // aviso no lo incluye y cuya consulta posterior ha fallado. Ahí "pagado"
    // significa el importe entero —no admiten cobros parciales—, así que se da
    // por recibido el total en lugar de guardar un 0 que descuadraría los
    // informes y el máximo reembolsable.
    const recibido = evento.receivedCents ?? (evento.estado === 'PAGADO' ? pago.amountCents : 0);
    let estadoFinal = A_ESTADO_BD[evento.estado];

    // Un "pagado parcial" que en realidad cubre el pedido (la diferencia es
    // solo la comisión de red) se acepta como pagado: rechazarlo por céntimos
    // cuesta más en soporte que la propia diferencia.
    if (
      evento.estado === 'PAGADO_PARCIAL' &&
      NowPaymentsProvider.cubreElPedido(recibido, pago.amountCents)
    ) {
      estadoFinal = 'PAID';
      this.logger.log(
        `Pago ${paymentId}: parcial de ${(recibido / 100).toFixed(2)} € sobre ` +
          `${(pago.amountCents / 100).toFixed(2)} €; dentro de tolerancia, se acepta`,
      );
    }

    if (evento.estado === 'PAGADO' && recibido > pago.amountCents * 1.01) {
      estadoFinal = 'OVERPAID';
    }

    await this.prisma.client.payment.update({
      where: { id: paymentId },
      data: {
        status: estadoFinal,
        receivedCents: recibido,
        ...(evento.txHash ? { txHash: evento.txHash } : {}),
        ...(evento.confirmations !== undefined ? { confirmations: evento.confirmations } : {}),
        ...(evento.payAmount ? { payAmount: evento.payAmount } : {}),
        ...(estadoFinal === 'PAID' ? { paidAt: new Date() } : {}),
        ...(estadoFinal === 'EXPIRED' ? { expiredAt: new Date() } : {}),
        rawPayload: evento.raw as Prisma.InputJsonValue,
      },
    });

    await this.prisma.client.orderEvent.create({
      data: {
        id: newId(),
        orderId: pago.orderId,
        type: `payment.${estadoFinal.toLowerCase()}`,
        description: this.describirEstado(estadoFinal, recibido, pago.amountCents),
        actorType: 'system',
        metadata: { paymentId, txHash: evento.txHash ?? null },
      },
    });

    // ── Consecuencias sobre el pedido ──
    if (estadoFinal === 'PAID' || estadoFinal === 'OVERPAID') {
      await this.orders.marcarPagado(pago.orderId, { paymentId });
    } else if (estadoFinal === 'AWAITING_CONFIRMATION') {
      // La transacción está en la cadena pero no es firme: se refleja en el
      // pedido para que el cliente vea que va, sin enviar nada al proveedor.
      if (pago.order.status === 'AWAITING_PAYMENT') {
        await this.orders.cambiarEstado(pago.orderId, 'PAYMENT_CONFIRMING', { origen: 'sistema' });
      }
      await this.prisma.client.order.update({
        where: { id: pago.orderId },
        data: { paymentStatus: 'AWAITING_CONFIRMATION' },
      });
    } else if (estadoFinal === 'PARTIALLY_PAID') {
      await this.prisma.client.order.update({
        where: { id: pago.orderId },
        data: { paymentStatus: 'PARTIALLY_PAID' },
      });
      this.logger.warn(
        `Pedido ${pago.order.number}: pago insuficiente ` +
          `(${(recibido / 100).toFixed(2)} € de ${(pago.amountCents / 100).toFixed(2)} €). Requiere decisión.`,
      );
    } else if (estadoFinal === 'EXPIRED' || estadoFinal === 'FAILED') {
      await this.prisma.client.order.update({
        where: { id: pago.orderId },
        data: { paymentStatus: estadoFinal },
      });
    }

    return { procesado: true };
  }

  private describirEstado(estado: PaymentStatus, recibido: number, esperado: number): string {
    const r = (recibido / 100).toFixed(2);
    const e = (esperado / 100).toFixed(2);

    const textos: Record<string, string> = {
      PAID: `Pago confirmado: ${r} €`,
      OVERPAID: `Pago recibido de más: ${r} € sobre ${e} €`,
      PARTIALLY_PAID: `Pago insuficiente: ${r} € de ${e} €`,
      AWAITING_CONFIRMATION: 'Transacción detectada, esperando confirmaciones en la red',
      EXPIRED: 'El plazo de pago ha caducado',
      FAILED: 'El pago ha fallado',
      REFUNDED: `Reembolsado: ${r} €`,
    };
    return textos[estado] ?? `Estado del pago: ${estado}`;
  }

  private formatearCobro(pago: {
    id: string;
    provider: string;
    externalId: string | null;
    status: string;
    amountCents: number;
    currency: string;
    payAddress: string | null;
    payAmount: string | null;
    payCurrency: string | null;
    expiresAt: Date | null;
  }) {
    return {
      paymentId: pago.id,
      provider: pago.provider,
      externalId: pago.externalId,
      status: pago.status,
      amountCents: pago.amountCents,
      currency: pago.currency,
      payAddress: pago.payAddress,
      payAmount: pago.payAmount,
      payCurrency: pago.payCurrency,
      expiresAt: pago.expiresAt,
      // Segundos restantes: el frontend pinta el contador con esto.
      segundosRestantes: pago.expiresAt
        ? Math.max(0, Math.floor((pago.expiresAt.getTime() - Date.now()) / 1000))
        : null,
    };
  }

  /** Estado del cobro, para que el frontend haga polling mientras el cliente paga. */
  async estadoCobro(paymentId: string) {
    const pago = await this.prisma.client.payment.findUnique({
      where: { id: paymentId },
      include: { order: { select: { number: true, status: true } } },
    });
    if (!pago) throw new NotFoundException('Cobro no encontrado');

    return {
      ...this.formatearCobro(pago),
      receivedCents: pago.receivedCents,
      txHash: pago.txHash,
      confirmations: pago.confirmations,
      pedido: pago.order.number,
      estadoPedido: pago.order.status,
    };
  }

  /**
   * Sincroniza con la pasarela un cobro que lleva rato sin novedades.
   *
   * Es la red de seguridad por si un webhook se pierde: sin esto, un pago
   * confirmado cuyo callback no llegó dejaría al cliente esperando y el pedido
   * sin procesar indefinidamente.
   */
  async reconciliar(paymentId: string): Promise<{ actualizado: boolean; estado: string }> {
    const pago = await this.prisma.client.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (!pago.externalId) return { actualizado: false, estado: pago.status };

    const proveedor = await this.pasarela(pago.provider as ClavePasarela);
    const estado = await proveedor.consultarCobro(pago.externalId);

    if (!estado) return { actualizado: false, estado: pago.status };

    const nuevo = A_ESTADO_BD[estado.estado];
    if (nuevo === pago.status) return { actualizado: false, estado: pago.status };

    await this.aplicarEvento(paymentId, {
      externalId: pago.externalId,
      estado: estado.estado,
      receivedCents: estado.receivedCents,
      ...(estado.txHash ? { txHash: estado.txHash } : {}),
      raw: estado.metadata ?? {},
    });

    this.logger.log(`Cobro ${paymentId} reconciliado: ${pago.status} → ${nuevo}`);
    return { actualizado: true, estado: nuevo };
  }

  /** Cobros pendientes que llevan tiempo sin actualizarse. */
  async pendientesDeReconciliar(minutos = 10) {
    return this.prisma.client.payment.findMany({
      where: {
        status: { in: ['PENDING', 'AWAITING_CONFIRMATION'] },
        updatedAt: { lt: new Date(Date.now() - minutos * 60_000) },
        externalId: { not: null },
      },
      select: { id: true, provider: true, externalId: true, orderId: true },
      take: 100,
    });
  }

  /** Caduca los cobros cuyo plazo ha vencido y libera el pedido. */
  async caducarVencidos(): Promise<number> {
    const vencidos = await this.prisma.client.payment.findMany({
      where: {
        status: { in: ['PENDING', 'AWAITING_CONFIRMATION'] },
        expiresAt: { lt: new Date() },
      },
      select: { id: true, orderId: true },
    });

    for (const pago of vencidos) {
      await this.prisma.client.payment.update({
        where: { id: pago.id },
        data: { status: 'EXPIRED', expiredAt: new Date() },
      });
      await this.prisma.client.order.update({
        where: { id: pago.orderId },
        data: { paymentStatus: 'EXPIRED' },
      });
    }

    if (vencidos.length > 0) {
      this.logger.log(`${vencidos.length} cobro(s) caducados`);
    }
    return vencidos.length;
  }
}
