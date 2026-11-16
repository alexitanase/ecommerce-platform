import { Global, Module } from '@nestjs/common';
import { ImagesService } from './images.service.js';
import { MediaController } from './media.controller.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  controllers: [MediaController],
  providers: [StorageService, ImagesService],
  exports: [StorageService, ImagesService],
})
export class StorageModule {}
