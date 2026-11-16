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
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import { UsersService } from './users.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import {
  AceptarInvitacionDto,
  ActualizarPerfilDto,
  ConsentimientoDto,
  EditarUsuarioDto,
  EstadoUsuarioDto,
  InvitarDto,
  ListarClientesDto,
  ListarUsuariosDto,
} from './dto/users.dto.js';

@ApiTags('Usuarios')
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // ── Perfil propio ─────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Patch('me')
  @ApiOperation({ summary: 'Actualizar mi perfil' })
  actualizarPerfil(@CurrentUser() u: UsuarioAutenticado, @Body() dto: ActualizarPerfilDto) {
    return this.users.actualizarPerfil(u.id, dto);
  }

  @ApiBearerAuth('access-token')
  @Patch('me/marketing-consent')
  @ApiOperation({ summary: 'Aceptar o retirar el consentimiento de marketing' })
  consentimiento(@CurrentUser() u: UsuarioAutenticado, @Body() dto: ConsentimientoDto) {
    return this.users.actualizarConsentimiento(u.id, dto.marketingConsent);
  }

  @ApiBearerAuth('access-token')
  @Get('me/export')
  @ApiOperation({ summary: 'Descargar mis datos personales (portabilidad RGPD)' })
  exportarPropios(@CurrentUser() u: UsuarioAutenticado) {
    return this.users.exportarDatos(u.id);
  }

  // ── Invitaciones ──────────────────────────────────────────

  @Public()
  @Post('accept-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Establecer la contraseña con el token de invitación' })
  async aceptarInvitacion(@Body() dto: AceptarInvitacionDto) {
    await this.users.establecerPasswordInvitacion(dto.token, dto.password);
    return { mensaje: 'Contraseña establecida. Ya puedes iniciar sesión.' };
  }

  // ── Clientes ──────────────────────────────────────────────
  //
  // Separado de la gestión del equipo a propósito: son permisos distintos.
  // Quien atiende a clientes no tiene por qué poder tocar las cuentas del
  // personal, ni al revés.

  @ApiBearerAuth('access-token')
  @Get('customers')
  @RequirePermissions('customers:read')
  @ApiOperation({ summary: 'Clientes con sus cifras de compra' })
  listarClientes(@Query() query: ListarClientesDto) {
    return this.users.listarClientes(query);
  }

  @ApiBearerAuth('access-token')
  @Get('customers/:id')
  @RequirePermissions('customers:read')
  @ApiOperation({ summary: 'Ficha del cliente con historial y direcciones' })
  fichaCliente(@Param('id') id: string) {
    return this.users.fichaCliente(id);
  }

  /**
   * Cerrar todas las sesiones de una cuenta.
   *
   * Va en el bloque de clientes y con `customers:write` porque el caso que lo
   * justifica es de atención al cliente: alguien llama diciendo que le han
   * entrado en su cuenta y hay que echar a quien esté dentro sin esperar a que
   * caduque nada.
   */
  @ApiBearerAuth('access-token')
  @Delete('customers/:id/sessions')
  @RequirePermissions('customers:write')
  @ApiOperation({ summary: 'Cerrar todas las sesiones abiertas de una cuenta' })
  cerrarSesionesCliente(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @CurrentUser('id') actorId: string,
  ) {
    return this.users.cerrarSesiones(id, { actorId, actorIp: req.ip });
  }

  @ApiBearerAuth('access-token')
  @Patch('customers/:id/status')
  @RequirePermissions('customers:write')
  @ApiOperation({ summary: 'Activar o bloquear la cuenta de un cliente' })
  cambiarEstadoCliente(
    @Param('id') id: string,
    @Body() dto: EstadoUsuarioDto,
    @Req() req: FastifyRequest,
    @CurrentUser('id') actorId: string,
  ) {
    return this.users.cambiarEstadoCliente(id, dto.isActive, { actorId, actorIp: req.ip });
  }

  // ── Gestión (admin) ───────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'Listar usuarios con filtros y paginación por cursor' })
  listar(@Query() query: ListarUsuariosDto) {
    return this.users.listar(query);
  }

  @ApiBearerAuth('access-token')
  @Get(':id')
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'Detalle de un usuario' })
  detalle(@Param('id') id: string) {
    return this.users.detalle(id);
  }

  @ApiBearerAuth('access-token')
  @Post('invite')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Invitar a un miembro del equipo' })
  invitar(
    @Body() dto: InvitarDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.users.invitar(dto, this.ctx(u, req));
  }

  /**
   * Editar nombre y roles de una cuenta del personal.
   *
   * Los roles se mandan enteros, no de uno en uno: la pantalla de edición
   * guarda un estado completo con un botón. Ver `editarUsuarioSchema`.
   */
  @ApiBearerAuth('access-token')
  @Patch(':id')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Editar el nombre y los roles de una cuenta del personal' })
  editar(
    @Param('id') id: string,
    @Body() dto: EditarUsuarioDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.users.editar(id, dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Patch(':id/status')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Activar o desactivar una cuenta' })
  cambiarEstado(
    @Param('id') id: string,
    @Body() dto: EstadoUsuarioDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.users.cambiarEstado(id, dto.isActive, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Delete(':id/sessions')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Cerrar todas las sesiones de una cuenta del personal' })
  cerrarSesionesPersonal(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @CurrentUser('id') actorId: string,
  ) {
    return this.users.cerrarSesionesPersonal(id, { actorId, actorIp: req.ip });
  }

  @ApiBearerAuth('access-token')
  @Get(':id/export')
  @RequirePermissions('customers:gdpr')
  @ApiOperation({ summary: 'Exportar los datos de un usuario (solicitud RGPD)' })
  exportar(@Param('id') id: string) {
    return this.users.exportarDatos(id);
  }

  @ApiBearerAuth('access-token')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('customers:gdpr')
  @ApiOperation({ summary: 'Anonimizar un usuario (derecho de supresión)' })
  anonimizar(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.users.anonimizar(id, this.ctx(u, req));
  }

  private ctx(u: UsuarioAutenticado, req: FastifyRequest): ContextoActor {
    return { actorId: u.id, actorIp: req.ip };
  }
}
