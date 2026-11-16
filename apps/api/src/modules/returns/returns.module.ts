import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { ReturnsController } from './returns.controller.js';
import { ReturnsService } from './returns.service.js';

@Module({
  imports: [OrdersModule, CatalogModule, ChannelsModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
