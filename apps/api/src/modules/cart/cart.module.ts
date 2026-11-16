import { Module } from '@nestjs/common';
import { ConsentModule } from '../consent/consent.module.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';
import { RecuperacionService } from './recuperacion.service.js';

@Module({
  imports: [ConsentModule],
  controllers: [CartController],
  providers: [CartService, RecuperacionService],
  exports: [CartService, RecuperacionService],
})
export class CartModule {}
