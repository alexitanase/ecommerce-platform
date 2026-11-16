import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ErrorProveedor, type InfoSeguimiento } from '@ecom/suppliers';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import { MailService } from '../mail/mail.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { OrdersService } from './orders.service.js';
import { enlaceDeSeguimiento, nombreDeTransportista } from './enlaces-seguimiento.js';
import { SeguimientoTransportistaService } from './seguimiento-transportista.service.js';

/**
 * Seguimiento de envíos.
 *
 * En dropshipping el paquete tarda semanas y el cliente no ve nada durante ese
 * tiempo. Sin seguimiento activo, cada pedido genera dos o tres correos de
 * "¿dónde está lo mío?", que es el mayor coste de soporte del negocio.
 *
 * La consulta se espacia según la antigüedad del envío: los primeros días el
 * estado cambia a menudo, y a partir de la tercera semana casi nunca. Consultar
 * todos los pedidos cada hora agotaría la cuota del proveedor sin aportar nada.
 *
 * **Se pregunta a dos sitios distintos, por este orden:**
 *
 *  1. Al PROVEEDOR, cuando su API lo ofrece. Es el mejor dato: sabe también si
 *     el pedido se canceló o cambió de precio, no solo dónde está la caja.
 *  2. Al TRANSPORTISTA, por el número de seguimiento, cuando lo primero no es
 *     posible. Cubre el agujero que dejaba tener solo lo anterior: Dreamlove no
 *     tiene API, así que sus pedidos —y cualquiera cuyo número se anote a
 *     mano— no se actualizaban nunca. El pedido se quedaba en «enviado al
 *     proveedor» mientras el paquete llegaba, y solo salía de ahí si a alguien
 *     le daba por moverlo.
 */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly suppliers: SuppliersService,
    private readonly orders: OrdersService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly transportistas: SeguimientoTransportistaService,
  ) {}

  /**
   * Cada cuánto conviene volver a preguntar, según los días desde el envío.
   *
   * Días 0-3: cada 6 h (el paquete se mueve mucho al principio)
   * Días 4-14: cada 12 h
   * Días 15+: cada 24 h (tránsito internacional, sin novedades)
   */
  private intervaloHoras(diasDesdeEnvio: number): number {
    if (diasDesdeEnvio <= 3) return 6;
    if (diasDesdeEnvio <= 14) return 12;
    return 24;
  }

  /** Sub-pedidos a los que toca consultar el seguimiento. */
  async pendientes(): Promise<string[]> {
    const activos = await this.prisma.client.supplierOrder.findMany({
      where: {
        status: { in: ['PLACED', 'SHIPPED'] },
        // Los que llevan más de 60 días se dan por perdidos y pasan a revisión
        // manual: seguir consultándolos indefinidamente no los va a encontrar.
        placedAt: { gte: new Date(Date.now() - 60 * 86_400_000) },
      },
      select: { id: true, placedAt: true, updatedAt: true },
    });

    const ahora = Date.now();

    return activos
      .filter((s) => {
        const dias = s.placedAt ? (ahora - s.placedAt.getTime()) / 86_400_000 : 0;
        const horasDesdeConsulta = (ahora - s.updatedAt.getTime()) / 3_600_000;
        return horasDesdeConsulta >= this.intervaloHoras(dias);
      })
      .map((s) => s.id);
  }

  /**
   * Consulta el seguimiento de un sub-pedido y propaga los cambios.
   */
  async actualizar(supplierOrderId: string): Promise<{
    actualizado: boolean;
    estado?: string;
    tracking?: string;
  }> {
    const sub = await this.prisma.client.supplierOrder.findUnique({
      where: { id: supplierOrderId },
    });

    if (!sub) return { actualizado: false };

    // Sin referencia del proveedor no hay nada que preguntarle a él, pero sí
    // puede haber un número de transportista anotado a mano: es exactamente el
    // caso de una compra manual en la web de Dreamlove.
    if (!sub.externalOrderId) {
      return this.porTransportista(sub);
    }

    let seguimiento: InfoSeguimiento | null = null;

    try {
      const adaptador = await this.suppliers.adaptador(sub.supplierId);

      if (!adaptador.capacidades.seguimiento) {
        // El proveedor no ofrece seguimiento por API. Antes se acababa aquí, y
        // ahí es donde se quedaban colgados los pedidos de Dreamlove: se
        // marcaba la fecha de consulta y a esperar a nadie. Si hay número de
        // transportista, se le pregunta a él.
        return this.porTransportista(sub);
      }

      seguimiento = await adaptador.obtenerSeguimiento(sub.externalOrderId);

      // El estado del pedido también puede haber avanzado.
      const pedidoProveedor = await adaptador.consultarPedido(sub.externalOrderId);
      if (pedidoProveedor) {
        await this.anotarEstadoDelProveedor(sub, pedidoProveedor.estado);
        await this.propagarEstado(sub.id, sub.orderId, pedidoProveedor.estado);
        await this.anotarCosteReal(sub, pedidoProveedor.costeTotalCents);
      }
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);

      // Un fallo de seguimiento no es una incidencia del pedido: el paquete
      // sigue su curso aunque la API del proveedor esté caída.
      this.logger.warn(
        `No se ha podido consultar el seguimiento de ${supplierOrderId}: ${mensaje}`,
      );

      await this.prisma.client.supplierOrder.update({
        where: { id: supplierOrderId },
        data: { updatedAt: new Date() },
      });

      if (error instanceof ErrorProveedor && error.reintentable) throw error;
      return { actualizado: false };
    }

    if (!seguimiento?.trackingNumber) {
      await this.prisma.client.supplierOrder.update({
        where: { id: supplierOrderId },
        data: { updatedAt: new Date() },
      });
      return { actualizado: false };
    }

    // ¿Es la primera vez que hay número de seguimiento?
    const esNuevo = sub.trackingNumber !== seguimiento.trackingNumber;

    await this.prisma.client.supplierOrder.update({
      where: { id: supplierOrderId },
      data: {
        status: 'SHIPPED',
        trackingCarrier: seguimiento.carrier,
        trackingNumber: seguimiento.trackingNumber,
        trackingUrl: seguimiento.trackingUrl ?? null,
        trackingStatus: seguimiento.estado ?? null,
        trackingEvents: seguimiento.eventos ?? [],
        ...(esNuevo ? { shippedAt: new Date() } : {}),
      },
    });

    if (esNuevo) {
      await this.avisarEnvio(sub.orderId, seguimiento);
    }

    return {
      actualizado: true,
      estado: seguimiento.estado ?? 'ENVIADO',
      tracking: seguimiento.trackingNumber,
    };
  }

  /**
   * Le pregunta al TRANSPORTISTA dónde está el paquete.
   *
   * Es la vía para todo lo que el proveedor no puede contarnos: sus compras
   * manuales, las de Dreamlove y cualquier número que se haya anotado a mano.
   * Lo único que hace falta es el número, que es el dato que siempre está.
   *
   * Toca la fecha de consulta pase lo que pase. Es lo que separa un envío que
   * ya se ha mirado hoy de uno que no, y sin eso el repaso volvería sobre los
   * mismos cada media hora sin avanzar nunca.
   */
  private async porTransportista(sub: {
    id: string;
    orderId: string;
    trackingNumber: string | null;
    trackingCarrier: string | null;
    trackingStatus: string | null;
  }): Promise<{ actualizado: boolean; estado?: string; tracking?: string }> {
    const marcarRevisado = () =>
      this.prisma.client.supplierOrder.update({
        where: { id: sub.id },
        data: { updatedAt: new Date() },
      });

    if (!sub.trackingNumber || !(await this.transportistas.disponible())) {
      await marcarRevisado();
      return { actualizado: false };
    }

    const [estado] = await this.transportistas.consultar([
      { numero: sub.trackingNumber, transportista: sub.trackingCarrier },
    ]);

    // DESCONOCIDO incluye «el transportista aún no tiene el paquete», que es lo
    // normal las primeras horas: no es motivo para tocar nada.
    if (!estado || estado.estado === 'DESCONOCIDO') {
      await marcarRevisado();
      return { actualizado: false };
    }

    const cambiaDeEstado = sub.trackingStatus !== estado.estado;

    await this.prisma.client.supplierOrder.update({
      where: { id: sub.id },
      data: {
        trackingStatus: estado.estado,
        updatedAt: new Date(),
        /*
         * Una incidencia entra en la cola de revisión.
         *
         * «Entrega fallida» o «retenido en aduana» no se arreglan solos y el
         * cliente se está quedando sin su pedido. Antes esto no lo veía nadie:
         * el paquete se paraba y el pedido seguía diciendo «en tránsito» hasta
         * que el cliente escribía. El texto del transportista se guarda tal
         * cual porque es lo que hay que leer para saber qué hacer.
         */
        ...(estado.estado === 'INCIDENCIA'
          ? {
              needsReview: true,
              lastError: estado.descripcion ?? 'El transportista informa de una incidencia',
              lastErrorType: 'INCIDENCIA_TRANSPORTE',
            }
          : {}),
      },
    });

    // Solo cuando cambia: anotar cada consulta llenaría la cronología del
    // pedido de líneas idénticas cada seis horas.
    if (cambiaDeEstado && estado.descripcion) {
      await this.prisma.client.orderEvent.create({
        data: {
          id: newId(),
          orderId: sub.orderId,
          type: 'supplier_order.tracking_carrier',
          description: `${sub.trackingCarrier ?? 'Transportista'}: ${estado.descripcion}${
            estado.ubicacion ? ` (${estado.ubicacion})` : ''
          }`,
          actorType: 'system',
          metadata: {
            supplierOrderId: sub.id,
            estado: estado.estado,
            ...(estado.ubicacion ? { ubicacion: estado.ubicacion } : {}),
          },
        },
      });
    }

    // Una incidencia NO mueve el pedido: sigue en tránsito, que es donde está
    // de verdad. Lo que cambia es que ahora aparece en la cola de revisión.
    if (estado.estado !== 'INCIDENCIA') {
      await this.propagarEstado(
        sub.id,
        sub.orderId,
        estado.estado === 'ENTREGADO' ? 'ENTREGADO' : 'ENVIADO',
      );
    }

    return { actualizado: true, estado: estado.estado, tracking: sub.trackingNumber };
  }

  /**
   * Lleva el estado del proveedor al pedido del cliente.
   *
   * Solo avanza cuando TODOS los sub-pedidos han llegado a ese punto: un pedido
   * con dos proveedores no está entregado hasta que llegan los dos paquetes.
   */
  /**
   * El estado del proveedor, tal y como él lo llama.
   *
   * Nuestro estado tiene cuatro escalones y se queda en «puesto al proveedor»
   * durante días. El suyo se mueve varias veces en ese rato —lo acepta el
   * vendedor, lo prepara, pasa control de riesgo— y eso es justo lo que hay que
   * ver para saber si un pedido va bien o está atascado.
   *
   * Solo se escribe cuando CAMBIA, y entonces queda también en la cronología
   * del pedido: si se anotara en cada consulta, el historial se llenaría de
   * líneas idénticas cada media hora y dejaría de servir para nada.
   */
  private async anotarEstadoDelProveedor(
    sub: { id: string; orderId: string; supplierStatus: string | null },
    estado: string,
  ): Promise<void> {
    if (estado === sub.supplierStatus) return;

    await this.prisma.client.supplierOrder.update({
      where: { id: sub.id },
      data: { supplierStatus: estado },
    });

    await this.prisma.client.orderEvent.create({
      data: {
        id: newId(),
        orderId: sub.orderId,
        type: 'supplier.status_changed',
        description: `El proveedor ha pasado el pedido a «${estado.toLowerCase()}».`,
        metadata: { supplierOrderId: sub.id, antes: sub.supplierStatus, ahora: estado },
      },
    });
  }

  /**
   * Lo que el proveedor ha cobrado DE VERDAD.
   *
   * Hasta ahora `costTotalCents` guardaba lo que esperábamos pagar cuando se
   * mandó el pedido, y ahí se quedaba para siempre aunque el cargo real fuera
   * otro. Con eso, cualquier informe de márgenes concilia contra una previsión
   * en vez de contra el extracto: si el proveedor cobra de más —porte que no
   * estaba, subida entre el pedido y el cobro— nadie se entera nunca.
   *
   * Se anota siempre que difiera, y se marca para revisión si además se ha
   * comido el margen. No se corrige el precio del catálogo desde aquí: eso lo
   * decide una persona mirando si compensa seguir vendiéndolo.
   */
  private async anotarCosteReal(
    sub: { id: string; orderId: string; costTotalCents: number },
    costeRealCents: number,
  ): Promise<void> {
    // Cero es «no lo ha dicho», no «ha salido gratis».
    if (costeRealCents <= 0 || costeRealCents === sub.costTotalCents) return;

    const diferencia = costeRealCents - sub.costTotalCents;

    await this.prisma.client.supplierOrder.update({
      where: { id: sub.id },
      data: {
        costTotalCents: costeRealCents,
        ...(diferencia > 0 ? { needsReview: true } : {}),
      },
    });

    await this.prisma.client.orderEvent.create({
      data: {
        id: newId(),
        orderId: sub.orderId,
        type: 'supplier.cost_reconciled',
        description:
          `El proveedor ha cobrado ${(costeRealCents / 100).toFixed(2)} € ` +
          `(se esperaban ${(sub.costTotalCents / 100).toFixed(2)} €).`,
        metadata: {
          supplierOrderId: sub.id,
          esperadoCents: sub.costTotalCents,
          realCents: costeRealCents,
          diferenciaCents: diferencia,
        },
      },
    });

    if (diferencia > 0) {
      this.logger.warn(
        `El proveedor ha cobrado ${(costeRealCents / 100).toFixed(2)} € por el sub-pedido ` +
          `${sub.id} y se esperaban ${(sub.costTotalCents / 100).toFixed(2)} €.`,
      );
    }
  }

  private async propagarEstado(
    supplierOrderId: string,
    orderId: string,
    estadoProveedor: string,
  ): Promise<void> {
    const mapa: Record<string, 'SHIPPED' | 'DELIVERED' | 'CANCELLED'> = {
      ENVIADO: 'SHIPPED',
      ENTREGADO: 'DELIVERED',
      CANCELADO: 'CANCELLED',
    };

    const nuevo = mapa[estadoProveedor];
    if (!nuevo) return;

    await this.prisma.client.supplierOrder.update({
      where: { id: supplierOrderId },
      data: {
        status: nuevo,
        ...(nuevo === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
      },
    });

    const hermanos = await this.prisma.client.supplierOrder.findMany({
      where: { orderId },
      select: { status: true },
    });

    const pedido = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: { status: true, number: true, email: true, locale: true, shippingAddress: true },
    });
    if (!pedido) return;

    const todosEntregados = hermanos.every((h) => h.status === 'DELIVERED');
    const algunoEnviado = hermanos.some((h) => h.status === 'SHIPPED' || h.status === 'DELIVERED');

    if (todosEntregados && pedido.status !== 'DELIVERED') {
      await this.orders.cambiarEstado(orderId, 'DELIVERED', { origen: 'sistema' });
      await this.avisarEntrega(orderId);
    } else if (algunoEnviado && pedido.status === 'SENT_TO_SUPPLIER') {
      await this.orders.cambiarEstado(orderId, 'IN_TRANSIT', { origen: 'sistema' });
    }
  }

  private async avisarEnvio(orderId: string, seguimiento: InfoSeguimiento): Promise<void> {
    const pedido = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: { number: true, email: true, locale: true, shippingAddress: true },
    });
    if (!pedido) return;

    const direccion = pedido.shippingAddress as Record<string, string | undefined>;

    await this.prisma.client.orderEvent.create({
      data: {
        id: newId(),
        orderId,
        type: 'order.shipped',
        description: `Envío en camino · ${seguimiento.carrier} ${seguimiento.trackingNumber}`,
        actorType: 'system',
      },
    });

    void this.mail
      .pedidoEnviado({
        email: pedido.email,
        nombre: direccion['firstName'] ?? null,
        numero: pedido.number,
        transportista: seguimiento.carrier,
        seguimiento: seguimiento.trackingNumber,
        urlSeguimiento: seguimiento.trackingUrl ?? '',
        locale: pedido.locale,
      })
      .catch(() => {
        // El aviso es importante pero no crítico: el cliente puede consultar
        // el seguimiento desde su cuenta igualmente.
      });
  }

  private async avisarEntrega(orderId: string): Promise<void> {
    const pedido = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: { number: true, email: true, locale: true, shippingAddress: true },
    });
    if (!pedido) return;

    const direccion = pedido.shippingAddress as Record<string, string | undefined>;

    void this.mail
      .pedidoEntregado({
        email: pedido.email,
        nombre: direccion['firstName'] ?? null,
        numero: pedido.number,
        locale: pedido.locale,
      })
      .catch(() => undefined);
  }

  /**
   * Anota a mano el seguimiento de una compra al proveedor.
   *
   * Es lo que cierra el círculo con un proveedor SIN API. Dreamlove no tiene
   * endpoint que consultar: quien compra en su web copia el transportista y el
   * número, y hasta que eso no entra aquí no pasa nada de lo que tiene que
   * pasar —el cliente no recibe el aviso de envío, el pedido no avanza a «en
   * tránsito» y el paquete acaba apareciendo semanas después en la lista de
   * envíos parados—.
   *
   * Hace exactamente lo mismo que la vía automática: guardar, avisar al cliente
   * y propagar el estado. Que el dato lo haya escrito una persona en vez de
   * llegar por API no cambia nada de lo que viene después.
   */
  async registrarAMano(
    supplierOrderId: string,
    datos: { transportista: string; numero: string; url?: string; avisarCliente?: boolean },
    ctx: ContextoActor = {},
  ): Promise<{ ok: boolean; mensaje: string; url: string | null }> {
    const sub = await this.prisma.client.supplierOrder.findUnique({
      where: { id: supplierOrderId },
    });
    if (!sub) throw new NotFoundException('Sub-pedido no encontrado');

    if (sub.status === 'CANCELLED') {
      throw new BadRequestException('Este sub-pedido está cancelado: no se le puede anotar envío.');
    }

    const numero = datos.numero.trim();
    const transportista = nombreDeTransportista(datos.transportista);

    // El enlace se genera si no lo dan: es lo que va dentro del correo del
    // cliente, y un número suelto no le sirve de nada.
    const url = datos.url?.trim() || enlaceDeSeguimiento(transportista, numero);

    const esNuevo = sub.trackingNumber !== numero;

    await this.prisma.client.supplierOrder.update({
      where: { id: supplierOrderId },
      data: {
        status: 'SHIPPED',
        trackingCarrier: transportista,
        trackingNumber: numero,
        trackingUrl: url,
        trackingStatus: 'ANOTADO_A_MANO',
        // Solo la primera vez: corregir una errata en el número no debe
        // reescribir la fecha de envío ni volver a avisar al cliente.
        ...(esNuevo ? { shippedAt: new Date() } : {}),
      },
    });

    await this.prisma.client.orderEvent.create({
      data: {
        id: newId(),
        orderId: sub.orderId,
        type: 'supplier_order.tracking_manual',
        description: `Seguimiento anotado a mano · ${transportista} ${numero}`,
        actorType: 'staff',
        actorId: ctx.actorId ?? null,
        metadata: { supplierOrderId, transportista, numero, url },
      },
    });

    await this.audit.registrar({
      action: 'supplier_order.tracking_manual',
      resource: 'supplier_order',
      resourceId: supplierOrderId,
      ...(ctx.actorId ? { actorId: ctx.actorId } : {}),
      ...(ctx.actorIp ? { actorIp: ctx.actorIp } : {}),
      after: { orderId: sub.orderId, transportista, numero },
    });

    // El aviso solo cuando el número es nuevo: con una corrección, el cliente
    // recibiría dos veces el mismo correo de «tu pedido va en camino».
    if (esNuevo && datos.avisarCliente !== false) {
      await this.avisarEnvio(sub.orderId, {
        carrier: transportista,
        trackingNumber: numero,
        ...(url ? { trackingUrl: url } : {}),
      });
    }

    /*
     * Se da de alta en el seguimiento automático, si está configurado.
     *
     * Aquí y no en el repaso periódico porque dar de alta un número gasta
     * cuota una sola vez y a partir de ahí consultarlo es gratis. Hacerlo al
     * anotarlo significa una llamada por envío; hacerlo en el repaso
     * significaría comprobar en cada vuelta si ya estaba dado de alta.
     *
     * Solo cuando el número es nuevo: corregir una errata no vuelve a gastar.
     * Y no se espera al resultado para responder —está fuera del `await` de lo
     * importante— porque un fallo suyo no puede impedir que se guarde el
     * seguimiento ni que salga el correo del cliente.
     */
    if (esNuevo) {
      const pedido = await this.prisma.client.order.findUnique({
        where: { id: sub.orderId },
        select: { number: true },
      });
      await this.transportistas.registrar(numero, transportista, pedido?.number);
    }

    // Y el pedido avanza igual que si lo hubiera dicho el proveedor: en cuanto
    // uno de sus envíos sale, está en tránsito.
    await this.propagarEstado(supplierOrderId, sub.orderId, 'ENVIADO');

    return {
      ok: true,
      mensaje: esNuevo
        ? `Envío anotado: ${transportista} ${numero}`
        : `Seguimiento actualizado: ${transportista} ${numero}`,
      url,
    };
  }

  /** Seguimiento visible para el cliente, sin datos internos del proveedor. */
  async paraCliente(orderId: string) {
    const subs = await this.prisma.client.supplierOrder.findMany({
      where: { orderId, trackingNumber: { not: null } },
      select: {
        trackingCarrier: true,
        trackingNumber: true,
        trackingUrl: true,
        trackingStatus: true,
        trackingEvents: true,
        shippedAt: true,
        deliveredAt: true,
      },
    });

    return subs.map((s) => ({
      transportista: s.trackingCarrier,
      numero: s.trackingNumber,
      url: s.trackingUrl,
      estado: s.trackingStatus,
      eventos: s.trackingEvents,
      enviadoEn: s.shippedAt,
      entregadoEn: s.deliveredAt,
    }));
  }

  /**
   * Envíos que llevan demasiado tiempo sin novedades.
   *
   * Un paquete parado tres semanas suele estar perdido. Detectarlo antes de que
   * el cliente reclame permite adelantarse: reenviar o reembolsar por iniciativa
   * propia cuesta mucho menos que una disputa.
   */
  async posiblesPerdidos(diasUmbral = 21) {
    const limite = new Date(Date.now() - diasUmbral * 86_400_000);

    const parados = await this.prisma.client.supplierOrder.findMany({
      where: { status: 'SHIPPED', shippedAt: { lt: limite } },
      include: { supplier: { select: { name: true } } },
    });

    const orderIds = [...new Set(parados.map((p) => p.orderId))];
    const pedidos = await this.prisma.client.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, number: true, email: true, totalCents: true },
    });

    return parados.map((p) => {
      const pedido = pedidos.find((o) => o.id === p.orderId);
      const dias = p.shippedAt ? Math.floor((Date.now() - p.shippedAt.getTime()) / 86_400_000) : 0;

      return {
        supplierOrderId: p.id,
        orderId: p.orderId,
        numeroPedido: pedido?.number ?? '—',
        cliente: pedido?.email ?? '—',
        proveedor: p.supplier.name,
        seguimiento: p.trackingNumber,
        ultimoEstado: p.trackingStatus,
        diasEnTransito: dias,
        importeCents: pedido?.totalCents ?? 0,
      };
    });
  }
}
