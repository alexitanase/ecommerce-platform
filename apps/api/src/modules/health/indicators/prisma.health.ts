import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service.js';
import { withTimeout } from '../../../common/with-timeout.js';

/** Si Postgres no contesta en este tiempo, lo damos por caído. */
const LIMITE_MS = 3000;

@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indicator: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(key);
    const inicio = Date.now();
    try {
      await withTimeout(this.prisma.ping(), LIMITE_MS);
      return check.up({ latencyMs: Date.now() - inicio });
    } catch (error) {
      return check.down({
        message: error instanceof Error ? error.message : 'Sin conexión',
        latencyMs: Date.now() - inicio,
      });
    }
  }
}
