import { Injectable, Logger } from '@nestjs/common';
import type { Locale } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { PreferenciasService } from '../consent/preferencias.service.js';
import {
  avisoPendiente,
  medirRecuperacion,
  VENTANA_MAXIMA_MS,
  type MetricasRecuperacion,
} from './recuperacion.js';

/**
 * Campaña de carritos abandonados y pagos a medias.
 *
 * Dos recuperaciones distintas con la misma idea: alguien estuvo a un clic de
 * comprar y no llegó. La diferencia es que en el carrito abandonado el cliente
 * se distrajo, y en el pago caducado creía haber comprado —en cripto la
 * ventana dura minutos— y se ha quedado con un pedido pendiente sin saberlo.
 *
 * Todo el envío pasa por una tarea periódica y no por un temporizador en
 * memoria: si el proceso se reinicia, un `setTimeout` de 24 horas se pierde y
 * ese carrito no recibe nada nunca.
 */

/** Cuánto se espera tras caducar un pago antes de escribir. */
const ESPERA_PAGO_CADUCADO_MS = 30 * 60_000;

/** Correos por ejecución. Un pico no puede vaciar la cuota del proveedor. */
const MAXIMO_POR_TANDA = 100;

@Injectable()
export class RecuperacionService {
  private readonly logger = new Logger(RecuperacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly preferencias: PreferenciasService,
  ) {}

  /**
   * Cupón que acompaña al segundo y tercer aviso, si se ha configurado.
   *
   * Se lee del ajuste directamente y no de `settings.publicos()`: este no es
   * público, y con razón —un código de descuento que la tienda sirve a
   * cualquiera que pida `/settings/public` lo acaba usando todo el mundo.
   */
  private async cupon(): Promise<{ codigo: string; descripcion: string } | undefined> {
    const ajuste = await this.prisma.client.setting.findUnique({
      where: { namespace_key: { namespace: 'marketing', key: 'recoveryCoupon' } },
      select: { value: true },
    });

    const codigo = ajuste?.value;

    if (typeof codigo !== 'string' || !codigo.trim()) return undefined;

    // El descuento se lee del cupón real, no de un texto suelto en los
    // ajustes: prometer "10 %" en el correo y aplicar 5 al pagar es la forma
    // más rápida de perder al cliente que habías recuperado.
    const cupon = await this.prisma.client.coupon.findUnique({
      where: { code: codigo.trim().toUpperCase() },
      select: { code: true, type: true, value: true, isActive: true, validUntil: true },
    });

    if (!cupon || !cupon.isActive) {
      this.logger.warn(
        `El cupón de recuperación "${codigo}" no existe o está desactivado: los avisos saldrán sin descuento.`,
      );
      return undefined;
    }

    if (cupon.validUntil && cupon.validUntil < new Date()) {
      this.logger.warn(`El cupón de recuperación "${codigo}" ha caducado.`);
      return undefined;
    }

    const valor = Number(cupon.value);
    const descripcion =
      cupon.type === 'PERCENTAGE'
        ? `${String(valor)} %`
        : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(
            valor / 100,
          );

    return { codigo: cupon.code, descripcion };
  }

  /**
   * Escribe a quien toca en esta pasada.
   *
   * @returns cuántos avisos se han enviado, por etapa
   */
  async enviarAvisos(): Promise<{ enviados: number; porEtapa: Record<number, number> }> {
    const ahora = new Date();
    const desde = new Date(ahora.getTime() - VENTANA_MAXIMA_MS);

    const candidatos = await this.prisma.client.cart.findMany({
      where: {
        convertedAt: null,
        recoveryOptOut: false,
        email: { not: null },
        lastActivityAt: { gte: desde, lte: new Date(ahora.getTime() - 3600_000) },
        recoveryStage: { lt: 3 },
        items: { some: {} },
      },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: { include: { translations: true } },
              },
            },
          },
        },
      },
      orderBy: { lastActivityAt: 'asc' },
      take: MAXIMO_POR_TANDA,
    });

    const porEtapa: Record<number, number> = {};
    let enviados = 0;
    let cupon: { codigo: string; descripcion: string } | undefined;
    let cuponResuelto = false;

    for (const carrito of candidatos) {
      const aviso = avisoPendiente(
        {
          email: carrito.email,
          lineas: carrito.items.length,
          lastActivityAt: carrito.lastActivityAt,
          convertedAt: carrito.convertedAt,
          recoveryStage: carrito.recoveryStage,
          lastRecoveryAt: carrito.lastRecoveryAt,
          optOut: carrito.recoveryOptOut,
        },
        ahora,
      );

      if (!aviso || !carrito.email) continue;

      // La baja del centro de preferencias manda sobre todo lo demás: puede
      // haberse dado de baja desde otro correo, con este carrito sin tocar.
      if (!(await this.preferencias.puedeEnviar(carrito.email, 'cartRecovery'))) continue;

      // Se busca una sola vez por tanda, y solo si algún aviso lo necesita.
      if (aviso.conCupon && !cuponResuelto) {
        cupon = await this.cupon();
        cuponResuelto = true;
      }

      const locale = carrito.locale as Locale;
      const lineas = carrito.items.map((i) => {
        const traduccion =
          i.variant.product.translations.find((t) => t.locale === locale) ??
          i.variant.product.translations[0];

        return {
          nombre: traduccion?.name ?? i.variant.sku,
          cantidad: i.quantity,
          // El precio de ahora, no el de cuando lo añadió: es lo que pagará si
          // vuelve, y anunciar el viejo sería un precio que no existe.
          totalCents: i.variant.priceCents * i.quantity,
        };
      });

      // El enlace de baja del pie lleva el token de la dirección, no el del
      // carrito: da de baja a la persona, no a ese carrito suelto.
      const preferencia = await this.preferencias.de(carrito.email, carrito.userId ?? undefined);

      const enviado = await this.mail.carritoAbandonado({
        email: carrito.email,
        nombre: null,
        token: carrito.token,
        tokenBaja: preferencia.unsubscribeToken,
        lineas,
        totalCents: lineas.reduce((a, l) => a + l.totalCents, 0),
        ...(aviso.conCupon && cupon ? { cupon } : {}),
        locale: carrito.locale,
      });

      // El contador sube aunque el envío falle: si el servidor de correo está
      // caído, reintentar el mismo aviso en cada pasada acabaría mandando
      // veinte copias en cuanto se recupere.
      await this.prisma.client.cart.update({
        where: { id: carrito.id },
        data: { recoveryStage: aviso.etapa, lastRecoveryAt: ahora },
      });

      if (enviado) {
        enviados++;
        porEtapa[aviso.etapa] = (porEtapa[aviso.etapa] ?? 0) + 1;
      }
    }

    if (enviados > 0) {
      this.logger.log(`Avisos de carrito abandonado enviados: ${String(enviados)}`);
    }

    return { enviados, porEtapa };
  }

  /**
   * Avisa de los pagos que caducaron sin completarse.
   *
   * Se espera media hora antes de escribir: quien está pagando con cripto a
   * veces termina justo después de que caduque la ventana, y un correo diciendo
   * "no has pagado" a quien acaba de pagar es peor que no escribir.
   */
  async avisarPagosCaducados(): Promise<{ enviados: number }> {
    const limite = new Date(Date.now() - ESPERA_PAGO_CADUCADO_MS);

    const pedidos = await this.prisma.client.order.findMany({
      where: {
        status: 'AWAITING_PAYMENT',
        paymentStatus: { in: ['PENDING', 'EXPIRED', 'FAILED'] },
        paymentReminderAt: null,
        // Solo los de los últimos tres días: más allá, el pedido se cancela
        // solo y el correo llegaría a algo que ya no se puede pagar.
        createdAt: { gte: new Date(Date.now() - 3 * 24 * 3600_000) },
        payments: { some: { status: { in: ['EXPIRED', 'FAILED'] }, updatedAt: { lte: limite } } },
      },
      select: {
        id: true,
        number: true,
        email: true,
        locale: true,
        publicToken: true,
        shippingAddress: true,
        payments: { select: { provider: true, payCurrency: true }, take: 1 },
      },
      take: MAXIMO_POR_TANDA,
    });

    let enviados = 0;

    for (const pedido of pedidos) {
      const direccion = (pedido.shippingAddress ?? {}) as Record<string, unknown>;
      const nombre = typeof direccion['firstName'] === 'string' ? direccion['firstName'] : null;

      const enviado = await this.mail.pagoCaducado({
        email: pedido.email,
        nombre,
        numero: pedido.number,
        token: pedido.publicToken,
        esCripto: pedido.payments[0]?.payCurrency !== null,
        locale: pedido.locale,
      });

      await this.prisma.client.order.update({
        where: { id: pedido.id },
        data: { paymentReminderAt: new Date() },
      });

      if (enviado) enviados++;
    }

    if (enviados > 0) {
      this.logger.log(`Avisos de pago caducado enviados: ${String(enviados)}`);
    }

    return { enviados };
  }

  /** Baja de los avisos, desde el enlace del propio correo. */
  async darDeBaja(token: string): Promise<void> {
    // `updateMany` y no `update`: con un token que no existe —o ya caducado—
    // no tiene sentido devolver un error al cliente que pulsa "no quiero más
    // correos". El resultado que le importa es el mismo.
    await this.prisma.client.cart.updateMany({
      where: { token },
      data: { recoveryOptOut: true },
    });
  }

  /** Resultado de la campaña en un periodo. */
  async metricas(
    desde: Date,
    hasta: Date,
  ): Promise<MetricasRecuperacion & { desde: Date; hasta: Date }> {
    const carritos = await this.prisma.client.cart.findMany({
      where: { lastRecoveryAt: { gte: desde, lte: hasta } },
      select: { recoveryStage: true, convertedAt: true, convertedToId: true },
    });

    const pedidos = await this.prisma.client.order.findMany({
      where: {
        id: { in: carritos.map((c) => c.convertedToId).filter((id) => id !== null) },
      },
      select: { id: true, totalCents: true },
    });

    const totalDe = new Map(pedidos.map((p) => [p.id, p.totalCents]));

    return {
      desde,
      hasta,
      ...medirRecuperacion(
        carritos.map((c) => ({
          recoveryStage: c.recoveryStage,
          convertedAt: c.convertedAt,
          totalCents: (c.convertedToId ? totalDe.get(c.convertedToId) : 0) ?? 0,
        })),
      ),
    };
  }
}
