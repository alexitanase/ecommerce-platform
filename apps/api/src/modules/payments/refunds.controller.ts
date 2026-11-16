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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { RefundStatus } from '@ecom/db';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import { RefundsService } from './refunds.service.js';
import {
  AprobarReembolsoDto,
  RechazarReembolsoDto,
  SolicitarReembolsoDto,
} from './dto/refunds.dto.js';

/**
 * Reembolsos.
 *
 * Los permisos están separados a propósito: `orders:refund` deja **pedir** un
 * reembolso, que no mueve dinero, y `payments:payout` deja **aprobarlo**, que
 * sí lo mueve y de forma irreversible. Quien atiende a clientes puede tramitar
 * una devolución sin poder vaciar la cuenta de la tienda.
 */
@ApiTags('Reembolsos')
@ApiBearerAuth('access-token')
@Controller({ path: 'refunds', version: '1' })
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get()
  @RequirePermissions('payments:read')
  @ApiOperation({ summary: 'Reembolsos, opcionalmente filtrados por estado' })
  listar(@Query('estado') estado?: RefundStatus) {
    return this.refunds.listar(estado);
  }

  @Get('order/:orderId')
  @RequirePermissions('payments:read')
  @ApiOperation({ summary: 'Reembolsos de un pedido y cuánto queda por devolver' })
  async porPedido(@Param('orderId') orderId: string) {
    const [reembolsos, importes] = await Promise.all([
      this.refunds.porPedido(orderId),
      this.refunds.disponible(orderId),
    ]);
    return { reembolsos, ...importes };
  }

  @Post()
  @RequirePermissions('orders:refund')
  @ApiOperation({ summary: 'Pedir un reembolso (no mueve dinero: queda pendiente)' })
  solicitar(
    @Body() dto: SolicitarReembolsoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.refunds.solicitar(
      {
        orderId: dto.orderId,
        importeCents: dto.importeCents,
        motivo: dto.motivo,
        ...(dto.direccion ? { direccion: dto.direccion } : {}),
        ...(dto.moneda ? { moneda: dto.moneda } : {}),
        ...(dto.red ? { red: dto.red } : {}),
      },
      { actorId: u.id, actorIp: req.ip },
    );
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments:payout')
  @ApiOperation({ summary: 'Aprobar y enviar el reembolso · IRREVERSIBLE' })
  aprobar(
    @Param('id') id: string,
    // El cuerpo solo lleva la confirmación; el DTO existe para que la
    // validación la exija y la interfaz tenga que pedirla.
    @Body() _dto: AprobarReembolsoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.refunds.aprobar(id, { actorId: u.id, actorIp: req.ip });
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments:payout')
  @ApiOperation({ summary: 'Denegar la solicitud' })
  rechazar(
    @Param('id') id: string,
    @Body() dto: RechazarReembolsoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.refunds.rechazar(id, dto.motivo, { actorId: u.id, actorIp: req.ip });
  }
}
