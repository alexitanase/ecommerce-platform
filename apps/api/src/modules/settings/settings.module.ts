import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';
import { TipoCambioService } from './tipo-cambio.service.js';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, TipoCambioService],
  exports: [SettingsService, TipoCambioService],
})
export class SettingsModule {}
