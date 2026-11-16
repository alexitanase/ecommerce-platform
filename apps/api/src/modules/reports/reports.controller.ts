import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { Locale } from '@ecom/shared';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CacheHttp } from '../../common/decorators/cache-http.decorator.js';
import { FeedService } from './feed.service.js';
import { ReportsService, type RangoFechas } from './reports.service.js';
import { RecuperacionService } from '../cart/recuperacion.service.js';
import { nombreFichero } from './csv.js';
import { rangoTrimestre, trimestreDe } from './informe-oss.js';
import { ConversionCriptoDto, RangoDto, TrimestreDto } from './dto/reports.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';

@ApiTags('Informes')
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly recuperacion: RecuperacionService,
    private readonly feed: FeedService,
  ) {}

  /**
   * Rango por defecto: los últimos 30 días.
   *
   * Un informe que abre vacío obliga a elegir fechas antes de ver nada, y lo
   * que casi siempre se quiere mirar es "cómo ha ido este mes".
   */
  private rango(query: RangoDto): RangoFechas {
    const hasta = query.hasta ? new Date(query.hasta) : new Date();
    const desde = query.desde ? new Date(query.desde) : new Date(hasta.getTime() - 30 * 86_400_000);

    return { desde, hasta };
  }

  /**
   * Trimestre a declarar. Por defecto, el **anterior** al de hoy.
   *
   * Es el que se está presentando: el trimestre en curso todavía no ha
   * terminado y su declaración no se puede cerrar. Abrir con el actual daría
   * una cifra incompleta con pinta de definitiva.
   */
  private trimestre(query: TrimestreDto): { anio: number; trimestre: number } {
    if (query.anio && query.trimestre) {
      return { anio: query.anio, trimestre: query.trimestre };
    }

    const hoy = new Date();
    const actual = trimestreDe(hoy);

    return actual.trimestre === 1
      ? { anio: actual.anio - 1, trimestre: 4 }
      : { anio: actual.anio, trimestre: actual.trimestre - 1 };
  }

  @ApiBearerAuth('access-token')
  @Get('summary')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Resumen del periodo con el margen desglosado' })
  resumen(@Query() query: RangoDto) {
    return this.reports.resumen(this.rango(query));
  }

  @ApiBearerAuth('access-token')
  @Get('daily')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Ventas por día' })
  porDia(@Query() query: RangoDto) {
    return this.reports.porDia(this.rango(query));
  }

  @ApiBearerAuth('access-token')
  @Get('products')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Productos ordenados por margen aportado' })
  productos(@Query() query: RangoDto) {
    return this.reports.productos(this.rango(query));
  }

  @ApiBearerAuth('access-token')
  @Get('crypto')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Libro de cobros en cripto, con ganancias por conversión (FIFO)' })
  cripto(@Query() query: RangoDto) {
    return this.reports.cripto(this.rango(query));
  }

  @ApiBearerAuth('access-token')
  @Post('crypto/settlements')
  @RequirePermissions('payments:write')
  @ApiOperation({ summary: 'Anotar una conversión de cripto a euros' })
  registrarConversion(@Body() dto: ConversionCriptoDto, @CurrentUser() u: UsuarioAutenticado) {
    return this.reports.registrarConversion(dto, u.id);
  }

  @ApiBearerAuth('access-token')
  @Get('crypto/settlements')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Conversiones anotadas' })
  conversiones() {
    return this.reports.conversiones();
  }

  @ApiBearerAuth('access-token')
  @Get('recovery')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Resultado de la campaña de carritos abandonados' })
  campanaRecuperacion(@Query() query: RangoDto) {
    const rango = this.rango(query);
    return this.recuperacion.metricas(rango.desde, rango.hasta);
  }

  @ApiBearerAuth('access-token')
  @Get('oss')
  @RequirePermissions('reports:read')
  @ApiOperation({
    summary: 'Declaración trimestral de la ventanilla única (modelo 369)',
  })
  oss(@Query() query: TrimestreDto) {
    const { anio, trimestre } = this.trimestre(query);
    return this.reports.declaracionOss(anio, trimestre);
  }

  @ApiBearerAuth('access-token')
  @Get('export/:informe')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Descargar un informe en CSV (pedidos, productos, iva, oss o cripto)' })
  async exportar(
    @Param('informe') informe: string,
    @Query() query: RangoDto & TrimestreDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const { anio, trimestre } = this.trimestre(query);
    // El de la ventanilla única va por trimestre natural, no por el rango de
    // fechas del resto: con el rango de 30 días por defecto, el fichero se
    // llamaría como un mes y contendría un trimestre entero.
    const rango = informe === 'oss' ? rangoTrimestre(anio, trimestre) : this.rango(query);

    const generadores: Record<string, () => Promise<string>> = {
      pedidos: () => this.reports.csvPedidos(rango),
      productos: () => this.reports.csvProductos(rango),
      iva: () => this.reports.csvIva(rango),
      cripto: () => this.reports.csvCripto(rango),
      oss: () => this.reports.csvOss(anio, trimestre),
    };

    const generar = generadores[informe] ?? generadores['pedidos']!;
    const csv = await generar();

    void reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="${nombreFichero(informe, rango.desde, rango.hasta)}"`,
      );

    return csv;
  }

  // ── Feed de Google Merchant Center ────────────────────────

  /**
   * El XML que descarga Google cada día.
   *
   * Público porque lo pide el robot de Google, que no trae sesión. No expone
   * nada que no esté ya en la tienda: son las fichas publicadas. Los productos
   * +18 quedan fuera —Google Shopping no los admite y colar uno suspende la
   * cuenta de Merchant entera—, y eso se filtra en la consulta y otra vez en
   * la lógica.
   */
  @Public()
  @Get('feed/merchant/:locale.xml')
  @CacheHttp({ compartida: 3600, navegador: 0 })
  @ApiOperation({ summary: 'Feed de productos para Google Merchant Center (XML)' })
  async feedMerchant(
    @Param('locale') locale: Locale,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<string> {
    void res.header('Content-Type', 'application/xml; charset=utf-8');
    return this.feed.xml(locale);
  }

  /**
   * Qué productos se quedan fuera del feed y por qué.
   *
   * Es la mitad útil para quien lleva la tienda: el XML lo lee un robot, pero
   * saber que faltan treinta productos por no tener descripción es lo que
   * permite arreglarlo. Sin esto, el síntoma es "tengo 400 productos y en
   * Shopping salen 120" sin nada en ningún sitio que lo explique.
   */
  @Get('feed/merchant/:locale/diagnostico')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Productos excluidos del feed, agrupados por motivo' })
  diagnosticoFeed(@Param('locale') locale: Locale) {
    return this.feed.diagnostico(locale);
  }
}
