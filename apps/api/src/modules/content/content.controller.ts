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
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { bloquesPortadaSchema, menuNavegacionSchema, LOCALES, type Locale } from '@ecom/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import { ContentService } from './content.service.js';
import { PortadaService } from './portada.service.js';
import { MenuService } from './menu.service.js';
import { BlogService } from './blog.service.js';
import { SitemapService } from './sitemap.service.js';
import { CacheHttp } from '../../common/decorators/cache-http.decorator.js';
import { AgeService } from '../age/age.service.js';
import { COOKIE_EDAD } from '../age/age.controller.js';

const slug = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones');

const traduccionArticulo = z.object({
  locale: z.enum(LOCALES),
  title: z.string().trim().min(1).max(200),
  slug,
  /** Si no se escribe, se saca del cuerpo; siempre es peor, pero mejor que nada. */
  excerpt: z.string().trim().max(500).optional(),
  content: z.string().min(1).max(200_000),
  metaTitle: z.string().trim().max(70).optional(),
  metaDescription: z.string().trim().max(160).optional(),
});

const crearArticuloSchema = z.object({
  handle: slug,
  categoryId: z.string().optional(),
  coverUrl: z.url().optional(),
  translations: z.array(traduccionArticulo).min(1, 'Hace falta al menos un idioma'),
  /** Productos que menciona: es lo que convierte el contenido en ventas. */
  productIds: z.array(z.string()).max(20).optional(),
});

const actualizarArticuloSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
  categoryId: z.string().nullable().optional(),
  coverUrl: z.url().nullable().optional(),
  translations: z.array(traduccionArticulo).optional(),
  productIds: z.array(z.string()).max(20).optional(),
});

class CrearArticuloDto extends createZodDto(crearArticuloSchema) {}
class ActualizarArticuloDto extends createZodDto(actualizarArticuloSchema) {}

const guardarSchema = z.object({
  id: z.string().optional(),
  handle: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones'),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
  translations: z
    .array(
      z.object({
        locale: z.enum(LOCALES),
        title: z.string().trim().min(1).max(200),
        slug: z
          .string()
          .trim()
          .min(2)
          .max(120)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones'),
        content: z.string().max(100_000),
        metaTitle: z.string().trim().max(70).optional(),
        metaDescription: z.string().trim().max(160).optional(),
      }),
    )
    .min(1),
});

class GuardarPaginaDto extends createZodDto(guardarSchema) {}

/** Los bloques van dentro de un objeto: un array suelto como cuerpo no deja
 *  añadir nada después sin romper a quien ya llama. */
class GuardarPortadaDto extends createZodDto(z.object({ bloques: bloquesPortadaSchema })) {}

class GuardarMenuDto extends createZodDto(z.object({ enlaces: menuNavegacionSchema })) {}

@ApiTags('Contenido')
@Controller({ path: 'content', version: '1' })
export class ContentController {
  constructor(
    private readonly content: ContentService,
    private readonly portada: PortadaService,
    private readonly menu: MenuService,
    private readonly blog: BlogService,
    private readonly age: AgeService,
    private readonly sitemap: SitemapService,
  ) {}

  /**
   * El inventario de URLs indexables, para el sitemap de la tienda.
   *
   * Va cacheado con margen ancho: el sitemap lo lee Google cada pocas horas, no
   * un cliente esperando, y recalcular la lista entera del catálogo en cada
   * lectura sería la consulta más cara de la API para el visitante que menos
   * prisa tiene.
   */
  @Public()
  @CacheHttp({ compartida: 3600, navegador: 0, mientrasRevalida: 86_400 })
  @Get('sitemap/:locale')
  @ApiOperation({ summary: 'Productos, categorías y artículos indexables de un idioma' })
  inventarioSitemap(@Param('locale') locale: Locale) {
    return this.sitemap.inventario(locale);
  }

  @Public()
  @Get('home/:locale')
  @ApiOperation({ summary: 'Bloques de la portada, ya resueltos y traducidos' })
  async home(
    @Param('locale') locale: Locale,
    @Req() req: FastifyRequest,
    @CurrentUser('id') userId?: string,
  ) {
    // Igual que el buscador: lo decide el servidor mirando la cookie que él
    // mismo puso, no un parámetro que se pueda escribir en la URL.
    const verificado = await this.age.estaVerificado(req.cookies[COOKIE_EDAD], userId);

    return this.portada.portada(locale, verificado);
  }

  /**
   * El menú de la sub-barra, resuelto en un idioma.
   *
   * Lo pide el layout de la tienda, así que entra en TODAS las páginas: se
   * cachea en el CDN diez minutos y se sirve mientras revalida, porque un menú
   * un rato desactualizado es infinitamente mejor que una cabecera que tarda.
   */
  @Public()
  @CacheHttp({ compartida: 600, navegador: 60, mientrasRevalida: 3600 })
  @Get('menu/:locale')
  @ApiOperation({ summary: 'Menú de navegación, resuelto y traducido' })
  menuPublico(@Param('locale') locale: Locale) {
    return this.menu.menu(locale);
  }

  @Public()
  @Get('pages/:locale/:slug')
  @ApiOperation({ summary: 'Página publicada por su slug traducido' })
  porSlug(@Param('locale') locale: Locale, @Param('slug') slug: string) {
    return this.content.porSlug(locale, slug);
  }

  @Public()
  @Get('pages/:locale')
  @ApiOperation({ summary: 'Páginas publicadas, para el menú del pie' })
  publicas(@Param('locale') locale: Locale) {
    return this.content.publicas(locale);
  }

  @ApiBearerAuth('access-token')
  @Get('admin/home')
  @RequirePermissions('content:write')
  @ApiOperation({ summary: 'Configuración de los bloques de la portada' })
  bloquesPortada() {
    return this.portada.bloques();
  }

  @ApiBearerAuth('access-token')
  @Post('admin/home')
  @RequirePermissions('content:write')
  @ApiOperation({ summary: 'Guardar los bloques de la portada' })
  guardarPortada(
    @Body() dto: GuardarPortadaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.portada.guardar(dto.bloques, { actorId: u.id, actorIp: req.ip });
  }

  @ApiBearerAuth('access-token')
  @Get('admin/menu')
  @RequirePermissions('content:write')
  @ApiOperation({ summary: 'Enlaces configurados del menú de navegación' })
  enlacesMenu() {
    return this.menu.enlaces();
  }

  @ApiBearerAuth('access-token')
  @Post('admin/menu')
  @RequirePermissions('content:write')
  @ApiOperation({ summary: 'Guardar el menú de navegación' })
  guardarMenu(
    @Body() dto: GuardarMenuDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.menu.guardar(dto.enlaces, { actorId: u.id, actorIp: req.ip });
  }

  @ApiBearerAuth('access-token')
  @Get('admin/pages')
  @RequirePermissions('content:write')
  @ApiOperation({ summary: 'Todas las páginas, con qué idiomas faltan por traducir' })
  listar() {
    return this.content.listar();
  }

  @ApiBearerAuth('access-token')
  @Get('admin/pages/:id')
  @RequirePermissions('content:write')
  @ApiOperation({ summary: 'Detalle de una página con todas sus traducciones' })
  detalle(@Param('id') id: string) {
    return this.content.detalle(id);
  }

  @ApiBearerAuth('access-token')
  @Post('admin/pages')
  @RequirePermissions('content:write')
  @ApiOperation({ summary: 'Crear o actualizar una página' })
  guardar(
    @Body() dto: GuardarPaginaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.content.guardar(dto, { actorId: u.id, actorIp: req.ip });
  }

  @ApiBearerAuth('access-token')
  @Delete('admin/pages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ summary: 'Eliminar una página no obligatoria' })
  eliminar(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.content.eliminar(id, { actorId: u.id, actorIp: req.ip });
  }

  // ── Blog / centro de contenidos ───────────────────────────

  @Public()
  @Get('blog/:locale/categorias')
  @CacheHttp({ compartida: 600, navegador: 60 })
  @ApiOperation({ summary: 'Categorías del blog con artículos publicados' })
  categoriasBlog(@Param('locale') locale: Locale) {
    return this.blog.categorias(locale);
  }

  @Public()
  @Get('blog/:locale')
  @CacheHttp({ compartida: 300, navegador: 60, mientrasRevalida: 3600 })
  @ApiOperation({ summary: 'Artículos publicados del blog' })
  articulos(
    @Param('locale') locale: Locale,
    @Query('categoria') categoria?: string,
    @Query('limite') limite?: string,
  ) {
    return this.blog.listar(locale, {
      ...(categoria ? { categoria } : {}),
      ...(limite ? { limite: Number(limite) } : {}),
    });
  }

  @Public()
  @Get('blog/:locale/:slug')
  @CacheHttp({ compartida: 300, navegador: 60, mientrasRevalida: 3600 })
  @ApiOperation({ summary: 'Un artículo, con los productos que menciona' })
  articulo(@Param('locale') locale: Locale, @Param('slug') slug: string) {
    return this.blog.porSlug(slug, locale);
  }

  // ── Blog · administración ─────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get('admin/blog')
  // `content:write` y no un `content:read` inventado: ese permiso no existe en
  // el seed, así que exigirlo dejaría la pantalla inaccesible para todo el
  // mundo, incluida la persona propietaria.
  @RequirePermissions('content:write')
  @ApiOperation({ summary: 'Todos los artículos, con sus idiomas' })
  articulosAdmin() {
    return this.blog.listarAdmin();
  }

  @ApiBearerAuth('access-token')
  @Post('admin/blog')
  @RequirePermissions('content:write')
  @ApiOperation({ summary: 'Crear un artículo (queda en borrador)' })
  crearArticulo(
    @Body() dto: CrearArticuloDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.blog.crear(dto, { actorId: u.id, actorIp: req.ip });
  }

  @ApiBearerAuth('access-token')
  @Patch('admin/blog/:id')
  @RequirePermissions('content:write')
  @ApiOperation({ summary: 'Modificar o publicar un artículo' })
  actualizarArticulo(
    @Param('id') id: string,
    @Body() dto: ActualizarArticuloDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.blog.actualizar(id, dto, { actorId: u.id, actorIp: req.ip });
  }

  @ApiBearerAuth('access-token')
  @Delete('admin/blog/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ summary: 'Archivar un artículo' })
  archivarArticulo(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.blog.archivar(id, { actorId: u.id, actorIp: req.ip });
  }
}
