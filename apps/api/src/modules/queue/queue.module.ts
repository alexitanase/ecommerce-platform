import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';
import { QueueService } from './queue.service.js';
import { QueueController } from './queue.controller.js';

/**
 * Global: prácticamente cualquier módulo necesita encolar trabajo o registrar
 * un evento de dominio.
 */
@Global()
@Module({
  controllers: [QueueController],
  providers: [QueueService, OutboxService],
  exports: [QueueService, OutboxService],
})
export class QueueModule {}
