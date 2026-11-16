import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { newId, type Locale } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { formularioDesistimiento } from './formulario-modelo.js';
import {
  diasRestantes,
  enPlazo,
  evaluarLineas,
  fechaLimite,
  fechaLimiteReembolso,
  reembolsoDeEnvio,
  type LineaDesistible,
  type LineaSolicitada,
  type MotivoExencion,
} from './plazo-desistimiento.js';

/**
 * Derecho de desistimiento.
 *
 * El cómputo de plazos vive en `plazo-desistimiento.ts`, probado aparte. Aquí
 * se orquesta y se deja rastro de todo: una devolución denegada acaba a veces
 * en una reclamación al consumo, y entonces hay que poder demostrar cuándo lo
 * comunicó el cliente, qué se le contestó y por qué.
 */
@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Qué puede devolver el cliente de un pedido, y hasta cuándo.
   *
   * Se consulta desde la página de seguimiento para que vea su plazo sin tener
   * que preguntarlo: informar es obligatorio, y no hacerlo alarga el plazo a
   * un año.
   */
  async elegibilidad(orderId: string) {
    const pedido = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        withdrawals: { include: { items: true } },
      },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const exenciones = await this.exencionesDe(pedido.items);

    // Lo ya solicitado no se puede volver a solicitar.
    const yaSolicitado = new Map<string, number>();
    for (const w of pedido.withdrawals) {
      if (w.status === 'REJECTED' || w.status === 'CANCELLED') continue;
      for (const i of w.items) {
        yaSolicitado.set(i.orderItemId, (yaSolicitado.get(i.orderItemId) ?? 0) + i.quantity);
      }
    }

    const lineas = pedido.items.map((item) => {
      const usadas = yaSolicitado.get(item.id) ?? 0;
      return {
        orderItemId: item.id,
        nombre: item.name,
        variante: item.variantName,
        sku: item.sku,
        imagen: item.imageUrl,
        cantidadComprada: item.quantity,
        cantidadDevolvible: Math.max(0, item.quantity - usadas),
        totalCents: item.totalCents,
        exencion: exenciones.get(item.productId ?? '') ?? null,
      };
    });

    return {
      entregadoEn: pedido.deliveredAt,
      fechaLimite: fechaLimite(pedido.deliveredAt),
      diasRestantes: diasRestantes(pedido.deliveredAt),
      enPlazo: enPlazo(pedido.deliveredAt),
      // No se puede desistir de lo que aún no se ha pagado.
      pagado: pedido.paymentStatus === 'PAID',
      lineas,
      solicitudes: pedido.withdrawals.map((w) => ({
        id: w.id,
        estado: w.status,
        comunicadoEn: w.requestedAt,
        reembolsoCents: w.refundAmountCents + w.refundShippingCents,
      })),
    };
  }

  /**
   * El cliente comunica que desiste.
   *
   * La fecha de esta llamada es el dato jurídicamente relevante: detiene el
   * plazo de 14 días y arranca el de otros 14 para reembolsarle.
   */
  async solicitar(
    orderId: string,
    datos: { lineas: LineaSolicitada[]; motivo?: string; nota?: string },
  ) {
    const pedido = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (pedido.paymentStatus !== 'PAID') {
      throw new BadRequestException('No se puede desistir de un pedido que aún no está pagado.');
    }

    if (!enPlazo(pedido.deliveredAt)) {
      const limite = fechaLimite(pedido.deliveredAt);
      throw new BadRequestException(
        `El plazo de desistimiento terminó el ${limite?.toLocaleDateString('es-ES') ?? '—'}.`,
      );
    }

    const exenciones = await this.exencionesDe(pedido.items);

    const disponibles: LineaDesistible[] = pedido.items.map((i) => ({
      orderItemId: i.id,
      quantity: i.quantity,
      totalCents: i.totalCents,
      exencion: exenciones.get(i.productId ?? '') ?? null,
    }));

    const evaluacion = evaluarLineas(disponibles, datos.lineas);

    if (evaluacion.aceptadas.length === 0) {
      const exentas = evaluacion.rechazadas.filter((r) => r.motivo === 'EXENTO').length;
      throw new BadRequestException(
        exentas > 0
          ? 'Los productos seleccionados están excluidos del derecho de desistimiento por razones de higiene o por estar personalizados.'
          : 'No hay ninguna línea válida en la solicitud.',
      );
    }

    // Total solo si se devuelve todo lo que se compró: solo entonces se
    // reembolsa el envío de ida.
    const unidadesPedido = pedido.items.reduce((a, i) => a + i.quantity, 0);
    const unidadesDevueltas = evaluacion.aceptadas.reduce((a, l) => a + l.quantity, 0);
    const esTotal = unidadesDevueltas === unidadesPedido;

    // Con el envío estándar como tope: si eligió urgente, la diferencia la
    // eligió él y no se le devuelve.
    const envioEstandar = await this.envioEstandarDe(pedido.shippingAddress);
    const reembolsoEnvio = reembolsoDeEnvio(pedido.shippingCents, envioEstandar, esTotal);

    const solicitudId = newId();
    const ahora = new Date();

    const solicitud = await this.prisma.client.$transaction(async (tx) => {
      const creada = await tx.withdrawalRequest.create({
        data: {
          id: solicitudId,
          orderId,
          status: 'REQUESTED',
          requestedAt: ahora,
          // Se guarda el límite que tenía, no se recalcula después: si algún
          // día cambian las reglas, esta solicitud se juzga con las de hoy.
          deadlineAt: fechaLimite(pedido.deliveredAt) ?? fechaLimiteReembolso(ahora),
          reason: datos.motivo ?? null,
          customerNote: datos.nota ?? null,
          refundAmountCents: evaluacion.reembolsoProductosCents,
          refundShippingCents: reembolsoEnvio,
        },
      });

      await tx.withdrawalItem.createMany({
        data: evaluacion.aceptadas.map((l) => ({
          id: newId(),
          withdrawalId: solicitudId,
          orderItemId: l.orderItemId,
          quantity: l.quantity,
          refundCents: l.refundCents,
        })),
      });

      await tx.orderEvent.create({
        data: {
          id: newId(),
          orderId,
          type: 'order.withdrawal_requested',
          description:
            `Desistimiento comunicado · ${evaluacion.aceptadas.length} línea(s) · ` +
            `${((evaluacion.reembolsoProductosCents + reembolsoEnvio) / 100).toFixed(2)} €`,
          actorType: 'customer',
        },
      });

      return creada;
    });

    this.logger.log(
      `Desistimiento ${solicitudId} del pedido ${pedido.number}: ` +
        `${((solicitud.refundAmountCents + solicitud.refundShippingCents) / 100).toFixed(2)} € a devolver`,
    );

    return {
      id: solicitud.id,
      estado: solicitud.status,
      comunicadoEn: solicitud.requestedAt,
      reembolsoProductosCents: solicitud.refundAmountCents,
      reembolsoEnvioCents: solicitud.refundShippingCents,
      reembolsoTotalCents: solicitud.refundAmountCents + solicitud.refundShippingCents,
      // Se le dice desde el primer momento: es su garantía y nuestro plazo.
      fechaLimiteReembolso: fechaLimiteReembolso(solicitud.requestedAt),
      rechazadas: evaluacion.rechazadas,
    };
  }

  /**
   * Excepciones al desistimiento de los productos de un pedido.
   *
   * En consulta aparte porque OrderItem guarda `productId` suelto, sin
   * relación: es lo que permite archivar un producto sin romper los pedidos
   * que lo contienen. Si el producto ya no existe, no hay excepción que
   * aplicar y el cliente puede devolver.
   */
  private async exencionesDe(
    items: { productId: string | null }[],
  ): Promise<Map<string, MotivoExencion | null>> {
    const ids = [...new Set(items.map((i) => i.productId).filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();

    const productos = await this.prisma.client.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, withdrawalExemption: true },
    });

    return new Map(productos.map((p) => [p.id, p.withdrawalExemption]));
  }

  /**
   * Coste del envío estándar al destino del pedido.
   *
   * Se consulta la tarifa más barata de su zona, que es la "modalidad ordinaria"
   * a efectos del art. 107.2.
   */
  private async envioEstandarDe(direccion: unknown): Promise<number> {
    const dir = direccion as { countryCode?: string; postalCode?: string } | null;
    if (!dir?.postalCode) return 0;

    const zonas = await this.prisma.client.shippingZone.findMany({
      where: { isActive: true, deletedAt: null },
      include: { rates: { where: { isActive: true, deletedAt: null } } },
      orderBy: { priority: 'desc' },
    });

    const cp = dir.postalCode.replace(/[\s-]/g, '').toUpperCase();
    const pais = (dir.countryCode ?? 'ES').toUpperCase();

    const zona = zonas.find(
      (z) =>
        z.countries.includes(pais) &&
        !z.excludedPostalPrefixes.some((p) => cp.startsWith(p)) &&
        (z.postalPrefixes.length === 0 || z.postalPrefixes.some((p) => cp.startsWith(p))),
    );

    if (!zona || zona.rates.length === 0) return 0;

    return Math.min(...zona.rates.map((r) => r.priceCents));
  }

  /**
   * Formulario modelo con los datos del pedido ya rellenos.
   *
   * Facilitarlo es obligatorio; no hacerlo alarga el plazo del cliente a doce
   * meses. Se genera con los datos fiscales configurados en el admin, así que
   * no hay que mantener un PDF aparte que se quede desactualizado.
   */
  async formularioPara(tokenPedido: string, locale: Locale = 'es'): Promise<string> {
    const pedido = await this.prisma.client.order.findUnique({
      where: { publicToken: tokenPedido },
      select: { number: true, createdAt: true, deliveredAt: true },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    // Las mismas claves que usa la facturación: los datos del emisor son los
    // mismos y tenerlos duplicados acabaría con un formulario que dice una
    // razón social y una factura que dice otra.
    const ajustes = await this.settings.publicos();
    const valor = (clave: string): string =>
      typeof ajustes[clave] === 'string' ? ajustes[clave] : '';

    return formularioDesistimiento(
      {
        razonSocial: valor('legal.companyName') || 'La tienda',
        nif: valor('legal.taxId'),
        domicilio: valor('legal.address'),
        email: valor('shop.contactEmail'),
        telefono: valor('shop.phone') || null,
      },
      { numero: pedido.number, fechaPedido: pedido.createdAt, fechaEntrega: pedido.deliveredAt },
      locale,
    );
  }

  // ── Gestión desde el admin ────────────────────────────────

  async listar(estado?: string) {
    return this.prisma.client.withdrawalRequest.findMany({
      where: estado ? { status: estado as never } : {},
      include: {
        items: true,
        order: { select: { number: true, email: true, totalCents: true, deliveredAt: true } },
      },
      orderBy: { requestedAt: 'asc' },
    });
  }

  async cambiarEstado(
    id: string,
    nuevo: 'ACCEPTED' | 'RECEIVED' | 'REFUNDED' | 'REJECTED' | 'CANCELLED',
    ctx: ContextoActor,
    motivoRechazo?: string,
  ) {
    const solicitud = await this.prisma.client.withdrawalRequest.findUnique({
      where: { id },
      include: { order: { select: { number: true } } },
    });

    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');

    // Rechazar sin motivo deja al cliente sin saber por qué y a nosotros sin
    // nada que enseñar si reclama.
    if (nuevo === 'REJECTED' && !motivoRechazo) {
      throw new BadRequestException('Rechazar un desistimiento exige indicar el motivo.');
    }

    // Marcar "reembolsado" es declarar cumplida una obligación legal con plazo.
    // Sin esta comprobación basta un clic para darla por cumplida sin que haya
    // salido un euro, y el descuadre solo aparece cuando el cliente reclama —o
    // cuando lo hace Consumo.
    if (nuevo === 'REFUNDED') {
      const devuelto = await this.reembolsadoDe(solicitud.orderId);
      const debido = solicitud.refundAmountCents + solicitud.refundShippingCents;

      if (devuelto < debido) {
        throw new BadRequestException(
          `No se puede marcar como reembolsado: se han devuelto ` +
            `${(devuelto / 100).toFixed(2).replace('.', ',')} € de los ` +
            `${(debido / 100).toFixed(2).replace('.', ',')} € que corresponden. ` +
            'Tramita el reembolso antes de cerrar el desistimiento.',
        );
      }
    }

    const actualizada = await this.prisma.client.withdrawalRequest.update({
      where: { id },
      data: {
        status: nuevo,
        ...(nuevo === 'RECEIVED' ? { receivedAt: new Date() } : {}),
        ...(nuevo === 'REFUNDED' ? { refundedAt: new Date() } : {}),
        ...(motivoRechazo ? { rejectionReason: motivoRechazo } : {}),
        handledBy: ctx.actorId ?? null,
      },
    });

    await this.audit.registrar({
      action: 'withdrawal.status_change',
      resource: 'withdrawal',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { estado: solicitud.status },
      after: { estado: nuevo },
      metadata: { pedido: solicitud.order.number, motivo: motivoRechazo },
    });

    return actualizada;
  }

  /**
   * Cuánto se ha devuelto ya de un pedido, solo reembolsos completados.
   *
   * Los que están pedidos o en curso no cuentan: mientras el dinero no haya
   * salido, la obligación sigue pendiente.
   */
  private async reembolsadoDe(orderId: string): Promise<number> {
    const reembolsos = await this.prisma.client.refund.findMany({
      where: { payment: { orderId }, status: 'COMPLETED' },
      select: { amountCents: true },
    });

    return reembolsos.reduce((a, r) => a + r.amountCents, 0);
  }

  /**
   * Solicitudes cuyo plazo de reembolso está a punto de vencer.
   *
   * Pasarse de los 14 días es incumplir, y no hay aviso automático que lo
   * recuerde: por eso existe esta consulta para el panel del admin.
   */
  async reembolsosUrgentes(diasAviso = 3) {
    const limite = new Date();
    limite.setDate(limite.getDate() - (14 - diasAviso));

    return this.prisma.client.withdrawalRequest.findMany({
      where: {
        status: { in: ['REQUESTED', 'ACCEPTED', 'RECEIVED'] },
        requestedAt: { lte: limite },
      },
      include: { order: { select: { number: true, email: true } } },
      orderBy: { requestedAt: 'asc' },
    });
  }
}
