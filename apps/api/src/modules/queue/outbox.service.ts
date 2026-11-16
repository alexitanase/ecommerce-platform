import { Injectable, Logger } from '@nestjs/common';
import { newId, objeto } from '@ecom/shared';
import type { Prisma } from '@ecom/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { COLAS, PRIORIDAD, QueueService, type NombreCola } from './queue.service.js';
import { extraerTraza, inyectarTraza } from '../../common/trazas.js';

/**
 * Patrón outbox.
 *
 * El problema que resuelve: si al confirmar un pago escribiéramos el cambio en
 * la base de datos y después encoláramos el trabajo, un fallo entre ambas
 * operaciones dejaría el pedido cobrado y nunca procesado. Al revés —encolar
 * primero— produciría trabajos sobre pedidos que no llegaron a guardarse.
 *
 * La solución es escribir el evento en la MISMA transacción que el cambio de
 * datos, y que un proceso aparte lo publique después. Si la transacción falla,
 * el evento no existe; si se confirma, el evento está garantizado y se
 * publicará aunque el servidor se caiga justo después.
 */

export interface EventoDominio {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  /** Retrasa la publicación (p. ej. recordatorio a las 24 h). */
  disponibleEn?: Date;
}

/** A qué cola va cada tipo de evento y con qué prioridad. */
const ENRUTADO: Record<string, { cola: NombreCola; prioridad: number }> = {
  'order.paid': { cola: COLAS.FULFILLMENT, prioridad: PRIORIDAD.CRITICA },
  'order.cancelled': { cola: COLAS.FULFILLMENT, prioridad: PRIORIDAD.ALTA },
  'order.refund_requested': { cola: COLAS.FULFILLMENT, prioridad: PRIORIDAD.ALTA },
  'supplier_order.placed': { cola: COLAS.TRACKING, prioridad: PRIORIDAD.NORMAL },
  'supplier_order.failed': { cola: COLAS.EMAIL, prioridad: PRIORIDAD.ALTA },
  'order.shipped': { cola: COLAS.EMAIL, prioridad: PRIORIDAD.NORMAL },
  'order.delivered': { cola: COLAS.EMAIL, prioridad: PRIORIDAD.NORMAL },
  'user.registered': { cola: COLAS.EMAIL, prioridad: PRIORIDAD.BAJA },
  'product.imported': { cola: COLAS.IMAGES, prioridad: PRIORIDAD.BAJA },
};

/** Cuántos eventos se publican por pasada. */
const TAMANO_LOTE = 100;
/** Intentos antes de dar el evento por fallido. */
const INTENTOS_MAXIMOS = 10;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Registra un evento DENTRO de una transacción existente.
   *
   * El primer parámetro es el cliente transaccional: pasarle `this.prisma` en
   * lugar del `tx` de la transacción anularía toda la garantía.
   */
  async registrar(tx: Prisma.TransactionClient, evento: EventoDominio): Promise<string> {
    const id = newId();

    await tx.outboxEvent.create({
      data: {
        id,
        eventType: evento.eventType,
        aggregateType: evento.aggregateType,
        aggregateId: evento.aggregateId,
        // El contexto de traza se guarda CON el evento, dentro de la misma
        // transacción. El outbox publica desde un temporizador, así que si el
        // contexto se capturara al publicar sería el del temporizador y la
        // traza empezaría ahí: se vería que un pedido se envió al proveedor,
        // pero no qué petición lo provocó. Guardándolo aquí, la cadena va del
        // clic en pagar hasta la llamada al proveedor.
        payload: inyectarTraza(objeto(evento.payload)) as Prisma.InputJsonValue,
        availableAt: evento.disponibleEn ?? new Date(),
      },
    });

    return id;
  }

  /**
   * Publica a las colas los eventos pendientes.
   *
   * Lo ejecuta un trabajo periódico cada pocos segundos. Marca primero como
   * PROCESSING para que dos instancias de la API no publiquen el mismo evento
   * dos veces.
   */
  async publicarPendientes(): Promise<{ publicados: number; fallidos: number }> {
    const pendientes = await this.prisma.client.outboxEvent.findMany({
      where: {
        status: 'PENDING',
        availableAt: { lte: new Date() },
        attempts: { lt: INTENTOS_MAXIMOS },
      },
      orderBy: { createdAt: 'asc' },
      take: TAMANO_LOTE,
    });

    if (pendientes.length === 0) return { publicados: 0, fallidos: 0 };

    // Reserva atómica: solo actualiza los que siguen en PENDING, así que si
    // otra instancia se adelantó, aquí no se toma ninguno de los suyos.
    const { count } = await this.prisma.client.outboxEvent.updateMany({
      where: { id: { in: pendientes.map((e) => e.id) }, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });

    if (count === 0) return { publicados: 0, fallidos: 0 };

    let publicados = 0;
    let fallidos = 0;

    for (const evento of pendientes) {
      const destino = ENRUTADO[evento.eventType];

      if (!destino) {
        // Un evento sin destino es un error de programación, no un fallo
        // transitorio: se marca como publicado para que no bloquee la cola,
        // pero se deja constancia en el log.
        this.logger.warn(
          `Evento "${evento.eventType}" sin cola asignada; se descarta. ` +
            `Añádelo al enrutado del outbox si debe procesarse.`,
        );
        await this.prisma.client.outboxEvent.update({
          where: { id: evento.id },
          data: { status: 'PUBLISHED', publishedAt: new Date(), lastError: 'Sin cola asignada' },
        });
        continue;
      }

      try {
        await this.queue.encolar(
          destino.cola,
          evento.eventType,
          {
            eventId: evento.id,
            aggregateType: evento.aggregateType,
            aggregateId: evento.aggregateId,
            payload: evento.payload,
            // Se sube a la raíz el contexto guardado al registrar el evento:
            // es donde el worker lo busca para continuar la traza original.
            ...(extraerTraza(evento.payload) ? { __traza: extraerTraza(evento.payload) } : {}),
          },
          {
            priority: destino.prioridad,
            // El id del evento como id de trabajo: si el outbox reintentara
            // publicar el mismo evento, BullMQ lo ignora en lugar de duplicarlo.
            // BullMQ no admite ":" en los identificadores personalizados.
            jobId: `outbox-${evento.id}`,
          },
        );

        await this.prisma.client.outboxEvent.update({
          where: { id: evento.id },
          data: { status: 'PUBLISHED', publishedAt: new Date() },
        });
        publicados++;
      } catch (error) {
        fallidos++;
        const intentos = evento.attempts + 1;
        const mensaje = error instanceof Error ? error.message : String(error);

        await this.prisma.client.outboxEvent.update({
          where: { id: evento.id },
          data: {
            // Se devuelve a PENDING para reintentar, salvo que se agoten los
            // intentos: entonces queda como FAILED para revisión manual.
            status: intentos >= INTENTOS_MAXIMOS ? 'FAILED' : 'PENDING',
            attempts: intentos,
            lastError: mensaje.slice(0, 500),
            // Espera creciente antes del siguiente intento.
            availableAt: new Date(Date.now() + Math.min(2 ** intentos, 300) * 1000),
          },
        });

        this.logger.error(
          `No se ha podido publicar el evento ${evento.eventType} (${evento.id}): ${mensaje}`,
        );
      }
    }

    if (publicados > 0) {
      this.logger.debug(`Outbox: ${publicados} evento(s) publicados`);
    }

    return { publicados, fallidos };
  }

  /** Eventos que han agotado los intentos: requieren mirar qué pasa. */
  async fallidos(limite = 50) {
    return this.prisma.client.outboxEvent.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: limite,
    });
  }

  async reintentar(eventId: string): Promise<boolean> {
    const evento = await this.prisma.client.outboxEvent.findUnique({ where: { id: eventId } });
    if (!evento) return false;

    await this.prisma.client.outboxEvent.update({
      where: { id: eventId },
      data: { status: 'PENDING', attempts: 0, availableAt: new Date(), lastError: null },
    });
    return true;
  }

  /**
   * Detecta eventos atascados en PROCESSING.
   *
   * Si una instancia muere justo después de reservar un lote, esos eventos se
   * quedarían en PROCESSING para siempre y nunca se publicarían. Este barrido
   * los devuelve a la cola pasado un tiempo prudencial.
   */
  async recuperarAtascados(minutosUmbral = 5): Promise<number> {
    const { count } = await this.prisma.client.outboxEvent.updateMany({
      where: {
        status: 'PROCESSING',
        createdAt: { lt: new Date(Date.now() - minutosUmbral * 60_000) },
      },
      data: { status: 'PENDING' },
    });

    if (count > 0) {
      this.logger.warn(`Recuperados ${count} evento(s) atascados en PROCESSING`);
    }
    return count;
  }

  async metricas() {
    const [pendientes, procesando, publicados, fallidos] = await Promise.all([
      this.prisma.client.outboxEvent.count({ where: { status: 'PENDING' } }),
      this.prisma.client.outboxEvent.count({ where: { status: 'PROCESSING' } }),
      this.prisma.client.outboxEvent.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.client.outboxEvent.count({ where: { status: 'FAILED' } }),
    ]);

    return { pendientes, procesando, publicados, fallidos };
  }
}
