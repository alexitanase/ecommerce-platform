import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CacheHttp } from '../../common/decorators/cache-http.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { marcajeDe } from '../channels/canales.js';
import { OrdersService } from './orders.service.js';
import { RiesgoService } from './riesgo.service.js';
import { FulfillmentService } from './fulfillment.service.js';
import { TrackingService } from './tracking.service.js';
import { PreferenciasService } from '../consent/preferencias.service.js';
import {
  CON_FLUJO_PROPIO,
  ESTADOS_KANBAN,
  ETIQUETAS,
  destinosManuales,
} from './order-state-machine.js';
import {
  CambiarEstadoDto,
  CancelarDto,
  MarcarPagadoDto,
  ResolverIncidenciaDto,
  CambiarDireccionDto,
  CrearPedidoDto,
  KanbanDto,
  ListarPedidosDto,
  PrevisualizarIvaDto,
  SeguimientoManualDto,
} from './dto/orders.dto.js';
import { TRANSPORTISTAS_CONOCIDOS } from './enlaces-seguimiento.js';

@ApiTags('Pedidos')
@Controller({ path: 'orders', version: '1' })
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly preferencias: PreferenciasService,
    private readonly riesgo: RiesgoService,
    private readonly fulfillment: FulfillmentService,
    private readonly tracking: TrackingService,
  ) {}

  // ── Control de riesgo ─────────────────────────────────────

  @Get('retenidos')
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Pedidos retenidos por el control de riesgo' })
  retenidos() {
    return this.riesgo.retenidos();
  }

  /**
   * Liberar un pedido retenido y comprarlo.
   *
   * Las dos cosas, y no solo la primera. Liberar quitaba la retención y ahí se
   * acababa: nadie volvía a intentar la compra, así que el pedido se quedaba
   * en FALLIDO —fuera del tablero, fuera de la cola de retenidos y fuera de la
   * de incidencias, porque esa lista mira sub-pedidos y aquí no llegó a haber
   * ninguno—. Un pedido cobrado, invisible en todas las pantallas.
   *
   * Liberar significa «este pedido es bueno, adelante», así que adelante.
   */
  @Post(':id/liberar-riesgo')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders:fulfill')
  @ApiOperation({ summary: 'Liberar un pedido retenido y lanzar la compra al proveedor' })
  async liberarRiesgo(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    const pedido = await this.riesgo.liberar(id, this.ctx(u, req));

    // Solo si ya está cobrado. La retención se puede levantar antes de que
    // confirme el pago —es lo normal en cripto—, y comprarle mercancía a un
    // pedido sin cobrar es pagar de nuestro bolsillo.
    if (pedido.paymentStatus !== 'PAID') return { ...pedido, compra: null };

    try {
      return { ...pedido, compra: await this.fulfillment.procesar(id) };
    } catch (error) {
      /*
       * Que falle la compra no deshace la liberación, que ya está hecha y
       * registrada. Devolver un 500 aquí haría creer que no se ha liberado
       * nada y llevaría a pulsar el botón otra vez.
       */
      return {
        ...pedido,
        compra: null,
        avisoCompra: error instanceof Error ? error.message : 'No se ha podido lanzar la compra',
      };
    }
  }

  /**
   * Lanza —o relanza— la compra al proveedor de un pedido.
   *
   * Es la salida de un callejón sin salida: si el trabajo en cola se perdió o
   * el worker estaba caído cuando se cobró, el pedido se queda pagado y sin
   * comprar, y hasta ahora no había ningún botón que lo empujara. Reintentar
   * solo existía sobre un sub-pedido, y en este caso no hay ninguno.
   *
   * Repetirlo no duplica nada: la clave de idempotencia es la misma para el
   * mismo pedido y proveedor, y lo que ya está comprado se salta.
   */
  @Post(':id/procesar')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders:fulfill')
  @ApiOperation({ summary: 'Lanzar la compra al proveedor de un pedido pagado' })
  procesar(@Param('id') id: string) {
    return this.fulfillment.procesar(id);
  }

  // ── Incidencias de fulfillment ────────────────────────────

  /*
   * La cola de lo que se ha quedado a medias al comprar al proveedor.
   *
   * Es la pantalla que evita el peor de los fallos silenciosos: un cliente que
   * pagó y cuyo pedido nunca llegó a comprarse porque el proveedor se quedó sin
   * stock o subió el precio. Sin esto, el sub-pedido se queda marcado en la base
   * de datos y nadie se entera hasta que el cliente escribe preguntando.
   */
  @Get('incidencias')
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Sub-pedidos de proveedor que esperan una decisión' })
  incidencias() {
    return this.fulfillment.incidencias();
  }

  @Post('incidencias/:supplierOrderId/reintentar')
  @HttpCode(HttpStatus.OK)
  // Permiso de envío, no de escritura: reintentar compra mercancía de verdad.
  @RequirePermissions('orders:fulfill')
  @ApiOperation({ summary: 'Reintentar el envío de un sub-pedido tras resolver la incidencia' })
  reintentarIncidencia(
    @Param('supplierOrderId') supplierOrderId: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.fulfillment.reintentar(supplierOrderId, this.ctx(u, req));
  }

  /**
   * Cerrar la incidencia porque la compra se ha hecho a mano en el proveedor.
   *
   * Mismo permiso que reintentar —`orders:fulfill`— porque la consecuencia es la
   * misma: el sistema pasa a dar por hecho que hay mercancía comprada y el
   * pedido avanza hacia el cliente.
   */
  @Post('incidencias/:supplierOrderId/resolver')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders:fulfill')
  @ApiOperation({ summary: 'Cerrar la incidencia indicando la compra hecha a mano' })
  resolverIncidencia(
    @Param('supplierOrderId') supplierOrderId: string,
    @Body() dto: ResolverIncidenciaDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.fulfillment.resolverAMano(
      supplierOrderId,
      { referencia: dto.referencia, ...(dto.nota ? { nota: dto.nota } : {}) },
      this.ctx(u, req),
    );
  }

  // ── Seguimiento de los envíos ─────────────────────────────

  /**
   * Anota a mano el transportista y el número de un envío.
   *
   * Es la única vía cuando el proveedor no tiene API: nadie nos va a mandar
   * este dato, lo copia una persona de su web. A partir de aquí el flujo es el
   * mismo que el automático —se avisa al cliente y el pedido pasa a «en
   * tránsito»—, porque quién escribió el número no cambia nada de lo que viene
   * después.
   *
   * Mismo permiso que comprar al proveedor y no `orders:write`: anotar un envío
   * dispara el correo que le dice al cliente que su paquete va en camino.
   */
  @Post('sub-pedidos/:supplierOrderId/seguimiento')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders:fulfill')
  @ApiOperation({ summary: 'Anotar a mano el seguimiento de una compra al proveedor' })
  registrarSeguimiento(
    @Param('supplierOrderId') supplierOrderId: string,
    @Body() dto: SeguimientoManualDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.tracking.registrarAMano(
      supplierOrderId,
      {
        transportista: dto.transportista,
        numero: dto.numero,
        ...(dto.url ? { url: dto.url } : {}),
        avisarCliente: dto.avisarCliente,
      },
      this.ctx(u, req),
    );
  }

  /** Los transportistas con enlace de seguimiento propio, para el desplegable. */
  @Get('transportistas')
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Transportistas conocidos, con enlace de seguimiento propio' })
  transportistas() {
    return TRANSPORTISTAS_CONOCIDOS;
  }

  /**
   * Envíos que llevan demasiado tiempo sin novedades.
   *
   * Un paquete parado tres semanas suele estar perdido, y adelantarse cuesta
   * mucho menos que una disputa: reenviar o reembolsar por iniciativa propia se
   * explica; hacerlo cuando el cliente ya ha abierto una reclamación, no.
   *
   * El cálculo existía desde el principio y no lo veía nadie porque no estaba
   * enchufado a ninguna ruta.
   */
  @Get('envios-parados')
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Envíos sin novedades desde hace semanas' })
  enviosParados(@Query('dias') dias?: string) {
    const umbral = Number(dias);
    return this.tracking.posiblesPerdidos(
      Number.isFinite(umbral) && umbral > 0 ? Math.min(umbral, 120) : 21,
    );
  }

  // ── Cliente ───────────────────────────────────────────────

  @Public()
  @Post()
  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Crear un pedido a partir del carrito' })
  async crear(
    @Body() dto: CrearPedidoDto,
    @Req() req: FastifyRequest,
    @CurrentUser('id') userId?: string,
  ) {
    // Antes de crear el pedido: si el consentimiento fallara después, el
    // cliente habría dicho que sí y no quedaría constancia de ello.
    if (dto.marketingConsent) {
      await this.preferencias.actualizar(
        dto.email,
        { offers: true, newsletter: true },
        {
          origen: 'checkout',
          ip: req.ip,
          ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}),
        },
        userId,
      );
    }

    // Se vuelve a limpiar aquí aunque el DTO lo haya validado: 'Newsletter' y
    // 'newsletter ' son el mismo canal, y sin normalizar saldrían como dos
    // filas distintas en el informe, ninguna con datos para decidir nada.
    const marcaje = marcajeDe({
      fuente: dto.utmSource,
      medio: dto.utmMedium,
      campana: dto.utmCampaign,
      contenido: dto.utmContent,
    });

    return this.orders.crear(
      {
        email: dto.email,
        ...(dto.phone ? { phone: dto.phone } : {}),
        locale: dto.locale,
        ...(userId ? { userId } : {}),
        lineas: dto.lineas,
        shippingAddress: dto.shippingAddress,
        ...(dto.billingAddress ? { billingAddress: dto.billingAddress } : {}),
        ...(dto.customerNote ? { customerNote: dto.customerNote } : {}),
        ...(dto.shippingRateId ? { shippingRateId: dto.shippingRateId } : {}),
        ...(dto.couponCode ? { couponCode: dto.couponCode } : {}),
        ...(dto.referralCode ? { referralCode: dto.referralCode } : {}),
        ...(dto.visitorId ? { visitorId: dto.visitorId } : {}),
        ...(marcaje
          ? {
              utmSource: marcaje.fuente,
              ...(marcaje.medio ? { utmMedium: marcaje.medio } : {}),
              ...(marcaje.campana ? { utmCampaign: marcaje.campana } : {}),
              ...(marcaje.contenido ? { utmContent: marcaje.contenido } : {}),
            }
          : {}),
        // Señales del control de riesgo. La IP la pone el servidor: si viniera
        // del cuerpo, quien quisiera saltarse el límite por IP se inventaría
        // una distinta en cada intento.
        ...(req.ip ? { ip: req.ip } : {}),
        ...(dto.segundosEnElCheckout !== undefined
          ? { segundosEnElCheckout: dto.segundosEnElCheckout }
          : {}),
      },
      dto.cartId,
    );
  }

  /**
   * Mis pedidos.
   *
   * Antes de listar se adoptan los pedidos que se hicieran sin sesión con este
   * mismo email —y solo si está verificado—. Se hace aquí porque es justo donde
   * se nota el problema: el pedido existe, llegó su correo, y en esta pantalla no
   * aparecía. Es idempotente y en la segunda visita no encuentra nada.
   */
  @ApiBearerAuth('access-token')
  @Get('mine')
  @ApiOperation({ summary: 'Mis pedidos' })
  async mios(@CurrentUser() u: UsuarioAutenticado, @Query() query: ListarPedidosDto) {
    await this.orders.vincularPedidosDeInvitado(u.id);
    return this.orders.listar({ ...this.filtros(query), userId: u.id });
  }

  @Public()
  @Get('track/:token')
  // El seguimiento cambia cuando el paquete se mueve, no cuando se recarga la
  // página: un margen corto evita machacar la API sin que el cliente note
  // retraso en el estado.
  @CacheHttp({ compartida: 0, navegador: 30 })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Consultar un pedido con su clave de seguimiento' })
  seguir(@Param('token') token: string) {
    return this.orders.porTokenPublico(token);
  }

  @Public()
  @Post('track/:token/cancel')
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @ApiOperation({ summary: 'El cliente cancela su pedido con la clave de seguimiento' })
  async cancelarCliente(
    @Param('token') token: string,
    @Body() dto: CancelarDto,
    @Req() req: FastifyRequest,
  ) {
    const orderId = await this.orders.idPorTokenPublico(token);
    // 'cliente': solo puede cancelar antes de que salga al proveedor. A partir
    // de ahí le cubre el derecho de desistimiento, que tiene su propio circuito.
    // Sin actorId porque no es personal: la acción la hace el propio cliente.
    return this.orders.cancelar(orderId, dto.motivo, { actorIp: req.ip }, 'cliente');
  }

  @Public()
  @Patch('track/:token/address')
  @ApiOperation({ summary: 'Cambiar la dirección de envío antes de que salga' })
  async cambiarDireccionCliente(
    @Param('token') token: string,
    @Body() dto: CambiarDireccionDto,
    @Req() req: FastifyRequest,
  ) {
    const orderId = await this.orders.idPorTokenPublico(token);
    return this.orders.cambiarDireccion(orderId, dto.shippingAddress, { actorIp: req.ip });
  }

  // ── Kanban y gestión (admin) ──────────────────────────────

  @Public()
  @Post('tax-preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'IVA y avisos de aduana del carrito, para enseñarlos antes de pagar',
  })
  previsualizarIva(@Body() dto: PrevisualizarIvaDto) {
    return this.orders.previsualizarIva(dto);
  }

  @ApiBearerAuth('access-token')
  @Get('oss-threshold')
  @RequirePermissions('orders:read')
  @ApiOperation({
    summary: 'Situación frente al umbral de 10.000 € de ventas a la UE (OSS)',
  })
  umbralOss(@Query('anio') anio?: string) {
    return this.orders.estadoUmbralOss(anio ? Number(anio) : undefined);
  }

  @ApiBearerAuth('access-token')
  @Get('kanban')
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Tablero Kanban de pedidos por columna' })
  kanban(@Query() query: KanbanDto) {
    return this.orders.kanban(query);
  }

  @ApiBearerAuth('access-token')
  @Get('kanban/columns')
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Columnas del tablero y transiciones permitidas desde cada una' })
  columnas() {
    return ESTADOS_KANBAN.map((estado) => ({
      estado,
      titulo: ETIQUETAS[estado],
      /*
       * El frontend usa esto para saber a qué columnas se puede arrastrar una
       * tarjeta, en lugar de duplicar las reglas en el cliente.
       *
       * Solo los destinos que de verdad son un movimiento. Antes iban todos, y
       * el menú de la tarjeta ofrecía «Cancelado», «Cerrado» y «Reembolsado»:
       * por ahí se marcaba un pedido como cancelado sin avisar al proveedor ni
       * devolver el dinero, y como reembolsado sin haber reembolsado nada. Cada
       * uno de los tres tiene su propio botón, que sí hace lo que dice.
       */
      destinos: destinosManuales(estado).map((d) => ({ estado: d, titulo: ETIQUETAS[d] })),
    }));
  }

  @ApiBearerAuth('access-token')
  @Get()
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Listar pedidos con filtros' })
  listar(@Query() query: ListarPedidosDto) {
    return this.orders.listar(this.filtros(query));
  }

  @ApiBearerAuth('access-token')
  @Get(':id')
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Detalle del pedido con su timeline y margen' })
  detalle(@Param('id') id: string) {
    return this.orders.detalle(id);
  }

  @ApiBearerAuth('access-token')
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders:write')
  @ApiOperation({ summary: 'Mover el pedido de estado (arrastrar en el Kanban)' })
  cambiarEstado(
    @Param('id') id: string,
    @Body() dto: CambiarEstadoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    /*
     * Los estados con flujo propio no entran por aquí.
     *
     * La comprobación va en la puerta HTTP y no en el servicio porque el
     * servicio SÍ tiene que poder llevarlos: es lo que hacen `cancelar()` y
     * `cerrar()` después de avisar al proveedor, liberar el stock y anotar
     * quién lo hizo. Lo que no puede es llegarse ahí por el atajo.
     */
    if (CON_FLUJO_PROPIO.includes(dto.status)) {
      throw new BadRequestException(
        `«${ETIQUETAS[dto.status]}» no es un movimiento del tablero: tiene su propia acción en la ` +
          'ficha del pedido, que además avisa al proveedor y devuelve el dinero cuando toca.',
      );
    }

    // origen 'manual': la máquina de estados rechazará las transiciones que
    // solo puede hacer el sistema.
    return this.orders.cambiarEstado(id, dto.status, {
      origen: 'manual',
      ...(dto.motivo ? { motivo: dto.motivo } : {}),
      actorId: u.id,
      actorIp: req.ip,
    });
  }

  /**
   * Marcar el pedido como pagado sin que lo haya confirmado la pasarela.
   *
   * Dos permisos y no uno: `orders:write` para tocar el pedido y
   * `payments:write` porque esto es declarar que ha entrado dinero. Con el rol
   * de pedidos —que tiene todo lo de pedidos pero no `payments:write`— no se
   * puede, y es deliberado: quien gestiona envíos no decide qué está cobrado.
   *
   * No se inventa un permiso nuevo a propósito: en producción no lo tendría
   * asignado nadie hasta volver a sembrar los roles, y el botón aparecería roto
   * justo el día que hace falta.
   */
  @ApiBearerAuth('access-token')
  @Post(':id/marcar-pagado')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders:write', 'payments:write')
  @ApiOperation({ summary: 'Marcar como pagado un pedido cuyo cobro no confirmó la pasarela' })
  marcarPagado(
    @Param('id') id: string,
    @Body() dto: MarcarPagadoDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.orders.marcarPagadoAMano(
      id,
      {
        motivo: dto.motivo,
        ...(dto.importeCents !== undefined ? { importeCents: dto.importeCents } : {}),
      },
      this.ctx(u, req),
    );
  }

  @ApiBearerAuth('access-token')
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders:close')
  @ApiOperation({ summary: 'Cerrar el pedido: desaparece del Kanban' })
  cerrar(
    @Param('id') id: string,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.orders.cerrar(id, this.ctx(u, req));
  }

  @ApiBearerAuth('access-token')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders:cancel')
  @ApiOperation({ summary: 'Cancelar un pedido' })
  cancelar(
    @Param('id') id: string,
    @Body() dto: CancelarDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.orders.cancelar(id, dto.motivo, this.ctx(u, req));
  }

  /** Convierte las fechas ISO del DTO a Date para la consulta. */
  private filtros(query: ListarPedidosDto): Parameters<OrdersService['listar']>[0] {
    const { desde, hasta, ...resto } = query;
    return {
      ...resto,
      ...(desde ? { desde: new Date(desde) } : {}),
      ...(hasta ? { hasta: new Date(hasta) } : {}),
    };
  }

  private ctx(u: UsuarioAutenticado, req: FastifyRequest): ContextoActor {
    return { actorId: u.id, actorIp: req.ip };
  }
}
