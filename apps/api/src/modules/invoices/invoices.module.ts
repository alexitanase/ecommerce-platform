import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';

@Module({
  imports: [SettingsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
