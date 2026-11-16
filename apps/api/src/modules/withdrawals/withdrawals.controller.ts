import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LOCALES, type Locale } from '@ecom/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { WithdrawalsService } from './withdrawals.service.js';
import { CambiarEstadoDesistimientoDto, SolicitarDesistimientoDto } from './dto/withdrawals.dto.js';

@ApiTags('Desistimiento')
@Controller({ path: 'withdrawals', version: '1' })
export class WithdrawalsController {
  constructor(
    private readonly withdrawals: WithdrawalsService,
    private readonly orders: OrdersService,
  ) {}

  // ── Cliente ───────────────────────────────────────────────
  //
  // Por la clave de seguimiento del pedido, no por su id: quien compra sin
  // cuenta también tiene derecho a desistir, y es la única llave que tiene.

  @Public()
  @Get('order/:token')
  @ApiOperation({ summary: 'Qué se puede devolver de un pedido y hasta cuándo' })
  async elegibilidad(@Param('token') token: string) {
    const orderId = await this.orders.idPorTokenPublico(token);
    return this.withdrawals.elegibilidad(orderId);
  }

  @Public()
  @Post('order/:token')
  // Comunicar el desistimiento es un acto único por pedido; un número alto de
  // intentos solo pasa si alguien está probando claves.
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Comunicar el desistimiento de un pedido' })
  async solicitar(@Param('token') token: string, @Body() dto: SolicitarDesistimientoDto) {
    const orderId = await this.orders.idPorTokenPublico(token);
    return this.withdrawals.solicitar(orderId, {
      lineas: dto.lineas,
      ...(dto.motivo ? { motivo: dto.motivo } : {}),
      ...(dto.nota ? { nota: dto.nota } : {}),
    });
  }

  @Public()
  @Get('order/:token/form')
  @ApiOperation({ summary: 'Formulario modelo de desistimiento (obligatorio facilitarlo)' })
  async formulario(
    @Param('token') token: string,
    @Query('locale') locale: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const texto = await this.withdrawals.formularioPara(token, this.idioma(locale));

    void reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', 'attachment; filename="desistimiento.txt"');

    return texto;
  }

  private idioma(valor?: string): Locale {
    return LOCALES.includes(valor as Locale) ? (valor as Locale) : 'es';
  }

  // ── Administración ────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get()
  @RequirePermissions('returns:manage')
  @ApiOperation({ summary: 'Desistimientos comunicados' })
  listar(@Query('estado') estado?: string) {
    return this.withdrawals.listar(estado);
  }

  @ApiBearerAuth('access-token')
  @Get('urgent')
  @RequirePermissions('returns:manage')
  @ApiOperation({ summary: 'Reembolsos a punto de pasarse del plazo legal' })
  urgentes() {
    return this.withdrawals.reembolsosUrgentes();
  }

  @ApiBearerAuth('access-token')
  @Patch(':id')
  @RequirePermissions('returns:manage')
  @ApiOperation({ summary: 'Mover el estado de un desistimiento' })
  cambiar(
    @Param('id') id: string,
    @Body() dto: CambiarEstadoDesistimientoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.withdrawals.cambiarEstado(
      id,
      dto.estado,
      { actorId: u.id, actorIp: req.ip } satisfies ContextoActor,
      dto.motivoRechazo,
    );
  }
}
