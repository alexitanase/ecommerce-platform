import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { RedisService } from '../../redis/redis.service.js';
import { withTimeout } from '../../../common/with-timeout.js';

/** Si Redis no contesta en este tiempo, lo damos por caído. */
const LIMITE_MS = 2000;

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly redis: RedisService,
    private readonly indicator: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(key);
    const inicio = Date.now();
    try {
      // El cliente usa maxRetriesPerRequest: null por exigencia de BullMQ, así
      // que un ping contra un Redis caído esperaría para siempre. El límite
      // convierte esa espera en una respuesta "down" inmediata.
      await withTimeout(this.redis.ping(), LIMITE_MS);
      return check.up({ latencyMs: Date.now() - inicio });
    } catch (error) {
      return check.down({
        message: error instanceof Error ? error.message : 'Sin conexión',
        latencyMs: Date.now() - inicio,
      });
    }
  }
}
