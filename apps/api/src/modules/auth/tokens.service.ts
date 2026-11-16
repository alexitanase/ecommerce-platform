import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import crypto from 'node:crypto';
import { newId, type Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

/** Contenido del access token. Deliberadamente mínimo. */
export interface AccessTokenPayload {
  /** ID del usuario */
  sub: string;
  /** ID de la sesión, para poder revocarla de forma individual */
  sid: string;
  /** CUSTOMER o STAFF */
  typ: string;
}

export interface ParPrometido {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Prefijo de la lista de sesiones revocadas en Redis. */
const CLAVE_REVOCADA = 'auth:revoked:';

/**
 * Cuánto sigue valiendo el token anterior después de rotar.
 *
 * Existe porque «token ya usado» y «token robado» se parecen mucho y no son lo
 * mismo. Dos pestañas abiertas comparten una sola cookie: si las dos refrescan
 * a la vez, la segunda llega con el token que la primera acaba de gastar. Sin
 * esta ventana eso se trataba como un robo y se cerraban TODAS las sesiones de
 * la persona, que se encontraba de golpe fuera de su cuenta con un mensaje
 * acusándola. Un reintento de la red tras un túnel hace exactamente lo mismo.
 *
 * Treinta segundos porque cubre de sobra una carrera entre peticiones —que se
 * mide en milisegundos— y una reconexión, sin regalarle al ladrón una ventana
 * que merezca la pena esperar. Pasado ese rato, el token viejo vuelve a ser
 * señal de robo y se actúa como antes.
 */
const GRACIA_ROTACION_MS = 30_000;

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ── Access token ──────────────────────────────────────────

  /**
   * El access token no lleva los permisos dentro a propósito.
   *
   * Si los llevara, quitarle un permiso a alguien no tendría efecto hasta que
   * su token caducara: hasta 15 minutos de margen para un empleado al que
   * acabas de retirar el acceso a reembolsos. Los permisos se resuelven en cada
   * petición desde una caché de Redis que se invalida al instante.
   */
  async firmarAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.env.JWT_ACCESS_SECRET,
      // jsonwebtoken tipa expiresIn con el literal de la librería `ms`. Nuestro
      // valor ya viene validado por Zod con el patrón `\d+[smhd]`, así que la
      // conversión es segura: el tipo es más estrecho que la comprobación real.
      expiresIn: this.env.JWT_ACCESS_TTL as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });
  }

  /**
   * Secretos con los que se acepta una firma, en orden de preferencia.
   *
   * Durante una rotación conviven dos: el nuevo, con el que ya se firma, y el
   * anterior, que valida los tokens emitidos antes del despliegue. Sin esto,
   * cambiar el secreto expulsa de golpe a todo el que tuviera sesión abierta.
   */
  private secretosAceptados(): string[] {
    const previo = this.env.JWT_ACCESS_SECRET_PREVIOUS;
    return previo && previo !== this.env.JWT_ACCESS_SECRET
      ? [this.env.JWT_ACCESS_SECRET, previo]
      : [this.env.JWT_ACCESS_SECRET];
  }

  async verificarAccessToken(token: string): Promise<AccessTokenPayload> {
    let payload: AccessTokenPayload | null = null;

    for (const secret of this.secretosAceptados()) {
      try {
        payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret });
        break;
      } catch {
        // Se prueba el siguiente secreto; solo si fallan todos es inválido.
      }
    }

    if (!payload) {
      throw new UnauthorizedException('Token inválido o caducado');
    }

    // La sesión pudo revocarse (logout, cambio de contraseña, robo detectado)
    // después de firmar este token, que sigue siendo criptográficamente válido.
    if (await this.sesionRevocada(payload.sid)) {
      throw new UnauthorizedException('La sesión ha sido cerrada');
    }

    return payload;
  }

  // ── Refresh token ─────────────────────────────────────────

  /**
   * El refresh token es `sessionId.secreto`. En la base de datos solo se
   * guarda el hash del secreto: si alguien vuelca la tabla de sesiones, no
   * obtiene tokens usables.
   */
  async crearSesion(
    userId: string,
    contexto: { userAgent?: string; ip?: string },
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const sessionId = newId();
    const secreto = crypto.randomBytes(32).toString('base64url');

    await this.prisma.client.session.create({
      data: {
        id: sessionId,
        userId,
        tokenHash: this.hash(secreto),
        userAgent: contexto.userAgent?.slice(0, 255) ?? null,
        ip: contexto.ip ?? null,
        expiresAt: new Date(Date.now() + this.msDesdeDuracion(this.env.JWT_REFRESH_TTL)),
      },
    });

    return { sessionId, refreshToken: `${sessionId}.${secreto}` };
  }

  /**
   * Rota el refresh token: cada uso invalida el anterior.
   *
   * Si llega un token cuyo secreto no coincide con el vigente, significa que
   * ese token ya se usó y alguien está reutilizando una copia robada. En ese
   * caso no basta con rechazarlo: se cierran TODAS las sesiones del usuario,
   * porque no sabemos si el ladrón es quien acaba de presentarlo o el legítimo.
   * Es la recomendación de OWASP para detección de reutilización.
   *
   * La excepción es el token recién gastado: durante {@link GRACIA_ROTACION_MS}
   * se acepta sin rotar y **sin devolver token nuevo**. Devolver uno sería
   * peor que no hacer nada: las dos respuestas de una carrera compiten por la
   * misma cookie y el navegador se quedaría con la del que llegue último, que
   * no tiene por qué ser el vigente. Al no tocarla, la cookie acaba siendo la
   * que dejó la rotación de verdad, que es la única correcta.
   *
   * De ahí que `refreshToken` sea opcional: cuando falta, quien llama debe
   * dejar la cookie como está.
   */
  async rotar(
    refreshToken: string,
    contexto: { userAgent?: string; ip?: string },
  ): Promise<{ userId: string; sessionId: string; refreshToken?: string }> {
    const [sessionId, secreto] = refreshToken.split('.');
    if (!sessionId || !secreto) {
      throw new UnauthorizedException('Refresh token con formato inválido');
    }

    const sesion = await this.prisma.client.session.findUnique({ where: { id: sessionId } });

    if (!sesion || sesion.revokedAt || sesion.expiresAt < new Date()) {
      throw new UnauthorizedException('Sesión no válida');
    }

    const hashPresentado = this.hash(secreto);

    if (!this.comparaSegura(sesion.tokenHash, hashPresentado)) {
      return await this.tokenYaGastado(sesion, hashPresentado);
    }

    /*
     * La escritura es condicional a propósito.
     *
     * Entre la lectura de arriba y esta línea puede colarse otra petición con
     * la misma cookie. Si las dos rotaran, cada una dejaría un token distinto,
     * la base de datos se quedaría con uno y el navegador con el otro: el
     * siguiente refresco parecería un robo y cerraría la sesión de alguien que
     * no ha hecho nada raro. Con el `tokenHash` en el WHERE solo gana una, y la
     * otra cae por el mismo camino que el token ya gastado.
     */
    const nuevoSecreto = crypto.randomBytes(32).toString('base64url');
    const ahora = new Date();
    const { count } = await this.prisma.client.session.updateMany({
      where: { id: sessionId, tokenHash: sesion.tokenHash },
      data: {
        tokenHash: this.hash(nuevoSecreto),
        prevHash: sesion.tokenHash,
        rotatedAt: ahora,
        lastUsedAt: ahora,
        userAgent: contexto.userAgent?.slice(0, 255) ?? sesion.userAgent,
        ip: contexto.ip ?? sesion.ip,
      },
    });

    if (count === 0) {
      // Perdida la carrera: se relee para decidir con el estado de verdad.
      const actual = await this.prisma.client.session.findUnique({ where: { id: sessionId } });
      if (!actual || actual.revokedAt) throw new UnauthorizedException('Sesión no válida');
      return await this.tokenYaGastado(actual, hashPresentado);
    }

    return { userId: sesion.userId, sessionId, refreshToken: `${sessionId}.${nuevoSecreto}` };
  }

  /**
   * Qué hacer con un token que ya no es el vigente.
   *
   * Dos posibilidades muy distintas: o es el que se acaba de gastar hace un
   * instante —dos pestañas, un reintento— o es una copia que alguien guardó.
   * La ventana de gracia es lo único que las separa.
   */
  private async tokenYaGastado(
    sesion: { userId: string; id: string; prevHash: string | null; rotatedAt: Date | null },
    hashPresentado: string,
  ): Promise<{ userId: string; sessionId: string }> {
    const reciente =
      sesion.rotatedAt !== null && Date.now() - sesion.rotatedAt.getTime() < GRACIA_ROTACION_MS;

    if (
      sesion.prevHash !== null &&
      reciente &&
      this.comparaSegura(sesion.prevHash, hashPresentado)
    ) {
      // Sin rotar y sin token nuevo: la cookie buena ya la dejó la otra.
      return { userId: sesion.userId, sessionId: sesion.id };
    }

    this.logger.warn(
      `Reutilización de refresh token detectada en la sesión ${sesion.id}; ` +
        `se cierran todas las sesiones del usuario ${sesion.userId}`,
    );
    await this.revocarTodasLasSesiones(sesion.userId);
    throw new UnauthorizedException('Sesión comprometida: vuelve a iniciar sesión');
  }

  // ── Revocación ────────────────────────────────────────────

  async revocarSesion(sessionId: string): Promise<void> {
    const sesion = await this.prisma.client.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    // La marca en Redis hace efecto inmediato: los access tokens ya emitidos
    // dejan de servir sin esperar a que caduquen.
    await this.marcarRevocada(sessionId, sesion.expiresAt);
  }

  async revocarTodasLasSesiones(userId: string, exceptoSessionId?: string): Promise<number> {
    const sesiones = await this.prisma.client.session.findMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptoSessionId ? { id: { not: exceptoSessionId } } : {}),
      },
    });

    if (sesiones.length === 0) return 0;

    await this.prisma.client.session.updateMany({
      where: { id: { in: sesiones.map((s) => s.id) } },
      data: { revokedAt: new Date() },
    });

    await Promise.all(sesiones.map((s) => this.marcarRevocada(s.id, s.expiresAt)));
    return sesiones.length;
  }

  async listarSesiones(userId: string): Promise<
    {
      id: string;
      userAgent: string | null;
      ip: string | null;
      createdAt: Date;
      lastUsedAt: Date | null;
    }[]
  > {
    return this.prisma.client.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  // ── Internos ──────────────────────────────────────────────

  private async marcarRevocada(sessionId: string, expiraEn: Date): Promise<void> {
    // La entrada caduca junto con la sesión: pasado ese momento el access token
    // tampoco valdría, así que no hace falta seguir ocupando memoria.
    const segundos = Math.max(1, Math.ceil((expiraEn.getTime() - Date.now()) / 1000));
    await this.redis.client.set(`${CLAVE_REVOCADA}${sessionId}`, '1', 'EX', segundos);
  }

  private async sesionRevocada(sessionId: string): Promise<boolean> {
    return (await this.redis.client.exists(`${CLAVE_REVOCADA}${sessionId}`)) === 1;
  }

  private hash(valor: string): string {
    return crypto.createHash('sha256').update(valor).digest('hex');
  }

  /** Comparación en tiempo constante, para no filtrar información por timing. */
  private comparaSegura(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /** Convierte `15m`, `24h`, `30d` a milisegundos. */
  msDesdeDuracion(duracion: string): number {
    const m = /^(\d+)([smhd])$/.exec(duracion);
    if (!m?.[1] || !m[2]) throw new Error(`Duración no válida: ${duracion}`);
    const valor = Number(m[1]);
    const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]] ?? 1000;
    return valor * factor;
  }
}
