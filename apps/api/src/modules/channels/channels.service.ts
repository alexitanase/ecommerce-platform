import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import {
  CANALES,
  baseComisionable,
  comisionDe,
  construirEnlace,
  resumirPorCanal,
  type Marcaje,
} from './canales.js';

/**
 * Canales de captación y programa de afiliados.
 *
 * Google Ads y Meta Ads no admiten catálogo adulto —no es que sea caro, es que
 * cierran la cuenta—, así que la captación se reparte entre SEO, correo
 * propio, comunidades y afiliados. Este módulo hace las dos cosas que eso
 * exige: medir de dónde vienen las ventas, y pagar a quien las trae.
 *
 * El cálculo de la comisión vive en `canales.ts`, que es puro y está probado
 * caso a caso, porque una comisión mal calculada no da ningún error: se paga y
 * se descubre al cuadrar.
 */
@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** El catálogo de canales con su letra pequeña, para el panel. */
  canales() {
    return CANALES;
  }

  /**
   * Enlace marcado para una campaña.
   *
   * Existe para que nadie tenga que acordarse de la sintaxis de los UTM: uno
   * mal escrito no da ningún error, simplemente hace que esa campaña no salga
   * en el informe y parezca que no funcionó.
   */
  enlace(base: string, marcaje: Marcaje): { enlace: string } {
    try {
      return { enlace: construirEnlace(base, marcaje) };
    } catch {
      throw new BadRequestException('Esa dirección no es válida.');
    }
  }

  /** Ventas por canal en un periodo. */
  async informe(desde?: Date, hasta?: Date) {
    const pedidos = await this.prisma.client.order.findMany({
      where: {
        paymentStatus: 'PAID',
        ...(desde || hasta
          ? { paidAt: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } }
          : {}),
      },
      select: { utmSource: true, totalCents: true },
    });

    return {
      total: pedidos.length,
      canales: resumirPorCanal(
        pedidos.map((p) => ({ fuente: p.utmSource, totalCents: p.totalCents })),
      ),
    };
  }

  // ── Afiliados ─────────────────────────────────────────────

  async listarAfiliados() {
    const afiliados = await this.prisma.client.affiliate.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const totales = await this.prisma.client.affiliateCommission.groupBy({
      by: ['affiliateId', 'status'],
      _count: { _all: true },
      _sum: { amountCents: true },
    });

    return afiliados.map((a) => {
      const suyas = totales.filter((t) => t.affiliateId === a.id);
      const suma = (estado: string) =>
        suyas.find((t) => t.status === estado)?._sum.amountCents ?? 0;

      return {
        id: a.id,
        name: a.name,
        email: a.email,
        code: a.code,
        commissionPercent: Number(a.commissionPercent),
        status: a.status,
        ventas: suyas.reduce((s, t) => s + t._count._all, 0),
        // Separadas a propósito: lo devengado todavía puede anularse por una
        // devolución, y lo pagado ya salió de la cuenta. Sumarlas daría una
        // deuda que no es.
        pendienteCents: suma('PENDIENTE') + suma('APROBADA'),
        pagadoCents: suma('PAGADA'),
      };
    });
  }

  async crearAfiliado(
    datos: {
      name: string;
      email: string;
      code: string;
      commissionPercent: number;
      payoutNotes?: string;
    },
    ctx: ContextoActor,
  ) {
    const afiliado = await this.prisma.client.affiliate.create({
      data: {
        id: newId(),
        name: datos.name,
        email: datos.email.toLowerCase().trim(),
        code: datos.code.toUpperCase(),
        commissionPercent: datos.commissionPercent,
        ...(datos.payoutNotes ? { payoutNotes: datos.payoutNotes } : {}),
      },
    });

    await this.audit.registrar({
      action: 'affiliate.create',
      resource: 'affiliate',
      resourceId: afiliado.id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { code: afiliado.code, commissionPercent: datos.commissionPercent },
    });

    return afiliado;
  }

  async actualizarAfiliado(
    id: string,
    datos: { commissionPercent?: number; status?: string; payoutNotes?: string },
    ctx: ContextoActor,
  ) {
    const antes = await this.prisma.client.affiliate.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException('Ese afiliado no existe.');

    const afiliado = await this.prisma.client.affiliate.update({
      where: { id },
      data: {
        ...(datos.commissionPercent !== undefined
          ? { commissionPercent: datos.commissionPercent }
          : {}),
        ...(datos.status ? { status: datos.status } : {}),
        ...(datos.payoutNotes !== undefined ? { payoutNotes: datos.payoutNotes } : {}),
      },
    });

    await this.audit.registrar({
      action: 'affiliate.update',
      resource: 'affiliate',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      // El porcentaje se audita siempre: es dinero, y cambiarlo sin dejar
      // rastro permitiría subirlo, cobrar y volver a bajarlo.
      before: { commissionPercent: Number(antes.commissionPercent), status: antes.status },
      after: { commissionPercent: Number(afiliado.commissionPercent), status: afiliado.status },
    });

    return afiliado;
  }

  /**
   * Devenga la comisión de un pedido pagado.
   *
   * Se llama al cobrar, no al crear: un pedido sin pagar no genera comisión.
   * Y queda PENDIENTE, no pagada — todavía puede devolverse, y pagar antes de
   * que venza el plazo de desistimiento es regalar el dinero dos veces.
   */
  async devengarComision(orderId: string): Promise<void> {
    const pedido = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: {
        utmSource: true,
        utmCampaign: true,
        discountCents: true,
        items: { select: { totalCents: true, taxRate: true } },
      },
    });

    // El código del afiliado viaja en la campaña: es lo que permite usar el
    // mismo canal 'afiliados' para todos y distinguir quién trajo cada venta.
    if (!pedido?.utmCampaign || pedido.utmSource !== 'afiliados') return;

    const afiliado = await this.prisma.client.affiliate.findUnique({
      where: { code: pedido.utmCampaign.toUpperCase() },
    });

    if (!afiliado || afiliado.status !== 'ACTIVO' || afiliado.deletedAt) return;

    const base = baseComisionable(
      pedido.items.map((i) => ({ totalCents: i.totalCents, taxRate: Number(i.taxRate) })),
      pedido.discountCents,
    );
    const porcentaje = Number(afiliado.commissionPercent);
    const importe = comisionDe(base, porcentaje);

    if (importe <= 0) return;

    // `orderId` es único en la tabla: un webhook de pago repetido no puede
    // devengar la comisión dos veces. Se captura el choque en lugar de
    // comprobarlo antes, que dejaría una carrera entre las dos llamadas.
    await this.prisma.client.affiliateCommission
      .create({
        data: {
          id: newId(),
          affiliateId: afiliado.id,
          orderId,
          baseCents: base,
          percent: porcentaje,
          amountCents: importe,
          status: 'PENDIENTE',
        },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `No se ha devengado la comisión del pedido ${orderId}: ` +
            (error instanceof Error ? error.message : ''),
        );
      });
  }

  /**
   * Anula la comisión de un pedido devuelto o cancelado.
   *
   * Sin esto, una devolución dejaría la comisión viva y se acabaría pagando
   * por una venta que se deshizo.
   */
  async anularComision(orderId: string): Promise<void> {
    await this.prisma.client.affiliateCommission.updateMany({
      where: { orderId, status: { in: ['PENDIENTE', 'APROBADA'] } },
      data: { status: 'ANULADA' },
    });
  }

  /** Comisiones de un afiliado, para revisarlas antes de liquidar. */
  async comisiones(affiliateId: string, estado?: string) {
    return this.prisma.client.affiliateCommission.findMany({
      where: { affiliateId, ...(estado ? { status: estado } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Marca como pagadas las comisiones aprobadas de un afiliado.
   *
   * Solo las APROBADAS: las pendientes son de pedidos que todavía pueden
   * devolverse. La transferencia se hace fuera —no hay pasarela de pagos a
   * terceros— y aquí solo se deja constancia de que se hizo.
   */
  async liquidar(affiliateId: string, ctx: ContextoActor) {
    const pendientes = await this.prisma.client.affiliateCommission.findMany({
      where: { affiliateId, status: 'APROBADA' },
      select: { id: true, amountCents: true },
    });

    if (pendientes.length === 0) {
      throw new BadRequestException(
        'No hay comisiones aprobadas que liquidar. Las pendientes son de pedidos que todavía pueden devolverse.',
      );
    }

    const total = pendientes.reduce((s, c) => s + c.amountCents, 0);

    await this.prisma.client.affiliateCommission.updateMany({
      where: { id: { in: pendientes.map((c) => c.id) } },
      data: { status: 'PAGADA', paidAt: new Date() },
    });

    await this.audit.registrar({
      action: 'affiliate.payout',
      resource: 'affiliate',
      resourceId: affiliateId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      metadata: { comisiones: pendientes.length, totalCents: total },
    });

    return { comisiones: pendientes.length, totalCents: total };
  }

  /**
   * Aprueba las comisiones cuyo pedido ya no puede devolverse.
   *
   * Catorce días desde la entrega es el plazo de desistimiento en España.
   * Aprobar antes sería exponerse a pagar por ventas que van a deshacerse.
   */
  async aprobarVencidas(): Promise<number> {
    const limite = new Date(Date.now() - 14 * 86_400_000);

    const candidatas = await this.prisma.client.affiliateCommission.findMany({
      where: { status: 'PENDIENTE', createdAt: { lt: limite } },
      select: { id: true, orderId: true },
    });

    if (candidatas.length === 0) return 0;

    // Solo las de pedidos que siguen entregados o cerrados: uno cancelado o
    // devuelto no puede aprobarse por el mero paso del tiempo.
    const vivos = await this.prisma.client.order.findMany({
      where: {
        id: { in: candidatas.map((c) => c.orderId) },
        status: { in: ['DELIVERED', 'PENDING_CLOSE', 'CLOSED'] },
      },
      select: { id: true },
    });

    const aprobables = new Set(vivos.map((o) => o.id));
    const ids = candidatas.filter((c) => aprobables.has(c.orderId)).map((c) => c.id);

    if (ids.length === 0) return 0;

    await this.prisma.client.affiliateCommission.updateMany({
      where: { id: { in: ids } },
      data: { status: 'APROBADA' },
    });

    this.logger.log(`${String(ids.length)} comisiones de afiliado aprobadas`);
    return ids.length;
  }
}
