import { Global, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { MailService } from './mail.service.js';

/** Global: casi cualquier módulo acaba necesitando avisar por email. */
@Global()
@Module({
  imports: [SettingsModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
