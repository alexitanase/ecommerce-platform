import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ErrorPasarela, type ClavePasarela } from '@ecom/payments';
import { idempotencyKey, newId } from '@ecom/shared';
import type { RefundStatus } from '@ecom/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../queue/outbox.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { PaymentsService } from './payments.service.js';
import {
  explicarRechazo,
  importeReembolsable,
  motivoNoReembolsable,
  puedeTransicionar,
} from './reglas-reembolso.js';

/**
 * Reembolsos.
 *
 * El flujo tiene dos pasos a propósito —**pedir** y **aprobar**— y es la
 * decisión de diseño más importante del módulo. En cripto el envío es
 * irreversible: no hay banco al que llamar ni transacción que anular. Una
 * dirección mal copiada, un importe con un cero de más o una petición
 * fraudulenta son dinero que sale y no vuelve.
 *
 * Con un solo paso, cualquier fallo del flujo automático —un webhook duplicado,
 * un bucle de reintentos— vacía la cuenta sin que nadie llegue a verlo. Con dos,
 * lo peor que puede pasar es una lista de solicitudes pendientes.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * Pide un reembolso. No mueve dinero: lo deja pendiente de aprobación.
   *
   * @param datos.direccion destino de los fondos, obligatorio en cripto
   */
  async solicitar(
    datos: {
      orderId: string;
      importeCents: number;
      motivo: string;
      direccion?: string;
      moneda?: string;
      red?: string;
    },
    ctx: ContextoActor,
  ) {
    const pedido = await this.prisma.client.order.findUnique({
      where: { id: datos.orderId },
      include: {
        payments: {
          where: { status: 'PAID' },
          orderBy: { createdAt: 'desc' },
          include: { refunds: true },
        },
      },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const cobro = pedido.payments[0];
    if (!cobro) {
      throw new BadRequestException(explicarRechazo('PAGO_NO_COBRADO'));
    }

    const capacidades = await this.payments.capacidadesDe(cobro.provider as ClavePasarela);
    const previos = cobro.refunds.map((r) => ({
      amountCents: r.amountCents,
      status: r.status,
    }));

    const motivo = motivoNoReembolsable({
      importeCents: datos.importeCents,
      // Lo devuelto se limita a lo **realmente recibido**, no a lo pedido: en
      // un pago parcial el cliente envió menos, y devolver el total del pedido
      // sería regalar la diferencia.
      cobradoCents: cobro.receivedCents > 0 ? cobro.receivedCents : cobro.amountCents,
      pagoCobrado: true,
      reembolsosPrevios: previos,
      requiereDireccion: capacidades.requiereDireccionReembolso,
      direccion: datos.direccion,
      moneda: datos.moneda ?? cobro.payCurrency ?? undefined,
    });

    if (motivo) {
      const disponible = importeReembolsable(
        cobro.receivedCents > 0 ? cobro.receivedCents : cobro.amountCents,
        previos,
      );
      throw new BadRequestException(explicarRechazo(motivo, disponible));
    }

    const reembolso = await this.prisma.client.refund.create({
      data: {
        id: newId(),
        paymentId: cobro.id,
        amountCents: datos.importeCents,
        currency: pedido.currency,
        reason: datos.motivo,
        status: 'REQUESTED',
        payoutAddress: datos.direccion ?? null,
        payoutCurrency: datos.moneda ?? cobro.payCurrency ?? null,
        payoutNetwork: datos.red ?? null,
        requestedBy: ctx.actorId ?? null,
      },
    });

    await this.audit.registrar({
      action: 'refund.request',
      resource: 'refund',
      resourceId: reembolso.id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: {
        pedido: pedido.number,
        importeCents: datos.importeCents,
        // La dirección va al registro de auditoría porque es el dato que hay
        // que poder revisar si un reembolso acaba en el sitio equivocado.
        direccion: datos.direccion ?? null,
        motivo: datos.motivo,
      },
    });

    this.logger.log(
      `Reembolso solicitado por ${(datos.importeCents / 100).toFixed(2)} € del pedido ${pedido.number}`,
    );

    return reembolso;
  }

  /**
   * Aprueba y ejecuta el envío.
   *
   * Aprobar y ejecutar van juntos a propósito: un estado intermedio de
   * "aprobado pero sin enviar" solo añade una casilla más donde un reembolso
   * debido puede quedarse parado sin que nadie se entere.
   */
  async aprobar(id: string, ctx: ContextoActor) {
    const reembolso = await this.prisma.client.refund.findUnique({
      where: { id },
      include: { payment: { include: { order: true } } },
    });

    if (!reembolso) throw new NotFoundException('Reembolso no encontrado');

    if (!puedeTransicionar(reembolso.status, 'APPROVED')) {
      throw new BadRequestException(
        `Un reembolso en estado "${reembolso.status}" ya no se puede aprobar.`,
      );
    }

    // Se marca PROCESSING **antes** de llamar a la pasarela. Si el proceso se
    // cae en mitad del envío, el reembolso queda en un estado que obliga a
    // mirarlo a mano en vez de volver a intentarlo solo: reintentar a ciegas
    // un envío que quizá salió es enviar el dinero dos veces.
    await this.prisma.client.refund.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        approvedBy: ctx.actorId ?? null,
        approvedAt: new Date(),
      },
    });

    try {
      const respuesta = await this.payments.ejecutarReembolso({
        provider: reembolso.payment.provider as ClavePasarela,
        externalPaymentId: reembolso.payment.externalId ?? '',
        amountCents: reembolso.amountCents,
        currency: reembolso.currency,
        reason: reembolso.reason,
        // Derivada del reembolso concreto: un reintento no puede crear un
        // segundo envío por el mismo concepto.
        idempotencyKey: idempotencyKey('refund', reembolso.id),
        ...(reembolso.payoutAddress ? { payoutAddress: reembolso.payoutAddress } : {}),
        ...(reembolso.payoutCurrency ? { payoutCurrency: reembolso.payoutCurrency } : {}),
        ...(reembolso.payoutNetwork ? { payoutNetwork: reembolso.payoutNetwork } : {}),
      });

      const completado = respuesta.estado === 'COMPLETADO';

      // El estado y el evento se escriben juntos: si se guardara el reembolso
      // y luego fallara el aviso, el cliente no se enteraría de que le han
      // devuelto el dinero, y el reembolso constaría como comunicado.
      const actualizado = await this.prisma.client.$transaction(async (tx) => {
        const r = await tx.refund.update({
          where: { id },
          data: {
            status: completado ? 'COMPLETED' : 'PROCESSING',
            externalId: respuesta.externalId,
            payoutTxHash: respuesta.txHash ?? null,
            ...(completado ? { completedAt: new Date() } : {}),
          },
        });

        await this.outbox.registrar(tx, {
          eventType: 'refund.sent',
          aggregateType: 'refund',
          aggregateId: id,
          payload: {
            orderId: reembolso.payment.orderId,
            importeCents: reembolso.amountCents,
            cantidadEnviada: respuesta.cantidadEnviada ?? null,
            monedaEnviada: respuesta.monedaEnviada ?? null,
            txHash: respuesta.txHash ?? null,
          },
        });

        return r;
      });

      await this.actualizarPago(reembolso.paymentId);

      await this.audit.registrar({
        action: 'refund.approve',
        resource: 'refund',
        resourceId: id,
        actorId: ctx.actorId,
        actorIp: ctx.actorIp,
        after: {
          externalId: respuesta.externalId,
          cantidadEnviada: respuesta.cantidadEnviada ?? null,
          estado: actualizado.status,
        },
      });

      this.logger.log(
        `Reembolso ${id} enviado: ${respuesta.cantidadEnviada ?? '—'} ${respuesta.monedaEnviada ?? ''}`.trim(),
      );

      return actualizado;
    } catch (error) {
      const mensaje =
        error instanceof ErrorPasarela ? error.message : 'Error desconocido al enviar el reembolso';

      const fallido = await this.prisma.client.refund.update({
        where: { id },
        data: { status: 'FAILED', failureReason: mensaje },
      });

      // Se registra el fallo y NO se reintenta solo: el dinero podría haber
      // salido igualmente y un reintento automático lo enviaría dos veces.
      await this.audit.registrar({
        action: 'refund.failed',
        resource: 'refund',
        resourceId: id,
        actorId: ctx.actorId,
        actorIp: ctx.actorIp,
        after: { motivo: mensaje },
      });

      this.logger.error(`Reembolso ${id} fallido: ${mensaje}`);

      return fallido;
    }
  }

  /** Deniega la solicitud. No mueve dinero. */
  async rechazar(id: string, motivo: string, ctx: ContextoActor) {
    const reembolso = await this.prisma.client.refund.findUnique({ where: { id } });
    if (!reembolso) throw new NotFoundException('Reembolso no encontrado');

    if (!puedeTransicionar(reembolso.status, 'REJECTED')) {
      throw new BadRequestException(
        `Un reembolso en estado "${reembolso.status}" ya no se puede rechazar.`,
      );
    }

    const actualizado = await this.prisma.client.refund.update({
      where: { id },
      data: { status: 'REJECTED', failureReason: motivo },
    });

    await this.audit.registrar({
      action: 'refund.reject',
      resource: 'refund',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { motivo },
    });

    return actualizado;
  }

  /**
   * Marca el cobro como reembolsado, total o parcialmente.
   *
   * Sin esto, un pedido devuelto entero seguiría contando como venta en los
   * informes de margen.
   */
  private async actualizarPago(paymentId: string): Promise<void> {
    const cobro = await this.prisma.client.payment.findUnique({
      where: { id: paymentId },
      include: { refunds: true },
    });
    if (!cobro) return;

    const devuelto = cobro.refunds
      .filter((r) => r.status === 'COMPLETED')
      .reduce((a, r) => a + r.amountCents, 0);

    if (devuelto === 0) return;

    const base = cobro.receivedCents > 0 ? cobro.receivedCents : cobro.amountCents;

    await this.prisma.client.payment.update({
      where: { id: paymentId },
      data: {
        status: devuelto >= base ? 'REFUNDED' : cobro.status,
        refundedAt: new Date(),
      },
    });
  }

  // ── Consulta ──────────────────────────────────────────────

  async listar(estado?: RefundStatus) {
    return this.prisma.client.refund.findMany({
      where: estado ? { status: estado } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        payment: {
          select: {
            provider: true,
            payCurrency: true,
            order: { select: { id: true, number: true, email: true } },
          },
        },
      },
    });
  }

  async porPedido(orderId: string) {
    return this.prisma.client.refund.findMany({
      where: { payment: { orderId } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Cuánto queda por devolver de un pedido, para no pedir de más. */
  async disponible(orderId: string): Promise<{ disponibleCents: number; cobradoCents: number }> {
    const cobro = await this.prisma.client.payment.findFirst({
      where: { orderId, status: { in: ['PAID', 'REFUNDED'] } },
      orderBy: { createdAt: 'desc' },
      include: { refunds: true },
    });

    if (!cobro) return { disponibleCents: 0, cobradoCents: 0 };

    const cobrado = cobro.receivedCents > 0 ? cobro.receivedCents : cobro.amountCents;

    return {
      cobradoCents: cobrado,
      disponibleCents: importeReembolsable(
        cobrado,
        cobro.refunds.map((r) => ({
          amountCents: r.amountCents,
          status: r.status,
        })),
      ),
    };
  }
}
