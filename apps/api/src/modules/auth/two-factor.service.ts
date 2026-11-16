import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from './password.service.js';
import { TotpService } from './totp.service.js';
import { TokensService } from './tokens.service.js';
import type { ContextoPeticion } from './auth.service.js';

/** El secreto pendiente de confirmar vive 10 minutos en Redis. */
const CLAVE_PENDIENTE = 'auth:2fa:pendiente:';
const TTL_PENDIENTE = 600;

/**
 * Alta y baja de la verificación en dos pasos.
 *
 * El secreto no se guarda en la base de datos hasta que el usuario demuestra
 * que su app lo ha registrado correctamente introduciendo un código válido.
 * Si se guardara antes, alguien que cerrara la pestaña a mitad del proceso se
 * quedaría con 2FA activo y sin forma de generar códigos: fuera de su cuenta.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly totp: TotpService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  async iniciarAlta(
    userId: string,
    email: string,
  ): Promise<{ secret: string; qrDataUrl: string; uri: string }> {
    const usuario = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpEnabledAt: true },
    });

    if (usuario.totpEnabledAt) {
      throw new BadRequestException('La verificación en dos pasos ya está activa');
    }

    const secreto = this.totp.generarSecreto();
    const marca = await this.nombreDeMarca();
    const uri = this.totp.uriDeAprovisionamiento(email, secreto, marca);

    await this.redis.client.set(`${CLAVE_PENDIENTE}${userId}`, secreto, 'EX', TTL_PENDIENTE);

    return {
      secret: secreto,
      qrDataUrl: await this.totp.generarQr(uri),
      uri,
    };
  }

  async confirmarAlta(
    userId: string,
    codigo: string,
    ctx: ContextoPeticion,
  ): Promise<{ recoveryCodes: string[] }> {
    const secreto = await this.redis.client.get(`${CLAVE_PENDIENTE}${userId}`);
    if (!secreto) {
      throw new BadRequestException(
        'El proceso ha caducado. Vuelve a empezar el alta de la verificación en dos pasos.',
      );
    }

    if (!this.totp.verificar(secreto, codigo)) {
      throw new UnauthorizedException('El código no es correcto');
    }

    const { claros, hasheados } = this.totp.generarCodigosRecuperacion();

    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        totpSecret: secreto,
        totpEnabledAt: new Date(),
        recoveryCodes: hasheados,
      },
    });

    await this.redis.client.del(`${CLAVE_PENDIENTE}${userId}`);

    await this.audit.registrar({
      action: 'auth.2fa_enabled',
      resource: 'user',
      resourceId: userId,
      actorId: userId,
      actorIp: ctx.ip,
    });

    // Se muestran una sola vez: a partir de aquí solo se guardan hasheados.
    return { recoveryCodes: claros };
  }

  async desactivar(
    userId: string,
    password: string,
    codigo: string,
    ctx: ContextoPeticion,
  ): Promise<void> {
    const usuario = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { password: true, totpSecret: true, totpEnabledAt: true },
    });

    if (!usuario.totpEnabledAt || !usuario.totpSecret) {
      throw new BadRequestException('La verificación en dos pasos no está activa');
    }

    // Se exigen ambos factores para desactivarla: si bastara la contraseña,
    // quien la robase podría anular justo la protección que se lo impide.
    if (!usuario.password || !(await this.passwords.verify(usuario.password, password))) {
      throw new UnauthorizedException('La contraseña no es correcta');
    }

    if (!this.totp.verificar(usuario.totpSecret, codigo)) {
      throw new UnauthorizedException('El código no es correcto');
    }

    await this.prisma.client.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null, recoveryCodes: [] },
    });

    await this.audit.registrar({
      action: 'auth.2fa_disabled',
      resource: 'user',
      resourceId: userId,
      actorId: userId,
      actorIp: ctx.ip,
    });
  }

  /**
   * Consume un código de recuperación cuando el usuario ha perdido el móvil.
   * Al gastarse el último, se avisa por auditoría para que soporte lo detecte.
   */
  async usarCodigoRecuperacion(userId: string, codigo: string): Promise<boolean> {
    const usuario = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { recoveryCodes: true },
    });

    const restantes = this.totp.consumirCodigoRecuperacion(codigo, usuario.recoveryCodes);
    if (restantes === null) return false;

    await this.prisma.client.user.update({
      where: { id: userId },
      data: { recoveryCodes: restantes },
    });

    // Un código de recuperación usado suele significar dispositivo perdido:
    // se cierran todas las sesiones por si el móvil está en malas manos.
    await this.tokens.revocarTodasLasSesiones(userId);

    await this.audit.registrar({
      action: 'auth.recovery_code_used',
      resource: 'user',
      resourceId: userId,
      actorId: userId,
      metadata: { codigosRestantes: restantes.length },
    });

    return true;
  }

  private async nombreDeMarca(): Promise<string> {
    const ajuste = await this.prisma.client.setting.findUnique({
      where: { namespace_key: { namespace: 'brand', key: 'name' } },
      select: { value: true },
    });
    return typeof ajuste?.value === 'string' ? ajuste.value : 'Tienda';
  }
}
