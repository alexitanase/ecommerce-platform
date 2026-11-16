import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '@ecom/shared';
import { ENV } from '../../../config/config.module.js';
import { Public } from '../../../common/decorators/public.decorator.js';
import {
  destinoDeFallo,
  destinoTrasOAuth,
  idiomaDelDestino,
  type MotivoFalloOAuth,
} from './destino-oauth.js';
import { OAuthService, type ProveedorOAuth } from './oauth.service.js';

const PROVEEDORES: ProveedorOAuth[] = ['google', 'apple'];
const COOKIE_REFRESH = 'refresh_token';

@ApiTags('Autenticación')
@Controller({ path: 'auth/oauth', version: '1' })
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly oauth: OAuthService,
  ) {}

  /**
   * Qué accesos sociales están disponibles.
   *
   * La tienda lo consulta antes de pintar los botones: enseñar "Entrar con
   * Google" sin configurar lleva a una pantalla de error de Google, que el
   * cliente lee como un fallo de la tienda.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Accesos sociales configurados y activos' })
  async disponibles() {
    return { proveedores: await this.oauth.proveedoresDisponibles() };
  }

  @Public()
  @Get(':provider')
  @Throttle({ default: { limit: 20, ttl: 900_000 } })
  @ApiOperation({ summary: 'Iniciar el acceso con Google o Apple' })
  async iniciar(@Param('provider') provider: string, @Query('redirect') redirect?: string) {
    return this.oauth.urlDeAutorizacion(this.validarProveedor(provider), redirect);
  }

  /**
   * Vuelta del proveedor. Google usa GET y Apple hace POST con `form_post`,
   * así que se aceptan ambos verbos contra el mismo destino.
   *
   * Quien llega aquí es **el navegador del cliente**, no un programa: viene de
   * pulsar un botón en Google y espera acabar en la tienda. Por eso esto termina
   * en una redirección y no en un JSON —devolver el `accessToken` en el cuerpo
   * dejaba al cliente mirando un objeto en pantalla, sin sesión y sin tienda—.
   *
   * El token no viaja en la URL a propósito. Lo que se lleva el navegador es la
   * cookie `httpOnly` del refresh, y la tienda la canjea por un access token
   * nada más cargar. Un token en la URL queda en el historial, en el `Referer`
   * y en los registros de cualquier proxy por el que pase.
   */
  @Public()
  @Get(':provider/callback')
  @ApiExcludeEndpoint()
  async callbackGet(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ): Promise<void> {
    return this.procesar(provider, code, state, error, req, res);
  }

  @Public()
  @Post(':provider/callback')
  @ApiExcludeEndpoint()
  async callbackPost(
    @Param('provider') provider: string,
    @Body() body: { code?: string; state?: string; error?: string },
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ): Promise<void> {
    return this.procesar(provider, body.code ?? '', body.state ?? '', body.error ?? '', req, res);
  }

  private async procesar(
    provider: string,
    code: string,
    state: string,
    error: string,
    req: FastifyRequest,
    res: FastifyReply,
  ): Promise<void> {
    const tienda = this.env.STOREFRONT_URL;

    /*
     * Cancelar no es un error del sistema.
     *
     * Google manda `error=access_denied` cuando el cliente pulsa «Cancelar» en
     * su pantalla. Es lo más normal del mundo y tiene que devolverle al
     * formulario de siempre, no a una página de fallo.
     */
    if (error) {
      return this.volver(res, destinoDeFallo(tienda, await this.idiomaDe(state), 'cancelado'));
    }

    if (!code || !state) {
      return this.volver(res, destinoDeFallo(tienda, await this.idiomaDe(state), 'fallido'));
    }

    // Se lee ANTES de canjear el código: `completar` consume el `state`, y si
    // falla el canje ya no habría forma de saber en qué idioma responder.
    const idioma = await this.idiomaDe(state);

    try {
      const resultado = await this.oauth.completar(this.validarProveedor(provider), code, state, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      void res.setCookie(COOKIE_REFRESH, resultado.refreshToken, {
        httpOnly: true,
        secure: this.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });

      return this.volver(res, destinoTrasOAuth(tienda, resultado.redirigirA));
    } catch (fallo) {
      /*
       * El motivo se traduce a un código corto y el detalle se queda en el log.
       *
       * En la URL de la tienda solo va `?error=caducado`: un mensaje de la API
       * pintado en la pantalla de acceso es texto ajeno dentro de nuestra
       * página, y quien vuelve de un acceso fallido no puede hacer nada con
       * «El proveedor no ha devuelto un id_token».
       */
      const motivo: MotivoFalloOAuth =
        fallo instanceof Error && /caducado|no es válida/i.test(fallo.message)
          ? 'caducado'
          : 'fallido';

      this.logger.warn(
        `Acceso con ${provider} fallido (${motivo}): ${fallo instanceof Error ? fallo.message : String(fallo)}`,
      );

      return this.volver(res, destinoDeFallo(tienda, idioma, motivo));
    }
  }

  /**
   * 303 y no 302.
   *
   * Apple vuelve con un POST (`form_post`). Un 302 deja que el navegador repita
   * el método, así que la tienda recibiría un POST a una página que solo
   * responde a GET; el 303 obliga a convertirlo en GET, que es lo que hace falta
   * en los dos casos.
   */
  private volver(res: FastifyReply, destino: string): void {
    void res.redirect(destino, 303);
  }

  /**
   * En qué idioma estaba navegando quien vuelve con un error.
   *
   * Se saca del destino guardado en el `state`, que sigue en Redis mientras no se
   * haya canjeado el código. Sin esto, un cliente que navega en catalán y pulsa
   * «Cancelar» en Google acaba en la pantalla de acceso en español, que es el
   * remate de algo que ya le ha salido mal.
   */
  private async idiomaDe(state: string): Promise<string> {
    const destino = await this.oauth.destinoGuardado(state);
    return idiomaDelDestino(destino, this.env.SUPPORTED_LOCALES, this.env.DEFAULT_LOCALE);
  }

  private validarProveedor(valor: string): ProveedorOAuth {
    if (!PROVEEDORES.includes(valor as ProveedorOAuth)) {
      throw new BadRequestException(
        `Proveedor no soportado. Disponibles: ${PROVEEDORES.join(', ')}`,
      );
    }
    return valor as ProveedorOAuth;
  }
}
