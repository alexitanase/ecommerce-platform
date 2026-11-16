import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import type { ContextoActor } from '../roles/roles.service.js';
import {
  ActualizarAfiliadoDto,
  CrearAfiliadoDto,
  EnlaceDto,
  InformeCanalesDto,
} from './dto/channels.dto.js';
import { ChannelsService } from './channels.service.js';

@ApiTags('Canales')
@Controller({ path: 'channels', version: '1' })
export class ChannelsController {
  constructor(private readonly canales: ChannelsService) {}

  @ApiBearerAuth('access-token')
  @Get()
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Canales viables para catálogo adulto, con sus condiciones' })
  listar() {
    return this.canales.canales();
  }

  @ApiBearerAuth('access-token')
  @Post('enlace')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Construir un enlace marcado para una campaña' })
  enlace(@Body() dto: EnlaceDto) {
    return this.canales.enlace(dto.base, {
      fuente: dto.fuente,
      ...(dto.medio ? { medio: dto.medio } : {}),
      ...(dto.campana ? { campana: dto.campana } : {}),
    });
  }

  @ApiBearerAuth('access-token')
  @Get('informe')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Ventas por canal' })
  informe(@Query() query: InformeCanalesDto) {
    return this.canales.informe(
      query.desde ? new Date(query.desde) : undefined,
      query.hasta ? new Date(query.hasta) : undefined,
    );
  }

  // ── Afiliados ─────────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get('afiliados')
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Afiliados con lo devengado y lo pagado' })
  afiliados() {
    return this.canales.listarAfiliados();
  }

  @ApiBearerAuth('access-token')
  @Post('afiliados')
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Dar de alta un afiliado' })
  crearAfiliado(
    @Body() dto: CrearAfiliadoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.canales.crearAfiliado(dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Patch('afiliados/:id')
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Cambiar la comisión o el estado de un afiliado' })
  actualizarAfiliado(
    @Param('id') id: string,
    @Body() dto: ActualizarAfiliadoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.canales.actualizarAfiliado(id, dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Get('afiliados/:id/comisiones')
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Comisiones de un afiliado' })
  comisiones(@Param('id') id: string, @Query('estado') estado?: string) {
    return this.canales.comisiones(id, estado);
  }

  @ApiBearerAuth('access-token')
  @Post('afiliados/:id/liquidar')
  @HttpCode(HttpStatus.OK)
  // Sale dinero de verdad, aunque la transferencia se haga fuera. Pide el
  // permiso de salida de fondos, no el de marketing: quien monta una campaña
  // no tiene por qué poder dar por pagadas las comisiones de esa campaña.
  @RequirePermissions('payments:payout')
  @ApiOperation({ summary: 'Marcar como pagadas las comisiones aprobadas' })
  liquidar(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.canales.liquidar(id, this.ctx(u, req));
  }

  private ctx(u: UsuarioAutenticado, req: FastifyRequest): ContextoActor {
    return { actorId: u.id, actorIp: req.ip };
  }
}
