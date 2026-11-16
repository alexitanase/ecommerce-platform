import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrismaHealthIndicator } from './indicators/prisma.health.js';
import { RedisHealthIndicator } from './indicators/redis.health.js';

/**
 * Sondas de salud.
 *
 * Separamos vivacidad de disponibilidad a propósito:
 *   · /health/live  — ¿el proceso responde? Si falla, hay que reiniciarlo.
 *   · /health/ready — ¿puede atender tráfico? Si falla, hay que sacarlo del
 *     balanceador, pero NO reiniciarlo: si Postgres se cae, reiniciar la API
 *     cada diez segundos no arregla nada y solo añade ruido.
 */
@ApiTags('Salud')
// Público y sin versión a propósito. Sin @Public() el guard global de
// autenticación devolvería 401 a la sonda del balanceador, que interpretaría
// la instancia como caída y la sacaría de rotación: el servicio entero se
// vendría abajo aunque funcionara perfectamente.
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Estado general del servicio' })
  root(): { status: string; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: 'ecom-api',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('live')
  @ApiOperation({ summary: 'Vivacidad · el proceso está en pie' })
  live(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Disponibilidad · dependencias accesibles' })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      (): Promise<HealthIndicatorResult> => this.prisma.isHealthy('database'),
      (): Promise<HealthIndicatorResult> => this.redis.isHealthy('redis'),
    ]);
  }
}
