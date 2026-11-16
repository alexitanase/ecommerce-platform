import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { InventoryService } from '../catalog/services/inventory.service.js';
import { OutboxService } from '../queue/outbox.service.js';
import { ChannelsService } from '../channels/channels.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import {
  cargaDeLaPruebaDelVendedor,
  enPlazo,
  fechaLimite,
  quienPagaPortes,
  reglasDe,
  resolucionValida,
  vuelveAStock,
  type MotivoDevolucion,
  type Resolucion,
} from './reglas-devolucion.js';

/**
 * Devoluciones (RMA).
 *
 * Las reglas legales viven en `reglas-devolucion.ts`, probadas aparte. Aquí se
 * orquesta el circuito: solicitud, aprobación, recepción y resolución.
 */
@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly outbox: OutboxService,
    private readonly canales: ChannelsService,
  ) {}

  /**
   * Qué puede devolver el cliente y con qué condiciones, por cada motivo.
   *
   * Se le enseñan las condiciones ANTES de elegir: quién paga los portes y
   * hasta cuándo tiene de plazo cambian según el motivo, y descubrirlo después
   * de enviar el paquete es una discusión garantizada.
   */
  async opciones(orderId: string) {
    const pedido = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      include: { items: true, returns: { include: { items: true } } },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const yaDevuelto = new Map<string, number>();
    for (const d of pedido.returns) {
      if (d.status === 'REJECTED' || d.status === 'CANCELLED') continue;
      for (const i of d.items) {
        yaDevuelto.set(i.orderItemId, (yaDevuelto.get(i.orderItemId) ?? 0) + i.quantity);
      }
    }

    const motivos: MotivoDevolucion[] = [
      'DEFECTIVE',
      'NOT_AS_DESCRIBED',
      'DAMAGED_IN_TRANSIT',
      'WRONG_ITEM',
      'MISSING_ITEM',
      'WITHDRAWAL',
    ];

    return {
      entregadoEn: pedido.deliveredAt,
      // La carga de la prueba se le dice también: saber que durante dos años
      // no tiene que demostrar nada le ahorra pensar que no merece la pena.
      pruebaLaAportaElVendedor: cargaDeLaPruebaDelVendedor(pedido.deliveredAt),
      motivos: motivos.map((motivo) => ({
        motivo,
        enPlazo: enPlazo(motivo, pedido.deliveredAt),
        fechaLimite: fechaLimite(motivo, pedido.deliveredAt),
        portesLosPaga: quienPagaPortes(motivo),
        remedios: reglasDe(motivo).remedios,
      })),
      lineas: pedido.items.map((item) => ({
        orderItemId: item.id,
        nombre: item.name,
        variante: item.variantName,
        sku: item.sku,
        imagen: item.imageUrl,
        cantidadComprada: item.quantity,
        cantidadDevolvible: Math.max(0, item.quantity - (yaDevuelto.get(item.id) ?? 0)),
        totalCents: item.totalCents,
      })),
      solicitudes: pedido.returns.map((d) => ({
        numero: d.number,
        motivo: d.reason,
        estado: d.status,
        resolucion: d.resolution,
        creadaEn: d.createdAt,
      })),
    };
  }

  /**
   * Correlativo propio de las devoluciones.
   *
   * Es el identificador que se le da al cliente y el que viaja en el paquete de
   * vuelta: un bulto sin él es imposible de asociar a nadie cuando llega.
   */
  private async siguienteNumero(): Promise<string> {
    const anio = new Date().getFullYear();
    const prefijo = `RMA-${anio}-`;

    const ultima = await this.prisma.client.returnRequest.findFirst({
      where: { number: { startsWith: prefijo } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const siguiente = ultima ? Number(ultima.number.slice(prefijo.length)) + 1 : 1;
    return `${prefijo}${String(siguiente).padStart(6, '0')}`;
  }

  async solicitar(
    orderId: string,
    datos: {
      motivo: MotivoDevolucion;
      lineas: { orderItemId: string; quantity: number }[];
      nota?: string;
      fotos?: string[];
    },
  ) {
    const pedido = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (pedido.paymentStatus !== 'PAID') {
      throw new BadRequestException('No se puede devolver un pedido que aún no está pagado.');
    }

    if (!enPlazo(datos.motivo, pedido.deliveredAt)) {
      const limite = fechaLimite(datos.motivo, pedido.deliveredAt);
      throw new BadRequestException(
        `El plazo para este tipo de devolución terminó el ${
          limite?.toLocaleDateString('es-ES') ?? '—'
        }.`,
      );
    }

    // Un defecto sin describir es imposible de gestionar: ni se puede reclamar
    // al proveedor ni decidir entre reparar y sustituir.
    if (datos.motivo === 'DEFECTIVE' && !datos.nota?.trim()) {
      throw new BadRequestException(
        'Cuéntanos qué le pasa al producto: sin esa información no podemos tramitarlo.',
      );
    }

    const lineasValidas: { orderItemId: string; quantity: number; refundCents: number }[] = [];

    for (const solicitud of datos.lineas) {
      const item = pedido.items.find((i) => i.id === solicitud.orderItemId);
      if (!item) continue;

      const cantidad = Math.min(Math.max(1, solicitud.quantity), item.quantity);
      lineasValidas.push({
        orderItemId: item.id,
        quantity: cantidad,
        refundCents:
          cantidad === item.quantity
            ? item.totalCents
            : Math.round((item.totalCents / item.quantity) * cantidad),
      });
    }

    if (lineasValidas.length === 0) {
      throw new BadRequestException('No hay ninguna línea válida en la solicitud.');
    }

    const id = newId();
    const numero = await this.siguienteNumero();
    const total = lineasValidas.reduce((a, l) => a + l.refundCents, 0);

    const solicitud = await this.prisma.client.$transaction(async (tx) => {
      const creada = await tx.returnRequest.create({
        data: {
          id,
          number: numero,
          orderId,
          reason: datos.motivo,
          status: 'REQUESTED',
          customerNote: datos.nota ?? null,
          photoUrls: datos.fotos ?? [],
          returnShippingPaidBy: quienPagaPortes(datos.motivo),
          refundAmountCents: total,
        },
      });

      await tx.returnItem.createMany({
        data: lineasValidas.map((l) => ({
          id: newId(),
          returnId: id,
          orderItemId: l.orderItemId,
          quantity: l.quantity,
          refundCents: l.refundCents,
        })),
      });

      await tx.orderEvent.create({
        data: {
          id: newId(),
          orderId,
          type: 'order.return_requested',
          description: `Devolución ${numero} solicitada · ${datos.motivo}`,
          actorType: 'customer',
        },
      });

      return creada;
    });

    this.logger.log(`Devolución ${numero} del pedido ${pedido.number} · ${datos.motivo}`);

    return {
      numero: solicitud.number,
      estado: solicitud.status,
      motivo: solicitud.reason,
      portesLosPaga: solicitud.returnShippingPaidBy,
      reembolsoEstimadoCents: total,
      remediosPosibles: reglasDe(datos.motivo).remedios,
      pruebaLaAportaElVendedor: cargaDeLaPruebaDelVendedor(pedido.deliveredAt),
    };
  }

  // ── Gestión ───────────────────────────────────────────────

  async listar(estado?: string) {
    return this.prisma.client.returnRequest.findMany({
      where: estado ? { status: estado as never } : {},
      include: {
        items: true,
        order: { select: { number: true, email: true, deliveredAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async aprobar(numero: string, ctx: ContextoActor) {
    const solicitud = await this.exigir(numero);

    if (solicitud.status !== 'REQUESTED') {
      throw new BadRequestException('Esta devolución ya se ha tramitado.');
    }

    const actualizada = await this.prisma.client.returnRequest.update({
      where: { id: solicitud.id },
      data: { status: 'APPROVED', approvedAt: new Date(), handledBy: ctx.actorId ?? null },
    });

    await this.registrarCambio(solicitud.id, solicitud.status, 'APPROVED', ctx);
    return actualizada;
  }

  /**
   * Anota lo que ha llegado y en qué estado.
   *
   * Aquí se decide si cada unidad vuelve al catálogo. Reponer sin mirar pone a
   * la venta lo que sea, incluido lo que el cliente devolvió por defectuoso.
   */
  async recibir(
    numero: string,
    lineas: { orderItemId: string; condicion: string }[],
    ctx: ContextoActor,
  ) {
    const solicitud = await this.exigir(numero);

    const pedido = await this.prisma.client.order.findUniqueOrThrow({
      where: { id: solicitud.orderId },
      include: { items: { select: { id: true, variantId: true } } },
    });

    const aReponer: { variantId: string; quantity: number }[] = [];

    for (const item of solicitud.items) {
      const recibido = lineas.find((l) => l.orderItemId === item.orderItemId);
      const condicion = recibido?.condicion ?? null;
      const repone = vuelveAStock(solicitud.reason, condicion);

      await this.prisma.client.returnItem.update({
        where: { id: item.id },
        data: { condition: condicion, restocked: repone },
      });

      if (repone) {
        const linea = pedido.items.find((i) => i.id === item.orderItemId);
        if (linea?.variantId) {
          aReponer.push({ variantId: linea.variantId, quantity: item.quantity });
        }
      }
    }

    if (aReponer.length > 0) {
      await this.inventory.devolverPorDevolucion(solicitud.id, aReponer);
    }

    const actualizada = await this.prisma.client.returnRequest.update({
      where: { id: solicitud.id },
      data: { status: 'RECEIVED', receivedAt: new Date(), handledBy: ctx.actorId ?? null },
    });

    await this.registrarCambio(solicitud.id, solicitud.status, 'RECEIVED', ctx);

    return { ...actualizada, unidadesRepuestas: aReponer.reduce((a, l) => a + l.quantity, 0) };
  }

  /**
   * Cierra la devolución con una resolución.
   *
   * La resolución tiene que ser de las que el motivo admite: ofrecer una
   * reparación a quien desiste es negarle el dinero al que tiene derecho.
   */
  async resolver(
    numero: string,
    resolucion: Resolucion,
    ctx: ContextoActor,
    opciones: { importeCents?: number; motivoRechazo?: string } = {},
  ) {
    const solicitud = await this.exigir(numero);
    const motivo = solicitud.reason;

    if (!resolucionValida(motivo, resolucion)) {
      throw new BadRequestException(
        `La resolución "${resolucion}" no es aplicable a una devolución por ${motivo}. ` +
          `Admite: ${reglasDe(motivo).remedios.join(', ')}.`,
      );
    }

    if (resolucion === 'REJECTED' && !opciones.motivoRechazo) {
      throw new BadRequestException('Rechazar una devolución exige indicar el motivo por escrito.');
    }

    const importe = opciones.importeCents ?? solicitud.refundAmountCents;

    if (importe > solicitud.refundAmountCents) {
      throw new BadRequestException(
        'El importe a devolver no puede superar el de las líneas devueltas.',
      );
    }

    const actualizada = await this.prisma.client.$transaction(async (tx) => {
      const r = await tx.returnRequest.update({
        where: { id: solicitud.id },
        data: {
          status: resolucion === 'REJECTED' ? 'REJECTED' : 'RESOLVED',
          resolution: resolucion,
          resolvedAt: new Date(),
          refundAmountCents: resolucion === 'REJECTED' ? 0 : importe,
          rejectionReason: opciones.motivoRechazo ?? null,
          handledBy: ctx.actorId ?? null,
        },
      });

      // El reembolso va por el outbox: si la pasarela tarda o falla, la
      // devolución ya está resuelta y el pago se reintenta solo.
      if (resolucion === 'REFUND' || resolucion === 'PRICE_REDUCTION') {
        await this.outbox.registrar(tx, {
          eventType: 'order.refund_requested',
          aggregateType: 'order',
          aggregateId: solicitud.orderId,
          payload: {
            orderId: solicitud.orderId,
            motivo: `Devolución ${solicitud.number}`,
            importeCents: importe,
          },
        });
      }

      return r;
    });

    // La comisión del afiliado se anula solo si vuelve el pedido entero. Una
    // devolución parcial no la toca: el afiliado trajo una venta que en su
    // mayor parte sigue en pie, y quitársela completa sería cobrarle a él el
    // problema de una línea.
    if (resolucion === 'REFUND') {
      const pedido = await this.prisma.client.order.findUnique({
        where: { id: solicitud.orderId },
        select: { totalCents: true },
      });

      if (pedido && importe >= pedido.totalCents) {
        await this.canales.anularComision(solicitud.orderId).catch((error: unknown) => {
          this.logger.error(
            `No se pudo anular la comisión de la devolución ${solicitud.number}: ` +
              (error instanceof Error ? error.message : String(error)),
          );
        });
      }
    }

    await this.registrarCambio(solicitud.id, solicitud.status, actualizada.status, ctx, {
      resolucion,
      importeCents: importe,
    });

    return actualizada;
  }

  /** Anota la referencia de la reclamación abierta al proveedor. */
  async anotarReclamacionProveedor(numero: string, referencia: string) {
    const solicitud = await this.exigir(numero);

    return this.prisma.client.returnRequest.update({
      where: { id: solicitud.id },
      data: { supplierClaimRef: referencia },
    });
  }

  private async exigir(numero: string) {
    const solicitud = await this.prisma.client.returnRequest.findUnique({
      where: { number: numero },
      include: { items: true },
    });

    if (!solicitud) throw new NotFoundException('Devolución no encontrada');
    return solicitud;
  }

  private async registrarCambio(
    id: string,
    antes: string,
    despues: string,
    ctx: ContextoActor,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.registrar({
      action: 'return.status_change',
      resource: 'return',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { estado: antes },
      after: { estado: despues },
      ...(extra ? { metadata: extra } : {}),
    });
  }
}
