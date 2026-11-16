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
import type { UsuarioAutenticado } from '../../common/types/request.js';
import { RolesService, type ContextoActor } from './roles.service.js';
import { ActualizarRolDto, AsignarRolDto, CrearRolDto } from './dto/roles.dto.js';

@ApiTags('Roles y permisos')
@ApiBearerAuth('access-token')
@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions('roles:write')
  @ApiOperation({ summary: 'Catálogo de permisos disponibles, agrupados por recurso' })
  listarPermisos() {
    return this.roles.listarPermisos();
  }

  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'Listar roles con sus permisos' })
  listar() {
    return this.roles.listarRoles();
  }

  @Post()
  @RequirePermissions('roles:write')
  @ApiOperation({ summary: 'Crear un rol propio' })
  crear(
    @Body() dto: CrearRolDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.roles.crearRol(dto, this.ctx(u, req));
  }

  @Patch(':id')
  @RequirePermissions('roles:write')
  @ApiOperation({ summary: 'Modificar un rol' })
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarRolDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.roles.actualizarRol(id, dto, this.ctx(u, req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('roles:write')
  @ApiOperation({ summary: 'Eliminar un rol propio' })
  eliminar(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.roles.eliminarRol(id, this.ctx(u, req));
  }

  @Post('users/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Asignar un rol a un usuario' })
  asignar(
    @Param('userId') userId: string,
    @Body() dto: AsignarRolDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.roles.asignarRolAUsuario(userId, dto.roleId, this.ctx(u, req));
  }

  @Delete('users/:userId/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Quitar un rol a un usuario' })
  quitar(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.roles.quitarRolAUsuario(userId, roleId, this.ctx(u, req));
  }

  private ctx(u: UsuarioAutenticado, req: FastifyRequest): ContextoActor {
    return { actorId: u.id, actorIp: req.ip };
  }
}
