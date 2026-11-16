import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { CouponsController } from './coupons.controller.js';
import { CouponsService } from './coupons.service.js';
import { ReferidosController } from './referidos.controller.js';
import { ReferidosService } from './referidos.service.js';

@Module({
  imports: [SettingsModule],
  controllers: [CouponsController, ReferidosController],
  providers: [CouponsService, ReferidosService],
  exports: [CouponsService, ReferidosService],
})
export class CouponsModule {}
