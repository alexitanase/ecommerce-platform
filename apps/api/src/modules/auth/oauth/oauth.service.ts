import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import { newId, type Env } from '@ecom/shared';
import { ENV } from '../../../config/config.module.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { IntegracionesService } from '../../integrations/integraciones.service.js';
import { TokensService } from '../tokens.service.js';
import { PermissionsService } from '../permissions.service.js';

export type ProveedorOAuth = 'google' | 'apple';

interface PerfilExterno {
  providerUserId: string;
  email: string;
  emailVerificado: boolean;
  nombre?: string | undefined;
  apellidos?: string | undefined;
}

/** El `state` anti-CSRF vive 10 minutos. */
const CLAVE_STATE = 'oauth:state:';
const TTL_STATE = 600;

/**
 * Inicio de sesión con Google y Apple.
 *
 * Se usa el flujo de código de autorización con `state` y PKCE, no el implícito:
 * el token nunca viaja por la URL del navegador, donde acabaría en el historial
 * y en los logs de cualquier proxy intermedio.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: TokensService,
    private readonly permisos: PermissionsService,
    private readonly audit: AuditService,
    private readonly integraciones: IntegracionesService,
  ) {}

  /** Construye la URL a la que redirigir al usuario para autenticarse. */
  async urlDeAutorizacion(
    proveedor: ProveedorOAuth,
    redirigirA?: string,
  ): Promise<{ url: string; state: string }> {
    await this.exigirConfiguracion(proveedor);

    const state = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    // El state se guarda en servidor: al volver, comprobamos que la respuesta
    // corresponde a una petición que iniciamos nosotros y no a un CSRF.
    await this.redis.client.set(
      `${CLAVE_STATE}${state}`,
      JSON.stringify({ proveedor, verifier, redirigirA: redirigirA ?? null }),
      'EX',
      TTL_STATE,
    );

    const base =
      proveedor === 'google'
        ? 'https://accounts.google.com/o/oauth2/v2/auth'
        : 'https://appleid.apple.com/auth/authorize';

    const params = new URLSearchParams({
      client_id: await this.clientId(proveedor),
      redirect_uri: this.redirectUri(proveedor),
      response_type: 'code',
      scope: proveedor === 'google' ? 'openid email profile' : 'name email',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...(proveedor === 'apple' ? { response_mode: 'form_post' } : { access_type: 'offline' }),
    });

    return { url: `${base}?${params.toString()}`, state };
  }

  /**
   * El destino que la tienda pidió al empezar, sin consumir el `state`.
   *
   * Lo usa el controlador para saber en qué idioma contestar cuando el acceso
   * falla —o cuando el cliente cancela en la pantalla de Google—, porque ahí no
   * hay sesión de la que sacarlo. Devuelve `null` si el `state` ya no existe, que
   * es exactamente lo que pasa cuando ha caducado.
   */
  async destinoGuardado(state: string): Promise<string | null> {
    if (!state) return null;

    const guardado = await this.redis.client.get(`${CLAVE_STATE}${state}`);
    if (!guardado) return null;

    const datos = JSON.parse(guardado) as { redirigirA?: string | null };
    return datos.redirigirA ?? null;
  }

  /**
   * Cierra el ciclo: canjea el código por el perfil y devuelve una sesión propia.
   */
  async completar(
    proveedor: ProveedorOAuth,
    code: string,
    state: string,
    ctx: { ip?: string; userAgent?: string },
  ) {
    const guardado = await this.redis.client.get(`${CLAVE_STATE}${state}`);
    if (!guardado) {
      throw new UnauthorizedException('La sesión de autenticación ha caducado o no es válida');
    }
    await this.redis.client.del(`${CLAVE_STATE}${state}`);

    const datos = JSON.parse(guardado) as {
      proveedor: string;
      verifier: string;
      redirigirA: string | null;
    };
    if (datos.proveedor !== proveedor) {
      throw new UnauthorizedException('El proveedor no coincide con el de la petición inicial');
    }

    const perfil = await this.obtenerPerfil(proveedor, code, datos.verifier);

    // Solo se vincula automáticamente si el proveedor confirma que el email
    // está verificado. Sin esa comprobación, alguien podría registrar en el
    // proveedor una cuenta con el email de otro y entrar en la suya.
    if (!perfil.emailVerificado) {
      throw new UnauthorizedException(
        'El proveedor no confirma que el email esté verificado; no podemos vincular la cuenta.',
      );
    }

    const usuario = await this.vincularOCrear(proveedor, perfil, ctx);
    const sesion = await this.tokens.crearSesion(usuario.id, ctx);
    const accessToken = await this.tokens.firmarAccessToken({
      sub: usuario.id,
      sid: sesion.sessionId,
      typ: usuario.type,
    });

    const permisos = await this.permisos.permisosDe(usuario.id);

    return {
      accessToken,
      refreshToken: sesion.refreshToken,
      /*
       * A dónde quería volver la tienda.
       *
       * Viaja dentro del `state`, que vive en nuestro Redis, y no en la URL de
       * la vuelta: así el destino es el que se pidió al empezar y no algo que
       * alguien haya podido cambiar por el camino. La validación de que sea una
       * ruta interna se hace igualmente al usarlo.
       */
      redirigirA: datos.redirigirA,
      user: {
        id: usuario.id,
        email: usuario.email,
        firstName: usuario.firstName,
        lastName: usuario.lastName,
        type: usuario.type,
        locale: usuario.locale,
        emailVerified: true,
        twoFactorEnabled: usuario.totpEnabledAt !== null,
        permissions: [...permisos],
      },
    };
  }

  // ── Internos ──────────────────────────────────────────────

  private async vincularOCrear(
    proveedor: ProveedorOAuth,
    perfil: PerfilExterno,
    ctx: { ip?: string },
  ) {
    const identidad = await this.prisma.client.userIdentity.findUnique({
      where: {
        provider_providerUserId: { provider: proveedor, providerUserId: perfil.providerUserId },
      },
      include: { user: true },
    });

    if (identidad) {
      if (!identidad.user.isActive || identidad.user.deletedAt) {
        throw new UnauthorizedException('La cuenta no está disponible');
      }
      await this.prisma.client.user.update({
        where: { id: identidad.userId },
        data: { lastLoginAt: new Date() },
      });
      return identidad.user;
    }

    // Si ya existe una cuenta con ese email, se vincula en lugar de crear una
    // segunda: de otro modo el usuario tendría dos cuentas con sus pedidos
    // repartidos entre ambas y sin forma de unirlas.
    const existente = await this.prisma.client.user.findUnique({
      where: { email: perfil.email },
    });

    if (existente) {
      if (!existente.isActive || existente.deletedAt) {
        throw new UnauthorizedException('La cuenta no está disponible');
      }

      await this.prisma.client.userIdentity.create({
        data: {
          id: newId(),
          userId: existente.id,
          provider: proveedor,
          providerUserId: perfil.providerUserId,
          email: perfil.email,
        },
      });

      await this.audit.registrar({
        action: 'auth.oauth_linked',
        resource: 'user',
        resourceId: existente.id,
        actorId: existente.id,
        actorIp: ctx.ip,
        metadata: { proveedor },
      });

      return existente;
    }

    const usuario = await this.prisma.client.user.create({
      data: {
        id: newId(),
        email: perfil.email,
        type: 'CUSTOMER',
        // Sin contraseña: la cuenta solo se usa con el proveedor externo hasta
        // que el usuario decida establecer una.
        password: null,
        firstName: perfil.nombre ?? null,
        lastName: perfil.apellidos ?? null,
        locale: this.env.DEFAULT_LOCALE,
        emailVerifiedAt: new Date(),
        identities: {
          create: {
            id: newId(),
            provider: proveedor,
            providerUserId: perfil.providerUserId,
            email: perfil.email,
          },
        },
      },
    });

    await this.audit.registrar({
      action: 'auth.oauth_register',
      resource: 'user',
      resourceId: usuario.id,
      actorId: usuario.id,
      actorIp: ctx.ip,
      metadata: { proveedor },
    });

    return usuario;
  }

  private async obtenerPerfil(
    proveedor: ProveedorOAuth,
    code: string,
    verifier: string,
  ): Promise<PerfilExterno> {
    const tokenUrl =
      proveedor === 'google'
        ? 'https://oauth2.googleapis.com/token'
        : 'https://appleid.apple.com/auth/token';

    const cuerpo = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri(proveedor),
      client_id: await this.clientId(proveedor),
      client_secret: await this.clientSecret(proveedor),
      code_verifier: verifier,
    });

    const respuesta = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cuerpo,
      signal: AbortSignal.timeout(10_000),
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text();
      this.logger.error(
        `Canje de código con ${proveedor} fallido (${respuesta.status}): ${detalle}`,
      );
      throw new ServiceUnavailableException(
        `No se ha podido completar el acceso con ${proveedor}. Inténtalo de nuevo.`,
      );
    }

    const datos = (await respuesta.json()) as { id_token?: string };
    if (!datos.id_token) {
      throw new ServiceUnavailableException('El proveedor no ha devuelto un id_token');
    }

    return this.leerIdToken(proveedor, datos.id_token);
  }

  /**
   * Lee el `id_token` (JWT) devuelto por el proveedor.
   *
   * No se verifica la firma aquí porque el token acaba de llegar por una
   * conexión TLS directa contra el endpoint oficial del proveedor, autenticada
   * con nuestro client_secret: no ha pasado por el navegador ni por terceros.
   * Si algún día aceptáramos un id_token enviado por el cliente, habría que
   * validar la firma contra el JWKS del proveedor antes de fiarse de nada.
   */
  private async leerIdToken(proveedor: ProveedorOAuth, idToken: string): Promise<PerfilExterno> {
    const partes = idToken.split('.');
    if (partes.length !== 3 || !partes[1]) {
      throw new BadRequestException('El id_token recibido no tiene formato JWT');
    }

    const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')) as {
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
      given_name?: string;
      family_name?: string;
      aud?: string;
      iss?: string;
    };

    if (!payload.sub || !payload.email) {
      throw new BadRequestException('El proveedor no ha devuelto identificador o email');
    }

    // Aunque venga por canal seguro, se comprueba que el token es para nosotros.
    if (payload.aud && payload.aud !== (await this.clientId(proveedor))) {
      throw new UnauthorizedException('El id_token no está emitido para esta aplicación');
    }

    return {
      providerUserId: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerificado: payload.email_verified === true || payload.email_verified === 'true',
      nombre: payload.given_name,
      apellidos: payload.family_name,
    };
  }

  /** Clave de la integración que respalda cada proveedor. */
  private claveIntegracion(proveedor: ProveedorOAuth): string {
    return proveedor === 'google' ? 'google_oauth' : 'apple_oauth';
  }

  /**
   * Qué accesos sociales se pueden ofrecer ahora mismo.
   *
   * La tienda lo consulta para decidir qué botones pinta: enseñar "Entrar con
   * Google" cuando no está configurado lleva a una pantalla de error de Google,
   * que parece un fallo de la tienda.
   */
  async proveedoresDisponibles(): Promise<ProveedorOAuth[]> {
    const disponibles: ProveedorOAuth[] = [];

    for (const proveedor of ['google', 'apple'] as const) {
      if (await this.integraciones.operativa(this.claveIntegracion(proveedor))) {
        disponibles.push(proveedor);
      }
    }

    return disponibles;
  }

  private async credenciales(proveedor: ProveedorOAuth): Promise<Record<string, string>> {
    const config = await this.integraciones.configuracion(this.claveIntegracion(proveedor));

    if (!config?.operativa) {
      throw new ServiceUnavailableException(
        `El acceso con ${proveedor === 'google' ? 'Google' : 'Apple'} no está configurado. ` +
          'Se activa en Ajustes → Integraciones.',
      );
    }

    return config.credenciales;
  }

  private async exigirConfiguracion(proveedor: ProveedorOAuth): Promise<void> {
    await this.credenciales(proveedor);
  }

  private async clientId(proveedor: ProveedorOAuth): Promise<string> {
    return (await this.credenciales(proveedor))['clientId'] ?? '';
  }

  /**
   * Apple no usa un secreto fijo: exige un JWT firmado con la clave privada
   * .p8 descargada de su consola, válido como mucho seis meses.
   */
  private async clientSecret(proveedor: ProveedorOAuth): Promise<string> {
    const credenciales = await this.credenciales(proveedor);

    if (proveedor === 'google') return credenciales['clientSecret'] ?? '';
    return this.generarSecretoApple(credenciales);
  }

  private generarSecretoApple(credenciales: Record<string, string>): string {
    const clave = credenciales['privateKey'];
    const keyId = credenciales['keyId'];
    const teamId = credenciales['teamId'];

    if (!clave || !keyId || !teamId) {
      throw new ServiceUnavailableException(
        'Faltan la clave privada, el Key ID o el Team ID para el acceso con Apple',
      );
    }

    const ahora = Math.floor(Date.now() / 1000);
    const cabecera = { alg: 'ES256', kid: keyId };
    const payload = {
      iss: teamId,
      iat: ahora,
      exp: ahora + 3600,
      aud: 'https://appleid.apple.com',
      sub: credenciales['clientId'],
    };

    const codificar = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const cuerpo = `${codificar(cabecera)}.${codificar(payload)}`;

    const firma = crypto.sign(
      null,
      Buffer.from(cuerpo),
      // La clave llega con saltos escapados desde la variable de entorno.
      { key: clave.replace(/\\n/g, '\n'), dsaEncoding: 'ieee-p1363' },
    );

    return `${cuerpo}.${firma.toString('base64url')}`;
  }

  private redirectUri(proveedor: ProveedorOAuth): string {
    return `${this.env.API_URL}/api/v1/auth/oauth/${proveedor}/callback`;
  }
}
