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
import type { Locale } from '@ecom/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { puedePublicarse, resumirProblemas } from './services/fidelidad-ficha.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CacheHttp } from '../../common/decorators/cache-http.decorator.js';
import { AgeService } from '../age/age.service.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { AttributesService } from './services/attributes.service.js';
import { CategoriesService } from './services/categories.service.js';
import { PortadasCategoriasService } from './services/portadas-categorias.service.js';
import { RelacionadosService } from './services/relacionados.service.js';
import { InventoryService } from './services/inventory.service.js';
import { ProductsService } from './services/products.service.js';
import { PriceHistoryService } from './services/price-history.service.js';
import {
  ActualizarCategoriaDto,
  ArbolCategoriasDto,
  CrearCategoriaDto,
  MoverCategoriaDto,
  ActualizarAtributoDto,
  CrearAtributoDto,
} from './dto/categories.dto.js';
import {
  ActualizarProductoDto,
  AplicarMargenDto,
  PlazoEntregaDto,
  ActualizarVarianteDto,
  AjustarStockDto,
  CrearProductoDto,
  ListarProductosDto,
} from './dto/products.dto.js';

@ApiTags('Catálogo')
@Controller({ path: 'catalog', version: '1' })
export class CatalogController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly portadas: PortadasCategoriasService,
    private readonly relacionados: RelacionadosService,
    private readonly inventory: InventoryService,
    private readonly precios: PriceHistoryService,
    private readonly age: AgeService,
    private readonly attributes: AttributesService,
  ) {}

  @ApiBearerAuth('access-token')
  @Post('prices/init-history')
  @RequirePermissions('products:write')
  @ApiOperation({
    summary: 'Inicializar el histórico de precios de las variantes que no lo tengan',
  })
  async iniciarHistoricoPrecios() {
    // Sin punto de partida no hay precio de referencia, y ningún producto
    // podría anunciarse rebajado. Se ejecuta una vez al desplegar.
    const inicializadas = await this.precios.inicializar();
    return { inicializadas };
  }

  // ── Público (tienda) ──────────────────────────────────────

  @Public()
  // El árbol de categorías cambia como mucho una vez al día: es lo más
  // cacheable de toda la tienda y aparece en cada página.
  @CacheHttp({ compartida: 600, navegador: 60, mientrasRevalida: 3600 })
  @Get('categories/tree')
  @ApiOperation({ summary: 'Árbol de categorías para la navegación' })
  arbol(@Query() query: ArbolCategoriasDto) {
    return this.categories.arbol(query.locale, !query.incluirInactivas);
  }

  /**
   * «También te puede interesar», para el final de la ficha.
   *
   * Respeta la verificación de edad igual que la ficha: si no, un producto apto
   * enseñaría cuatro miniaturas del catálogo restringido a quien no ha
   * declarado su edad, que es justo lo que la puerta existe para impedir.
   */
  @Public()
  @CacheHttp({ compartida: 600, navegador: 0, mientrasRevalida: 3600 })
  @Get('products/:id/relacionados')
  @ApiOperation({ summary: 'Productos de la misma categoría, para el final de la ficha' })
  async relacionadosDe(
    @Param('id') id: string,
    @Query('locale') locale: Locale,
    @Req() req: FastifyRequest,
    @CurrentUser('id') userId?: string,
  ) {
    const verificado = await this.age.puedeVerAdulto(req, userId);
    return this.relacionados.de(id, locale, verificado);
  }

  @Public()
  // Margen corto en el navegador y largo en el CDN: purgar el CDN al cambiar
  // un precio se hace en segundos, pero una copia en el disco del cliente no
  // hay forma de alcanzarla hasta que caduque.
  @CacheHttp({ compartida: 300, navegador: 0, mientrasRevalida: 600 })
  @Get('products/by-slug/:locale/:slug')
  @ApiOperation({ summary: 'Ficha de producto por su slug traducido' })
  async porSlug(
    @Param('locale') locale: Locale,
    @Param('slug') slug: string,
    @Req() req: FastifyRequest,
    @CurrentUser('id') userId?: string,
  ) {
    // La verificación se comprueba AQUÍ, en el servidor. Un aviso modal en la
    // tienda se cierra desde la consola del navegador; esto no: si el visitante
    // no está verificado, la ficha de un producto +18 no se sirve y responde
    // 403 pidiendo que verifique la edad (el motivo de que sea 403 y no 404
    // está explicado en `porSlugPublico`).
    const verificado = await this.age.puedeVerAdulto(req, userId);

    return this.products.porSlugPublico(slug, locale, verificado);
  }

  /**
   * Lo justo para la vista previa de un enlace compartido.
   *
   * Existe por una razón concreta: la ficha completa responde 403 a quien no ha
   * verificado la edad, y **ningún robot verifica la edad**. Cuando alguien pega
   * un enlace de la tienda en WhatsApp o en Telegram, esas aplicaciones piden la
   * página sin cookies, así que la vista previa de todo el catálogo salía igual
   * —el nombre de la tienda, sin foto y sin decir qué se compartía— y un enlace
   * así no se pulsa.
   *
   * Devuelve **solo** lo que va a acabar dentro de esa tarjeta: nombre, un
   * texto y la foto con sus medidas. Ni precio, ni stock, ni variantes, ni
   * proveedor. Es la misma decisión de lista blanca que `fichaPublica`, y aquí
   * más estricta todavía porque esto sí se sirve sin ninguna comprobación.
   *
   * Lo que se abre, entonces, es que cualquiera puede saber cómo se llama y qué
   * aspecto tiene un producto cuya dirección exacta ya conoce. Es exactamente lo
   * que se está compartiendo a propósito: quien manda el enlace quiere que al
   * otro lado se vea. Comprarlo sigue exigiendo pasar por la puerta.
   */
  @Public()
  // Muy cacheable: lo piden robots, muchas veces el mismo enlace, y lo que
  // devuelve solo cambia si se reedita el producto.
  @CacheHttp({ compartida: 3600, navegador: 0, mientrasRevalida: 86_400 })
  @Get('products/preview/:locale/:slug')
  @ApiOperation({ summary: 'Nombre, texto y foto de un producto, para compartir el enlace' })
  vistaPrevia(@Param('locale') locale: Locale, @Param('slug') slug: string) {
    return this.products.vistaPreviaPublica(slug, locale);
  }

  // ── Atributos ─────────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get('attributes')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Atributos del catálogo y su uso' })
  listarAtributos() {
    return this.attributes.listar();
  }

  @ApiBearerAuth('access-token')
  @Post('attributes')
  @RequirePermissions('categories:write')
  @ApiOperation({ summary: 'Crear un atributo' })
  crearAtributo(
    @Body() dto: CrearAtributoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.attributes.crear(dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Patch('attributes/:id')
  @RequirePermissions('categories:write')
  @ApiOperation({ summary: 'Modificar un atributo' })
  actualizarAtributo(
    @Param('id') id: string,
    @Body() dto: ActualizarAtributoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.attributes.actualizar(id, dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Delete('attributes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('categories:write')
  @ApiOperation({ summary: 'Eliminar un atributo sin uso' })
  eliminarAtributo(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.attributes.eliminar(id, this.ctx(u, req));
  }

  // ── Categorías (admin) ────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Post('categories')
  @RequirePermissions('categories:write')
  @ApiOperation({ summary: 'Crear una categoría' })
  crearCategoria(
    @Body() dto: CrearCategoriaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.categories.crear(dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Patch('categories/:id')
  @RequirePermissions('categories:write')
  @ApiOperation({ summary: 'Modificar una categoría' })
  actualizarCategoria(
    @Param('id') id: string,
    @Body() dto: ActualizarCategoriaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.categories.actualizar(id, dto, this.ctx(u, req));
  }

  /*
   * Renovar ya las fotos de las categorías.
   *
   * Lo normal es que lo haga el repaso diario, pero hay dos momentos en los que
   * esperar un día no sirve: justo después de importar el catálogo —cuando la
   * tienda está vacía de fotos y se quiere ver cómo queda— y después de mover
   * categorías de sitio, que cambia qué productos cuelgan de cada rama.
   */
  @ApiBearerAuth('access-token')
  @Post('categories/covers')
  @RequirePermissions('categories:write')
  @ApiOperation({ summary: 'Renovar ahora las fotos de portada de las categorías' })
  renovarPortadas() {
    return this.portadas.refrescarCaducadas();
  }

  @ApiBearerAuth('access-token')
  @Post('categories/:id/move')
  @RequirePermissions('categories:write')
  @ApiOperation({ summary: 'Mover una categoría a otro padre' })
  moverCategoria(
    @Param('id') id: string,
    @Body() dto: MoverCategoriaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.categories.mover(id, dto.parentId, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('categories:write')
  @ApiOperation({ summary: 'Eliminar una categoría vacía' })
  eliminarCategoria(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.categories.eliminar(id, this.ctx(u, req));
  }

  // ── Productos (admin) ─────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get('products')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Listar productos con filtros' })
  listarProductos(@Query() query: ListarProductosDto) {
    return this.products.listar(query);
  }

  @ApiBearerAuth('access-token')
  @Get('products/:id')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Detalle completo de un producto' })
  detalleProducto(@Param('id') id: string, @Query('locale') locale: Locale = 'es') {
    return this.products.detalleCompleto(id, locale);
  }

  @ApiBearerAuth('access-token')
  @Get('products/:id/fidelity')
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Qué le falta a la ficha para poder publicarse' })
  async revisarFidelidad(@Param('id') id: string) {
    const problemas = await this.products.revisarFidelidad(id);
    return {
      problemas,
      puedePublicarse: puedePublicarse(problemas),
      resumen: resumirProblemas(problemas),
    };
  }

  @ApiBearerAuth('access-token')
  @Post('products')
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Crear un producto con sus variantes' })
  crearProducto(
    @Body() dto: CrearProductoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.products.crear(dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Patch('products/:id')
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Modificar un producto' })
  actualizarProducto(
    @Param('id') id: string,
    @Body() dto: ActualizarProductoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.products.actualizar(id, dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Patch('products/variants/:variantId')
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Cambiar precio, coste, SKU o alertas de una variante' })
  actualizarVariante(
    @Param('variantId') variantId: string,
    @Body() dto: ActualizarVarianteDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.products.actualizarVariante(variantId, dto, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Post('products/:id/margen')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Recalcular los precios a partir de un margen objetivo' })
  aplicarMargen(
    @Param('id') id: string,
    @Body() dto: AplicarMargenDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.products.aplicarMargen(
      id,
      dto.margen,
      { actorId: u.id, actorIp: req.ip },
      dto.simular ?? false,
    );
  }

  @ApiBearerAuth('access-token')
  @Patch('products/:id/lead-time')
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Fijar a mano el plazo de entrega máximo del producto' })
  fijarPlazoEntrega(
    @Param('id') id: string,
    @Body() dto: PlazoEntregaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.products.fijarPlazoEntrega(id, dto.dias, { actorId: u.id, actorIp: req.ip });
  }

  @ApiBearerAuth('access-token')
  @Delete('products/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('products:delete')
  @ApiOperation({ summary: 'Archivar un producto (no se borra, por los pedidos)' })
  archivarProducto(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.products.archivar(id, this.ctx(u, req));
  }

  @Post('products/:id/restaurar')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Devolver al catálogo un producto archivado (vuelve como borrador)' })
  restaurarProducto(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.products.restaurar(id, this.ctx(u, req));
  }

  // ── Inventario ────────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get('inventory/low-stock')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Variantes por debajo de su umbral de aviso' })
  stockBajo() {
    return this.inventory.stockBajo();
  }

  @ApiBearerAuth('access-token')
  @Get('inventory/:variantId/history')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Histórico de movimientos de stock de una variante' })
  historialStock(@Param('variantId') variantId: string) {
    return this.inventory.historial(variantId);
  }

  @ApiBearerAuth('access-token')
  @Patch('inventory/:variantId')
  @RequirePermissions('products:write')
  @ApiOperation({ summary: 'Ajustar manualmente el stock de una variante' })
  ajustarStock(
    @Param('variantId') variantId: string,
    @Body() dto: AjustarStockDto,
    @CurrentUser() u: UsuarioAutenticado,
  ) {
    return this.inventory.ajustar(variantId, dto.stock, 'MANUAL', {
      nota: dto.nota,
      actorId: u.id,
    });
  }

  private ctx(u: UsuarioAutenticado, req: FastifyRequest): ContextoActor {
    return { actorId: u.id, actorIp: req.ip };
  }
}
