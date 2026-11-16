import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { FeedService } from './feed.service.js';

@Module({
  imports: [CartModule],
  controllers: [ReportsController],
  providers: [ReportsService, FeedService],
  exports: [ReportsService],
})
export class ReportsModule {}
