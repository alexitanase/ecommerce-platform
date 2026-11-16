import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { newId } from '@ecom/shared';
import type { Prisma } from '@ecom/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import {
  evaluarCupon,
  mensajeRechazo,
  type Cupon,
  type LineaCarrito,
  type ResultadoCupon,
} from './calculo-cupon.js';

/**
 * Cupones.
 *
 * El cálculo vive en `calculo-cupon.ts`. Aquí está lo que no se puede probar
 * sin base de datos: contar usos sin pasarse cuando llegan pedidos a la vez.
 */
@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async porCodigo(codigo: string) {
    return this.prisma.client.coupon.findFirst({
      where: { code: codigo.trim().toUpperCase(), deletedAt: null },
    });
  }

  /**
   * Comprueba un cupón sin consumirlo, para enseñar el descuento en el carrito.
   *
   * No reserva nada a propósito: si reservara, un carrito abandonado dejaría un
   * uso bloqueado hasta que caducara, y con cupones de tirada corta eso agota
   * la promoción sin una sola venta.
   */
  async comprobar(
    codigo: string,
    lineas: LineaCarrito[],
    subtotalCents: number,
    cliente: { userId?: string; email?: string },
  ): Promise<ResultadoCupon & { mensaje?: string; code?: string }> {
    const cupon = await this.porCodigo(codigo);
    const usos = cupon ? await this.usosDelCliente(cupon.id, cliente) : 0;

    const resultado = evaluarCupon(
      cupon ? this.aDominio(cupon) : null,
      lineas,
      subtotalCents,
      usos,
    );

    if (!resultado.aplicable && resultado.motivo) {
      return {
        ...resultado,
        mensaje: mensajeRechazo(resultado.motivo, cupon ? this.aDominio(cupon) : null),
      };
    }

    return { ...resultado, code: cupon?.code };
  }

  /**
   * Consume el cupón dentro de la transacción del pedido.
   *
   * Aquí está lo delicado. El `updateMany` con la condición del tope en el
   * propio WHERE es lo que hace el conteo seguro: la base decide, en una sola
   * operación atómica, si quedaba hueco. Leer el contador, comprobarlo en
   * memoria y luego escribir deja una ventana entre ambas cosas por la que se
   * cuelan tantos pedidos como lleguen a la vez — y un cupón de 100 usos
   * termina canjeado 300 veces en el minuto en que se publica.
   *
   * @returns el descuento realmente aplicado
   */
  async consumir(
    tx: Prisma.TransactionClient,
    codigo: string,
    orderId: string,
    lineas: LineaCarrito[],
    subtotalCents: number,
    cliente: { userId?: string; email: string },
  ): Promise<{ descuentoCents: number; envioGratis: boolean; couponId: string }> {
    const cupon = await tx.coupon.findFirst({
      where: { code: codigo.trim().toUpperCase(), deletedAt: null },
    });

    if (!cupon) throw new BadRequestException(mensajeRechazo('NO_EXISTE'));

    const usos = await this.usosDelCliente(cupon.id, cliente, tx);
    const resultado = evaluarCupon(this.aDominio(cupon), lineas, subtotalCents, usos);

    if (!resultado.aplicable && resultado.motivo) {
      throw new BadRequestException(mensajeRechazo(resultado.motivo, this.aDominio(cupon)));
    }

    // Incremento condicional: solo prospera si el tope sigue sin alcanzarse.
    const { count } = await tx.coupon.updateMany({
      where: {
        id: cupon.id,
        ...(cupon.maxUses !== null ? { usedCount: { lt: cupon.maxUses } } : {}),
      },
      data: { usedCount: { increment: 1 } },
    });

    if (count === 0) {
      // Otro pedido se llevó el último uso entre la comprobación y ahora.
      throw new BadRequestException(mensajeRechazo('AGOTADO'));
    }

    await tx.couponRedemption.create({
      data: {
        id: newId(),
        couponId: cupon.id,
        orderId,
        userId: cliente.userId ?? null,
        email: cliente.email,
        discountCents: resultado.descuentoCents,
      },
    });

    return {
      descuentoCents: resultado.descuentoCents,
      envioGratis: resultado.envioGratis,
      couponId: cupon.id,
    };
  }

  /**
   * Devuelve el uso al cancelarse el pedido.
   *
   * Sin esto, cancelar consume el cupón igual: el cliente se queda sin
   * descuento y sin poder volver a usarlo, y la promoción pierde usos por
   * pedidos que nunca existieron.
   */
  async devolverUso(orderId: string): Promise<void> {
    const canje = await this.prisma.client.couponRedemption.findFirst({ where: { orderId } });
    if (!canje) return;

    await this.prisma.client.$transaction([
      this.prisma.client.coupon.update({
        where: { id: canje.couponId },
        // No baja de cero aunque algo se descuadre: un contador negativo daría
        // usos infinitos.
        data: { usedCount: { decrement: 1 } },
      }),
      this.prisma.client.couponRedemption.delete({ where: { id: canje.id } }),
    ]);

    this.logger.log(`Uso de cupón devuelto al cancelarse el pedido ${orderId}`);
  }

  /**
   * Cuántas veces ha usado este cupón el cliente.
   *
   * Por usuario si está identificado, y por email si compró como invitado: sin
   * lo segundo, cualquiera repite un cupón de un solo uso comprando sin cuenta.
   */
  private async usosDelCliente(
    couponId: string,
    cliente: { userId?: string; email?: string },
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const cliente_ = tx ?? this.prisma.client;

    const condiciones: Prisma.CouponRedemptionWhereInput[] = [];
    if (cliente.userId) condiciones.push({ userId: cliente.userId });
    if (cliente.email) condiciones.push({ email: cliente.email.toLowerCase() });

    if (condiciones.length === 0) return 0;

    return cliente_.couponRedemption.count({ where: { couponId, OR: condiciones } });
  }

  private aDominio(c: {
    code: string;
    type: string;
    value: number;
    maxDiscountCents: number | null;
    minOrderCents: number;
    maxUses: number | null;
    maxUsesPerCustomer: number;
    usedCount: number;
    validFrom: Date;
    validUntil: Date | null;
    categoryIds: string[];
    excludedProductIds: string[];
    isActive: boolean;
  }): Cupon {
    return { ...c, type: c.type as Cupon['type'] };
  }

  // ── Administración ────────────────────────────────────────

  async listar() {
    const cupones = await this.prisma.client.coupon.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { redemptions: true } } },
    });

    // El descuento total entregado por cada cupón: es lo que dice si la
    // campaña salió a cuenta o solo regaló margen a quien iba a comprar igual.
    const gasto = await this.prisma.client.couponRedemption.groupBy({
      by: ['couponId'],
      _sum: { discountCents: true },
    });
    const porCupon = new Map(gasto.map((g) => [g.couponId, g._sum.discountCents ?? 0]));

    return cupones.map((c) => ({
      ...c,
      canjes: c._count.redemptions,
      descuentoEntregadoCents: porCupon.get(c.id) ?? 0,
    }));
  }

  async crear(
    datos: {
      code: string;
      type: 'PERCENTAGE' | 'FIXED' | 'FREE_SHIPPING';
      value: number;
      maxDiscountCents?: number | null;
      minOrderCents?: number;
      maxUses?: number | null;
      maxUsesPerCustomer?: number;
      validFrom?: string;
      validUntil?: string | null;
      categoryIds?: string[];
      excludedProductIds?: string[];
      internalNote?: string;
    },
    ctx: ContextoActor,
  ) {
    const code = datos.code.trim().toUpperCase();

    const existente = await this.prisma.client.coupon.findUnique({ where: { code } });
    if (existente) throw new BadRequestException(`Ya existe un cupón con el código "${code}"`);

    if (datos.type === 'PERCENTAGE' && (datos.value < 1 || datos.value > 100)) {
      throw new BadRequestException('Un descuento en porcentaje debe estar entre 1 y 100.');
    }

    // Un porcentaje alto sin tope es la forma más rápida de regalar dinero en
    // un pedido grande. Se avisa en vez de impedirlo: puede ser deliberado.
    if (datos.type === 'PERCENTAGE' && datos.value >= 30 && !datos.maxDiscountCents) {
      this.logger.warn(
        `Cupón ${code} con ${datos.value}% y sin tope de descuento: un pedido grande puede llevarse mucho margen`,
      );
    }

    const cupon = await this.prisma.client.coupon.create({
      data: {
        id: newId(),
        code,
        type: datos.type,
        value: datos.value,
        maxDiscountCents: datos.maxDiscountCents ?? null,
        minOrderCents: datos.minOrderCents ?? 0,
        maxUses: datos.maxUses ?? null,
        maxUsesPerCustomer: datos.maxUsesPerCustomer ?? 1,
        ...(datos.validFrom ? { validFrom: new Date(datos.validFrom) } : {}),
        validUntil: datos.validUntil ? new Date(datos.validUntil) : null,
        categoryIds: datos.categoryIds ?? [],
        excludedProductIds: datos.excludedProductIds ?? [],
        internalNote: datos.internalNote ?? null,
      },
    });

    await this.audit.registrar({
      action: 'coupon.create',
      resource: 'coupon',
      resourceId: cupon.id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { code: cupon.code, type: cupon.type, value: cupon.value },
    });

    return cupon;
  }

  async actualizar(
    id: string,
    datos: { isActive?: boolean; validUntil?: string | null; maxUses?: number | null },
    ctx: ContextoActor,
  ) {
    const antes = await this.prisma.client.coupon.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException('Cupón no encontrado');

    const cupon = await this.prisma.client.coupon.update({
      where: { id },
      data: {
        ...(datos.isActive !== undefined ? { isActive: datos.isActive } : {}),
        ...(datos.validUntil !== undefined
          ? { validUntil: datos.validUntil ? new Date(datos.validUntil) : null }
          : {}),
        ...(datos.maxUses !== undefined ? { maxUses: datos.maxUses } : {}),
      },
    });

    await this.audit.registrar({
      action: 'coupon.update',
      resource: 'coupon',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { isActive: antes.isActive, maxUses: antes.maxUses },
      after: { isActive: cupon.isActive, maxUses: cupon.maxUses },
    });

    return cupon;
  }

  async eliminar(id: string, ctx: ContextoActor): Promise<void> {
    // Borrado lógico: los canjes ya hechos apuntan aquí y forman parte del
    // histórico de una campaña. Borrarlo de verdad los dejaría huérfanos.
    await this.prisma.client.coupon.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.registrar({
      action: 'coupon.delete',
      resource: 'coupon',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
    });
  }
}
