import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { ComprobadoresService } from './comprobadores.service.js';

/**
 * Módulo aparte, y no dentro de IntegracionesModule, para romper el ciclo:
 * pagos, correo, almacenamiento y buscador dependen de las integraciones, así
 * que las integraciones no pueden depender de ellos. Este módulo se carga el
 * último y los une.
 */
@Module({
  imports: [SearchModule, StorageModule, PaymentsModule, OrdersModule, SettingsModule],
  providers: [ComprobadoresService],
})
export class ComprobadoresModule {}
