import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';
import { FulfillmentService } from '../orders/fulfillment.service.js';
import { InventoryService } from '../catalog/services/inventory.service.js';
import { PortadasCategoriasService } from '../catalog/services/portadas-categorias.service.js';
import { SolicitudResenasService } from '../catalog/services/solicitud-resenas.service.js';
import { PrivacyService } from '../privacy/privacy.service.js';
import { SupplierSyncService } from '../suppliers/sync.service.js';
import { TrackingService } from '../orders/tracking.service.js';
import { ChannelsService } from '../channels/channels.service.js';
import { OutboxService } from './outbox.service.js';
import { RecuperacionService } from '../cart/recuperacion.service.js';
import { COLAS, QueueService } from './queue.service.js';
import { conTrazaDelTrabajo, marcar } from '../../common/trazas.js';

/**
 * Procesadores de las colas.
 *
 * En producción conviene arrancarlos en un proceso aparte de la API
 * (`apps/worker`), para poder escalar el número de workers según la
 * profundidad de la cola sin tocar las instancias que sirven tráfico web. Aquí
 * viven en el mismo proceso porque simplifica el entorno de desarrollo; la
 * separación está anotada como tarea de la fase de escalado.
 */
@Injectable()
export class WorkersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkersService.name);
  private readonly workers: Worker[] = [];

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly queue: QueueService,
    private readonly outbox: OutboxService,
    private readonly fulfillment: FulfillmentService,
    private readonly inventory: InventoryService,
    private readonly portadas: PortadasCategoriasService,
    private readonly resenas: SolicitudResenasService,
    private readonly privacy: PrivacyService,
    private readonly recuperacion: RecuperacionService,
    private readonly sync: SupplierSyncService,
    private readonly canales: ChannelsService,
    private readonly tracking: TrackingService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.crearWorkers();
    await this.programarTareasPeriodicas();
  }

  private get conexion() {
    return { url: this.env.REDIS_URL, maxRetriesPerRequest: null };
  }

  private crearWorkers(): void {
    // ── Fulfillment: lo más crítico, poca concurrencia ──
    // Se limita a 3 en paralelo a propósito: los proveedores tienen cuota de
    // peticiones y lanzar veinte a la vez provocaría que nos limiten.
    this.registrar(
      COLAS.FULFILLMENT,
      async (job) => {
        const datos = job.data as { aggregateId: string; payload: { orderId?: string } };
        const orderId = datos.payload?.orderId ?? datos.aggregateId;

        if (job.name === 'order.paid') {
          const resultado = await this.fulfillment.procesar(orderId);
          return resultado;
        }

        if (job.name === 'order.cancelled') {
          this.logger.log(`Cancelación de ${orderId}: pendiente de cancelar en el proveedor`);
          return { cancelado: true };
        }

        return { ignorado: job.name };
      },
      3,
    );

    // ── Outbox: publica los eventos pendientes ──
    this.registrar(
      COLAS.OUTBOX,
      async () => {
        await this.outbox.recuperarAtascados();
        return this.outbox.publicarPendientes();
      },
      1,
    );

    // ── Sincronización con proveedores ──
    this.registrar(
      COLAS.SUPPLIER_SYNC,
      async (job) => {
        if (job.name === 'sync.pendientes') {
          const ids = await this.sync.proveedoresPendientes();
          for (const id of ids) {
            await this.queue.encolar(COLAS.SUPPLIER_SYNC, 'sync.proveedor', { supplierId: id });
          }
          return { encolados: ids.length };
        }

        const { supplierId } = job.data as { supplierId: string };
        return this.sync.sincronizar(supplierId, { tipo: 'incremental' });
      },
      2,
    );

    // ── Mantenimiento ──
    this.registrar(
      COLAS.MAINTENANCE,
      async (job) => {
        if (job.name === 'reservas.limpiar') {
          const liberadas = await this.inventory.limpiarReservasCaducadas();
          return { liberadas };
        }
        if (job.name === 'datos.purgar') {
          return this.privacy.purgar();
        }
        if (job.name === 'comisiones.aprobar') {
          const aprobadas = await this.canales.aprobarVencidas();
          return { aprobadas };
        }
        if (job.name === 'carritos.recuperar') {
          const carritos = await this.recuperacion.enviarAvisos();
          const pagos = await this.recuperacion.avisarPagosCaducados();
          return { carritos, pagos };
        }
        if (job.name === 'categorias.portadas') {
          return this.portadas.refrescarCaducadas();
        }
        if (job.name === 'resenas.solicitar') {
          return this.resenas.solicitarPendientes();
        }
        return { ignorado: job.name };
      },
      1,
    );

    /*
     * ── Seguimiento de envíos ──
     *
     * Esta cola existía sin procesador: los trabajos entraban y se descartaban
     * con un aviso en el registro que nadie lee. `TrackingService` estaba
     * escrito y probado, pero no lo llamaba nadie, así que **ningún pedido
     * cambió nunca de estado solo**. En el panel se quedaban en «enviado al
     * proveedor» para siempre mientras el paquete viajaba, y la única forma de
     * saber dónde estaba era entrar en AliExpress a mirarlo.
     *
     * Concurrencia 2, no más: cada actualización son dos llamadas al proveedor
     * y hay cuota. Con pocos pedidos da igual, y con muchos importa mucho.
     */
    this.registrar(
      COLAS.TRACKING,
      async (job) => {
        if (job.name === 'seguimiento.pendientes') {
          const ids = await this.tracking.pendientes();
          for (const id of ids) {
            await this.queue.encolar(COLAS.TRACKING, 'seguimiento.actualizar', {
              supplierOrderId: id,
            });
          }
          return { encolados: ids.length };
        }

        /*
         * Un pedido recién puesto al proveedor.
         *
         * Se consulta enseguida y no se espera al repaso periódico: el primer
         * estado —«el vendedor lo ha aceptado»— es el que confirma que la
         * compra existe de verdad, y es lo que hay que ver antes de decirle
         * nada al cliente.
         */
        if (job.name === 'supplier_order.placed') {
          const datos = job.data as {
            aggregateId?: string;
            payload?: { supplierOrderId?: string };
          };
          const id = datos.payload?.supplierOrderId ?? datos.aggregateId;
          if (!id) return { ignorado: 'sin identificador de sub-pedido' };
          return this.tracking.actualizar(id);
        }

        if (job.name === 'seguimiento.actualizar') {
          const { supplierOrderId } = job.data as { supplierOrderId: string };
          return this.tracking.actualizar(supplierOrderId);
        }

        return { ignorado: job.name };
      },
      2,
    );

    /*
     * ── Colas sin procesador propio ──
     *
     * Estas dos reciben eventos cuyo trabajo YA se ha hecho de forma síncrona
     * en el servicio que los emitió: los cuatro correos que se enrutan a
     * `email` los manda `MailService` directamente desde `tracking.service`,
     * `auth.service` y `orders.service`, y las imágenes de `product.imported`
     * las procesa el importador antes de terminar. El trabajo encolado es, hoy,
     * una duplicidad: descartarlo es correcto.
     *
     * Lo que NO era correcto es que `tracking` estuviera en esta lista. Ahí el
     * trabajo no lo hacía nadie más, así que cada `supplier_order.placed`
     * entraba, se daba por completado sin hacer nada y el pedido se quedaba con
     * el estado del día que se compró. Un aviso en el registro no lo delató en
     * semanas.
     *
     * Regla que deja esto: antes de meter una cola aquí hay que poder señalar
     * quién hace ese trabajo. Si la respuesta es «nadie todavía», no va en esta
     * lista: va implementada o el evento no se enruta.
     */
    for (const cola of [COLAS.EMAIL, COLAS.IMAGES]) {
      this.registrar(
        cola,
        (job) => {
          this.logger.debug(
            `Cola "${cola}": "${job.name}" ya se atendió de forma síncrona; nada que hacer.`,
          );
          return Promise.resolve({ atendidoDeFormaSincrona: true });
        },
        1,
      );
    }
  }

  /**
   * Saca del trabajo los identificadores por los que luego se busca en Jaeger.
   *
   * Filtrar por `pedido.id` y ver la historia completa —clic en pagar, cola,
   * llamada al proveedor— es la diferencia entre poder responder a un cliente
   * y tener que decirle que lo miraremos.
   */
  private identificadoresDeNegocio(job: Job): Record<string, string | undefined> {
    const datos = job.data as {
      aggregateId?: string;
      orderId?: string;
      supplierId?: string;
      payload?: { orderId?: string };
    };

    return {
      'pedido.id': datos.payload?.orderId ?? datos.orderId ?? datos.aggregateId,
      'proveedor.id': datos.supplierId,
    };
  }

  private registrar(
    nombre: string,
    procesador: (job: Job) => Promise<unknown>,
    concurrencia: number,
  ): void {
    // Todo procesador pasa por aquí, así que la continuación de traza se
    // aplica una vez y vale para todas las colas.
    const conTraza = (job: Job): Promise<unknown> =>
      conTrazaDelTrabajo(
        job.data as Record<string, unknown>,
        `cola ${nombre} · ${job.name}`,
        () => {
          marcar({
            'cola.nombre': nombre,
            'cola.trabajo': job.name,
            'cola.intento': job.attemptsMade + 1,
            ...this.identificadoresDeNegocio(job),
          });
          return procesador(job);
        },
      );

    const worker = new Worker(nombre, conTraza, {
      connection: this.conexion,
      concurrency: concurrencia,
      // Un trabajo que tarde más de cinco minutos se da por colgado.
      lockDuration: 300_000,
    });

    worker.on('failed', (job, error) => {
      this.logger.error(
        `[${nombre}] Trabajo ${job?.id ?? '?'} (${job?.name ?? '?'}) fallido ` +
          `en el intento ${job?.attemptsMade ?? 0}: ${error.message}`,
      );
    });

    worker.on('error', (error) => {
      this.logger.error(`[${nombre}] Error del worker: ${error.message}`);
    });

    this.workers.push(worker);
  }

  /**
   * Tareas que se ejecutan solas.
   *
   * El outbox cada 5 segundos: es el que convierte "pedido pagado" en "pedido
   * enviado al proveedor", así que un intervalo largo se traduce directamente
   * en retraso para el cliente.
   */
  private async programarTareasPeriodicas(): Promise<void> {
    await this.queue.programar(COLAS.OUTBOX, 'outbox.publicar', {}, { every: 5_000 });
    await this.queue.programar(COLAS.MAINTENANCE, 'reservas.limpiar', {}, { every: 5 * 60_000 });

    // Cada quince minutos: la primera etapa se envía a la hora de abandonar el
    // carrito, así que este intervalo solo añade unos minutos de retraso y
    // evita repasar todos los carritos cada minuto para no hacer nada.
    await this.queue.programar(COLAS.MAINTENANCE, 'carritos.recuperar', {}, { every: 15 * 60_000 });
    await this.queue.programar(COLAS.SUPPLIER_SYNC, 'sync.pendientes', {}, { every: 15 * 60_000 });

    /*
     * El repaso de envíos, cada media hora.
     *
     * No decide él con qué frecuencia se consulta cada pedido: eso lo calcula
     * `TrackingService.pendientes()` según los días que lleve enviado —cada 6 h
     * los primeros días, cada 24 h a partir de la tercera semana—. Este trabajo
     * solo pregunta a qué pedidos les toca ya. Media hora es el grano más fino
     * que tiene sentido: consultarlos todos cada minuto agotaría la cuota del
     * proveedor sin adelantar nada.
     */
    await this.queue.programar(
      COLAS.TRACKING,
      'seguimiento.pendientes',
      {},
      { every: 30 * 60_000 },
    );

    // Una vez al día basta: los plazos de conservación se miden en años, así
    // que ejecutarla más a menudo solo añade carga sin adelantar nada.
    await this.queue.programar(COLAS.MAINTENANCE, 'datos.purgar', {}, { every: 24 * 3600_000 });

    // También a diario: lo que se aprueba es que ya venció el plazo de
    // devolución de catorce días, y un día arriba o abajo no cambia nada. Lo
    // que sí importa es que no se apruebe antes de tiempo.
    await this.queue.programar(
      COLAS.MAINTENANCE,
      'comisiones.aprobar',
      {},
      { every: 24 * 3600_000 },
    );

    /*
     * Las portadas de las categorías, una vez al día y también AL ARRANCAR.
     *
     * Lo que se renueva dura dieciocho días, así que el intervalo no decide
     * cada cuánto cambia la foto: decide cada cuánto se pregunta a quién le
     * toca. Diario es el grano que hace falta para que el cupo del repaso
     * —ciento cincuenta— reparta el catálogo entero en unos días sin que se
     * note, y para que una categoría recién creada tenga foto mañana en lugar
     * de la semana que viene.
     *
     * El `alArrancar` es lo que faltaba, y se pagó caro: por defecto, BullMQ
     * pone la primera ejecución veinticuatro horas DESPUÉS de arrancar. Se desplegó
     * la función y en producción las 318 categorías siguieron sin foto, que
     * desde fuera no se lee como «todavía no le ha tocado» sino como «esto no
     * funciona». Repetirlo en cada arranque no cuesta nada: solo toca las que
     * llevan más de dieciocho días sin refrescar, así que recién ejecutado es
     * una consulta indexada que devuelve cero filas.
     */
    await this.queue.programar(
      COLAS.MAINTENANCE,
      'categorias.portadas',
      {},
      { every: 24 * 3600_000, alArrancar: true },
    );

    /*
     * Pedir valoración de lo entregado, una vez al día.
     *
     * SIN `alArrancar`: manda correos a clientes reales, y un despliegue no
     * puede convertirse en una tanda de correos. Que la primera vuelta sea
     * mañana no le importa a nadie; que se repita en cada reinicio, sí.
     */
    await this.queue.programar(
      COLAS.MAINTENANCE,
      'resenas.solicitar',
      {},
      { every: 24 * 3600_000 },
    );

    this.logger.log(
      'Tareas periódicas programadas: outbox, limpieza de reservas, sincronización, ' +
        'seguimiento de envíos, recuperación de carritos, purga de datos, aprobación de ' +
        'comisiones, portadas de categoría y peticiones de valoración',
    );
  }

  async onModuleDestroy(): Promise<void> {
    // Cierre ordenado: espera a que terminen los trabajos en curso para no
    // dejar un pedido a medio enviar al proveedor.
    await Promise.all(this.workers.map((w) => w.close()));
    this.logger.log('Workers detenidos');
  }
}
