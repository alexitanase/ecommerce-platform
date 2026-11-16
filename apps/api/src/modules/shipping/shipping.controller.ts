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
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CacheHttp } from '../../common/decorators/cache-http.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { ShippingService } from './shipping.service.js';
import {
  ActualizarTarifaDto,
  ActualizarZonaDto,
  CalcularEnvioDto,
  CrearTarifaDto,
  CrearZonaDto,
} from './dto/shipping.dto.js';

@ApiTags('Envíos')
@Controller({ path: 'shipping', version: '1' })
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  // ── Tienda ────────────────────────────────────────────────

  @Public()
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Opciones de envío para un destino y un carrito' })
  calcular(@Body() dto: CalcularEnvioDto) {
    const destino = { countryCode: dto.countryCode, postalCode: dto.postalCode };

    // Con carrito manda el carrito: el importe y el peso los pone el catálogo,
    // no el navegador. El par subtotal/peso queda para las simulaciones del
    // panel, donde se quiere probar una zona sin tener un pedido delante.
    if (dto.lineas) return this.shipping.opcionesDeCarrito(destino, dto.lineas);

    return this.shipping.opciones(destino, dto.subtotalCents ?? 0, dto.pesoGramos ?? 0);
  }

  @Public()
  // Las zonas cambian de higos a brevas y esto se pinta en la página de envíos
  // y en el pie: es de lo más cacheable de la tienda.
  @CacheHttp({ compartida: 3600, navegador: 300, mientrasRevalida: 86_400 })
  @Get('zones/public')
  @ApiOperation({ summary: 'Zonas a las que enviamos, para informar en la tienda' })
  async zonasPublicas() {
    const zonas = await this.shipping.listarZonas();
    return zonas
      .filter((z) => z.isActive)
      .map((z) => ({
        nombre: z.name,
        paises: z.countries,
        avisoAduanas: z.customsWarning,
        sinIva: z.outsideVatTerritory,
        desdeCents: Math.min(...z.rates.map((r) => r.priceCents), 0),
        plazo: {
          min: Math.min(...z.rates.map((r) => r.minDays)),
          max: Math.max(...z.rates.map((r) => r.maxDays)),
        },
      }));
  }

  // ── Administración ────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get('zones')
  @RequirePermissions('settings:read')
  @ApiOperation({ summary: 'Zonas y tarifas configuradas' })
  listar() {
    return this.shipping.listarZonas();
  }

  @ApiBearerAuth('access-token')
  @Post('zones')
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Crear una zona de envío' })
  crearZona(
    @Body() dto: CrearZonaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.shipping.crearZona(dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Patch('zones/:id')
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Modificar una zona' })
  actualizarZona(
    @Param('id') id: string,
    @Body() dto: ActualizarZonaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.shipping.actualizarZona(id, dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Delete('zones/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Retirar una zona' })
  borrarZona(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.shipping.borrarZona(id, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Post('zones/:id/rates')
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Añadir una tarifa a una zona' })
  crearTarifa(@Param('id') zoneId: string, @Body() dto: CrearTarifaDto) {
    return this.shipping.crearTarifa(zoneId, dto);
  }

  @ApiBearerAuth('access-token')
  @Patch('rates/:id')
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Modificar una tarifa' })
  actualizarTarifa(@Param('id') id: string, @Body() dto: ActualizarTarifaDto) {
    return this.shipping.actualizarTarifa(id, dto);
  }

  @ApiBearerAuth('access-token')
  @Delete('rates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Retirar una tarifa' })
  borrarTarifa(@Param('id') id: string) {
    return this.shipping.borrarTarifa(id);
  }

  private ctx(u: UsuarioAutenticado, req: FastifyRequest): ContextoActor {
    return { actorId: u.id, actorIp: req.ip };
  }
}
