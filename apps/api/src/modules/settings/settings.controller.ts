import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import { SettingsService } from './settings.service.js';

/**
 * Ajustes cuyo valor acaba dentro de una etiqueta `<style>` de la tienda.
 *
 * Los colores de marca se inyectan como variables CSS en el layout de todas las
 * páginas. Sin validarlos aquí, quien tenga permiso para editar la marca podría
 * guardar `red}</style><script>…` y ejecutar JavaScript en el navegador de todos
 * los visitantes: una escalada de "puedo cambiar el logo" a "puedo robar
 * sesiones". La tienda además lo filtra al pintar, pero el sitio donde hay que
 * pararlo es al guardar.
 */
const AJUSTES_DE_COLOR = ['primaryColor', 'accentColor'];
const COLOR_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const actualizarSchema = z.object({
  cambios: z
    .array(
      z
        .object({
          namespace: z.string().trim().min(1).max(40),
          key: z.string().trim().min(1).max(60),
          value: z.unknown(),
        })
        .refine(
          (c) =>
            c.namespace !== 'brand' ||
            !AJUSTES_DE_COLOR.includes(c.key) ||
            (typeof c.value === 'string' && COLOR_HEX.test(c.value.trim())),
          { message: 'El color debe ser hexadecimal (#rrggbb)', path: ['value'] },
        ),
    )
    .min(1),
});

class ActualizarAjustesDto extends createZodDto(actualizarSchema) {}

@ApiTags('Ajustes')
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Ajustes públicos: marca, idiomas, umbrales' })
  publicos() {
    return this.settings.publicos();
  }

  /**
   * Divisas en las que la tienda puede enseñar un precio, con su tasa.
   *
   * Va aparte de `/public` porque su caché es de otro tamaño: la marca cambia
   * una vez al mes y los tipos de cambio una vez al día. Mezclarlos obligaría a
   * elegir un TTL malo para los dos.
   *
   * Con `tasas` vacío la tienda opera solo en euros, y eso es un estado normal:
   * es lo que pasa mientras no haya proveedor de tipo de cambio configurado.
   */
  @Public()
  @Get('public/divisas')
  @ApiOperation({ summary: 'Divisas activas y sus tipos de cambio para mostrar precios' })
  divisas() {
    return this.settings.divisasPublicas();
  }

  /**
   * Las divisas entre las que el panel deja elegir.
   *
   * Salen del proveedor de tipo de cambio y no de una lista escrita en el código,
   * que era lo que había: ampliarla obligaba a desplegar para añadir un dato que
   * ya publica un servicio externo, y permitía marcar divisas que ese servicio no
   * cubría —quedaban activadas y sin efecto ninguno en la tienda—.
   *
   * Devuelve solo los códigos. El nombre lo pone el navegador con `Intl`, en el
   * idioma que tenga puesto el panel, que además evita mandar tres traducciones
   * de cada una para una lista que casi nunca se abre.
   *
   * La lista vacía es un estado normal y significa «no hay proveedor
   * configurado»: la tienda opera solo en euros y el panel lo explica.
   */
  @ApiBearerAuth('access-token')
  @Get('divisas-disponibles')
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Divisas que publica el proveedor de tipo de cambio' })
  async divisasDisponibles() {
    return { divisas: await this.settings.divisasDisponibles() };
  }

  @ApiBearerAuth('access-token')
  @Get()
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Todos los ajustes, agrupados' })
  todos() {
    return this.settings.todos();
  }

  @ApiBearerAuth('access-token')
  @Patch()
  @RequirePermissions('settings:write')
  @ApiOperation({ summary: 'Actualizar ajustes' })
  actualizar(
    @Body() dto: ActualizarAjustesDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.settings.actualizar(dto.cambios, { actorId: u.id, actorIp: req.ip });
  }
}
