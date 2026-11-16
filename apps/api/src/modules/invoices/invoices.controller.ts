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
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import { InvoicesService } from './invoices.service.js';

const rectificarSchema = z.object({
  motivo: z.string().trim().min(5, 'Indica el motivo de la rectificación').max(300),
  importeCents: z.number().int().min(1).optional(),
});

const libroSchema = z.object({
  desde: z.iso.datetime({ offset: true }),
  hasta: z.iso.datetime({ offset: true }),
});

class RectificarDto extends createZodDto(rectificarSchema) {}
class LibroDto extends createZodDto(libroSchema) {}

@ApiTags('Facturación')
@ApiBearerAuth('access-token')
@Controller({ path: 'invoices', version: '1' })
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post('order/:orderId')
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Emitir la factura de un pedido (idempotente)' })
  emitir(
    @Param('orderId') orderId: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.invoices.emitir(orderId, { actorId: u.id, actorIp: req.ip });
  }

  /**
   * La factura de MI pedido, desde el área de cliente.
   *
   * Sin `@RequirePermissions`: aquí no entra el equipo, entra quien compró. La
   * autorización no es un permiso de rol sino la propiedad del pedido, y eso lo
   * comprueba el servicio comparando con el usuario autenticado.
   *
   * Es un POST y no un GET porque la primera llamada EMITE la factura: le
   * asigna número de serie y la registra en el libro de IVA. Un GET que crea un
   * documento fiscal es un GET que cualquier prefetch del navegador puede
   * disparar solo.
   */
  @Post('mine/:orderId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Emitir y obtener la factura de un pedido propio' })
  miFactura(@Param('orderId') orderId: string, @CurrentUser() u: UsuarioAutenticado) {
    return this.invoices.miFactura(orderId, u.id);
  }

  @Get('order/:orderId')
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Facturas de un pedido' })
  porPedido(@Param('orderId') orderId: string) {
    return this.invoices.porPedido(orderId);
  }

  @Get('book')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Libro de facturas emitidas para el modelo 303' })
  libro(@Query() query: LibroDto) {
    return this.invoices.libroIva(new Date(query.desde), new Date(query.hasta));
  }

  @Get('check')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Comprobar que no hay huecos en la numeración' })
  comprobar(@Query('anio') anio?: string) {
    return this.invoices.comprobarCorrelatividad(anio ? Number(anio) : undefined);
  }

  @Get(':id')
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Detalle de una factura' })
  detalle(@Param('id') id: string) {
    return this.invoices.detalle(id);
  }

  @Post(':id/credit-note')
  @RequirePermissions('orders:refund')
  @ApiOperation({ summary: 'Emitir una rectificativa' })
  rectificar(
    @Param('id') id: string,
    @Body() dto: RectificarDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.invoices.rectificar(id, dto, { actorId: u.id, actorIp: req.ip });
  }
}
