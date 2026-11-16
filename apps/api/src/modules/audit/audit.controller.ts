import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { AuditService } from './audit.service.js';
import { ConsultarAuditoriaDto } from './dto/audit.dto.js';

/**
 * Registro de actividad.
 *
 * Solo lectura, y a propósito: un registro de auditoría que se puede editar o
 * borrar desde la propia aplicación no sirve para auditar nada. Si alguien
 * hace algo indebido y puede borrar la huella, la huella no existía.
 */
@ApiTags('Auditoría')
@Controller({ path: 'audit', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @ApiBearerAuth('access-token')
  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Consultar el registro de actividad' })
  consultar(@Query() query: ConsultarAuditoriaDto) {
    // Las fechas llegan como texto ISO y el servicio espera Date: se separan
    // del resto para que el tipo no las herede como string.
    const { desde, hasta, ...resto } = query;

    return this.audit.consultar({
      ...resto,
      ...(desde ? { desde: new Date(desde) } : {}),
      ...(hasta ? { hasta: new Date(hasta) } : {}),
    });
  }

  @ApiBearerAuth('access-token')
  @Get('actions')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Acciones y recursos con actividad, para los filtros' })
  filtros() {
    return this.audit.valoresDeFiltro();
  }
}
