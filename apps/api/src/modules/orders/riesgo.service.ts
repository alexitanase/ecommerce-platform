import { Injectable, Logger } from '@nestjs/common';
import crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import {
  esEmailDesechable,
  evaluarRiesgo,
  type ResultadoRiesgo,
  type SenalesPedido,
} from './riesgo.js';

/**
 * Reúne las señales del pedido y aplica el motor de riesgo.
 *
 * La separación es a propósito: aquí solo se consulta la base de datos, y toda
 * la decisión vive en `riesgo.ts`, que es lógica pura y se puede probar caso a
 * caso. Tocar un umbral sin poder probarlo es como calibrar a ciegas, y un
 * motor mal calibrado no da errores: da ventas perdidas que nadie cuenta.
 */
@Injectable()
export class RiesgoService {
  private readonly logger = new Logger(RiesgoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Contador de pedidos por IP, en Redis y con caducidad de una hora.
   *
   * En Redis y no en una tabla a propósito: una IP es dato personal, y la
   * finalidad —detectar un bombardeo de tarjetas— se agota en una hora. Un
   * contador que caduca solo es proporcionado; una columna en el histórico de
   * pedidos guardaría la IP de cada cliente durante años sin necesitarla.
   *
   * Se guarda además el hash, no la IP: para contar sirve igual y quien mire
   * la base de Redis no ve direcciones de nadie.
   */
  private claveIp(ip: string): string {
    const hash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
    return `riesgo:ip:${hash}`;
  }

  /** Anota un pedido de esta IP y devuelve cuántos lleva en la última hora. */
  async anotarPedidoDeLaIp(ip: string): Promise<number> {
    const clave = this.claveIp(ip);
    const cuantos = await this.redis.client.incr(clave);
    // Solo al crear la clave: renovarlo en cada pedido haría que una ráfaga
    // continua no caducara nunca.
    if (cuantos === 1) await this.redis.client.expire(clave, 3600);
    return cuantos;
  }

  /**
   * Evalúa un pedido antes de crearlo.
   *
   * Se llama con el total ya calculado por el servidor, nunca con el que
   * mande el navegador: el importe es una de las señales y aceptarlo de fuera
   * permitiría declarar un pedido de 1 € para esquivar la revisión.
   */
  async evaluar(datos: {
    email: string;
    totalCents: number;
    paisEnvio: string;
    paisFacturacion?: string;
    userId?: string;
    ip?: string;
    segundosEnElCheckout?: number;
  }): Promise<ResultadoRiesgo> {
    const haceUnaHora = new Date(Date.now() - 3_600_000);
    const email = datos.email.toLowerCase().trim();

    // Todas las consultas a la vez: van en el camino del checkout y encadenarlas
    // sumaría su latencia a cada compra.
    const [porEmail, porIp, pagados, fallidos, cuenta] = await Promise.all([
      this.prisma.client.order.count({
        where: { email, createdAt: { gte: haceUnaHora } },
      }),

      // Sin IP no se puede contar por IP; se cuenta 0 en lugar de fallar.
      datos.ip ? this.anotarPedidoDeLaIp(datos.ip) : Promise.resolve(0),

      this.prisma.client.order.count({
        where: {
          email,
          // Lo que cuenta como aval es haber pagado, no haber pedido: si no,
          // el propio bombardeo de pedidos falsos se daría crédito a sí mismo.
          paymentStatus: 'PAID',
        },
      }),

      this.prisma.client.payment.count({
        where: {
          order: { email },
          status: 'FAILED',
          createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
        },
      }),

      datos.userId
        ? this.prisma.client.user.findUnique({
            where: { id: datos.userId },
            select: { createdAt: true },
          })
        : Promise.resolve(null),
    ]);

    const senales: SenalesPedido = {
      totalCents: datos.totalCents,
      pedidosDelEmailUltimaHora: porEmail,
      pedidosDeLaIpUltimaHora: porIp,
      pedidosPagadosDelEmail: pagados,
      paisEnvio: datos.paisEnvio,
      ...(datos.paisFacturacion ? { paisFacturacion: datos.paisFacturacion } : {}),
      emailDesechable: esEmailDesechable(email),
      cuentaRecienCreada: cuenta ? cuenta.createdAt >= haceUnaHora : false,
      invitado: !datos.userId,
      ...(datos.segundosEnElCheckout !== undefined
        ? { segundosEnElCheckout: datos.segundosEnElCheckout }
        : {}),
      pagosFallidosDelEmail: fallidos,
    };

    const resultado = evaluarRiesgo(senales);

    if (resultado.decision !== 'ACEPTAR') {
      this.logger.warn(
        `Pedido de ${email} con riesgo ${String(resultado.puntuacion)} (${resultado.decision}): ` +
          resultado.motivos.map((m) => m.codigo).join(', '),
      );
    }

    return resultado;
  }

  /** Pedidos retenidos esperando que alguien los mire. */
  async retenidos() {
    const pedidos = await this.prisma.client.order.findMany({
      where: { riskDecision: 'REVISAR', riskClearedAt: null, cancelledAt: null },
      orderBy: [{ riskScore: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        number: true,
        email: true,
        totalCents: true,
        status: true,
        paymentStatus: true,
        riskScore: true,
        riskReasons: true,
        createdAt: true,
      },
      take: 100,
    });

    return pedidos;
  }

  /**
   * Suelta un pedido retenido.
   *
   * A partir de aquí el pedido sigue su curso normal y se enviará al proveedor
   * cuando el pago esté confirmado. Queda registrado quién lo soltó: es dinero
   * real de mercancía y la responsabilidad tiene que tener nombre.
   */
  async liberar(orderId: string, ctx: ContextoActor) {
    const pedido = await this.prisma.client.order.update({
      where: { id: orderId },
      data: {
        riskClearedAt: new Date(),
        riskClearedBy: ctx.actorId ?? null,
      },
      // `paymentStatus` incluido porque quien libera necesita saber si además
      // toca comprar: la retención se puede levantar antes de que el cobro
      // confirme, y ahí no hay que pedirle nada al proveedor.
      select: { id: true, number: true, riskScore: true, status: true, paymentStatus: true },
    });

    await this.audit.registrar({
      action: 'order.risk_cleared',
      resource: 'order',
      resourceId: orderId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      metadata: { numero: pedido.number, puntuacion: pedido.riskScore },
    });

    this.logger.log(`Pedido ${pedido.number} liberado de la revisión de riesgo`);
    return pedido;
  }

  /**
   * ¿Se puede enviar este pedido al proveedor?
   *
   * Es la comprobación que da sentido a todo lo demás. Retener el envío y no
   * el cobro es lo que hace barato equivocarse: si el pedido resulta bueno,
   * solo se ha retrasado unas horas; si era fraude, no se ha gastado nada en
   * mercancía que no se va a recuperar.
   */
  async puedeEnviarse(orderId: string): Promise<{ puede: boolean; motivo?: string }> {
    const pedido = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: { riskDecision: true, riskClearedAt: true, riskScore: true },
    });

    if (!pedido) return { puede: false, motivo: 'El pedido no existe' };
    if (pedido.riskDecision !== 'REVISAR') return { puede: true };
    if (pedido.riskClearedAt) return { puede: true };

    return {
      puede: false,
      motivo:
        `Retenido por el control de riesgo (${String(pedido.riskScore)} puntos). ` +
        'Revísalo en Pedidos → Retenidos y libéralo para enviarlo al proveedor.',
    };
  }
}
