import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { FORMATOS, NOMBRE_RED, revisionCaducada } from '@ecom/shared';
import { CANALES } from '../channels/canales.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { ActivosService } from './activos.service.js';
import { CampanasService } from './campanas.service.js';
import { CreatividadesService } from './creatividades.service.js';
import {
  ActualizarActivoDto,
  ActualizarCampanaDto,
  CrearCampanaDto,
  CrearCreatividadDto,
  CrearVarianteDto,
  GuardarDocumentoDto,
  ImportarDelCatalogoDto,
  ListarActivosDto,
  ListarCampanasDto,
  ListarCreatividadesDto,
  MotivoDto,
} from './dto/studio.dto.js';

/**
 * API del Studio.
 *
 * Un solo controlador para las cuatro cosas que maneja —formatos, campañas,
 * creatividades y activos— porque comparten prefijo, permisos y contexto de
 * actor; partirlo en cuatro solo duplicaría el andamiaje sin separar nada.
 */
@ApiTags('Studio')
@ApiBearerAuth('access-token')
@Controller({ path: 'studio', version: '1' })
export class StudioController {
  constructor(
    private readonly campanas: CampanasService,
    private readonly creatividades: CreatividadesService,
    private readonly activos: ActivosService,
  ) {}

  // ── Formatos ──────────────────────────────────────────────

  /**
   * El catálogo de formatos con su letra pequeña.
   *
   * Sale del código y no de la base de datos: son datos de referencia que
   * cambian cuando cambia la red, no cuando lo decide quien usa el panel. Se
   * marca cuál lleva demasiado sin revisar, porque una tanda entera rechazada
   * por un peso que bajó de 300 a 150 KB es un día perdido.
   */
  @Get('formatos')
  @RequirePermissions('studio:read')
  @ApiOperation({ summary: 'Formatos de anuncio con tamaños, pesos y límites de texto' })
  formatos() {
    const hoy = new Date();
    return {
      redes: NOMBRE_RED,
      formatos: FORMATOS.map((f) => ({ ...f, revisionCaducada: revisionCaducada(f, hoy) })),
    };
  }

  /**
   * Los canales de captación, para el desplegable de la campaña.
   *
   * Se sirve aquí y no se reutiliza `/channels` porque aquel pide
   * `marketing:write`, y el rol Creativo no lo tiene ni debe tenerlo: elegir
   * dónde va una campaña no es lo mismo que poder tocar cupones y afiliados.
   */
  @Get('canales')
  @RequirePermissions('studio:read')
  @ApiOperation({ summary: 'Canales de captación con su letra pequeña' })
  canales() {
    return CANALES;
  }

  // ── Campañas ──────────────────────────────────────────────

  @Get('campanas')
  @RequirePermissions('studio:read')
  @ApiOperation({ summary: 'Campañas con su estado y cuántas piezas llevan' })
  listarCampanas(@Query() query: ListarCampanasDto) {
    return this.campanas.listar(query);
  }

  @Get('campanas/:id')
  @RequirePermissions('studio:read')
  @ApiOperation({ summary: 'Una campaña con sus creatividades y su marcaje' })
  campana(@Param('id') id: string) {
    return this.campanas.obtener(id);
  }

  @Post('campanas')
  @RequirePermissions('studio:write')
  @ApiOperation({ summary: 'Crear una campaña' })
  crearCampana(
    @Body() dto: CrearCampanaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.campanas.crear(dto, this.ctx(u, req));
  }

  @Patch('campanas/:id')
  @RequirePermissions('studio:write')
  @ApiOperation({ summary: 'Editar una campaña' })
  actualizarCampana(
    @Param('id') id: string,
    @Body() dto: ActualizarCampanaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.campanas.actualizar(id, dto, this.ctx(u, req));
  }

  @Delete('campanas/:id')
  @RequirePermissions('studio:write')
  @ApiOperation({ summary: 'Archivar una campaña (no se borra nunca)' })
  archivarCampana(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.campanas.archivar(id, this.ctx(u, req));
  }

  // ── Creatividades ─────────────────────────────────────────

  @Get('creatividades')
  @RequirePermissions('studio:read')
  @ApiOperation({ summary: 'Creatividades, filtrables por campaña, estado y formato' })
  listarCreatividades(@Query() query: ListarCreatividadesDto) {
    return this.creatividades.listar(query);
  }

  @Get('creatividades/:id')
  @RequirePermissions('studio:read')
  @ApiOperation({ summary: 'Una creatividad con su documento vigente' })
  creatividad(@Param('id') id: string) {
    return this.creatividades.obtener(id);
  }

  @Post('creatividades')
  @RequirePermissions('studio:write')
  @ApiOperation({ summary: 'Crear una creatividad, en blanco o desde una plantilla' })
  crearCreatividad(
    @Body() dto: CrearCreatividadDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.creatividades.crear(dto, this.ctx(u, req));
  }

  /**
   * Guarda el documento.
   *
   * Es `PUT` y no `PATCH` porque llega entero: un documento se guarda completo o
   * no se guarda, y aplicar un parche parcial sobre un árbol de capas es la
   * forma de acabar con una capa huérfana que solo revienta al exportar.
   */
  @Put('creatividades/:id/documento')
  @RequirePermissions('studio:write')
  @ApiOperation({ summary: 'Guardar una versión nueva del documento' })
  guardarDocumento(
    @Param('id') id: string,
    @Body() dto: GuardarDocumentoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.creatividades.guardarDocumento(id, dto, this.ctx(u, req));
  }

  @Get('creatividades/:id/versiones')
  @RequirePermissions('studio:read')
  @ApiOperation({ summary: 'Historial de versiones' })
  versiones(@Param('id') id: string) {
    return this.creatividades.versiones(id);
  }

  @Get('creatividades/:id/versiones/:version')
  @RequirePermissions('studio:read')
  @ApiOperation({ summary: 'El documento de una versión concreta' })
  version(@Param('id') id: string, @Param('version', ParseIntPipe) version: number) {
    return this.creatividades.documentoDeVersion(id, version);
  }

  @Post('creatividades/:id/versiones/:version/restaurar')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('studio:write')
  @ApiOperation({ summary: 'Volver a una versión anterior, copiándola como nueva' })
  restaurar(
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.creatividades.restaurar(id, version, this.ctx(u, req));
  }

  /*
   * El cambio de estado va en rutas separadas y no en una sola con el destino
   * en el cuerpo. El motivo es el permiso: mandar a revisión es trabajo de
   * quien diseña, y aprobar y publicar son decisiones del negocio. Con una sola
   * ruta habría que elegir un permiso para todas —y entonces o el creativo no
   * puede pedir revisión, o puede publicarse a sí mismo— o comprobarlo a mano
   * dentro del método, que es justo lo que el decorador existe para evitar.
   */

  @Post('creatividades/:id/revision')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('studio:write')
  @ApiOperation({ summary: 'Mandar a revisión' })
  mandarARevision(
    @Param('id') id: string,
    @Body() dto: MotivoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.creatividades.cambiarEstado(
      id,
      { estado: 'EN_REVISION', ...dto },
      this.ctx(u, req),
    );
  }

  @Post('creatividades/:id/devolver')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('studio:write')
  @ApiOperation({ summary: 'Devolver a borrador: rechazar una revisión o recuperar lo archivado' })
  devolver(
    @Param('id') id: string,
    @Body() dto: MotivoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.creatividades.cambiarEstado(id, { estado: 'BORRADOR', ...dto }, this.ctx(u, req));
  }

  @Post('creatividades/:id/aprobar')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('studio:publish')
  @ApiOperation({ summary: 'Aprobar: nada se publica sin pasar por aquí' })
  aprobar(
    @Param('id') id: string,
    @Body() dto: MotivoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.creatividades.cambiarEstado(id, { estado: 'APROBADA', ...dto }, this.ctx(u, req));
  }

  @Post('creatividades/:id/publicar')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('studio:publish')
  @ApiOperation({ summary: 'Dar por publicada, una vez subida a la red' })
  publicar(
    @Param('id') id: string,
    @Body() dto: MotivoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.creatividades.cambiarEstado(id, { estado: 'PUBLICADA', ...dto }, this.ctx(u, req));
  }

  @Delete('creatividades/:id')
  @RequirePermissions('studio:write')
  @ApiOperation({ summary: 'Archivar una creatividad (no se borra nunca)' })
  archivarCreatividad(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.creatividades.archivar(id, this.ctx(u, req));
  }

  @Post('creatividades/:id/variantes')
  @RequirePermissions('studio:write')
  @ApiOperation({ summary: 'Crear una hermana para probar A/B, con su propio marcaje' })
  crearVariante(
    @Param('id') id: string,
    @Body() dto: CrearVarianteDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.creatividades.crearVariante(id, dto, this.ctx(u, req));
  }

  // ── Activos ───────────────────────────────────────────────

  @Get('activos')
  @RequirePermissions('studio:read')
  @ApiOperation({ summary: 'Biblioteca de activos, con su procedencia' })
  listarActivos(@Query() query: ListarActivosDto) {
    return this.activos.listar(query);
  }

  @Post('activos')
  @RequirePermissions('studio:write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir una imagen a la biblioteca' })
  async subirActivo(@Req() req: FastifyRequest, @CurrentUser() u: UsuarioAutenticado) {
    const fichero = await req.file();
    if (!fichero) throw new BadRequestException('No se ha recibido ningún fichero');

    return this.activos.subirImagen(await fichero.toBuffer(), fichero.filename, this.ctx(u, req));
  }

  @Post('activos/del-catalogo')
  @RequirePermissions('studio:write')
  @ApiOperation({ summary: 'Traer una foto del catálogo a la biblioteca' })
  importarDelCatalogo(
    @Body() dto: ImportarDelCatalogoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.activos.importarDelCatalogo(dto.mediaId, this.ctx(u, req));
  }

  @Patch('activos/:id')
  @RequirePermissions('studio:write')
  @ApiOperation({ summary: 'Renombrar o etiquetar un activo' })
  actualizarActivo(@Param('id') id: string, @Body() dto: ActualizarActivoDto) {
    return this.activos.actualizar(id, dto);
  }

  @Delete('activos/:id')
  @RequirePermissions('studio:write')
  @ApiOperation({ summary: 'Retirar un activo de la biblioteca' })
  retirarActivo(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.activos.retirar(id, this.ctx(u, req));
  }

  private ctx(u: UsuarioAutenticado, req: FastifyRequest): ContextoActor {
    return { actorId: u.id, actorIp: req.ip };
  }
}
