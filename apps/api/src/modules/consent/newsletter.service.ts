import crypto from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { newId, type Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { truncarIp } from './consent.service.js';
import { segmentosDe, type Segmento, type SenalesSuscriptor } from './segmentos.js';

/**
 * Alta en la newsletter con doble confirmación.
 *
 * El alta en dos pasos no es una formalidad. Sin ella:
 *
 *  · Cualquiera puede apuntar a otra persona escribiendo su dirección, y esa
 *    persona recibe correo que nunca pidió.
 *  · No hay forma de acreditar el consentimiento, que es justo lo que el RGPD
 *    exige poder demostrar. Un formulario enviado no prueba quién lo envió; un
 *    clic desde el buzón de esa dirección, sí.
 *  · Las direcciones falsas o mal escritas entran en la lista y disparan los
 *    rebotes, que es lo que hunde la reputación del dominio. Con la reputación
 *    tocada dejan de llegar hasta los correos de pedido.
 *
 * Por eso el alta guarda una solicitud pendiente y solo el clic en el correo
 * la convierte en suscripción, dejando registrado cuándo y desde qué IP.
 */
@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);

  /**
   * Cuánto vale el enlace de confirmación.
   *
   * Suficiente para quien lo abre al día siguiente, corto para que un enlace
   * olvidado en un buzón antiguo no sirva meses después.
   */
  private readonly VALIDEZ_HORAS = 48;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Paso 1: alguien pide darse de alta.
   *
   * Responde siempre lo mismo, esté o no la dirección en la lista. Decir «ya
   * estás suscrito» convertiría este formulario en una forma de comprobar si
   * una dirección concreta es clienta de la tienda, que con catálogo +18 es
   * información sensible de verdad.
   */
  async solicitar(email: string): Promise<{ enviado: true }> {
    const direccion = email.toLowerCase().trim();
    const token = crypto.randomBytes(32).toString('base64url');

    const preferencia = await this.prisma.client.communicationPreference.upsert({
      where: { email: direccion },
      update: { newsletterPendingToken: token, newsletterPendingAt: new Date() },
      create: {
        id: newId(),
        email: direccion,
        unsubscribeToken: crypto.randomBytes(24).toString('base64url'),
        newsletterPendingToken: token,
        newsletterPendingAt: new Date(),
      },
    });

    // A quien ya está suscrito no se le manda nada: recibir "confirma tu alta"
    // cuando ya estás dado de alta desconcierta y parece un fallo.
    if (!preferencia.newsletter) {
      await this.mail
        .confirmarNewsletter({
          email: direccion,
          token,
          locale: 'es',
          horas: this.VALIDEZ_HORAS,
        })
        .catch((error: unknown) => {
          // Que falle el correo no puede revelar a quien está en el formulario
          // si la dirección existía o no.
          this.logger.error(
            `No se ha podido enviar la confirmación: ${error instanceof Error ? error.message : ''}`,
          );
        });
    }

    return { enviado: true };
  }

  /**
   * Paso 2: el clic en el correo.
   *
   * Aquí es donde nace la suscripción y donde se guarda la prueba: cuándo se
   * confirmó y desde qué IP. Es lo que se enseña si alguien reclama.
   */
  async confirmar(token: string, contexto: { ip?: string }) {
    const preferencia = await this.prisma.client.communicationPreference.findUnique({
      where: { newsletterPendingToken: token },
    });

    if (!preferencia?.newsletterPendingAt) {
      throw new BadRequestException('Este enlace no es válido o ya se ha usado.');
    }

    const caducaEn = new Date(
      preferencia.newsletterPendingAt.getTime() + this.VALIDEZ_HORAS * 3_600_000,
    );

    if (caducaEn < new Date()) {
      throw new BadRequestException(
        'El enlace de confirmación ha caducado. Vuelve a apuntarte y te mandamos otro.',
      );
    }

    await this.prisma.client.$transaction([
      this.prisma.client.communicationPreference.update({
        where: { id: preferencia.id },
        data: {
          newsletter: true,
          newsletterConfirmedAt: new Date(),
          // Truncada, como el resto de IP del módulo de consentimiento: para
          // acreditar el alta basta la red de origen, y guardar la dirección
          // completa sería recoger más de lo necesario.
          newsletterConfirmedIp: contexto.ip ? truncarIp(contexto.ip) : null,
          // El token se consume: un enlace de un solo uso no se puede
          // reutilizar si alguien reenvía el correo.
          newsletterPendingToken: null,
          newsletterPendingAt: null,
        },
      }),
      this.prisma.client.communicationConsentLog.create({
        data: {
          id: newId(),
          preferenceId: preferencia.id,
          channel: 'newsletter',
          granted: true,
          source: 'doble-opt-in',
          ipTruncated: contexto.ip ? truncarIp(contexto.ip) : null,
        },
      }),
    ]);

    this.logger.log(`Newsletter confirmada para ${preferencia.email}`);
    return { confirmado: true, email: preferencia.email };
  }

  /**
   * Suscriptores de un segmento, para exportarlos o mandarles una campaña.
   *
   * Solo salen los que tienen `newsletter` en true, que por el doble opt-in
   * significa que han confirmado. Nadie más.
   */
  async suscriptores(segmento?: Segmento) {
    const preferencias = await this.prisma.client.communicationPreference.findMany({
      where: { newsletter: true },
      select: { email: true, newsletterConfirmedAt: true },
      take: 5000,
    });

    const correos = preferencias.map((p) => p.email);
    if (correos.length === 0) return [];

    // Todas las señales de una vez: una consulta por suscriptor haría que
    // exportar cinco mil direcciones tardara minutos.
    const [pedidos, carritos] = await Promise.all([
      this.prisma.client.order.groupBy({
        by: ['email'],
        where: { email: { in: correos }, paymentStatus: 'PAID' },
        _count: { _all: true },
        _sum: { totalCents: true },
        _max: { paidAt: true },
      }),
      this.prisma.client.cart.findMany({
        where: { email: { in: correos }, items: { some: {} } },
        select: { email: true },
      }),
    ]);

    const porEmail = new Map(pedidos.map((p) => [p.email, p]));
    const conCarrito = new Set(carritos.map((c) => c.email));
    const ahora = Date.now();

    return preferencias
      .map((p) => {
        const suyos = porEmail.get(p.email);
        const ultima = suyos?._max.paidAt;

        const senales: SenalesSuscriptor = {
          pedidosPagados: suyos?._count._all ?? 0,
          totalGastadoCents: suyos?._sum.totalCents ?? 0,
          diasDesdeUltimaCompra: ultima
            ? Math.floor((ahora - ultima.getTime()) / 86_400_000)
            : null,
          carritoAbandonado: conCarrito.has(p.email),
        };

        return {
          email: p.email,
          confirmadoEl: p.newsletterConfirmedAt,
          segmentos: segmentosDe(senales),
        };
      })
      .filter((s) => !segmento || s.segmentos.includes(segmento));
  }

  /** Cuántos hay en cada segmento, para el panel. */
  async resumen() {
    const todos = await this.suscriptores();
    const cuenta = new Map<Segmento, number>();

    for (const s of todos) {
      for (const seg of s.segmentos) cuenta.set(seg, (cuenta.get(seg) ?? 0) + 1);
    }

    return {
      total: todos.length,
      segmentos: [...cuenta.entries()].map(([segmento, cuantos]) => ({ segmento, cuantos })),
    };
  }
}
