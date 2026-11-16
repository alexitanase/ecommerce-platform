import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsController } from './payments.controller.js';
import { RefundsController } from './refunds.controller.js';
import { RefundsService } from './refunds.service.js';
import { PaymentsService } from './payments.service.js';

@Module({
  imports: [OrdersModule],
  controllers: [PaymentsController, RefundsController],
  providers: [PaymentsService, RefundsService],
  exports: [PaymentsService, RefundsService],
})
export class PaymentsModule {}
