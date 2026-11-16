import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';
import { StorefrontCacheService } from './storefront-cache.service.js';

/**
 * Global: la caché la usan catálogo, contenido y ajustes de marca, y no tiene
 * sentido importarla módulo a módulo.
 */
@Global()
@Module({
  providers: [CacheService, StorefrontCacheService],
  exports: [CacheService, StorefrontCacheService],
})
export class CacheModule {}
