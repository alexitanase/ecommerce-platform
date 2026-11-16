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
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { SuppliersService } from './suppliers.service.js';
import { SupplierSyncService } from './sync.service.js';
import { SupplierImportService } from './import.service.js';
import { AutorizacionProveedoresService } from './autorizacion.service.js';
import { SubidaCatalogoService } from './dreamlove/subida-catalogo.service.js';
import { CategoriasProveedorService } from './categorias-proveedor.service.js';
import { ImportacionCatalogoService } from './dreamlove/importacion-catalogo.service.js';
import { ImportacionMasivaService } from './dreamlove/importacion-masiva.service.js';
import {
  ActualizarProveedorDto,
  BuscarProveedorDto,
  CredencialesDto,
  CrearProveedorDto,
  ImportarCatalogoDto,
  ImportarDto,
  SincronizarDto,
} from './dto/suppliers.dto.js';

@ApiTags('Proveedores')
@ApiBearerAuth('access-token')
@Controller({ path: 'suppliers', version: '1' })
export class SuppliersController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly sync: SupplierSyncService,
    private readonly importer: SupplierImportService,
    private readonly autorizacion: AutorizacionProveedoresService,
    private readonly catalogo: SubidaCatalogoService,
    private readonly importacionCatalogo: ImportacionCatalogoService,
    private readonly importacionMasiva: ImportacionMasivaService,
    private readonly categorias: CategoriasProveedorService,
  ) {}

  @Get('available')
  @RequirePermissions('suppliers:read')
  @ApiOperation({ summary: 'Proveedores soportados y sus campos de credenciales' })
  disponibles() {
    return this.suppliers.disponibles();
  }

  @Get()
  @RequirePermissions('suppliers:read')
  @ApiOperation({ summary: 'Proveedores configurados, con su salud y última sincronización' })
  listar() {
    return this.suppliers.listar();
  }

  @Post()
  @RequirePermissions('suppliers:write')
  @ApiOperation({ summary: 'Dar de alta un proveedor' })
  crear(
    @Body() dto: CrearProveedorDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.suppliers.crear(dto, this.ctx(u, req));
  }

  @Patch(':id')
  @RequirePermissions('suppliers:write')
  @ApiOperation({ summary: 'Modificar la configuración de un proveedor' })
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarProveedorDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.suppliers.actualizar(id, dto, this.ctx(u, req));
  }

  @Patch(':id/credentials')
  @RequirePermissions('suppliers:write')
  @ApiOperation({ summary: 'Actualizar credenciales (se guardan cifradas)' })
  credenciales(
    @Param('id') id: string,
    @Body() dto: CredencialesDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.suppliers.actualizarCredenciales(id, dto.credentials, this.ctx(u, req));
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('suppliers:read')
  @ApiOperation({ summary: 'Comprobar que las credenciales funcionan' })
  verificar(@Param('id') id: string) {
    return this.suppliers.verificar(id);
  }

  // ── Autorización (OAuth) ──────────────────────────────────
  //
  // AliExpress no se conforma con una clave: hace falta que el titular de la
  // cuenta autorice la aplicación desde una página suya. Estos tres endpoints
  // son ese recorrido.

  @Get(':id/oauth/status')
  @RequirePermissions('suppliers:read')
  @ApiOperation({ summary: '¿Está autorizado el proveedor y hasta cuándo?' })
  estadoAutorizacion(@Param('id') id: string) {
    return this.autorizacion.estado(id);
  }

  @Post(':id/oauth/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('suppliers:write')
  @ApiOperation({ summary: 'URL a la que mandar al titular para que autorice' })
  comenzarAutorizacion(@Param('id') id: string) {
    return this.autorizacion.comenzar(id);
  }

  /**
   * Vuelta desde AliExpress.
   *
   * Público porque quien lo abre es el navegador del titular al terminar de
   * autorizar, y en ese momento no hay sesión nuestra: viene de otro dominio.
   * Lo que autentica esta llamada es el propio código, que es de un solo uso,
   * caduca en minutos y solo lo tiene quien acaba de decir que sí.
   *
   * Termina redirigiendo al panel en lugar de devolver JSON: al otro lado hay
   * una persona mirando una pestaña del navegador, no un programa.
   */
  @Public()
  @Get('oauth/aliexpress/callback')
  @ApiExcludeEndpoint()
  async retornoAliExpress(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ): Promise<void> {
    const volverAlPanel = (parametros: Record<string, string>): void => {
      const url = new URL('/proveedores', this.autorizacion.urlDelPanel());
      for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, v);
      void res.redirect(url.toString(), 302);
    };

    if (!state) return volverAlPanel({ autorizacion: 'error', motivo: 'Falta el proveedor' });
    if (!code) {
      // Pasa cuando el titular cancela en la pantalla de permisos.
      return volverAlPanel({ autorizacion: 'cancelada', proveedor: state });
    }

    try {
      // Sin actorId: aquí no hay sesión del equipo, autoriza el titular de la
      // cuenta de AliExpress desde su navegador. La auditoría lo registra como
      // acción del sistema con la IP de quien volvió.
      const resultado = await this.autorizacion.completar(state, code, { actorIp: req.ip });

      return volverAlPanel({
        autorizacion: 'ok',
        proveedor: state,
        ...(resultado.cuenta ? { cuenta: resultado.cuenta } : {}),
      });
    } catch (error) {
      // El motivo se enseña tal cual: distinguir "el código ha caducado" de
      // "el App Secret está mal" es la diferencia entre reintentar y revisar
      // la configuración.
      return volverAlPanel({
        autorizacion: 'error',
        proveedor: state,
        motivo: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('suppliers:write')
  @ApiOperation({ summary: 'Eliminar un proveedor sin pedidos' })
  eliminar(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.suppliers.eliminar(id, this.ctx(u, req));
  }

  // ── Catálogo del proveedor ────────────────────────────────

  @Get(':id/catalog')
  @RequirePermissions('products:import')
  @ApiOperation({ summary: 'Buscar en el catálogo del proveedor con el PVP propuesto' })
  buscarCatalogo(@Param('id') id: string, @Query() query: BuscarProveedorDto) {
    return this.importer.buscar(id, query);
  }

  @Get(':id/catalog/:externalId')
  @RequirePermissions('products:import')
  @ApiOperation({ summary: 'Ficha de un producto concreto por su ID o URL, con el PVP propuesto' })
  previsualizar(@Param('id') id: string, @Param('externalId') externalId: string) {
    return this.importer.previsualizar(id, decodeURIComponent(externalId));
  }

  @Post(':id/import')
  @RequirePermissions('products:import')
  @ApiOperation({ summary: 'Importar un producto del proveedor (queda en borrador)' })
  importar(
    @Param('id') id: string,
    @Body() dto: ImportarDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.importer.importar(id, dto.externalId, dto, this.ctx(u, req));
  }

  // ── Catálogo por fichero (proveedores sin API) ────────────

  /**
   * Sube el catálogo que manda el proveedor.
   *
   * Es la integración entera con Dreamlove: no hay API que llamar, hay un XML
   * de unos 340 MB que mandan ellos. Se responde en cuanto el fichero está en
   * disco y el procesado sigue por detrás, porque escribir 12.913 artículos
   * tarda más de lo que aguanta cualquier proxy delante de la API.
   */
  @Post(':id/catalog/upload')
  @RequirePermissions('suppliers:write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir el fichero de catálogo de un proveedor sin API' })
  subirCatalogo(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @CurrentUser() u: UsuarioAutenticado,
  ) {
    return this.catalogo.recibirFichero(id, req, this.ctx(u, req));
  }

  @Get(':id/catalog-file/status')
  @RequirePermissions('suppliers:read')
  @ApiOperation({ summary: 'Estado del catálogo guardado y última importación' })
  estadoCatalogo(@Param('id') id: string) {
    return this.importacionCatalogo.estado(id);
  }

  @Get(':id/catalog-file/history')
  @RequirePermissions('suppliers:read')
  @ApiOperation({ summary: 'Historial de catálogos procesados' })
  historialCatalogo(@Param('id') id: string) {
    return this.importacionCatalogo.historial(id);
  }

  // ── Subir el catálogo entero a la tienda ─────────────────
  //
  // Tener el catálogo del proveedor procesado no pone ni un producto a la
  // venta: son dos cosas distintas y esta es la segunda. Crea o actualiza de
  // una vez todas sus familias, cada una en su categoría y con su marca.

  @Post(':id/catalog-file/import-all')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('products:import')
  @ApiOperation({ summary: 'Crear o actualizar en la tienda todo el catálogo del proveedor' })
  importarCatalogoCompleto(
    @Param('id') id: string,
    @Body() dto: ImportarCatalogoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.importacionMasiva.lanzar(id, dto, this.ctx(u, req));
  }

  @Get(':id/catalog-file/import-all/status')
  @RequirePermissions('suppliers:read')
  @ApiOperation({ summary: 'Cómo va —o cómo fue— la última importación masiva' })
  estadoImportacionMasiva(@Param('id') id: string) {
    return this.importacionMasiva.estado(id);
  }

  @Post(':id/catalog-file/import-all/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('products:import')
  @ApiOperation({ summary: 'Parar la importación masiva en curso' })
  cancelarImportacionMasiva(@Param('id') id: string) {
    return this.importacionMasiva.cancelar(id);
  }

  // ── Categorías del proveedor ──────────────────────────────

  @Get(':id/categories')
  @RequirePermissions('suppliers:read')
  @ApiOperation({ summary: 'Árbol de categorías del proveedor y cuáles están creadas' })
  categoriasProveedor(@Param('id') id: string) {
    return this.categorias.listar(id);
  }

  @Post(':id/categories/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('products:import')
  @ApiOperation({ summary: 'Crear en el catálogo todas las categorías del proveedor' })
  crearCategoriasProveedor(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.categorias.sincronizar(id, this.ctx(u, req));
  }

  // ── Sincronización ────────────────────────────────────────

  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('suppliers:write')
  @ApiOperation({ summary: 'Sincronizar precio y stock con el proveedor' })
  sincronizar(@Param('id') id: string, @Body() dto: SincronizarDto) {
    return this.sync.sincronizar(id, dto);
  }

  /**
   * Refresca un producto concreto contra su proveedor.
   *
   * Va por `products/` y no por `:id/` porque quien lo pide es la ficha del
   * producto, que no sabe —ni tiene por qué— de qué proveedor viene.
   */
  @Post('products/:productId/refresh')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Consultar al proveedor el coste y el stock actuales de un producto' })
  refrescarProducto(@Param('productId') productId: string) {
    return this.sync.refrescarProducto(productId);
  }

  @Get(':id/sync/history')
  @RequirePermissions('suppliers:read')
  @ApiOperation({ summary: 'Historial de sincronizaciones' })
  historial(@Param('id') id: string) {
    return this.sync.historial(id);
  }

  @Get('sync/pending')
  @RequirePermissions('suppliers:read')
  @ApiOperation({ summary: 'Proveedores a los que les toca sincronizar' })
  pendientes() {
    return this.sync.proveedoresPendientes();
  }

  private ctx(u: UsuarioAutenticado, req: FastifyRequest): ContextoActor {
    return { actorId: u.id, actorIp: req.ip };
  }
}
