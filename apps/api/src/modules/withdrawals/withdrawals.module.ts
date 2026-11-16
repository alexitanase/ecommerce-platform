import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { WithdrawalsController } from './withdrawals.controller.js';
import { WithdrawalsService } from './withdrawals.service.js';

@Module({
  imports: [OrdersModule, SettingsModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
