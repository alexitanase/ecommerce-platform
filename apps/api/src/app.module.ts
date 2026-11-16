import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from './common/throttler-redis.storage.js';
import { AppConfigModule } from './config/config.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';
import { AddressesModule } from './modules/addresses/addresses.module.js';
import { ShippingModule } from './modules/shipping/shipping.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { SuppliersModule } from './modules/suppliers/suppliers.module.js';
import { WorkersModule } from './modules/queue/workers.module.js';
import { QueueModule } from './modules/queue/queue.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { PrivacyModule } from './modules/privacy/privacy.module.js';
import { AgeModule } from './modules/age/age.module.js';
import { ConsentModule } from './modules/consent/consent.module.js';
import { CouponsModule } from './modules/coupons/coupons.module.js';
import { ExperimentsModule } from './modules/experiments/experiments.module.js';
import { ChannelsModule } from './modules/channels/channels.module.js';
import { StudioModule } from './modules/studio/studio.module.js';
import { ContentModule } from './modules/content/content.module.js';
import { IntegracionesModule } from './modules/integrations/integraciones.module.js';
import { ComprobadoresModule } from './modules/integrations/comprobadores.module.js';
import { TraduccionModule } from './modules/translation/traduccion.module.js';
import { MailModule } from './modules/mail/mail.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { ReturnsModule } from './modules/returns/returns.module.js';
import { WithdrawalsModule } from './modules/withdrawals/withdrawals.module.js';
import { InvoicesModule } from './modules/invoices/invoices.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { CartModule } from './modules/cart/cart.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { MetricsModule } from './modules/metrics/metrics.module.js';
import { CacheModule } from './modules/cache/cache.module.js';
import { CacheHttpInterceptor } from './common/interceptors/cache-http.interceptor.js';
import { PrismaModule } from './modules/prisma/prisma.module.js';
import { RedisModule } from './modules/redis/redis.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { RolesModule } from './modules/roles/roles.module.js';
import { UsersModule } from './modules/users/users.module.js';

/**
 * Módulo raíz.
 *
 * Los tres guards globales se aplican en orden: primero el límite de peticiones
 * (rechaza antes de gastar nada), después la autenticación y por último los
 * permisos. Cada área de negocio entra aquí como módulo propio.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    AuditModule,
    AuthModule,
    HealthModule,
    MetricsModule,
    CacheModule,
    RolesModule,
    ReportsModule,
    UsersModule,
    AddressesModule,
    SettingsModule,
    MailModule,
    ContentModule,
    IntegracionesModule,
    // El último: enchufa cada servicio con su comprobación en el panel.
    ComprobadoresModule,
    TraduccionModule,
    CouponsModule,
    ExperimentsModule,
    ChannelsModule,
    StudioModule,
    ConsentModule,
    AgeModule,
    SearchModule,
    ShippingModule,
    StorageModule,
    QueueModule,
    CatalogModule,
    CartModule,
    SuppliersModule,
    OrdersModule,
    InvoicesModule,
    WithdrawalsModule,
    ReturnsModule,
    PaymentsModule,
    PrivacyModule,
    // Solo si este proceso consume colas. Con `WORKERS_ENABLED=false` la API
    // sigue encolando trabajos —QueueModule es global— pero no los procesa:
    // de eso se encarga el proceso de workers.
    ...(process.env['WORKERS_ENABLED'] === 'false' ? [] : [WorkersModule]),

    // El contador vive en Redis, no en memoria: con varias instancias de la API
    // detrás de un balanceador, un límite por proceso sería el límite
    // multiplicado por el número de instancias.
    ThrottlerModule.forRootAsync({
      useClass: ThrottlerStorageRedisService,
    }),
  ],
  providers: [
    // Cabeceras de caché y ETag en las respuestas marcadas como públicas.
    { provide: APP_INTERCEPTOR, useClass: CacheHttpInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
