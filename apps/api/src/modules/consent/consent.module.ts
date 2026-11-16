import { Module } from '@nestjs/common';
import { ConsentController } from './consent.controller.js';
import { ConsentService } from './consent.service.js';
import { PreferenciasService } from './preferencias.service.js';
import { NewsletterService } from './newsletter.service.js';

@Module({
  controllers: [ConsentController],
  providers: [ConsentService, PreferenciasService, NewsletterService],
  exports: [ConsentService, PreferenciasService, NewsletterService],
})
export class ConsentModule {}
