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
  Query,
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
import {
  AsignacionDto,
  CrearExperimentoDto,
  EstadoExperimentoDto,
  GanadoraDto,
} from './dto/experiments.dto.js';
import { ExperimentsService } from './experiments.service.js';

@ApiTags('Experimentos')
@Controller({ path: 'experiments', version: '1' })
export class ExperimentsController {
  constructor(private readonly experimentos: ExperimentsService) {}

  /**
   * Lo que le toca ver a quien está navegando.
   *
   * Público y con límite: lo llama la tienda en cada primera carga. El límite
   * es generoso porque una visita normal lo pide una vez, pero existe para que
   * nadie llene la tabla de asignaciones inventándose visitantes.
   */
  @Public()
  @Get('asignacion')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Variantes asignadas a un visitante' })
  asignacion(@Query() query: AsignacionDto) {
    return this.experimentos.paraVisitante(query.visitante);
  }

  // ── Administración ────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get()
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Experimentos con sus cifras y su veredicto' })
  listar() {
    return this.experimentos.listar();
  }

  @ApiBearerAuth('access-token')
  @Get(':id')
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Un experimento con su lectura' })
  ver(@Param('id') id: string) {
    return this.experimentos.conResultado(id);
  }

  @ApiBearerAuth('access-token')
  @Post()
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Crear un experimento' })
  crear(
    @Body() dto: CrearExperimentoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.experimentos.crear(dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Patch(':id/estado')
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Arrancar o parar un experimento' })
  cambiarEstado(
    @Param('id') id: string,
    @Body() dto: EstadoExperimentoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.experimentos.cambiarEstado(id, dto.estado, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Patch(':id/ganadora')
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Dar por ganadora una variante y cerrar' })
  declararGanadora(
    @Param('id') id: string,
    @Body() dto: GanadoraDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.experimentos.declararGanadora(id, dto.variante, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('marketing:write')
  @ApiOperation({ summary: 'Eliminar un experimento y sus datos' })
  eliminar(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.experimentos.eliminar(id, this.ctx(u, req));
  }

  private ctx(u: UsuarioAutenticado, req: FastifyRequest): ContextoActor {
    return { actorId: u.id, actorIp: req.ip };
  }
}
