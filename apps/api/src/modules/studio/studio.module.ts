import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { ActivosService } from './activos.service.js';
import { CampanasService } from './campanas.service.js';
import { CreatividadesService } from './creatividades.service.js';
import { StudioController } from './studio.controller.js';

/**
 * Studio: fabricación del material de marketing.
 *
 * Depende de `StorageModule` porque la biblioteca de activos guarda ficheros, y
 * de nada más: campañas y creatividades solo necesitan la base de datos y el
 * registro de auditoría, que son globales. Ver STUDIO.md.
 */
@Module({
  imports: [StorageModule],
  controllers: [StudioController],
  providers: [CampanasService, CreatividadesService, ActivosService],
  exports: [CampanasService, CreatividadesService, ActivosService],
})
export class StudioModule {}
