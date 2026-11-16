import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import { newId, type Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from './password.service.js';
import { PermissionsService } from './permissions.service.js';
import { TokensService } from './tokens.service.js';
import { TotpService } from './totp.service.js';
import { MailService } from '../mail/mail.service.js';
import type { LoginDto, RegisterDto } from './dto/auth.dto.js';

export interface ContextoPeticion {
  ip?: string;
  userAgent?: string;
}

export interface ResultadoSesion {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    type: string;
    locale: string;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
    permissions: string[];
  };
}

/**
 * Lo que devuelve un refresco, que no siempre trae token nuevo.
 *
 * Al entrar o registrarse siempre hay uno; al refrescar puede no haberlo, y es
 * lo correcto: si el token presentado es el que se acaba de gastar —dos
 * pestañas a la vez, un reintento de la red— la cookie buena ya la dejó la
 * petición que sí rotó, y pisarla rompería justo lo que se quiere arreglar.
 * Ver TokensService.rotar.
 */
export type ResultadoRefresco = Omit<ResultadoSesion, 'refreshToken'> & { refreshToken?: string };

/** Intentos fallidos consecutivos antes de bloquear temporalmente la cuenta. */
const INTENTOS_MAXIMOS = 5;
const BLOQUEO_SEGUNDOS = 900;
const CLAVE_INTENTOS = 'auth:intentos:';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly permisos: PermissionsService,
    private readonly totp: TotpService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // ── Registro ──────────────────────────────────────────────

  async registrar(dto: RegisterDto, ctx: ContextoPeticion): Promise<ResultadoSesion> {
    const existente = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (existente) {
      // Se responde igual que si el email fuera nuevo sería lo ideal para no
      // filtrar qué cuentas existen, pero entonces el usuario legítimo que ya
      // tiene cuenta no entiende por qué no puede entrar. El compromiso: se
      // rechaza aquí, y a cambio el rate limiting impide enumerar en masa.
      throw new ConflictException('Ya existe una cuenta con este email');
    }

    const usuario = await this.prisma.client.user.create({
      data: {
        id: newId(),
        email: dto.email,
        password: await this.passwords.hash(dto.password),
        firstName: dto.firstName ?? null,
        lastName: dto.lastName ?? null,
        locale: dto.locale,
        type: 'CUSTOMER',
        marketingConsentAt: dto.marketingConsent ? new Date() : null,
      },
    });

    await this.crearTokenVerificacion(usuario.id);

    await this.audit.registrar({
      action: 'auth.register',
      resource: 'user',
      resourceId: usuario.id,
      actorId: usuario.id,
      actorIp: ctx.ip,
    });

    return this.emitirSesion(usuario.id, ctx);
  }

  // ── Login ─────────────────────────────────────────────────

  async login(dto: LoginDto, ctx: ContextoPeticion): Promise<ResultadoSesion> {
    await this.comprobarBloqueo(dto.email);

    const usuario = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        password: true,
        isActive: true,
        deletedAt: true,
        totpSecret: true,
        totpEnabledAt: true,
        type: true,
      },
    });

    // Se gasta el mismo tiempo aunque el usuario no exista, para que no se
    // pueda deducir qué emails están registrados midiendo la respuesta.
    if (!usuario?.password) {
      await this.passwords.fakeVerify();
      await this.registrarIntentoFallido(dto.email);
      throw new UnauthorizedException('Email o contraseña incorrectos');
    }

    const valida = await this.passwords.verify(usuario.password, dto.password);
    if (!valida) {
      await this.registrarIntentoFallido(dto.email);
      throw new UnauthorizedException('Email o contraseña incorrectos');
    }

    if (!usuario.isActive || usuario.deletedAt) {
      throw new UnauthorizedException('La cuenta no está disponible');
    }

    // ── Segundo factor ──
    if (usuario.totpEnabledAt && usuario.totpSecret) {
      if (!dto.totpCode) {
        throw new UnauthorizedException({
          message: 'Se requiere el código de verificación en dos pasos',
          error: 'TOTP_REQUIRED',
          statusCode: 401,
        });
      }
      const correcto = this.totp.verificar(usuario.totpSecret, dto.totpCode);
      if (!correcto) {
        await this.registrarIntentoFallido(dto.email);
        throw new UnauthorizedException('Código de verificación incorrecto');
      }
    }

    await this.limpiarIntentos(dto.email);

    // Si endurecemos los parámetros de Argon2, la contraseña se actualiza sola.
    if (this.passwords.needsRehash(usuario.password)) {
      await this.prisma.client.user.update({
        where: { id: usuario.id },
        data: { password: await this.passwords.hash(dto.password) },
      });
    }

    await this.prisma.client.user.update({
      where: { id: usuario.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.registrar({
      action: 'auth.login',
      resource: 'user',
      resourceId: usuario.id,
      actorId: usuario.id,
      actorIp: ctx.ip,
      metadata: { userAgent: ctx.userAgent },
    });

    return this.emitirSesion(usuario.id, ctx);
  }

  // ── Refresh ───────────────────────────────────────────────

  async refrescar(refreshToken: string, ctx: ContextoPeticion): Promise<ResultadoRefresco> {
    const rotado = await this.tokens.rotar(refreshToken, ctx);

    const usuario = await this.cargarUsuario(rotado.userId);
    const accessToken = await this.tokens.firmarAccessToken({
      sub: usuario.id,
      sid: rotado.sessionId,
      typ: usuario.type,
    });

    return {
      accessToken,
      ...(rotado.refreshToken ? { refreshToken: rotado.refreshToken } : {}),
      user: usuario,
    };
  }

  // ── Cierre de sesión ──────────────────────────────────────

  async logout(sessionId: string, ctx: ContextoPeticion): Promise<void> {
    await this.tokens.revocarSesion(sessionId);
    await this.audit.registrar({
      action: 'auth.logout',
      resource: 'session',
      resourceId: sessionId,
      actorIp: ctx.ip,
    });
  }

  async logoutTodas(userId: string, sessionIdActual: string): Promise<number> {
    return this.tokens.revocarTodasLasSesiones(userId, sessionIdActual);
  }

  // ── Verificación de email ─────────────────────────────────

  async crearTokenVerificacion(userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');

    await this.prisma.client.verificationToken.create({
      data: {
        id: newId(),
        userId,
        purpose: 'EMAIL_VERIFICATION',
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const usuario = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, firstName: true, locale: true },
    });

    // El envío no bloquea el registro: si el correo falla, la cuenta ya está
    // creada y el usuario puede pedir otro email de verificación.
    void this.mail
      .verificarEmail({
        email: usuario.email,
        nombre: usuario.firstName,
        token,
        locale: usuario.locale,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `No se ha podido enviar la verificación a ${usuario.email}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      });

    return token;
  }

  /**
   * Vuelve a mandar el correo de verificación.
   *
   * Sin esto, quien no recibiera el primero —correo en spam, servicio de envío
   * mal configurado, dirección tecleada con una errata que luego se corrige— se
   * quedaba **sin ninguna forma de verificar su email**. Y eso no es un detalle
   * cosmético: de la verificación depende que la cuenta pueda adoptar los
   * pedidos que se hicieran sin sesión.
   *
   * No dice si la cuenta existe ni si ya estaba verificada: la respuesta es la
   * misma siempre. Distinguirlas convertiría esto en un comprobador de emails
   * registrados.
   */
  async reenviarVerificacion(email: string): Promise<void> {
    const usuario = await this.prisma.client.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true, isActive: true, deletedAt: true },
    });

    if (!usuario || usuario.emailVerifiedAt || !usuario.isActive || usuario.deletedAt) {
      this.logger.debug(`Reenvío de verificación ignorado para ${email}`);
      return;
    }

    await this.crearTokenVerificacion(usuario.id);
  }

  async verificarEmail(token: string): Promise<void> {
    const registro = await this.consumirToken(token, 'EMAIL_VERIFICATION');
    await this.prisma.client.user.update({
      where: { id: registro.userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  // ── Recuperación de contraseña ────────────────────────────

  async solicitarReset(email: string): Promise<void> {
    const usuario = await this.prisma.client.user.findUnique({
      where: { email },
      select: { id: true },
    });

    // Se responde siempre igual exista o no la cuenta: si distinguiéramos,
    // este endpoint sería un comprobador gratuito de emails registrados.
    if (!usuario) {
      this.logger.debug(`Solicitud de reset para email no registrado: ${email}`);
      return;
    }

    // Un solo token vivo por usuario: pedir uno nuevo invalida el anterior.
    await this.prisma.client.verificationToken.updateMany({
      where: { userId: usuario.id, purpose: 'PASSWORD_RESET', usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = crypto.randomBytes(32).toString('base64url');
    await this.prisma.client.verificationToken.create({
      data: {
        id: newId(),
        userId: usuario.id,
        purpose: 'PASSWORD_RESET',
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const datos = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: usuario.id },
      select: { email: true, firstName: true, locale: true },
    });

    void this.mail
      .restablecerPassword({
        email: datos.email,
        nombre: datos.firstName,
        token,
        locale: datos.locale,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `No se ha podido enviar el restablecimiento a ${datos.email}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      });
  }

  async restablecerPassword(token: string, nueva: string, ctx: ContextoPeticion): Promise<void> {
    const registro = await this.consumirToken(token, 'PASSWORD_RESET');

    await this.prisma.client.user.update({
      where: { id: registro.userId },
      data: { password: await this.passwords.hash(nueva) },
    });

    // Cambiar la contraseña cierra todas las sesiones: si el motivo del cambio
    // es que alguien te la había robado, dejarle la sesión abierta no arregla nada.
    const cerradas = await this.tokens.revocarTodasLasSesiones(registro.userId);

    await this.audit.registrar({
      action: 'auth.password_reset',
      resource: 'user',
      resourceId: registro.userId,
      actorId: registro.userId,
      actorIp: ctx.ip,
      metadata: { sesionesCerradas: cerradas },
    });
  }

  async cambiarPassword(
    userId: string,
    actual: string,
    nueva: string,
    sessionIdActual: string,
    ctx: ContextoPeticion,
  ): Promise<void> {
    const usuario = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { password: true },
    });

    if (!usuario.password || !(await this.passwords.verify(usuario.password, actual))) {
      throw new UnauthorizedException('La contraseña actual no es correcta');
    }

    await this.prisma.client.user.update({
      where: { id: userId },
      data: { password: await this.passwords.hash(nueva) },
    });

    // Se cierran las demás sesiones pero se conserva la actual, para no echar
    // al usuario de la pantalla en la que acaba de cambiar su contraseña.
    await this.tokens.revocarTodasLasSesiones(userId, sessionIdActual);

    await this.audit.registrar({
      action: 'auth.password_change',
      resource: 'user',
      resourceId: userId,
      actorId: userId,
      actorIp: ctx.ip,
    });
  }

  /** Perfil y permisos actuales, para el endpoint /auth/me. */
  async refrescarPerfil(userId: string): Promise<ResultadoSesion['user']> {
    return this.cargarUsuario(userId);
  }

  // ── Internos ──────────────────────────────────────────────

  private async emitirSesion(userId: string, ctx: ContextoPeticion): Promise<ResultadoSesion> {
    const usuario = await this.cargarUsuario(userId);
    const sesion = await this.tokens.crearSesion(userId, ctx);

    const accessToken = await this.tokens.firmarAccessToken({
      sub: userId,
      sid: sesion.sessionId,
      typ: usuario.type,
    });

    return { accessToken, refreshToken: sesion.refreshToken, user: usuario };
  }

  private async cargarUsuario(userId: string): Promise<ResultadoSesion['user']> {
    const usuario = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        // El teléfono viaja en la sesión porque el formulario de perfil tiene
        // que poder mostrar el que ya está guardado. Sin él, el campo aparecía
        // siempre vacío al entrar y parecía que no se hubiera guardado nada.
        phone: true,
        type: true,
        locale: true,
        emailVerifiedAt: true,
        totpEnabledAt: true,
      },
    });

    const permisos = await this.permisos.permisosDe(userId);

    return {
      id: usuario.id,
      email: usuario.email,
      firstName: usuario.firstName,
      lastName: usuario.lastName,
      phone: usuario.phone,
      type: usuario.type,
      locale: usuario.locale,
      emailVerified: usuario.emailVerifiedAt !== null,
      twoFactorEnabled: usuario.totpEnabledAt !== null,
      permissions: [...permisos],
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async consumirToken(
    token: string,
    purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
  ): Promise<{ userId: string }> {
    const registro = await this.prisma.client.verificationToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });

    if (!registro || registro.purpose !== purpose) {
      throw new BadRequestException('El enlace no es válido');
    }
    if (registro.usedAt) {
      throw new BadRequestException('Este enlace ya se ha utilizado');
    }
    if (registro.expiresAt < new Date()) {
      throw new BadRequestException('El enlace ha caducado; solicita uno nuevo');
    }

    await this.prisma.client.verificationToken.update({
      where: { id: registro.id },
      data: { usedAt: new Date() },
    });

    return { userId: registro.userId };
  }

  // ── Protección contra fuerza bruta ────────────────────────

  private async comprobarBloqueo(email: string): Promise<void> {
    const intentos = await this.redis.client.get(`${CLAVE_INTENTOS}${email}`);
    if (intentos !== null && Number(intentos) >= INTENTOS_MAXIMOS) {
      const ttl = await this.redis.client.ttl(`${CLAVE_INTENTOS}${email}`);
      throw new UnauthorizedException(
        `Demasiados intentos fallidos. Inténtalo de nuevo en ${Math.ceil(ttl / 60)} minutos.`,
      );
    }
  }

  private async registrarIntentoFallido(email: string): Promise<void> {
    const clave = `${CLAVE_INTENTOS}${email}`;
    const intentos = await this.redis.client.incr(clave);
    // La ventana se fija en el primer fallo y no se renueva con cada intento:
    // así el bloqueo tiene una duración predecible.
    if (intentos === 1) {
      await this.redis.client.expire(clave, BLOQUEO_SEGUNDOS);
    }
  }

  private async limpiarIntentos(email: string): Promise<void> {
    await this.redis.client.del(`${CLAVE_INTENTOS}${email}`);
  }
}
