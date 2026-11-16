import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueueService } from '../queue/queue.service.js';

/**
 * Métricas operativas en formato Prometheus.
 *
 * Lo que importa no es la media de latencia sino los percentiles: si el p99 se
 * dispara mientras la media sigue plana, hay una parte de los clientes que no
 * puede comprar y las medias no lo enseñan.
 *
 * Las métricas de negocio (pedidos, ingresos) están aquí a propósito, junto a
 * las técnicas. Una caída de pedidos con toda la infraestructura en verde es la
 * alerta más útil que existe: significa que algo funciona pero está mal.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registro = new Registry();

  /** Latencia HTTP. Los buckets llegan hasta 10s porque el checkout llama a pasarelas externas. */
  readonly httpDuracion = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duración de las peticiones HTTP en segundos',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registro],
  });

  readonly httpTotal = new Counter({
    name: 'http_requests_total',
    help: 'Peticiones HTTP atendidas',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registro],
  });

  /** Pedidos creados, por estado. El throughput de negocio. */
  readonly pedidosTotal = new Counter({
    name: 'orders_total',
    help: 'Pedidos por transición de estado',
    labelNames: ['estado'],
    registers: [this.registro],
  });

  readonly ingresosCents = new Counter({
    name: 'orders_revenue_cents_total',
    help: 'Importe cobrado en céntimos',
    labelNames: ['moneda'],
    registers: [this.registro],
  });

  readonly pagosTotal = new Counter({
    name: 'payments_total',
    help: 'Intentos de pago por pasarela y resultado',
    labelNames: ['pasarela', 'resultado'],
    registers: [this.registro],
  });

  /** Llamadas al proveedor: si AliExpress se cae, esto lo enseña antes que los clientes. */
  readonly proveedorLlamadas = new Counter({
    name: 'supplier_calls_total',
    help: 'Llamadas a la API del proveedor',
    labelNames: ['proveedor', 'operacion', 'resultado'],
    registers: [this.registro],
  });

  readonly proveedorDuracion = new Histogram({
    name: 'supplier_call_duration_seconds',
    help: 'Duración de las llamadas al proveedor',
    labelNames: ['proveedor', 'operacion'],
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30],
    registers: [this.registro],
  });

  /**
   * Profundidad de las colas.
   *
   * Es la señal de saturación que se adelanta a todo lo demás: la cola crece
   * bastante antes de que la latencia HTTP se resienta, así que da margen para
   * escalar antes de que el cliente lo note.
   */
  readonly colaProfundidad = new Gauge({
    name: 'queue_depth',
    help: 'Trabajos en cola por estado',
    labelNames: ['cola', 'estado'],
    registers: [this.registro],
  });

  readonly outboxPendientes = new Gauge({
    name: 'outbox_pending',
    help: 'Eventos de dominio pendientes de publicar',
    registers: [this.registro],
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit(): void {
    // CPU, memoria, event loop lag y descriptores de fichero del proceso.
    collectDefaultMetrics({ register: this.registro, prefix: 'nodejs_' });
  }

  /**
   * Refresca las métricas que hay que consultar, no las que se van sumando.
   *
   * Se hace al raspar y no en un intervalo: si nadie mira, no se gastan
   * consultas contra Redis ni Postgres.
   */
  private async refrescarMedidas(): Promise<void> {
    try {
      for (const m of await this.queue.metricasTodas()) {
        this.colaProfundidad.set({ cola: m.nombre, estado: 'esperando' }, m.esperando);
        this.colaProfundidad.set({ cola: m.nombre, estado: 'activos' }, m.activos);
        this.colaProfundidad.set({ cola: m.nombre, estado: 'retrasados' }, m.retrasados);
        this.colaProfundidad.set({ cola: m.nombre, estado: 'fallidos' }, m.fallidos);
      }

      const pendientes = await this.prisma.client.outboxEvent.count({
        where: { publishedAt: null },
      });
      this.outboxPendientes.set(pendientes);
    } catch {
      // Que el raspado no reviente por una consulta caída: es preferible
      // servir métricas incompletas a no servir ninguna justo en la incidencia
      // en la que más falta hacen.
    }
  }

  async exportar(): Promise<string> {
    await this.refrescarMedidas();
    return this.registro.metrics();
  }

  get contentType(): string {
    return this.registro.contentType;
  }
}
