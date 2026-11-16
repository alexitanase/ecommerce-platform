import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  canjearCodigo,
  refrescarToken,
  tokenCaducado,
  urlDeAutorizacion,
  type TokensAliExpress,
} from '@ecom/suppliers';
import type { Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CryptoService } from '../../common/crypto.service.js';
import type { ContextoActor } from '../roles/roles.service.js';

/**
 * Autorización de proveedores que usan OAuth.
 *
 * Hoy solo AliExpress, y está aparte del servicio de proveedores a propósito:
 * el resto de proveedores se configuran pegando una clave en un formulario,
 * mientras que aquí hay un recorrido de ida y vuelta por el navegador del
 * titular de la cuenta, un código de un solo uso y un token que caduca y hay
 * que renovar solo. Mezclarlo con el CRUD haría ilegibles los dos.
 *
 * Lo que hay que entender de este flujo: el App Key y el App Secret identifican
 * a NUESTRA aplicación, no dan permiso sobre ninguna cuenta. El permiso lo
 * concede el titular entrando en una página de AliExpress. Por eso una
 * integración puede tener las credenciales correctas y aun así no poder pedir
 * nada, y por eso el panel distingue las dos cosas.
 */
@Injectable()
export class AutorizacionProveedoresService {
  private readonly logger = new Logger(AutorizacionProveedoresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * URL de retorno que AliExpress tiene que tener dada de alta.
   *
   * Se construye desde `API_URL` para que sea siempre la misma cadena que se
   * enseña en el panel y la que se manda en la petición: si difirieran en una
   * barra final, AliExpress rechazaría la autorización sin decir por qué.
   */
  urlDeRetorno(): string {
    return `${this.env.API_URL.replace(/\/$/, '')}/api/v1/suppliers/oauth/aliexpress/callback`;
  }

  /** Base del panel de administración, a donde se vuelve tras autorizar. */
  urlDelPanel(): string {
    return this.env.ADMIN_URL;
  }

  /** Empieza el recorrido: devuelve a dónde hay que mandar al titular. */
  async comenzar(supplierId: string): Promise<{ url: string; urlDeRetorno: string }> {
    const { credenciales, proveedor } = await this.credencialesDe(supplierId);

    if (proveedor.key !== 'aliexpress') {
      throw new BadRequestException(
        `"${proveedor.name}" no usa autorización por OAuth; sus credenciales se ponen a mano.`,
      );
    }

    const appKey = credenciales['appKey'];
    if (!appKey) {
      throw new BadRequestException(
        'Falta el App Key. Guárdalo primero en las credenciales del proveedor.',
      );
    }

    const urlDeRetorno = this.urlDeRetorno();

    return {
      // El identificador del proveedor viaja en `state` y vuelve tal cual: es
      // lo que permite saber a qué proveedor corresponde el código cuando
      // AliExpress nos devuelve la llamada, porque en ese momento no hay
      // sesión de nadie.
      url: urlDeAutorizacion({ appKey, redirectUri: urlDeRetorno, state: supplierId }),
      urlDeRetorno,
    };
  }

  /**
   * Cierra el recorrido: cambia el código por los tokens y los guarda.
   *
   * Lo llama el navegador del titular al volver de AliExpress, sin sesión
   * nuestra: la autenticación de este paso es el propio código, que es de un
   * solo uso, caduca en minutos y solo lo conoce quien acaba de autorizar.
   */
  async completar(
    supplierId: string,
    code: string,
    ctx: ContextoActor,
  ): Promise<{ cuenta?: string; caducaEl: Date }> {
    const { credenciales, proveedor } = await this.credencialesDe(supplierId);

    const tokens = await canjearCodigo({
      appKey: credenciales['appKey'] ?? '',
      appSecret: credenciales['appSecret'] ?? '',
      code,
    });

    await this.guardarTokens(supplierId, credenciales, tokens);

    await this.audit.registrar({
      action: 'supplier.oauth_authorized',
      resource: 'supplier',
      resourceId: supplierId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      // Queda constancia de QUÉ cuenta autorizó y hasta cuándo, nunca el token.
      metadata: {
        proveedor: proveedor.name,
        ...(tokens.cuenta ? { cuenta: tokens.cuenta } : {}),
        caducaEl: new Date(tokens.accessTokenExpiraEn).toISOString(),
      },
    });

    this.logger.log(
      `${proveedor.name} autorizado${tokens.cuenta ? ` por ${tokens.cuenta}` : ''}; ` +
        `el token caduca el ${new Date(tokens.accessTokenExpiraEn).toISOString()}`,
    );

    return {
      ...(tokens.cuenta ? { cuenta: tokens.cuenta } : {}),
      caducaEl: new Date(tokens.accessTokenExpiraEn),
    };
  }

  /**
   * Renueva el token si le queda poco, y dice si hay uno utilizable.
   *
   * Se llama antes de cada uso del adaptador. Renovar aquí y no con una tarea
   * programada tiene un motivo: una tarea que falle de madrugada deja la
   * tienda sin poder enviar pedidos hasta que alguien lo mire, mientras que
   * así el peor caso es que una petición tarde un segundo más.
   *
   * `renovado` importa a quien llama: el adaptador se cachea con sus
   * credenciales dentro, así que tras una renovación hay que reconstruirlo o
   * seguiría firmando con el token viejo.
   */
  async asegurarTokenVigente(
    supplierId: string,
  ): Promise<{ utilizable: boolean; renovado: boolean }> {
    const { credenciales, proveedor } = await this.credencialesDe(supplierId);

    if (proveedor.key !== 'aliexpress') return { utilizable: true, renovado: false };
    if (!credenciales['accessToken']) return { utilizable: false, renovado: false };

    const expira = Number(credenciales['accessTokenExpiraEn'] ?? 0);
    if (!tokenCaducado(expira || undefined)) return { utilizable: true, renovado: false };

    const refreshToken = credenciales['refreshToken'];
    if (!refreshToken) {
      this.logger.warn(
        `${proveedor.name}: el token ha caducado y no hay refresh token; hay que volver a autorizar.`,
      );
      return { utilizable: false, renovado: false };
    }

    try {
      const tokens = await refrescarToken({
        appKey: credenciales['appKey'] ?? '',
        appSecret: credenciales['appSecret'] ?? '',
        refreshToken,
      });

      await this.guardarTokens(supplierId, credenciales, tokens);
      this.logger.log(`${proveedor.name}: token renovado sin intervención.`);
      return { utilizable: true, renovado: true };
    } catch (error) {
      // No se propaga: quien llama tiene que poder decir "hay que reautorizar"
      // en vez de reventar a mitad de un pedido.
      this.logger.error(
        `${proveedor.name}: no se ha podido renovar el token — ${
          error instanceof Error ? error.message : 'motivo desconocido'
        }`,
      );
      return { utilizable: false, renovado: false };
    }
  }

  /** Lo que el panel necesita saber, sin un solo secreto. */
  async estado(supplierId: string): Promise<{
    usaOauth: boolean;
    autorizado: boolean;
    caducaEl: Date | null;
    cuenta: string | null;
    urlDeRetorno: string;
  }> {
    const { credenciales, proveedor } = await this.credencialesDe(supplierId);

    if (proveedor.key !== 'aliexpress') {
      return {
        usaOauth: false,
        autorizado: true,
        caducaEl: null,
        cuenta: null,
        urlDeRetorno: this.urlDeRetorno(),
      };
    }

    const expira = Number(credenciales['accessTokenExpiraEn'] ?? 0);

    return {
      usaOauth: true,
      // "Autorizado" es tener token Y que siga vivo. Un token caducado con
      // refresh token válido se renueva solo en la siguiente llamada, así que
      // aquí se sigue considerando autorizado.
      autorizado: Boolean(
        credenciales['accessToken'] &&
        (!tokenCaducado(expira || undefined) || credenciales['refreshToken']),
      ),
      caducaEl: expira ? new Date(expira) : null,
      cuenta: credenciales['cuentaAutorizada'] ?? null,
      urlDeRetorno: this.urlDeRetorno(),
    };
  }

  private async guardarTokens(
    supplierId: string,
    credencialesActuales: Record<string, string>,
    tokens: TokensAliExpress,
  ): Promise<void> {
    // Se conservan App Key y App Secret: solo cambian los tokens.
    const credenciales: Record<string, string> = {
      ...credencialesActuales,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiraEn: String(tokens.accessTokenExpiraEn),
      ...(tokens.refreshTokenExpiraEn
        ? { refreshTokenExpiraEn: String(tokens.refreshTokenExpiraEn) }
        : {}),
      ...(tokens.cuenta ? { cuentaAutorizada: tokens.cuenta } : {}),
    };

    await this.prisma.client.supplier.update({
      where: { id: supplierId },
      data: {
        credentials: this.crypto.cifrarObjeto(credenciales),
        credentialsSetAt: new Date(),
        healthStatus: 'UNKNOWN',
        consecutiveErrors: 0,
      },
    });
  }

  private async credencialesDe(supplierId: string) {
    const proveedor = await this.prisma.client.supplier.findFirst({
      where: { id: supplierId, deletedAt: null },
      select: { id: true, key: true, name: true, credentials: true },
    });

    if (!proveedor) throw new BadRequestException('El proveedor no existe');

    const credenciales = proveedor.credentials
      ? this.crypto.descifrarObjeto<Record<string, string>>(proveedor.credentials)
      : {};

    return { proveedor, credenciales };
  }
}
