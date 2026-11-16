import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { ReturnsService } from './returns.service.js';
import {
  RecibirDevolucionDto,
  ResolverDevolucionDto,
  SolicitarDevolucionDto,
} from './dto/returns.dto.js';

@ApiTags('Devoluciones')
@Controller({ path: 'returns', version: '1' })
export class ReturnsController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly orders: OrdersService,
  ) {}

  // ── Cliente ───────────────────────────────────────────────
  //
  // Por la clave de seguimiento: quien compra sin cuenta también devuelve.

  @Public()
  @Get('order/:token')
  @ApiOperation({ summary: 'Qué se puede devolver, con plazos y condiciones de cada motivo' })
  async opciones(@Param('token') token: string) {
    const orderId = await this.orders.idPorTokenPublico(token);
    return this.returns.opciones(orderId);
  }

  @Public()
  @Post('order/:token')
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Solicitar una devolución' })
  async solicitar(@Param('token') token: string, @Body() dto: SolicitarDevolucionDto) {
    const orderId = await this.orders.idPorTokenPublico(token);
    return this.returns.solicitar(orderId, {
      motivo: dto.motivo,
      lineas: dto.lineas,
      ...(dto.nota ? { nota: dto.nota } : {}),
      ...(dto.fotos ? { fotos: dto.fotos } : {}),
    });
  }

  // ── Gestión ───────────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get()
  @RequirePermissions('returns:manage')
  @ApiOperation({ summary: 'Devoluciones solicitadas' })
  listar(@Query('estado') estado?: string) {
    return this.returns.listar(estado);
  }

  @ApiBearerAuth('access-token')
  @Post(':numero/approve')
  @RequirePermissions('returns:manage')
  @ApiOperation({ summary: 'Aprobar una devolución' })
  aprobar(
    @Param('numero') numero: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.returns.aprobar(numero, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Post(':numero/receive')
  @RequirePermissions('returns:manage')
  @ApiOperation({ summary: 'Anotar la recepción y el estado de lo devuelto' })
  recibir(
    @Param('numero') numero: string,
    @Body() dto: RecibirDevolucionDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.returns.recibir(numero, dto.lineas, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Patch(':numero/resolve')
  @RequirePermissions('returns:manage')
  @ApiOperation({ summary: 'Resolver la devolución' })
  resolver(
    @Param('numero') numero: string,
    @Body() dto: ResolverDevolucionDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.returns.resolver(numero, dto.resolucion, this.ctx(u, req), {
      ...(dto.importeCents !== undefined ? { importeCents: dto.importeCents } : {}),
      ...(dto.motivoRechazo ? { motivoRechazo: dto.motivoRechazo } : {}),
    });
  }

  private ctx(u: UsuarioAutenticado, req: FastifyRequest): ContextoActor {
    return { actorId: u.id, actorIp: req.ip };
  }
}
