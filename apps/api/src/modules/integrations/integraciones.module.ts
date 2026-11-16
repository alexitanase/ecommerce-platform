import { Global, Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto.service.js';
import { IntegracionesController } from './integraciones.controller.js';
import { IntegracionesService } from './integraciones.service.js';

/**
 * Global porque lo consultan los pagos, el correo, el traductor y el acceso
 * social. Sin esto, cuatro módulos tendrían que importarlo a mano y el quinto
 * que se añada se olvidará.
 */
@Global()
@Module({
  controllers: [IntegracionesController],
  providers: [IntegracionesService, CryptoService],
  exports: [IntegracionesService],
})
export class IntegracionesModule {}
