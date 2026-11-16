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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import { AddressesService } from './addresses.service.js';
import { ActualizarDireccionDto, CrearDireccionDto } from './dto/addresses.dto.js';

/**
 * Libreta de direcciones del cliente.
 *
 * Todas las operaciones van contra las direcciones del usuario autenticado:
 * el ID de usuario nunca se acepta como parámetro, se toma siempre del token.
 */
@ApiTags('Direcciones')
@ApiBearerAuth('access-token')
@Controller({ path: 'addresses', version: '1' })
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar mis direcciones' })
  listar(@CurrentUser() u: UsuarioAutenticado) {
    return this.addresses.listar(u.id);
  }

  @Post()
  @ApiOperation({ summary: 'Añadir una dirección' })
  crear(@CurrentUser() u: UsuarioAutenticado, @Body() dto: CrearDireccionDto) {
    return this.addresses.crear(u.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modificar una dirección' })
  actualizar(
    @CurrentUser() u: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() dto: ActualizarDireccionDto,
  ) {
    return this.addresses.actualizar(u.id, id, dto);
  }

  @Post(':id/default')
  @ApiOperation({ summary: 'Marcar como dirección predeterminada' })
  predeterminada(@CurrentUser() u: UsuarioAutenticado, @Param('id') id: string) {
    return this.addresses.marcarPredeterminada(u.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar una dirección' })
  eliminar(@CurrentUser() u: UsuarioAutenticado, @Param('id') id: string) {
    return this.addresses.eliminar(u.id, id);
  }
}
