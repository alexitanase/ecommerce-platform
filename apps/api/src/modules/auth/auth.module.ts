import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { PermissionsService } from './permissions.service.js';
import { TokensService } from './tokens.service.js';
import { TotpService } from './totp.service.js';
import { TwoFactorService } from './two-factor.service.js';
import { OAuthController } from './oauth/oauth.controller.js';
import { OAuthService } from './oauth/oauth.service.js';

/**
 * Módulo global: los guards de autenticación y permisos se aplican a toda la
 * aplicación, así que sus servicios deben estar disponibles en cualquier módulo.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, OAuthController],
  providers: [
    AuthService,
    PasswordService,
    PermissionsService,
    TokensService,
    TotpService,
    TwoFactorService,
    OAuthService,
  ],
  exports: [AuthService, PermissionsService, TokensService, PasswordService],
})
export class AuthModule {}
