import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DEFAULT_LOCALE, newId, type Locale } from '@ecom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { StockMovementReason } from '@ecom/db';

/** Cuánto dura una reserva de carrito antes de liberarse sola. */
const MINUTOS_RESERVA = 20;

export interface DisponibilidadVariante {
  variantId: string;
  stock: number;
  reservado: number;
  disponible: number;
  permiteBackorder: boolean;
}

/**
 * Control de stock.
 *
 * La cifra que importa no es `stock`, sino `stock - reservas activas`. Sin
 * reservas, dos clientes pueden pagar a la vez la última unidad: uno recibe su
 * pedido y el otro se queda esperando un paquete que nunca saldrá, con el
 * cobro ya hecho y una devolución garantizada.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async disponibilidad(variantIds: string[]): Promise<Map<string, DisponibilidadVariante>> {
    const variantes = await this.prisma.client.productVariant.findMany({
      where: { id: { in: variantIds }, deletedAt: null },
      select: { id: true, stock: true, allowBackorder: true },
    });

    const reservas = await this.prisma.client.stockReservation.groupBy({
      by: ['variantId'],
      where: { variantId: { in: variantIds }, expiresAt: { gt: new Date() } },
      _sum: { quantity: true },
    });

    const reservadoPor = new Map(reservas.map((r) => [r.variantId, r._sum.quantity ?? 0]));

    return new Map(
      variantes.map((v) => {
        const reservado = reservadoPor.get(v.id) ?? 0;
        return [
          v.id,
          {
            variantId: v.id,
            stock: v.stock,
            reservado,
            disponible: Math.max(0, v.stock - reservado),
            permiteBackorder: v.allowBackorder,
          },
        ];
      }),
    );
  }

  /**
   * Reserva stock para un carrito.
   *
   * La comprobación y la reserva van dentro de una transacción con bloqueo de
   * fila (`SELECT … FOR UPDATE`). Comprobar y después insertar sin bloqueo deja
   * una ventana en la que dos peticiones simultáneas leen "queda 1" y ambas
   * reservan: es el caso clásico que aparece justo en los picos de campaña.
   */
  async reservar(
    cartId: string,
    lineas: { variantId: string; quantity: number }[],
  ): Promise<
    { ok: true } | { ok: false; insuficientes: { variantId: string; disponible: number }[] }
  > {
    return this.prisma.client.$transaction(async (tx) => {
      const insuficientes: { variantId: string; disponible: number }[] = [];

      for (const linea of lineas) {
        const [fila] = await tx.$queryRaw<{ stock: number; allowBackorder: boolean }[]>`
          SELECT stock, "allowBackorder" FROM product_variants
          WHERE id = ${linea.variantId} AND "deletedAt" IS NULL
          FOR UPDATE
        `;

        if (!fila) {
          insuficientes.push({ variantId: linea.variantId, disponible: 0 });
          continue;
        }

        const [agregado] = await tx.$queryRaw<{ total: bigint | null }[]>`
          SELECT COALESCE(SUM(quantity), 0)::bigint AS total FROM stock_reservations
          WHERE "variantId" = ${linea.variantId}
            AND "expiresAt" > NOW()
            AND ("cartId" IS DISTINCT FROM ${cartId})
        `;

        const reservadoPorOtros = Number(agregado?.total ?? 0);
        const disponible = fila.stock - reservadoPorOtros;

        if (!fila.allowBackorder && disponible < linea.quantity) {
          insuficientes.push({ variantId: linea.variantId, disponible: Math.max(0, disponible) });
        }
      }

      if (insuficientes.length > 0) {
        return { ok: false as const, insuficientes };
      }

      // Se reemplazan las reservas previas del carrito para que actualizar la
      // cantidad no acumule reservas duplicadas.
      await tx.stockReservation.deleteMany({ where: { cartId } });

      const expiresAt = new Date(Date.now() + MINUTOS_RESERVA * 60_000);
      await tx.stockReservation.createMany({
        data: lineas.map((l) => ({
          id: newId(),
          variantId: l.variantId,
          cartId,
          quantity: l.quantity,
          expiresAt,
        })),
      });

      return { ok: true as const };
    });
  }

  async liberarReservas(cartId: string): Promise<number> {
    const { count } = await this.prisma.client.stockReservation.deleteMany({ where: { cartId } });
    return count;
  }

  /**
   * Confirma la venta: descuenta stock de verdad y elimina la reserva.
   * Se ejecuta cuando el pago está confirmado, no antes.
   */
  async confirmarVenta(
    cartId: string,
    orderId: string,
    lineas: { variantId: string; quantity: number }[],
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      for (const linea of lineas) {
        const variante = await tx.productVariant.update({
          where: { id: linea.variantId },
          data: { stock: { decrement: linea.quantity } },
          select: { stock: true },
        });

        await tx.stockMovement.create({
          data: {
            id: newId(),
            variantId: linea.variantId,
            delta: -linea.quantity,
            stockAfter: variante.stock,
            reason: 'PURCHASE',
            reference: orderId,
          },
        });
      }

      await tx.stockReservation.deleteMany({ where: { cartId } });
    });
  }

  /**
   * Devuelve al stock las unidades de un pedido cancelado.
   *
   * Sin esto, cancelar deja las unidades descontadas para siempre: el producto
   * figura agotado sin estarlo y se pierden ventas sin que nada lo delate.
   *
   * Es idempotente por diseño: comprueba que no haya ya un movimiento de
   * cancelación para ese pedido. Cancelar dos veces —un doble clic, un
   * reintento del worker— inflaría el inventario con unidades que no existen.
   */
  async devolverPorCancelacion(
    orderId: string,
    lineas: { variantId: string; quantity: number }[],
  ): Promise<{ devueltas: number; yaHecho: boolean }> {
    const yaDevuelto = await this.prisma.client.stockMovement.findFirst({
      where: { reference: orderId, reason: 'CANCELLATION' },
      select: { id: true },
    });

    if (yaDevuelto) {
      this.logger.warn(`El stock del pedido ${orderId} ya se había devuelto; no se repite`);
      return { devueltas: 0, yaHecho: true };
    }

    let devueltas = 0;

    await this.prisma.client.$transaction(async (tx) => {
      for (const linea of lineas) {
        const variante = await tx.productVariant.update({
          where: { id: linea.variantId },
          data: { stock: { increment: linea.quantity } },
          select: { stock: true },
        });

        await tx.stockMovement.create({
          data: {
            id: newId(),
            variantId: linea.variantId,
            delta: linea.quantity,
            stockAfter: variante.stock,
            reason: 'CANCELLATION',
            reference: orderId,
          },
        });

        devueltas += linea.quantity;
      }
    });

    this.logger.log(`Devueltas ${devueltas} unidades al stock por cancelar ${orderId}`);
    return { devueltas, yaHecho: false };
  }

  /**
   * Devuelve al stock lo que ha vuelto de una devolución.
   *
   * Solo llega aquí lo que ya se ha decidido que puede volver al catálogo: un
   * producto defectuoso no repone nunca, y uno en desistimiento solo si llegó
   * como salió. Esa decisión se toma al recibirlo, no aquí.
   *
   * Idempotente por el mismo motivo que la cancelación: reintentar no puede
   * inflar el inventario con unidades que no existen.
   */
  async devolverPorDevolucion(
    returnId: string,
    lineas: { variantId: string; quantity: number }[],
  ): Promise<{ devueltas: number; yaHecho: boolean }> {
    const yaDevuelto = await this.prisma.client.stockMovement.findFirst({
      where: { reference: returnId, reason: 'RETURN' },
      select: { id: true },
    });

    if (yaDevuelto) {
      this.logger.warn(`El stock de la devolución ${returnId} ya se había repuesto`);
      return { devueltas: 0, yaHecho: true };
    }

    let devueltas = 0;

    await this.prisma.client.$transaction(async (tx) => {
      for (const linea of lineas) {
        const variante = await tx.productVariant.update({
          where: { id: linea.variantId },
          data: { stock: { increment: linea.quantity } },
          select: { stock: true },
        });

        await tx.stockMovement.create({
          data: {
            id: newId(),
            variantId: linea.variantId,
            delta: linea.quantity,
            stockAfter: variante.stock,
            reason: 'RETURN',
            reference: returnId,
          },
        });

        devueltas += linea.quantity;
      }
    });

    this.logger.log(`Repuestas ${devueltas} unidades por la devolución ${returnId}`);
    return { devueltas, yaHecho: false };
  }

  /** Ajuste manual o por sincronización con el proveedor. */
  async ajustar(
    variantId: string,
    nuevoStock: number,
    motivo: StockMovementReason,
    opciones: { nota?: string; actorId?: string; referencia?: string } = {},
  ) {
    if (nuevoStock < 0) throw new BadRequestException('El stock no puede ser negativo');

    const variante = await this.prisma.client.productVariant.findUnique({
      where: { id: variantId },
      select: { stock: true, sku: true, lowStockAlert: true },
    });
    if (!variante) throw new NotFoundException('Variante no encontrada');

    const delta = nuevoStock - variante.stock;
    if (delta === 0) return { variantId, stock: nuevoStock, sinCambios: true };

    await this.prisma.client.$transaction([
      this.prisma.client.productVariant.update({
        where: { id: variantId },
        data: { stock: nuevoStock },
      }),
      this.prisma.client.stockMovement.create({
        data: {
          id: newId(),
          variantId,
          delta,
          stockAfter: nuevoStock,
          reason: motivo,
          note: opciones.nota ?? null,
          reference: opciones.referencia ?? null,
          actorId: opciones.actorId ?? null,
        },
      }),
    ]);

    if (nuevoStock <= variante.lowStockAlert) {
      // TODO(Fase 7): avisar al equipo por email o Slack.
      this.logger.warn(`Stock bajo en ${variante.sku}: quedan ${nuevoStock} unidades`);
    }

    return { variantId, stock: nuevoStock, delta };
  }

  async historial(variantId: string, limite = 50) {
    return this.prisma.client.stockMovement.findMany({
      where: { variantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limite, 200),
    });
  }

  async stockBajo(umbralExtra = 0, locale: Locale = DEFAULT_LOCALE) {
    const variantes = await this.prisma.client.productVariant.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        sku: true,
        stock: true,
        lowStockAlert: true,
        product: {
          select: {
            id: true,
            handle: true,
            // Se filtra por idioma: sin el `where`, Prisma devuelve una
            // traducción cualquiera y el aviso sale en el idioma equivocado.
            translations: { where: { locale }, select: { name: true } },
          },
        },
      },
    });

    return variantes
      .filter((v) => v.stock <= v.lowStockAlert + umbralExtra)
      .map((v) => ({
        variantId: v.id,
        sku: v.sku,
        stock: v.stock,
        umbral: v.lowStockAlert,
        producto: v.product.translations[0]?.name ?? v.product.handle,
        productId: v.product.id,
      }))
      .sort((a, b) => a.stock - b.stock);
  }

  /**
   * Limpia reservas caducadas. Sin esto, un carrito abandonado mantendría el
   * stock bloqueado para siempre y el producto figuraría agotado sin estarlo.
   */
  async limpiarReservasCaducadas(): Promise<number> {
    const { count } = await this.prisma.client.stockReservation.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) {
      this.logger.log(`Liberadas ${count} reservas de stock caducadas`);
    }
    return count;
  }
}
