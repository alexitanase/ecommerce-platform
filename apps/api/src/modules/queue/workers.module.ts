import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PrivacyModule } from '../privacy/privacy.module.js';
import { SuppliersModule } from '../suppliers/suppliers.module.js';
import { WorkersService } from './workers.service.js';

/**
 * Separado de QueueModule a propósito: QueueModule es global y lo usa todo el
 * mundo para encolar; este solo lo carga el proceso que CONSUME las colas.
 *
 * Quién lo carga lo decide `WORKERS_ENABLED`:
 *
 *  · En desarrollo va a `true` y todo corre en un proceso, que es cómodo.
 *  · En producción, la API arranca con `WORKERS_ENABLED=false` y los workers
 *    en su propio proceso (`node dist/main.workers.js`). Un proceso que sirve
 *    HTTP y a la vez sincroniza mil productos reparte el mismo bucle de
 *    eventos entre las dos cosas, y quien paga la latencia es el cliente que
 *    está en el checkout.
 *
 * La separación es además lo que permite escalar cada mitad por su señal: la
 * API por peticiones por segundo, los workers por profundidad de cola.
 */
@Module({
  imports: [
    OrdersModule,
    CatalogModule,
    SuppliersModule,
    PrivacyModule,
    CartModule,
    ChannelsModule,
  ],
  providers: [WorkersService],
})
export class WorkersModule {}
