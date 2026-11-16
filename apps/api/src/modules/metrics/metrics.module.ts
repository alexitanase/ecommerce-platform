import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsController } from './metrics.controller.js';
import { MetricsInterceptor } from './metrics.interceptor.js';
import { MetricsService } from './metrics.service.js';

/**
 * Global: cualquier servicio puede querer sumar una métrica de negocio
 * (un pago aceptado, una llamada al proveedor) sin tener que importar el módulo.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
  exports: [MetricsService],
})
export class MetricsModule {}
