import { Module } from '@nestjs/common';
import { TraduccionController } from './traduccion.controller.js';
import { TraduccionService } from './traduccion.service.js';

@Module({
  controllers: [TraduccionController],
  providers: [TraduccionService],
  exports: [TraduccionService],
})
export class TraduccionModule {}
