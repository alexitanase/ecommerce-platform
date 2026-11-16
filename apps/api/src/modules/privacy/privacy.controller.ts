import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import { PrivacyService } from './privacy.service.js';
import { PorEmailDto, SuprimirDto, SuprimirMiaDto } from './dto/privacy.dto.js';

/**
 * Derechos RGPD.
 *
 * El cliente identificado opera sobre **sus propios datos** sin poder indicar
 * otro email: dejar que lo escriba convertiría el endpoint de exportación en
 * una forma cómoda de leer los datos personales de cualquiera con solo conocer
 * su correo.
 *
 * Quien compró sin cuenta no puede autoservirse aquí: hace falta comprobar que
 * el correo es suyo, y eso exige el envío de un enlace de verificación. Hasta
 * que el correo saliente esté configurado, su solicitud la tramita el equipo
 * desde el panel, que es la vía que la ley admite igualmente.
 */
@ApiTags('Privacidad')
@Controller({ path: 'privacy', version: '1' })
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @ApiBearerAuth('access-token')
  @Get('me/export')
  // Genera un volcado completo: sin freno es una forma barata de cargar la
  // base de datos a peticiones.
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Descargar todos mis datos personales (RGPD arts. 15 y 20)' })
  exportarMios(@CurrentUser() u: UsuarioAutenticado) {
    return this.privacy.exportar(u.email);
  }

  @ApiBearerAuth('access-token')
  @Get('me/erasure-preview')
  @ApiOperation({ summary: 'Qué se borraría y qué se conservaría si pido la supresión' })
  previsualizarMia(@CurrentUser() u: UsuarioAutenticado) {
    return this.privacy.previsualizarSupresion(u.email);
  }

  @ApiBearerAuth('access-token')
  @Post('me/erasure')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Ejercer el derecho de supresión sobre mi cuenta · IRREVERSIBLE' })
  suprimirMia(
    @Body() _dto: SuprimirMiaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.privacy.suprimir(u.email, { actorId: u.id, actorIp: req.ip });
  }

  // ── Panel ─────────────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Post('export')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('customers:read')
  @ApiOperation({ summary: 'Exportar los datos de una persona por email (solicitud RGPD)' })
  exportar(@Body() dto: PorEmailDto) {
    return this.privacy.exportar(dto.email);
  }

  @ApiBearerAuth('access-token')
  @Post('erasure-preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('customers:read')
  @ApiOperation({ summary: 'Plan de supresión antes de ejecutarlo' })
  previsualizar(@Body() dto: PorEmailDto) {
    return this.privacy.previsualizarSupresion(dto.email);
  }

  @ApiBearerAuth('access-token')
  @Post('erasure')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('customers:gdpr')
  @ApiOperation({ summary: 'Ejecutar la supresión de una persona · IRREVERSIBLE' })
  suprimir(
    @Body() dto: SuprimirDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.privacy.suprimir(dto.email, { actorId: u.id, actorIp: req.ip });
  }

  @ApiBearerAuth('access-token')
  @Get('purge-preview')
  @RequirePermissions('customers:read')
  @ApiOperation({ summary: 'Qué borraría la purga por plazo de conservación, sin ejecutarla' })
  previsualizarPurga() {
    return this.privacy.purgar({ simulacion: true });
  }

  @ApiBearerAuth('access-token')
  @Post('purge')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('customers:gdpr')
  @ApiOperation({ summary: 'Ejecutar ahora la purga por plazo de conservación' })
  purgar() {
    // Existe además de la tarea periódica porque una inspección o una
    // reclamación pueden exigir demostrar que se ha aplicado hoy, sin esperar
    // al ciclo nocturno.
    return this.privacy.purgar();
  }
}
