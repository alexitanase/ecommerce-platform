import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';

/**
 * Conexión a Redis.
 *
 * Redis es aquí caché, rate limiting, locks distribuidos y el sustrato de las
 * colas BullMQ. `maxRetriesPerRequest: null` es obligatorio para BullMQ: sin
 * eso, ioredis aborta comandos en espera y los workers pierden trabajos.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    this.client.on('error', (err: Error) => this.logger.error(`Redis: ${err.message}`));
    this.client.on('ready', () => this.logger.log('Conectado a Redis'));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }
}
