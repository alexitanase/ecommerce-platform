import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { newId, type Locale } from '@ecom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { SearchService } from '../../search/search.service.js';
import type { ContextoActor } from '../../roles/roles.service.js';

/**
 * Reseñas de producto.
 *
 * Solo se admiten de clientes registrados y se publican tras moderación. Las
 * reseñas abiertas a cualquiera se llenan de spam en cuestión de días, y una
 * reseña falsa que ensalce el producto es publicidad engañosa sancionable.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly search: SearchService,
  ) {}

  async listarPublicas(productId: string, opciones: { limite?: number; cursor?: string } = {}) {
    const limite = Math.min(opciones.limite ?? 20, 50);

    const resenas = await this.prisma.client.review.findMany({
      where: { productId, status: 'APPROVED', deletedAt: null },
      orderBy: [{ isVerifiedPurchase: 'desc' }, { helpfulCount: 'desc' }, { createdAt: 'desc' }],
      take: limite + 1,
      ...(opciones.cursor ? { cursor: { id: opciones.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        isVerifiedPurchase: true,
        helpfulCount: true,
        reply: true,
        repliedAt: true,
        createdAt: true,
        locale: true,
      },
    });

    const hayMas = resenas.length > limite;
    return {
      items: hayMas ? resenas.slice(0, limite) : resenas,
      nextCursor: hayMas ? (resenas[limite - 1]?.id ?? null) : null,
    };
  }

  /** Resumen de valoración: media y reparto por estrellas. */
  async resumen(productId: string) {
    const aprobadas = await this.prisma.client.review.findMany({
      where: { productId, status: 'APPROVED', deletedAt: null },
      select: { rating: true },
    });

    if (aprobadas.length === 0) {
      return { media: 0, total: 0, reparto: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    }

    const reparto: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of aprobadas) reparto[r.rating] = (reparto[r.rating] ?? 0) + 1;

    const suma = aprobadas.reduce((a, r) => a + r.rating, 0);

    return {
      media: Math.round((suma / aprobadas.length) * 10) / 10,
      total: aprobadas.length,
      reparto,
    };
  }

  async crear(
    userId: string,
    datos: { productId: string; rating: number; title?: string; body?: string; locale: Locale },
  ) {
    const producto = await this.prisma.client.product.findUnique({
      where: { id: datos.productId },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!producto || producto.deletedAt || producto.status !== 'ACTIVE') {
      throw new NotFoundException('Producto no encontrado');
    }

    const yaResenado = await this.prisma.client.review.findFirst({
      where: { productId: datos.productId, userId, deletedAt: null },
    });
    if (yaResenado) {
      throw new BadRequestException('Ya has valorado este producto');
    }

    // TODO(Fase 6): marcar isVerifiedPurchase consultando los pedidos
    // entregados de este usuario que incluyan el producto.
    const compraVerificada = false;

    const resena = await this.prisma.client.review.create({
      data: {
        id: newId(),
        productId: datos.productId,
        userId,
        rating: datos.rating,
        title: datos.title ?? null,
        body: datos.body ?? null,
        locale: datos.locale,
        isVerifiedPurchase: compraVerificada,
        status: 'PENDING',
      },
    });

    return {
      id: resena.id,
      status: resena.status,
      mensaje: 'Tu valoración se publicará tras revisarla.',
    };
  }

  async moderar(reviewId: string, decision: 'APPROVED' | 'REJECTED', ctx: ContextoActor) {
    const resena = await this.prisma.client.review.findUnique({ where: { id: reviewId } });
    if (!resena || resena.deletedAt) throw new NotFoundException('Reseña no encontrada');

    const actualizada = await this.prisma.client.review.update({
      where: { id: reviewId },
      data: { status: decision },
    });

    await this.audit.registrar({
      action: decision === 'APPROVED' ? 'review.approve' : 'review.reject',
      resource: 'review',
      resourceId: reviewId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { status: resena.status },
      after: { status: decision },
    });

    // La valoración media forma parte del documento indexado y se muestra en
    // los resultados, así que hay que refrescarla.
    await this.search.indexarProducto(resena.productId);

    return actualizada;
  }

  async responder(reviewId: string, respuesta: string, ctx: ContextoActor) {
    const resena = await this.prisma.client.review.findUnique({ where: { id: reviewId } });
    if (!resena || resena.deletedAt) throw new NotFoundException('Reseña no encontrada');

    const actualizada = await this.prisma.client.review.update({
      where: { id: reviewId },
      data: { reply: respuesta, repliedAt: new Date() },
    });

    // Una respuesta pública del comercio queda auditada: es contenido visible
    // para cualquier cliente y hay que saber quién lo escribió.
    await this.audit.registrar({
      action: 'review.reply',
      resource: 'review',
      resourceId: reviewId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { reply: respuesta.slice(0, 200) },
    });

    return actualizada;
  }

  async pendientes(limite = 50) {
    return this.prisma.client.review.findMany({
      where: { status: 'PENDING', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: Math.min(limite, 100),
      include: {
        product: { select: { id: true, handle: true, translations: { take: 1 } } },
      },
    });
  }

  async marcarUtil(reviewId: string): Promise<{ helpfulCount: number }> {
    const resena = await this.prisma.client.review.update({
      where: { id: reviewId },
      data: { helpfulCount: { increment: 1 } },
      select: { helpfulCount: true, status: true },
    });

    if (resena.status !== 'APPROVED') {
      throw new ForbiddenException('Esta reseña no está publicada');
    }

    return { helpfulCount: resena.helpfulCount };
  }
}
