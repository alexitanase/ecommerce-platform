import {
  BadRequestException,
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
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { ImagesService } from '../storage/images.service.js';
import { BrandsService } from './services/brands.service.js';
import { ActualizarMarcaDto, CrearMarcaDto } from './dto/brands.dto.js';

/**
 * Marcas de producto.
 *
 * El permiso es `categories:write` y no uno propio: gestionar marcas es la
 * misma clase de trabajo que gestionar categorías —ordenar el catálogo— y lo
 * hace la misma persona. Inventar `brands:write` habría dejado la pantalla
 * inaccesible para el rol de catálogo hasta volver a sembrar los permisos y
 * repartirlos, sin ganar ninguna separación real.
 *
 * Ojo con `brand:write`, que ya existe y NO es esto: ese es el logotipo y los
 * colores de la tienda.
 */
@ApiTags('Marcas')
@Controller({ path: 'brands', version: '1' })
export class BrandsController {
  constructor(
    private readonly brands: BrandsService,
    private readonly images: ImagesService,
  ) {}

  /**
   * Marcas activas, para la tienda.
   *
   * Público y sin datos internos: solo nombre, identificador y logotipo. Es lo
   * que hace falta para pintar una marca en una ficha o listar el catálogo por
   * fabricante.
   */
  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Marcas activas con su logotipo' })
  async publicas() {
    const marcas = await this.brands.listar(true, true);

    return (
      marcas
        /*
         * Las marcas sin nada que vender no salen.
         *
         * Es la misma regla que las categorías vacías, y por lo mismo: en un
         * catálogo importado de un proveedor quedan marcas creadas cuyos
         * productos siguen en borrador o se despublicaron. Ofrecerlas lleva a
         * un listado en blanco, y quien se encuentra uno no prueba con otra.
         */
        .filter((m) => m.productos > 0)
        .map((m) => ({
          handle: m.handle,
          name: m.name,
          logoUrl: m.logoUrl,
          productos: m.productos,
        }))
    );
  }

  @Get()
  @ApiBearerAuth('access-token')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Marcas con su número de productos' })
  listar(@Query('soloActivas') soloActivas?: string) {
    return this.brands.listar(soloActivas === 'true');
  }

  @Post()
  @ApiBearerAuth('access-token')
  @RequirePermissions('categories:write')
  @ApiOperation({ summary: 'Crear una marca' })
  crear(
    @Body() dto: CrearMarcaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.brands.crear(dto, this.ctx(u, req));
  }

  @Patch(':id')
  @ApiBearerAuth('access-token')
  @RequirePermissions('categories:write')
  @ApiOperation({ summary: 'Renombrar, activar o cambiar el logotipo de una marca' })
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarMarcaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.brands.actualizar(id, dto, this.ctx(u, req));
  }

  /**
   * Sube el logotipo de la marca.
   *
   * Se procesa como cualquier otra imagen —se valida el contenido real, no la
   * extensión, y se convierte a WebP con sus tamaños— pero con un mínimo de
   * lado mucho más bajo: un logotipo suele ser apaisado y estrecho, y el mínimo
   * de 200×200 de las fotos de producto rechazaría la mayoría.
   */
  @Post(':id/logo')
  @ApiBearerAuth('access-token')
  @RequirePermissions('categories:write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir el logotipo de una marca' })
  async subirLogo(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @CurrentUser() u: UsuarioAutenticado,
  ) {
    const fichero = await req.file();
    if (!fichero) throw new BadRequestException('No se ha recibido ningún fichero');

    const buffer = await fichero.toBuffer();
    const procesada = await this.images.procesar(buffer, 'marcas', { ladoMinimoPx: 48 });

    return this.brands.actualizar(id, { logoUrl: procesada.url }, this.ctx(u, req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @RequirePermissions('categories:write')
  @ApiOperation({ summary: 'Eliminar una marca sin productos' })
  eliminar(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.brands.eliminar(id, this.ctx(u, req));
  }

  private ctx(u: UsuarioAutenticado, req: FastifyRequest): ContextoActor {
    return { actorId: u.id, actorIp: req.ip };
  }
}
