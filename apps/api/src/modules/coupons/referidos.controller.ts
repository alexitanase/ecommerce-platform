import { Body, Controller, Get, Patch, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { ListarReferidosDto, ReglasReferidosDto } from './dto/referidos.dto.js';
import { ReferidosService } from './referidos.service.js';

@ApiTags('Referidos')
@Controller({ path: 'referrals', version: '1' })
export class ReferidosController {
  constructor(private readonly referidos: ReferidosService) {}

  /**
   * Lo que la tienda enseña a quien no ha entrado todavía.
   *
   * Solo los importes y las condiciones, y solo si el programa está encendido:
   * anunciar un descuento que luego no se aplica es peor que no anunciarlo.
   */
  @Public()
  @Get('programa')
  @ApiOperation({ summary: 'Condiciones públicas del programa de referidos' })
  async programa() {
    const reglas = await this.referidos.reglas();

    if (!reglas.activo) return { activo: false };

    return {
      activo: true,
      premioReferidorCents: reglas.premioReferidorCents,
      premioReferidoCents: reglas.premioReferidoCents,
      pedidoMinimoCents: reglas.pedidoMinimoCents,
      diasDeValidez: reglas.diasDeValidez,
    };
  }

  @ApiBearerAuth('access-token')
  @Get('mi-codigo')
  @ApiOperation({ summary: 'Código de invitación propio, creándolo si no existe' })
  miCodigo(@CurrentUser() u: UsuarioAutenticado) {
    return this.referidos.miCodigo(u.id);
  }

  @ApiBearerAuth('access-token')
  @Get('mios')
  @ApiOperation({ summary: 'A quién ha traído quien pregunta' })
  mios(@CurrentUser() u: UsuarioAutenticado) {
    return this.referidos.misReferidos(u.id);
  }

  // ── Administración ────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get()
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Referidos con lo que ha costado el programa' })
  listar(@Query() query: ListarReferidosDto) {
    return this.referidos.listar(query.estado);
  }

  @ApiBearerAuth('access-token')
  @Get('reglas')
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Reglas configuradas del programa' })
  reglas() {
    return this.referidos.reglas();
  }

  @ApiBearerAuth('access-token')
  @Patch('reglas')
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Cambiar las reglas del programa' })
  guardarReglas(
    @Body() dto: ReglasReferidosDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    const ctx: ContextoActor = { actorId: u.id, actorIp: req.ip };
    return this.referidos.guardarReglas(dto, ctx);
  }
}
