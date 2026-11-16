import {
  Body,
  Controller,
  Delete,
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
import { TraduccionService } from './traduccion.service.js';

const aprobarSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones')
    .optional(),
  shortDescription: z.string().max(500).nullable().optional(),
  description: z.string().max(20_000).nullable().optional(),
});

class AprobarTraduccionDto extends createZodDto(aprobarSchema) {}

@ApiTags('Traducciones')
@ApiBearerAuth('access-token')
@Controller({ path: 'translations', version: '1' })
export class TraduccionController {
  constructor(private readonly traduccion: TraduccionService) {}

  @Get('pending')
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Traducciones automáticas pendientes de repasar' })
  async pendientes(@Query('limite') limite?: string) {
    return {
      motorActivo: await this.traduccion.estaActiva(),
      total: await this.traduccion.cuantasPendientes(),
      items: await this.traduccion.pendientes(limite ? Number(limite) : undefined),
    };
  }

  @Post('products/:productId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Traducir un producto a los idiomas que le falten' })
  async traducir(@Param('productId') productId: string) {
    const idiomas = await this.traduccion.traducirProducto(productId);
    return { idiomas, motorActivo: await this.traduccion.estaActiva() };
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Publicar la traducción, con las correcciones que se hayan hecho' })
  aprobar(
    @Param('id') id: string,
    @Body() dto: AprobarTraduccionDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.traduccion.aprobar(id, dto, { actorId: u.id, actorIp: req.ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Descartar una traducción sin publicarla' })
  descartar(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.traduccion.descartar(id, { actorId: u.id, actorIp: req.ip });
  }
}
