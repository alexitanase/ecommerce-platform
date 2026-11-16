import { Global, Module } from '@nestjs/common';
import { ConsentModule } from '../consent/consent.module.js';
import { AgeController } from './age.controller.js';
import { AgeService } from './age.service.js';

/**
 * Global: el catálogo necesita saber si el visitante está verificado para
 * decidir qué devuelve, y pasarlo módulo a módulo solo invita a que alguien
 * se lo salte.
 */
@Global()
@Module({
  imports: [ConsentModule],
  controllers: [AgeController],
  providers: [AgeService],
  exports: [AgeService],
})
export class AgeModule {}
