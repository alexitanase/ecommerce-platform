import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents, type JobsOptions } from 'bullmq';
import type { Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';
import { inyectarTraza } from '../../common/trazas.js';

/**
 * Colas de trabajo.
 *
 * Los nombres se declaran aquí como constantes y no como cadenas sueltas:
 * una errata en el nombre de una cola crea silenciosamente una cola nueva a la
 * que nadie escucha, y los trabajos se acumulan sin que nada falle.
 */
export const COLAS = {
  /** Envío de pedidos a los proveedores. Lo más crítico: mueve dinero. */
  FULFILLMENT: 'fulfillment',
  /** Consulta periódica del estado de los envíos. */
  TRACKING: 'tracking',
  /** Sincronización de precio y stock con proveedores. */
  SUPPLIER_SYNC: 'supplier-sync',
  /** Publicación de eventos de dominio desde la tabla outbox. */
  OUTBOX: 'outbox',
  /** Envío de correo transaccional. */
  EMAIL: 'email',
  /** Procesado de imágenes con IA. */
  IMAGES: 'images',
  /** Tareas de mantenimiento: limpiar reservas, purgar datos… */
  MAINTENANCE: 'maintenance',
} as const;

export type NombreCola = (typeof COLAS)[keyof typeof COLAS];

/**
 * Prioridades. En BullMQ, número más bajo = se atiende antes.
 *
 * Cuando la cola se llena en un pico de campaña, lo que no puede esperar es
 * mandar los pedidos al proveedor: un email de bienvenida que llega diez
 * minutos tarde no le importa a nadie; un pedido que sale dos horas tarde, sí.
 */
export const PRIORIDAD = {
  CRITICA: 1,
  ALTA: 3,
  NORMAL: 5,
  BAJA: 8,
} as const;

/**
 * Opciones por defecto de los trabajos.
 *
 * Cinco reintentos con espera exponencial desde 5 segundos: 5s, 10s, 20s, 40s,
 * 80s. Cubre las caídas breves de un proveedor sin machacarlo. Los trabajos
 * fallados se conservan para poder inspeccionarlos y relanzarlos desde el admin.
 */
const OPCIONES_BASE: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  // Los completados se limpian pronto: ocupan memoria de Redis sin aportar.
  removeOnComplete: { age: 3600, count: 1000 },
  // Los fallidos se conservan una semana: son la cola de incidencias.
  removeOnFail: { age: 7 * 24 * 3600 },
};

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly colas = new Map<NombreCola, Queue>();
  private readonly eventos = new Map<NombreCola, QueueEvents>();
  private readonly conexion: { url: string };

  constructor(@Inject(ENV) env: Env) {
    this.conexion = { url: env.REDIS_URL };
  }

  cola(nombre: NombreCola): Queue {
    const existente = this.colas.get(nombre);
    if (existente) return existente;

    const cola = new Queue(nombre, {
      connection: {
        url: this.conexion.url,
        // BullMQ lo exige: sin esto, ioredis aborta comandos en espera y los
        // workers pierden trabajos a medio procesar.
        maxRetriesPerRequest: null,
      },
      defaultJobOptions: OPCIONES_BASE,
    });

    this.colas.set(nombre, cola);
    return cola;
  }

  /**
   * Encola un trabajo.
   *
   * `jobId` sirve de clave de deduplicación: BullMQ ignora un trabajo cuyo id
   * ya existe. Es lo que impide que el mismo pedido se envíe dos veces al
   * proveedor si el evento llega duplicado.
   */
  async encolar<T extends object>(
    nombre: NombreCola,
    tipo: string,
    datos: T,
    opciones: JobsOptions & { jobId?: string } = {},
  ) {
    const cola = this.cola(nombre);
    // El contexto de traza viaja dentro del trabajo: sin esto, la petición
    // HTTP y el trabajo que desencadena son dos trazas sin relación y nadie
    // puede seguir un pedido de punta a punta.
    return cola.add(tipo, inyectarTraza(datos), { priority: PRIORIDAD.NORMAL, ...opciones });
  }

  /**
   * Programa un trabajo repetitivo (sincronizaciones, mantenimiento).
   *
   * Usa los **programadores** de BullMQ (`upsertJobScheduler`) y no los
   * antiguos `repeat`, por un motivo que costó un fallo en producción:
   *
   * `cola.add({ repeat })` **no actualiza** una programación que ya exista en
   * Redis. Se cambia el intervalo en el código, se despliega, y sigue corriendo
   * con el de antes; y como el trabajo se ejecuta —solo que cuando quería el
   * horario viejo— no hay ningún error que lo delate. Le pasó a las portadas de
   * categoría: se desplegó la tarea, en la tienda no aparecía ninguna foto, y
   * el motivo era que la primera ejecución estaba puesta para veinticuatro
   * horas después. `upsertJobScheduler`, como dice su nombre, sí sustituye la
   * programación anterior.
   *
   * **`alArrancar` decide cuándo es la primera vez.** Un programador nuevo
   * ejecuta el trabajo de inmediato, que es lo que se quiere cuando produce
   * algo visible —las fotos de las categorías— y lo que NO se quiere cuando
   * manda correos o purga datos: ahí, un reinicio de más no puede convertirse
   * en un correo de más. Por defecto la primera ejecución se retrasa un
   * intervalo completo, que es como se comportaba esto antes.
   */
  async programar<T extends object>(
    nombre: NombreCola,
    tipo: string,
    datos: T,
    patron: { every?: number; pattern?: string; alArrancar?: boolean },
  ) {
    const cola = this.cola(nombre);
    const { alArrancar = false, ...repeticion } = patron;

    /*
     * Se retiran las programaciones del mecanismo antiguo.
     *
     * Los `repeat` que creaba la versión anterior siguen vivos en Redis después
     * de desplegar, y conviven con el programador nuevo: la tarea quedaría
     * programada DOS veces y se ejecutaría el doble. Con la limpieza de
     * reservas o la purga da igual —son idempotentes—, pero `carritos.recuperar`
     * manda correos, y duplicarlos es escribir dos veces al mismo cliente.
     *
     * Se borran por nombre de trabajo, que es lo que identifica a la tarea con
     * independencia de cómo estuviera programada. Es una operación barata y que
     * a partir del segundo despliegue no encuentra nada: se deja puesta porque
     * el coste es cero y la alternativa es acordarse de limpiar Redis a mano.
     */
    for (const antiguo of await cola.getRepeatableJobs()) {
      if (antiguo.name === tipo) {
        await cola.removeRepeatableByKey(antiguo.key).catch(() => undefined);
      }
    }

    return cola.upsertJobScheduler(
      // Un identificador fijo por cola y tipo: es lo que hace que reprogramar
      // sustituya en vez de acumular una programación nueva en cada arranque.
      `repetitivo-${nombre}-${tipo}`,
      {
        ...repeticion,
        ...(alArrancar || !repeticion.every
          ? {}
          : { startDate: new Date(Date.now() + repeticion.every) }),
      },
      { name: tipo, data: datos },
    );
  }

  /** Métricas de una cola, para el centro de trabajos del admin. */
  async metricas(nombre: NombreCola) {
    const cola = this.cola(nombre);
    const [esperando, activos, completados, fallidos, retrasados, pausada] = await Promise.all([
      cola.getWaitingCount(),
      cola.getActiveCount(),
      cola.getCompletedCount(),
      cola.getFailedCount(),
      cola.getDelayedCount(),
      cola.isPaused(),
    ]);

    return { nombre, esperando, activos, completados, fallidos, retrasados, pausada };
  }

  async metricasTodas() {
    return Promise.all(Object.values(COLAS).map((c) => this.metricas(c)));
  }

  /** Trabajos fallidos: la cola de incidencias que revisa el equipo. */
  async fallidos(nombre: NombreCola, limite = 50) {
    const trabajos = await this.cola(nombre).getFailed(0, limite - 1);
    return trabajos.map((t) => ({
      id: t.id,
      nombre: t.name,
      datos: t.data as unknown,
      intentos: t.attemptsMade,
      error: t.failedReason,
      falloEn: t.finishedOn ? new Date(t.finishedOn) : null,
      traza: t.stacktrace?.slice(0, 3),
    }));
  }

  async reintentar(nombre: NombreCola, jobId: string): Promise<boolean> {
    const trabajo = await this.cola(nombre).getJob(jobId);
    if (!trabajo) return false;
    await trabajo.retry();
    this.logger.log(`Trabajo ${jobId} de la cola ${nombre} relanzado manualmente`);
    return true;
  }

  async descartar(nombre: NombreCola, jobId: string): Promise<boolean> {
    const trabajo = await this.cola(nombre).getJob(jobId);
    if (!trabajo) return false;
    await trabajo.remove();
    return true;
  }

  /** Reintenta de golpe todos los fallidos de una cola. */
  async reintentarTodos(nombre: NombreCola): Promise<number> {
    const trabajos = await this.cola(nombre).getFailed();
    await Promise.all(trabajos.map((t) => t.retry()));
    this.logger.log(`Relanzados ${trabajos.length} trabajos fallidos de ${nombre}`);
    return trabajos.length;
  }

  async pausar(nombre: NombreCola): Promise<void> {
    await this.cola(nombre).pause();
  }

  async reanudar(nombre: NombreCola): Promise<void> {
    await this.cola(nombre).resume();
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      ...[...this.colas.values()].map((c) => c.close()),
      ...[...this.eventos.values()].map((e) => e.close()),
    ]);
  }
}
