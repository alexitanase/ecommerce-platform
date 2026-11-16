import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import {
  REGLAS_POR_DEFECTO,
  evaluarReferido,
  generarCodigo,
  normalizarCodigo,
  type ReglasReferidos,
} from './referidos.js';

/**
 * Programa de referidos.
 *
 * Con catálogo +18 —sin Google Ads ni Meta Ads— el boca a boca es de los pocos
 * canales que quedan. Aquí solo se consulta y se escribe: quién puede cobrar y
 * cuánto lo decide `referidos.ts`, que es lógica pura y está probada caso a
 * caso, porque un referido mal validado no da ningún error. Emite un cupón y ya
 * está, y se descubre semanas después cuadrando cuentas.
 *
 * El premio se reparte **al pagar**, no al crear el pedido. Un pedido creado y
 * nunca pagado repartiría descuentos por una venta que no existió.
 */
@Injectable()
export class ReferidosService {
  private readonly logger = new Logger(ReferidosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
  ) {}

  /** Reglas configuradas en el panel, con los valores por defecto de respaldo. */
  async reglas(): Promise<ReglasReferidos> {
    const guardados = await this.prisma.client.setting.findMany({
      where: { namespace: 'referidos' },
    });

    const valores = Object.fromEntries(guardados.map((g) => [g.key, g.value]));
    const numero = (clave: keyof ReglasReferidos, porDefecto: number): number => {
      const v = Number(valores[clave]);
      return Number.isFinite(v) && v >= 0 ? v : porDefecto;
    };

    return {
      activo: valores['activo'] === true,
      premioReferidorCents: numero('premioReferidorCents', REGLAS_POR_DEFECTO.premioReferidorCents),
      premioReferidoCents: numero('premioReferidoCents', REGLAS_POR_DEFECTO.premioReferidoCents),
      pedidoMinimoCents: numero('pedidoMinimoCents', REGLAS_POR_DEFECTO.pedidoMinimoCents),
      maximoPorReferidor: numero('maximoPorReferidor', REGLAS_POR_DEFECTO.maximoPorReferidor),
      diasDeValidez: numero('diasDeValidez', REGLAS_POR_DEFECTO.diasDeValidez),
    };
  }

  /**
   * Código de invitación de una persona, creándolo la primera vez.
   *
   * Perezoso a propósito: generarlo para todo el mundo al registrarse llenaría
   * la tabla de códigos que nadie usa, y el índice único haría el registro más
   * lento por algo que casi nadie pide.
   */
  async miCodigo(userId: string): Promise<{ codigo: string; enlace: string }> {
    const usuario = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { referralCode: true },
    });

    let codigo = usuario.referralCode;

    if (!codigo) {
      // Con 31^8 combinaciones la colisión es improbable, pero el índice único
      // la rechazaría con un error críptico. Se reintenta unas cuantas veces.
      for (let intento = 0; intento < 5 && !codigo; intento++) {
        const candidato = generarCodigo();
        const ocupado = await this.prisma.client.user.findUnique({
          where: { referralCode: candidato },
          select: { id: true },
        });
        if (!ocupado) codigo = candidato;
      }

      if (!codigo) throw new Error('No se ha podido generar un código de invitación');

      await this.prisma.client.user.update({
        where: { id: userId },
        data: { referralCode: codigo },
      });
    }

    return { codigo, enlace: `?ref=${codigo}` };
  }

  /**
   * Registra que alguien llega con un código, al crear su pedido.
   *
   * Todavía no premia nada: deja la invitación PENDIENTE. El premio se decide
   * al pagar, porque un pedido sin pagar no es una venta.
   */
  async registrarUso(datos: {
    codigo: string;
    emailReferido: string;
    orderId: string;
    referredUserId?: string;
  }): Promise<void> {
    const codigo = normalizarCodigo(datos.codigo);

    const referidor = await this.prisma.client.user.findUnique({
      where: { referralCode: codigo },
      select: { id: true },
    });

    // Un código inventado no rompe el pedido: se ignora. Quien compra no tiene
    // por qué quedarse sin comprar porque se equivocara al teclear.
    if (!referidor) {
      this.logger.warn(`Código de invitación desconocido en el pedido ${datos.orderId}`);
      return;
    }

    await this.prisma.client.referral.create({
      data: {
        id: newId(),
        referrerId: referidor.id,
        code: codigo,
        referredEmail: datos.emailReferido.toLowerCase().trim(),
        ...(datos.referredUserId ? { referredUserId: datos.referredUserId } : {}),
        orderId: datos.orderId,
        status: 'PENDIENTE',
      },
    });
  }

  /**
   * Resuelve la invitación cuando el pedido se paga.
   *
   * Es el único punto que emite premios. Se llama desde el flujo de pago, no
   * desde el de creación: la diferencia entre las dos cosas es exactamente la
   * diferencia entre una venta y una intención.
   */
  async alPagarPedido(orderId: string): Promise<void> {
    const referido = await this.prisma.client.referral.findUnique({
      where: { orderId },
      include: { referrer: { select: { id: true, email: true } } },
    });

    if (!referido || referido.status !== 'PENDIENTE') return;

    const [reglas, pedido, completados, yaReferido, pedidosPreviosDelReferido] = await Promise.all([
      this.reglas(),
      this.prisma.client.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { totalCents: true },
      }),
      this.prisma.client.referral.count({
        where: { referrerId: referido.referrerId, status: 'COMPLETADO' },
      }),
      this.prisma.client.referral.count({
        where: {
          referredEmail: referido.referredEmail,
          status: 'COMPLETADO',
          NOT: { id: referido.id },
        },
      }),
      this.prisma.client.order.count({
        where: {
          email: referido.referredEmail,
          paymentStatus: 'PAID',
          NOT: { id: orderId },
        },
      }),
    ]);

    const decision = evaluarReferido(
      {
        referidorId: referido.referrerId,
        emailReferidor: referido.referrer.email,
        emailReferido: referido.referredEmail,
        // Ya era cliente si tenía pedidos pagados ANTES de este.
        referidoYaEraCliente: pedidosPreviosDelReferido > 0,
        referidosCompletados: completados,
        totalPedidoCents: pedido.totalCents,
        yaFueReferido: yaReferido > 0,
      },
      reglas,
    );

    if (!decision.valido || !decision.premios) {
      await this.prisma.client.referral.update({
        where: { id: referido.id },
        data: { status: 'RECHAZADO', rejectionReason: decision.motivo ?? 'DESCONOCIDO' },
      });

      this.logger.log(
        `Referido de ${referido.referredEmail} rechazado: ${decision.detalle ?? decision.motivo ?? ''}`,
      );
      return;
    }

    const [cuponReferidor, cuponReferido] = await Promise.all([
      this.emitirCupon(decision.premios.referidorCents, reglas, 'REF'),
      this.emitirCupon(decision.premios.referidoCents, reglas, 'BIENVENIDA'),
    ]);

    await this.prisma.client.referral.update({
      where: { id: referido.id },
      data: {
        status: 'COMPLETADO',
        completedAt: new Date(),
        referrerCouponId: cuponReferidor.id,
        referredCouponId: cuponReferido.id,
      },
    });

    await this.audit.registrar({
      action: 'referral.completed',
      resource: 'referral',
      resourceId: referido.id,
      // Queda cuánto ha costado: es dinero que sale del margen y tiene que
      // poder sumarse a fin de mes.
      metadata: {
        referidor: referido.referrer.email,
        premioReferidorCents: decision.premios.referidorCents,
        premioReferidoCents: decision.premios.referidoCents,
      },
    });

    // Sin el aviso el programa no existe: los cupones quedan en la base de
    // datos y nadie se entera de que los tiene. Va después de guardar y con el
    // error tragado — un fallo del servidor de correo no puede deshacer un
    // premio que ya está concedido.
    await Promise.all([
      this.avisar(
        referido.referrer.email,
        true,
        cuponReferidor.code,
        decision.premios.referidorCents,
        reglas,
      ),
      this.avisar(
        referido.referredEmail,
        false,
        cuponReferido.code,
        decision.premios.referidoCents,
        reglas,
      ),
    ]);

    this.logger.log(
      `Referido completado: ${referido.referrer.email} trae a ${referido.referredEmail}`,
    );
  }

  private async avisar(
    email: string,
    esReferidor: boolean,
    codigo: string,
    importeCents: number,
    reglas: ReglasReferidos,
  ): Promise<void> {
    await this.mail
      .premioReferido({
        email,
        // El idioma del cliente no se guarda en el referido; el castellano es
        // el del mercado al que se lanza.
        locale: 'es',
        esReferidor,
        codigo,
        importeCents,
        minimoCents: reglas.pedidoMinimoCents,
        dias: reglas.diasDeValidez,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `No se ha podido avisar del cupón de referido a ${email}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      });
  }

  /**
   * Cupón nominal de importe fijo.
   *
   * De un solo uso y con caducidad: un cupón sin límites emitido por un
   * programa automático es una puerta abierta a que circule por foros de
   * descuentos y lo use quien no lo ganó.
   */
  private async emitirCupon(importeCents: number, reglas: ReglasReferidos, prefijo: string) {
    const codigo = `${prefijo}-${generarCodigo().slice(0, 6)}`;

    return this.prisma.client.coupon.create({
      data: {
        id: newId(),
        code: codigo,
        type: 'FIXED',
        value: importeCents,
        // El mínimo del programa se aplica también al cupón: si no, el premio
        // por un pedido de 25 € podría gastarse en uno de 6 €.
        minOrderCents: reglas.pedidoMinimoCents,
        maxUses: 1,
        maxUsesPerCustomer: 1,
        validUntil: new Date(Date.now() + reglas.diasDeValidez * 86_400_000),
        isActive: true,
      },
    });
  }

  /** Lo que ve quien recomienda: a cuánta gente ha traído y qué ha ganado. */
  async misReferidos(userId: string) {
    const referidos = await this.prisma.client.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return referidos.map((r) => ({
      // El correo de quien llega se enseña recortado: quien recomienda no
      // necesita saber la dirección completa de otra persona.
      invitado: r.referredEmail.replace(/^(.{2}).*(@.*)$/, '$1***$2'),
      estado: r.status,
      fecha: r.createdAt,
      completadoEl: r.completedAt,
    }));
  }

  /**
   * Listado para el panel, con lo que ha costado el programa.
   *
   * El coste va aparte de la cuenta de referidos: diez completados con premios
   * de 5 € y diez con premios de 20 € se ven igual en un contador y no son lo
   * mismo en el margen.
   */
  async listar(estado?: string) {
    const [referidos, completados] = await Promise.all([
      this.prisma.client.referral.findMany({
        where: estado ? { status: estado } : {},
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { referrer: { select: { email: true } } },
      }),
      this.prisma.client.referral.findMany({
        where: { status: 'COMPLETADO' },
        select: { referrerCouponId: true, referredCouponId: true },
      }),
    ]);

    const cupones = completados.flatMap((r) =>
      [r.referrerCouponId, r.referredCouponId].filter((id): id is string => id !== null),
    );

    const emitido = cupones.length
      ? await this.prisma.client.coupon.aggregate({
          where: { id: { in: cupones } },
          _sum: { value: true },
        })
      : { _sum: { value: 0 } };

    // Emitido no es gastado: un cupón que caduca sin usarse no cuesta nada.
    const canjeado = cupones.length
      ? await this.prisma.client.coupon.aggregate({
          where: { id: { in: cupones }, usedCount: { gt: 0 } },
          _sum: { value: true },
        })
      : { _sum: { value: 0 } };

    return {
      referidos: referidos.map((r) => ({
        id: r.id,
        referidor: r.referrer.email,
        invitado: r.referredEmail,
        codigo: r.code,
        estado: r.status,
        motivoRechazo: r.rejectionReason,
        fecha: r.createdAt,
        completadoEl: r.completedAt,
      })),
      resumen: {
        completados: completados.length,
        emitidoCents: emitido._sum.value ?? 0,
        canjeadoCents: canjeado._sum.value ?? 0,
      },
    };
  }

  /** Reglas configurables desde el panel. */
  async guardarReglas(reglas: Partial<ReglasReferidos>, ctx: ContextoActor) {
    // Se valida sobre la mezcla, no sobre lo que llega: bajar solo el mínimo
    // en una segunda edición dejaría el programa igual de roto que cambiar los
    // dos campos a la vez.
    const resultantes = { ...(await this.reglas()), ...reglas };

    if (
      resultantes.premioReferidorCents + resultantes.premioReferidoCents >=
      resultantes.pedidoMinimoCents
    ) {
      // Si los dos premios juntos igualan el pedido mínimo, el programa es una
      // forma de sacar dinero: se refiere gente, se compra el mínimo justo y
      // en cada vuelta sale más descuento del que ha entrado.
      throw new BadRequestException(
        'Los dos premios juntos no pueden llegar al pedido mínimo: el programa perdería dinero en cada referido.',
      );
    }

    if (resultantes.diasDeValidez < 1) {
      throw new BadRequestException('El cupón tiene que durar al menos un día.');
    }

    await this.settings.actualizar(
      Object.entries(reglas).map(([key, value]) => ({ namespace: 'referidos', key, value })),
      ctx,
    );

    return this.reglas();
  }
}
