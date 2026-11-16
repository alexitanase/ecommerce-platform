import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { ConsentService } from './consent.service.js';
import { PreferenciasService, type CanalComunicacion } from './preferencias.service.js';
import {
  ActualizarPreferenciasDto,
  AltaNewsletterDto,
  RegistrarConsentimientoDto,
} from './dto/consent.dto.js';
import { NewsletterService } from './newsletter.service.js';
import type { Segmento } from './segmentos.js';

/**
 * Cookie técnica que identifica al visitante SOLO para acreditar su
 * consentimiento. No sirve para seguirle ni para analítica, y por eso es
 * necesaria y no requiere permiso previo: sin ella no habría forma de
 * demostrar qué aceptó.
 */
const COOKIE_VISITANTE = 'consent_id';

@ApiTags('Consentimiento')
@Controller({ path: 'consent', version: '1' })
export class ConsentController {
  constructor(
    private readonly consent: ConsentService,
    private readonly preferencias: PreferenciasService,
    private readonly newsletter: NewsletterService,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  // Un visitante decide una o dos veces; más que eso es alguien probando.
  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Dejar constancia del consentimiento de cookies' })
  async registrar(
    @Body() dto: RegistrarConsentimientoDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser('id') userId?: string,
  ): Promise<void> {
    let visitorId = req.cookies[COOKIE_VISITANTE];

    if (!visitorId) {
      visitorId = crypto.randomBytes(16).toString('hex');
      void reply.setCookie(COOKIE_VISITANTE, visitorId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.protocol === 'https',
        path: '/',
        // Tres años, lo mismo que se conserva el registro.
        maxAge: 3 * 365 * 86_400,
      });
    }

    await this.consent.registrar({
      visitorId,
      ...(userId ? { userId } : {}),
      analiticas: dto.analiticas,
      marketing: dto.marketing,
      version: dto.version,
      ip: req.ip,
      ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}),
    });
  }

  // ── Preferencias de correo ────────────────────────────────

  /**
   * Mis preferencias, ya identificado.
   *
   * Devuelve también el token para que el área de cliente enlace al mismo
   * centro de preferencias que el pie de los correos: una sola pantalla que
   * mantener, y el cliente ve exactamente lo mismo por los dos caminos.
   */
  @ApiBearerAuth('access-token')
  @Get('preferences')
  @ApiOperation({ summary: 'Mis preferencias de comunicación' })
  async misPreferencias(@CurrentUser() u: UsuarioAutenticado) {
    const p = await this.preferencias.de(u.email, u.id);

    return {
      email: p.email,
      token: p.unsubscribeToken,
      cartRecovery: p.cartRecovery,
      reviewInvites: p.reviewInvites,
      offers: p.offers,
      newsletter: p.newsletter,
    };
  }

  /**
   * Qué correos recibe esta dirección, desde el enlace del pie.
   *
   * Sin autenticación a propósito: quien compra como invitado no tiene cuenta,
   * y obligarle a registrarse para dejar de recibir correos convertiría la baja
   * en un trámite. El token opaco es la credencial.
   */
  @Public()
  @Get('preferences/:token')
  @ApiOperation({ summary: 'Preferencias de comunicación desde el enlace del correo' })
  async preferenciasPorToken(@Param('token') token: string) {
    const p = await this.preferencias.porToken(token);

    return {
      email: p.email,
      cartRecovery: p.cartRecovery,
      reviewInvites: p.reviewInvites,
      offers: p.offers,
      newsletter: p.newsletter,
    };
  }

  @Public()
  @Post('preferences/:token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Cambiar qué correos se reciben' })
  async guardarPreferencias(
    @Param('token') token: string,
    @Body() dto: ActualizarPreferenciasDto,
    @Req() req: FastifyRequest,
  ) {
    const actual = await this.preferencias.porToken(token);
    const cambios: Partial<Record<CanalComunicacion, boolean>> = dto;

    const guardada = await this.preferencias.actualizar(actual.email, cambios, {
      origen: 'email_link',
      ip: req.ip,
      ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}),
    });

    return {
      email: guardada.email,
      cartRecovery: guardada.cartRecovery,
      reviewInvites: guardada.reviewInvites,
      offers: guardada.offers,
      newsletter: guardada.newsletter,
    };
  }

  /** Baja de todo lo comercial con un solo clic, como exige la LSSI. */
  @Public()
  @Post('preferences/:token/unsubscribe-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Dejar de recibir todos los correos comerciales' })
  async bajaDeTodo(@Param('token') token: string, @Req() req: FastifyRequest): Promise<void> {
    await this.preferencias.bajaDeTodo(token, {
      origen: 'email_link',
      ip: req.ip,
      ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}),
    });
  }

  // ── Newsletter (doble opt-in) ─────────────────────────────

  /**
   * Paso 1: alguien pide el alta desde la tienda.
   *
   * Responde siempre lo mismo, esté o no la dirección en la lista. Decir "ya
   * estás suscrito" convertiría este formulario en una forma de comprobar si
   * una dirección concreta es clienta de la tienda, que con catálogo +18 es
   * información sensible de verdad.
   */
  @Public()
  @Post('newsletter')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Solicitar el alta en la newsletter' })
  solicitarNewsletter(@Body() dto: AltaNewsletterDto) {
    // Sin la IP a propósito: en este paso no se registra nada de quien lo pide,
    // porque todavía no hay consentimiento. La que importa es la del clic de
    // confirmación, que es la que acredita el alta.
    return this.newsletter.solicitar(dto.email);
  }

  /** Paso 2: el clic del correo. Aquí nace la suscripción. */
  @Public()
  @Post('newsletter/confirmar/:token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar el alta con el enlace del correo' })
  confirmarNewsletter(@Param('token') token: string, @Req() req: FastifyRequest) {
    return this.newsletter.confirmar(token, { ip: req.ip });
  }

  @ApiBearerAuth('access-token')
  @Get('newsletter/resumen')
  @RequirePermissions('customers:read')
  @ApiOperation({ summary: 'Cuántos suscriptores hay en cada segmento' })
  resumenNewsletter() {
    return this.newsletter.resumen();
  }

  /**
   * Suscriptores de un segmento.
   *
   * Es lo que se exporta al proveedor de email marketing que se conecte desde
   * Integraciones. Solo salen los confirmados: mandar a quien no ha
   * confirmado es exactamente lo que el doble opt-in existe para impedir.
   */
  @ApiBearerAuth('access-token')
  @Get('newsletter/suscriptores')
  @RequirePermissions('customers:read')
  @ApiOperation({ summary: 'Suscriptores confirmados, opcionalmente de un segmento' })
  suscriptores(@Query('segmento') segmento?: Segmento) {
    return this.newsletter.suscriptores(segmento);
  }
}
