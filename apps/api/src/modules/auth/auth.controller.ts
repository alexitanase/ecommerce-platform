import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import { AuthService, type ContextoPeticion } from './auth.service.js';
import { TokensService } from './tokens.service.js';
import { TwoFactorService } from './two-factor.service.js';
import {
  ChangePasswordDto,
  Disable2faDto,
  Enable2faDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto.js';

/** Nombre de la cookie donde viaja el refresh token. */
const COOKIE_REFRESH = 'refresh_token';

@ApiTags('Autenticación')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  // ── Registro y acceso ─────────────────────────────────────

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Crear una cuenta de cliente' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const resultado = await this.auth.registrar(dto, this.contexto(req));
    this.ponerCookie(res, resultado.refreshToken);
    return { accessToken: resultado.accessToken, user: resultado.user };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Límite generoso por IP a propósito: quien de verdad frena la fuerza bruta
  // es el bloqueo por cuenta (5 intentos). Un límite bajo por IP dejaría fuera
  // a usuarios legítimos que comparten salida —una oficina, o el CGNAT de una
  // operadora móvil—, que en España es lo habitual. Esto solo corta el escaneo masivo.
  @Throttle({ default: { limit: 60, ttl: 900_000 } })
  @ApiOperation({ summary: 'Iniciar sesión' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const resultado = await this.auth.login(dto, this.contexto(req));
    this.ponerCookie(res, resultado.refreshToken);
    return { accessToken: resultado.accessToken, user: resultado.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar el access token' })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    // Preferimos la cookie httpOnly: es inaccesible desde JavaScript, así que
    // un XSS no puede robarla. El cuerpo se admite para clientes no web.
    const token = req.cookies?.[COOKIE_REFRESH] ?? dto.refreshToken;
    if (!token) {
      throw new UnauthorizedException('Falta el refresh token');
    }

    const resultado = await this.auth.refrescar(token, this.contexto(req));
    // Sin token nuevo no se toca la cookie: ver ResultadoSesion.refreshToken.
    if (resultado.refreshToken) this.ponerCookie(res, resultado.refreshToken);
    return { accessToken: resultado.accessToken, user: resultado.user };
  }

  @ApiBearerAuth('access-token')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cerrar la sesión actual' })
  async logout(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(usuario.sessionId, this.contexto(req));
    void res.clearCookie(COOKIE_REFRESH, { path: '/' });
  }

  @ApiBearerAuth('access-token')
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar todas las demás sesiones' })
  async logoutAll(@CurrentUser() usuario: UsuarioAutenticado) {
    const cerradas = await this.auth.logoutTodas(usuario.id, usuario.sessionId);
    return { sesionesCerradas: cerradas };
  }

  // ── Perfil y sesiones ─────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get('me')
  @ApiOperation({ summary: 'Datos del usuario autenticado' })
  async me(@CurrentUser() usuario: UsuarioAutenticado) {
    const resultado = await this.auth.refrescarPerfil(usuario.id);
    return resultado;
  }

  @ApiBearerAuth('access-token')
  @Get('sessions')
  @ApiOperation({ summary: 'Sesiones activas del usuario' })
  async sesiones(@CurrentUser() usuario: UsuarioAutenticado) {
    const sesiones = await this.tokens.listarSesiones(usuario.id);
    return sesiones.map((s) => ({ ...s, actual: s.id === usuario.sessionId }));
  }

  // ── Email y contraseña ────────────────────────────────────

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verificar la dirección de email' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verificarEmail(dto.token);
    return { verificado: true };
  }

  /**
   * Reenviar el correo de verificación.
   *
   * Público y muy limitado: manda correos a una dirección que no es de quien
   * llama, así que sin freno sería una forma cómoda de usar nuestro servidor
   * para molestar a alguien. Tres por hora, como el de recuperar contraseña.
   */
  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Volver a enviar el correo de verificación' })
  async reenviarVerificacion(@Body() dto: ForgotPasswordDto) {
    await this.auth.reenviarVerificacion(dto.email);
    // Respuesta idéntica exista o no la cuenta, y esté o no ya verificada.
    return { mensaje: 'Si hace falta verificar esa dirección, recibirás el correo.' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Solicitar el restablecimiento de contraseña' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.solicitarReset(dto.email);
    // Respuesta idéntica exista o no la cuenta, para no revelar qué emails
    // están registrados.
    return { mensaje: 'Si existe una cuenta con ese email, recibirás las instrucciones.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Establecer una contraseña nueva con el token recibido' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: FastifyRequest) {
    await this.auth.restablecerPassword(dto.token, dto.password, this.contexto(req));
    return { mensaje: 'Contraseña actualizada. Vuelve a iniciar sesión.' };
  }

  @ApiBearerAuth('access-token')
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar la contraseña estando autenticado' })
  async changePassword(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Body() dto: ChangePasswordDto,
    @Req() req: FastifyRequest,
  ) {
    await this.auth.cambiarPassword(
      usuario.id,
      dto.currentPassword,
      dto.newPassword,
      usuario.sessionId,
      this.contexto(req),
    );
    return { mensaje: 'Contraseña actualizada. Las demás sesiones se han cerrado.' };
  }

  // ── Verificación en dos pasos ─────────────────────────────

  @ApiBearerAuth('access-token')
  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar el alta de 2FA: devuelve el QR' })
  async setup2fa(@CurrentUser() usuario: UsuarioAutenticado) {
    return this.twoFactor.iniciarAlta(usuario.id, usuario.email);
  }

  @ApiBearerAuth('access-token')
  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar el alta de 2FA con un código válido' })
  async enable2fa(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Body() dto: Enable2faDto,
    @Req() req: FastifyRequest,
  ) {
    return this.twoFactor.confirmarAlta(usuario.id, dto.totpCode, this.contexto(req));
  }

  @ApiBearerAuth('access-token')
  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desactivar la verificación en dos pasos' })
  async disable2fa(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Body() dto: Disable2faDto,
    @Req() req: FastifyRequest,
  ) {
    await this.twoFactor.desactivar(usuario.id, dto.password, dto.totpCode, this.contexto(req));
    return { mensaje: 'Verificación en dos pasos desactivada.' };
  }

  // ── Internos ──────────────────────────────────────────────

  private contexto(req: FastifyRequest): ContextoPeticion {
    return {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  /**
   * El refresh token va en cookie httpOnly y no en el cuerpo: si el storefront
   * sufre un XSS, el atacante no puede leerla desde JavaScript. `sameSite=lax`
   * corta el CSRF básico; en producción además viaja solo por HTTPS.
   */
  private ponerCookie(res: FastifyReply, refreshToken: string): void {
    void res.setCookie(COOKIE_REFRESH, refreshToken, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(this.tokens.msDesdeDuracion(this.env.JWT_REFRESH_TTL) / 1000),
    });
  }
}
