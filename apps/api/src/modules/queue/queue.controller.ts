import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { replicasRecomendadas } from './escalado.js';
import { COLAS, QueueService, type NombreCola } from './queue.service.js';
import { OutboxService } from './outbox.service.js';

/**
 * Centro de trabajos del admin: ver qué hay en cola, qué ha fallado y
 * relanzarlo sin tocar la base de datos ni entrar por SSH.
 */
@ApiTags('Colas y trabajos')
@ApiBearerAuth('access-token')
@Controller({ path: 'jobs', version: '1' })
export class QueueController {
  constructor(
    private readonly queue: QueueService,
    private readonly outbox: OutboxService,
  ) {}

  @Get()
  @RequirePermissions('jobs:manage')
  @ApiOperation({ summary: 'Métricas de todas las colas' })
  async metricas() {
    const [colas, outbox] = await Promise.all([this.queue.metricasTodas(), this.outbox.metricas()]);
    return { colas, outbox };
  }

  /**
   * Cuántas réplicas de worker hacen falta ahora mismo.
   *
   * Lo lee un orquestador —o quien esté de guardia— para decidir si escalar.
   * Se publica aparte de las métricas de Prometheus porque la decisión incluye
   * el número actual de réplicas, que solo conoce quien pregunta.
   */
  @Get('escalado')
  @RequirePermissions('jobs:manage')
  @ApiOperation({ summary: 'Réplicas de worker recomendadas según la profundidad de las colas' })
  async escalado(@Query('replicas') replicas?: string) {
    const colas = await this.queue.metricasTodas();
    const actuales = Math.max(1, Number(replicas) || 1);

    return replicasRecomendadas(
      colas.map((c) => ({ cola: c.nombre, esperando: c.esperando, activos: c.activos })),
      actuales,
    );
  }

  @Get(':cola/failed')
  @RequirePermissions('jobs:manage')
  @ApiOperation({ summary: 'Trabajos fallidos de una cola' })
  fallidos(@Param('cola') cola: NombreCola, @Query('limite') limite?: string) {
    return this.queue.fallidos(cola, limite ? Number(limite) : 50);
  }

  @Post(':cola/:jobId/retry')
  @RequirePermissions('jobs:manage')
  @ApiOperation({ summary: 'Relanzar un trabajo fallido' })
  async reintentar(@Param('cola') cola: NombreCola, @Param('jobId') jobId: string) {
    const ok = await this.queue.reintentar(cola, jobId);
    return { reintentado: ok };
  }

  @Post(':cola/retry-all')
  @RequirePermissions('jobs:manage')
  @ApiOperation({ summary: 'Relanzar todos los fallidos de una cola' })
  async reintentarTodos(@Param('cola') cola: NombreCola) {
    const total = await this.queue.reintentarTodos(cola);
    return { relanzados: total };
  }

  @Delete(':cola/:jobId')
  @RequirePermissions('jobs:manage')
  @ApiOperation({ summary: 'Descartar un trabajo fallido' })
  async descartar(@Param('cola') cola: NombreCola, @Param('jobId') jobId: string) {
    const ok = await this.queue.descartar(cola, jobId);
    return { descartado: ok };
  }

  @Post(':cola/pause')
  @RequirePermissions('jobs:manage')
  @ApiOperation({ summary: 'Pausar una cola' })
  async pausar(@Param('cola') cola: NombreCola) {
    await this.queue.pausar(cola);
    return { pausada: true };
  }

  @Post(':cola/resume')
  @RequirePermissions('jobs:manage')
  @ApiOperation({ summary: 'Reanudar una cola' })
  async reanudar(@Param('cola') cola: NombreCola) {
    await this.queue.reanudar(cola);
    return { pausada: false };
  }

  @Get('outbox/failed')
  @RequirePermissions('jobs:manage')
  @ApiOperation({ summary: 'Eventos de dominio que no se han podido publicar' })
  outboxFallidos() {
    return this.outbox.fallidos();
  }

  @Post('outbox/:eventId/retry')
  @RequirePermissions('jobs:manage')
  @ApiOperation({ summary: 'Reintentar la publicación de un evento' })
  async outboxReintentar(@Param('eventId') eventId: string) {
    const ok = await this.outbox.reintentar(eventId);
    return { reintentado: ok };
  }

  @Get('queues/names')
  @RequirePermissions('jobs:manage')
  @ApiOperation({ summary: 'Nombres de las colas disponibles' })
  nombres() {
    return Object.values(COLAS);
  }
}
