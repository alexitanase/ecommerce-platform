import { Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AgeService } from '../age/age.service.js';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { SearchService } from './search.service.js';
import { BuscarDto, SugerenciasDto } from './dto/search.dto.js';

@ApiTags('Búsqueda')
@Controller({ path: 'search', version: '1' })
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly age: AgeService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Buscar productos con filtros y facetas' })
  async buscar(
    @Query() query: BuscarDto,
    @Req() req: FastifyRequest,
    @CurrentUser('id') userId?: string,
  ) {
    // Lo decide el servidor a partir de la verificación, nunca un parámetro de
    // la petición: si viniera del cliente, saltarse el control sería añadir
    // `?incluirAdulto=true` a la URL.
    const incluirAdulto = await this.age.puedeVerAdulto(req, userId);

    return this.search.buscar({ ...query, incluirAdulto });
  }

  @Public()
  @Get('suggest')
  @ApiOperation({ summary: 'Sugerencias para el desplegable del buscador' })
  async sugerencias(
    @Query() query: SugerenciasDto,
    @Req() req: FastifyRequest,
    @CurrentUser('id') userId?: string,
  ) {
    // La misma regla que la búsqueda completa: si no, el desplegable dice que
    // un producto no existe y la búsqueda entera lo encuentra.
    const incluirAdulto = await this.age.puedeVerAdulto(req, userId);

    return this.search.sugerencias(query.q, query.locale, undefined, incluirAdulto);
  }

  @ApiBearerAuth('access-token')
  @Get('status')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Estado del buscador y documentos por índice' })
  estado() {
    return this.search.estado();
  }

  @ApiBearerAuth('access-token')
  @Post('reindex')
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Reindexar todo el catálogo' })
  reindexar() {
    return this.search.reindexarTodo();
  }
}
