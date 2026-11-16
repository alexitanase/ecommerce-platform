import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { CouponsService } from './coupons.service.js';
import { ActualizarCuponDto, ComprobarCuponDto, CrearCuponDto } from './dto/coupons.dto.js';

@ApiTags('Cupones')
@Controller({ path: 'coupons', version: '1' })
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Public()
  @Post('check')
  @HttpCode(HttpStatus.OK)
  // Un límite ajustado: probar códigos a ciegas hasta dar con uno válido es el
  // uso indebido más común de este endpoint.
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Comprobar un cupón sin consumirlo' })
  comprobar(@Body() dto: ComprobarCuponDto, @CurrentUser('id') userId?: string) {
    return this.coupons.comprobar(dto.codigo, dto.lineas, dto.subtotalCents, {
      ...(userId ? { userId } : {}),
      ...(dto.email ? { email: dto.email } : {}),
    });
  }

  // ── Administración ────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get()
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Cupones con sus métricas de uso' })
  listar() {
    return this.coupons.listar();
  }

  @ApiBearerAuth('access-token')
  @Post()
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Crear un cupón' })
  crear(
    @Body() dto: CrearCuponDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.coupons.crear(dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Patch(':id')
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Activar, caducar o cambiar el tope de un cupón' })
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarCuponDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.coupons.actualizar(id, dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Retirar un cupón' })
  eliminar(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.coupons.eliminar(id, this.ctx(u, req));
  }

  private ctx(u: UsuarioAutenticado, req: FastifyRequest): ContextoActor {
    return { actorId: u.id, actorIp: req.ip };
  }
}
