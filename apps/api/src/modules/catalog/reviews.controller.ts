import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { PricingService } from './services/pricing.service.js';
import { ReviewsService } from './services/reviews.service.js';
import {
  CalcularPvpDto,
  CrearResenaDto,
  ModerarResenaDto,
  ResponderResenaDto,
} from './dto/reviews.dto.js';

@ApiTags('Reseñas y precios')
@Controller({ path: 'reviews', version: '1' })
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly pricing: PricingService,
  ) {}

  // ── Público ───────────────────────────────────────────────

  @Public()
  @Get('product/:productId')
  @ApiOperation({ summary: 'Reseñas publicadas de un producto' })
  listar(@Param('productId') productId: string, @Query('cursor') cursor?: string) {
    return this.reviews.listarPublicas(productId, cursor ? { cursor } : {});
  }

  @Public()
  @Get('product/:productId/summary')
  @ApiOperation({ summary: 'Media y reparto de estrellas' })
  resumen(@Param('productId') productId: string) {
    return this.reviews.resumen(productId);
  }

  // ── Cliente ───────────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Post()
  // Una reseña por producto ya está limitada en el servicio; esto corta el
  // envío masivo desde una cuenta comprometida.
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Publicar una valoración (queda pendiente de moderar)' })
  crear(@CurrentUser() u: UsuarioAutenticado, @Body() dto: CrearResenaDto) {
    return this.reviews.crear(u.id, dto);
  }

  @Public()
  @Post(':id/helpful')
  @Throttle({ default: { limit: 30, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Marcar una reseña como útil' })
  util(@Param('id') id: string) {
    return this.reviews.marcarUtil(id);
  }

  // ── Moderación (admin) ────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get('pending')
  @RequirePermissions('reviews:moderate')
  @ApiOperation({ summary: 'Cola de reseñas pendientes de moderar' })
  pendientes() {
    return this.reviews.pendientes();
  }

  @ApiBearerAuth('access-token')
  @Post(':id/moderate')
  @RequirePermissions('reviews:moderate')
  @ApiOperation({ summary: 'Aprobar o rechazar una reseña' })
  moderar(
    @Param('id') id: string,
    @Body() dto: ModerarResenaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.reviews.moderar(id, dto.decision, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Post(':id/reply')
  @RequirePermissions('reviews:moderate')
  @ApiOperation({ summary: 'Responder públicamente a una reseña' })
  responder(
    @Param('id') id: string,
    @Body() dto: ResponderResenaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.reviews.responder(id, dto.reply, this.ctx(u, req));
  }

  // ── Precios ───────────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Post('pricing/calculate')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Calcular el PVP a partir del coste y el margen objetivo' })
  calcularPvp(@Body() dto: CalcularPvpDto) {
    return this.pricing.calcularPvp(dto);
  }

  @ApiBearerAuth('access-token')
  @Get('pricing/low-margin')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Variantes por debajo del margen mínimo' })
  bajoMargen(@Query('margenMinimo') margenMinimo?: string) {
    return this.pricing.variantesBajoMargen(margenMinimo ? Number(margenMinimo) : 20);
  }

  private ctx(u: UsuarioAutenticado, req: FastifyRequest): ContextoActor {
    return { actorId: u.id, actorIp: req.ip };
  }
}
