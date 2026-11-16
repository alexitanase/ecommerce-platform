import { Module } from '@nestjs/common';
import { ConsentModule } from '../consent/consent.module.js';
import { ShippingModule } from '../shipping/shipping.module.js';
import { CartModule } from '../cart/cart.module.js';
import { CouponsModule } from '../coupons/coupons.module.js';
import { ExperimentsModule } from '../experiments/experiments.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { SuppliersModule } from '../suppliers/suppliers.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { RiesgoService } from './riesgo.service.js';
import { FulfillmentService } from './fulfillment.service.js';
import { TrackingService } from './tracking.service.js';
import { SeguimientoTransportistaService } from './seguimiento-transportista.service.js';

@Module({
  imports: [
    ShippingModule,
    CartModule,
    CouponsModule,
    ExperimentsModule,
    ChannelsModule,
    CatalogModule,
    SuppliersModule,
    ConsentModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    FulfillmentService,
    TrackingService,
    SeguimientoTransportistaService,
    RiesgoService,
  ],
  exports: [
    OrdersService,
    FulfillmentService,
    TrackingService,
    SeguimientoTransportistaService,
    RiesgoService,
  ],
})
export class OrdersModule {}
