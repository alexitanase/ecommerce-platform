import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CacheHttp } from '../../common/decorators/cache-http.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import { IntegracionesService } from './integraciones.service.js';

const guardarSchema = z.object({
  activa: z.boolean().optional(),
  /** Solo lo que se haya tocado: lo que no venga, se conserva. */
  credenciales: z.record(z.string(), z.string()).optional(),
  ajustes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

class GuardarIntegracionDto extends createZodDto(guardarSchema) {}

/**
 * Configuración de los servicios externos.
 *
 * Exige `settings:write`: quien puede configurar la pasarela puede desviar los
 * cobros de la tienda, así que no es un permiso de contenido.
 */
@ApiTags('Integraciones')
@ApiBearerAuth('access-token')
@Controller({ path: 'integrations', version: '1' })
export class IntegracionesController {
  constructor(private readonly integraciones: IntegracionesService) {}

  /**
   * Identificadores de analítica, para la tienda.
   *
   * Público porque lo pide el navegador de cualquier visitante antes de cargar
   * nada, y porque estos identificadores no son secretos: se ven en el HTML de
   * cualquier página. Lo que aporta es lo contrario a un secreto: si no hay
   * nada configurado, la tienda **no carga ni un byte** de Google ni de Meta.
   */
  @Public()
  @Get('analitica')
  @CacheHttp({ compartida: 300, navegador: 60 })
  @ApiOperation({ summary: 'Identificadores de analítica activos (sin secretos)' })
  analitica() {
    return this.integraciones.analiticaPublica();
  }

  @Get()
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Estado de todas las integraciones, sin secretos' })
  estado() {
    return this.integraciones.estado();
  }

  /**
   * Comprueba la integración contra el servicio real.
   *
   * Unas credenciales mal copiadas no fallan al guardarlas: fallan con el
   * primer cliente que intenta pagar, con la primera foto que se sube o con el
   * primer correo que no llega. El resultado queda anotado y se ve en la
   * pantalla.
   */
  @Post(':key/test')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Probar la conexión con el servicio' })
  probar(@Param('key') key: string) {
    return this.integraciones.probar(key);
  }

  @Post(':key')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Configurar una integración' })
  guardar(
    @Param('key') key: string,
    @Body() dto: GuardarIntegracionDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.integraciones.guardar(key, dto, { actorId: u.id, actorIp: req.ip });
  }
}
