import { Injectable, Logger } from '@nestjs/common';
import {
  ErrorProveedor,
  type DireccionEnvio,
  type EstadoProducto,
  type LineaPedidoProveedor,
} from '@ecom/suppliers';
import { idempotencyKey, newId } from '@ecom/shared';
import type { Prisma } from '@ecom/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { estadoDeVariante } from '../suppliers/estado-de-variante.js';
import { RiesgoService } from './riesgo.service.js';
import { OutboxService } from '../queue/outbox.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import { OrdersService } from './orders.service.js';
import { elegirEnlace } from './eleccion-proveedor.js';

interface GrupoProveedor {
  supplierId: string;
  supplierName: string;
  lineas: (LineaPedidoProveedor & { orderItemId: string })[];
  costeTotalCents: number;
}

/** Una línea de la lista de la compra de un proveedor que se pide a mano. */
export interface LineaDeCompra {
  referencia: string;
  /** El código con el que se busca en la web del proveedor: «D-237595». */
  codigo: string;
  titulo: string;
  url: string | null;
  cantidad: number;
  costeUnitarioCents: number;
  disponible: boolean;
  stock: number;
}

/**
 * Las líneas guardadas al enviar el sub-pedido, ya con forma utilizable.
 *
 * Se comprueba campo a campo en vez de confiar en el tipo: lo que hay en la
 * columna es JSON escrito por una versión anterior del código, y dar por hecha
 * su forma es cómo un pedido antiguo tumba la pantalla de incidencias.
 */
function lineasDe(instantanea: Prisma.JsonValue): LineaPedidoProveedor[] {
  if (!Array.isArray(instantanea)) return [];

  const lineas: LineaPedidoProveedor[] = [];

  for (const cruda of instantanea) {
    if (typeof cruda !== 'object' || cruda === null || Array.isArray(cruda)) continue;

    const campos = cruda as Record<string, unknown>;
    if (typeof campos['externalProductId'] !== 'string') continue;

    lineas.push({
      externalProductId: campos['externalProductId'],
      ...(typeof campos['externalVariantId'] === 'string'
        ? { externalVariantId: campos['externalVariantId'] }
        : {}),
      quantity: typeof campos['quantity'] === 'number' ? campos['quantity'] : 1,
      expectedCostCents:
        typeof campos['expectedCostCents'] === 'number' ? campos['expectedCostCents'] : 0,
    });
  }

  return lineas;
}

/**
 * Envío de pedidos a los proveedores.
 *
 * Es la parte del sistema donde más fácil se pierde dinero, y donde los fallos
 * son más caros de deshacer: un pedido duplicado son dos paquetes pagados y una
 * devolución; un pedido no enviado es un cliente que pagó y no recibe nada.
 *
 * Tres garantías que sostienen todo lo demás:
 *
 *  1. **Idempotencia.** La clave se deriva del pedido y del proveedor, así que
 *     es siempre la misma. Un reintento tras un timeout devuelve el pedido ya
 *     creado en lugar de crear otro.
 *
 *  2. **Verificación de coste antes de comprar.** Si el proveedor ha subido el
 *     precio desde que el cliente pagó, no se compra automáticamente: pasa a
 *     revisión. Comprar por encima del margen es vender a pérdida sin enterarse.
 *
 *  3. **Nada se envía sin cobro confirmado.** Lo garantiza la máquina de
 *     estados, pero se vuelve a comprobar aquí por si acaso.
 */
@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  /** Margen de tolerancia a subidas de coste antes de exigir revisión. */
  private readonly TOLERANCIA_SUBIDA_PCT = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly suppliers: SuppliersService,
    private readonly orders: OrdersService,
    private readonly outbox: OutboxService,
    private readonly riesgo: RiesgoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Procesa un pedido pagado: lo reparte entre proveedores y lo envía.
   * Lo invoca el worker al consumir el evento `order.paid`.
   */
  async procesar(orderId: string): Promise<{
    enviados: number;
    fallidos: number;
    requierenRevision: number;
  }> {
    const pedido = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!pedido) {
      throw new Error(`El pedido ${orderId} no existe`);
    }

    // Doble comprobación: la máquina de estados ya lo impide, pero este es el
    // punto donde se gasta dinero real y conviene ser paranoico.
    if (pedido.paymentStatus !== 'PAID') {
      throw new Error(
        `El pedido ${pedido.number} no está pagado (${pedido.paymentStatus}); no se envía al proveedor.`,
      );
    }

    /*
     * El control de riesgo, justo aquí y no antes.
     *
     * Es el punto exacto donde el fraude deja de ser una venta perdida y pasa
     * a ser una pérdida real: a partir de esta línea se compra mercancía al
     * proveedor con dinero nuestro. Reteniendo el envío —y no el cobro— un
     * falso positivo solo retrasa un pedido bueno unas horas, mientras que
     * dejarlo pasar cuesta el producto, el porte y el contracargo.
     */
    const riesgo = await this.riesgo.puedeEnviarse(orderId);
    if (!riesgo.puede) {
      await this.marcarIncidencia(orderId, riesgo.motivo ?? 'Retenido por el control de riesgo');
      this.logger.warn(`${pedido.number} no se envía al proveedor: ${riesgo.motivo ?? ''}`);
      return { enviados: 0, fallidos: 0, requierenRevision: 1 };
    }

    const grupos = await this.agruparPorProveedor(pedido.items);

    if (grupos.length === 0) {
      await this.marcarIncidencia(
        orderId,
        'Ninguna línea del pedido tiene proveedor asignado. Revisa el mapeo del catálogo.',
      );
      return { enviados: 0, fallidos: 1, requierenRevision: 1 };
    }

    if (pedido.status === 'PAID') {
      await this.orders.cambiarEstado(orderId, 'PREPARING', { origen: 'sistema' });
    }

    const envio = this.direccionDesde(pedido.shippingAddress, pedido.email, pedido.phone);

    let enviados = 0;
    let fallidos = 0;
    let requierenRevision = 0;
    let manuales = 0;

    for (const grupo of grupos) {
      const resultado = await this.enviarAProveedor(pedido.id, pedido.number, grupo, envio);
      if (resultado === 'enviado') enviados++;
      else if (resultado === 'manual') {
        // No es un fallo: es un proveedor que se compra a mano. Se cuenta en
        // revisión porque necesita a una persona, pero no en `fallidos`, que
        // es lo que dispara los avisos de «algo ha ido mal».
        manuales++;
        requierenRevision++;
      } else if (resultado === 'revision') {
        requierenRevision++;
        fallidos++;
      } else fallidos++;
    }

    // Solo se avanza si TODOS los sub-pedidos salieron: uno pendiente significa
    // que el cliente no va a recibir el pedido completo. Una compra manual
    // pendiente cuenta igual —la mercancía aún no está comprada—, pero se dice
    // de otra forma porque lo que toca es distinto: no revisar un error, sino
    // entrar en la web del proveedor y comprar.
    if (fallidos === 0 && manuales === 0) {
      await this.orders.cambiarEstado(orderId, 'SENT_TO_SUPPLIER', { origen: 'sistema' });
      this.logger.log(`Pedido ${pedido.number} enviado a ${enviados} proveedor(es)`);
    } else if (fallidos === 0) {
      /*
       * Pendiente de comprar a mano NO es un pedido fallido.
       *
       * Marcarlo como tal era lo cómodo —ya existía el camino— y habría sido
       * un error caro: con un proveedor sin API, TODOS los pedidos nacerían
       * fallidos. El tablero se llenaría de rojo, las métricas de incidencias
       * dejarían de significar nada y el fallo de verdad, el que sí hay que
       * mirar, quedaría escondido entre veinte que no lo son.
       *
       * Se queda en PREPARANDO, que es lo que es —el pedido está en curso—, y
       * lo que hay que hacer aparece en la cola de compras del panel.
       */
      await this.registrarEvento(
        orderId,
        'order.awaiting_manual_purchase',
        `Queda(n) ${manuales} compra(s) por hacer a mano en el proveedor`,
      );
      this.logger.log(
        `Pedido ${pedido.number}: ${manuales} compra(s) pendiente(s) de hacer a mano`,
      );
    } else {
      await this.marcarIncidencia(
        orderId,
        `${fallidos} de ${grupos.length} sub-pedido(s) no se han podido enviar`,
      );
    }

    return { enviados, fallidos, requierenRevision };
  }

  /**
   * Reparte las líneas entre proveedores.
   *
   * Quién sirve cada línea lo decide `elegirEnlace`, compartido con el cálculo
   * del IVA: los dos tienen que llegar a la misma conclusión o la factura dirá
   * que la mercancía salió de un sitio del que no salió.
   */
  private async agruparPorProveedor(
    items: { id: string; variantId: string | null; quantity: number; unitCostCents: number }[],
  ): Promise<GrupoProveedor[]> {
    const variantIds = items.map((i) => i.variantId).filter((v): v is string => v !== null);

    const enlaces = await this.prisma.client.supplierProduct.findMany({
      where: {
        variantId: { in: variantIds },
        available: true,
        discontinued: false,
        supplier: { isActive: true, deletedAt: null },
      },
      include: { supplier: { select: { id: true, name: true, priority: true } } },
    });

    const porProveedor = new Map<string, GrupoProveedor>();

    for (const item of items) {
      if (!item.variantId) continue;

      const elegido = elegirEnlace(enlaces, item.variantId, item.quantity);
      if (!elegido) {
        this.logger.warn(
          `La línea ${item.id} no tiene proveedor con stock suficiente (${item.quantity} uds)`,
        );
        continue;
      }

      const grupo = porProveedor.get(elegido.supplierId) ?? {
        supplierId: elegido.supplierId,
        supplierName: elegido.supplier.name,
        lineas: [],
        costeTotalCents: 0,
      };

      grupo.lineas.push({
        orderItemId: item.id,
        externalProductId: elegido.externalProductId,
        ...(elegido.externalVariantId ? { externalVariantId: elegido.externalVariantId } : {}),
        quantity: item.quantity,
        expectedCostCents: elegido.costCents,
      });
      grupo.costeTotalCents += elegido.costCents * item.quantity;

      porProveedor.set(elegido.supplierId, grupo);
    }

    return [...porProveedor.values()];
  }

  private async enviarAProveedor(
    orderId: string,
    numeroPedido: string,
    grupo: GrupoProveedor,
    envio: DireccionEnvio,
  ): Promise<'enviado' | 'fallido' | 'revision' | 'manual'> {
    // La clave es determinista: mismo pedido + mismo proveedor = misma clave,
    // siempre. Es lo que impide duplicar el pedido en un reintento.
    const clave = idempotencyKey('ord', orderId, 'sup', grupo.supplierId);

    // Si ya existe un sub-pedido con esta clave y salió bien, no se repite.
    const existente = await this.prisma.client.supplierOrder.findUnique({
      where: { idempotencyKey: clave },
    });

    if (existente?.status === 'PLACED' || existente?.status === 'SHIPPED') {
      this.logger.log(
        `El sub-pedido de ${grupo.supplierName} para ${numeroPedido} ya estaba enviado; no se repite`,
      );
      return 'enviado';
    }

    const supplierOrderId = existente?.id ?? newId();

    if (!existente) {
      await this.prisma.client.supplierOrder.create({
        data: {
          id: supplierOrderId,
          supplierId: grupo.supplierId,
          orderId,
          idempotencyKey: clave,
          status: 'PLACING',
          costTotalCents: grupo.costeTotalCents,
          shippingSnapshot: envio as unknown as Prisma.InputJsonValue,
          linesSnapshot: grupo.lineas as unknown as Prisma.InputJsonValue,
        },
      });
    } else {
      await this.prisma.client.supplierOrder.update({
        where: { id: supplierOrderId },
        data: { status: 'PLACING', attempts: { increment: 1 } },
      });
    }

    try {
      const adaptador = await this.suppliers.adaptador(grupo.supplierId);

      // ── Comprobación de coste antes de comprar ──
      const revision = await this.comprobarCoste(adaptador, grupo);
      if (revision) {
        await this.prisma.client.supplierOrder.update({
          where: { id: supplierOrderId },
          data: {
            status: 'FAILED',
            needsReview: true,
            lastError: revision,
            lastErrorType: 'PRECIO_CAMBIADO',
          },
        });
        await this.registrarEvento(orderId, 'supplier_order.needs_review', revision);
        return 'revision';
      }

      /*
       * Proveedores que no reciben pedidos por programa.
       *
       * Dreamlove es el primero: no tiene API, así que comprar es entrar en su
       * web y hacerlo a mano. Se pregunta por la capacidad en vez de intentarlo
       * y ver qué pasa, porque intentarlo deja el sub-pedido marcado como
       * FALLIDO —y con él el pedido entero— cuando no ha fallado nada: es el
       * funcionamiento normal de ese proveedor.
       *
       * Queda en PENDIENTE y marcado para revisión, que es exactamente lo que
       * es: falta comprarlo, y lo tiene que hacer una persona. La cola de
       * incidencias lo enseña con la lista de lo que hay que pedir y sus
       * códigos, y al cerrarlo se anota la referencia como en cualquier otra
       * compra manual.
       */
      if (!adaptador.capacidades.crearPedido) {
        await this.prisma.client.supplierOrder.update({
          where: { id: supplierOrderId },
          data: {
            status: 'PENDING',
            needsReview: true,
            lastErrorType: 'COMPRA_MANUAL',
            lastError: null,
            costTotalCents: grupo.costeTotalCents,
          },
        });

        await this.registrarEvento(
          orderId,
          'supplier_order.manual_purchase_required',
          `${grupo.supplierName} no admite pedidos automáticos: hay que comprarlo en su web`,
        );

        this.logger.log(
          `${numeroPedido}: ${grupo.supplierName} queda pendiente de compra manual ` +
            `(${grupo.lineas.length} línea(s))`,
        );

        return 'manual';
      }

      const respuesta = await adaptador.crearPedido({
        referenciaInterna: numeroPedido,
        idempotencyKey: clave,
        lineas: grupo.lineas,
        envio,
        // Sin publicidad del proveedor en el paquete: el cliente compró en
        // nuestra tienda, no en AliExpress.
        nota: 'Enviar sin factura ni publicidad del proveedor en el paquete',
      });

      await this.prisma.client.supplierOrder.update({
        where: { id: supplierOrderId },
        data: {
          status: 'PLACED',
          externalOrderId: respuesta.externalOrderId,
          costTotalCents: respuesta.costeTotalCents,
          placedAt: new Date(),
          needsReview: false,
          lastError: null,
          ...(respuesta.tracking
            ? {
                trackingCarrier: respuesta.tracking.carrier,
                trackingNumber: respuesta.tracking.trackingNumber,
                trackingUrl: respuesta.tracking.trackingUrl ?? null,
              }
            : {}),
        },
      });

      await this.prisma.client.$transaction(async (tx) => {
        await this.outbox.registrar(tx, {
          eventType: 'supplier_order.placed',
          aggregateType: 'supplier_order',
          aggregateId: supplierOrderId,
          payload: { orderId, supplierOrderId, externalOrderId: respuesta.externalOrderId },
        });
      });

      await this.registrarEvento(
        orderId,
        'supplier_order.placed',
        `Enviado a ${grupo.supplierName} · referencia ${respuesta.externalOrderId}`,
      );

      return 'enviado';
    } catch (error) {
      const esProveedor = error instanceof ErrorProveedor;
      const mensaje = error instanceof Error ? error.message : String(error);
      const tipo = esProveedor ? error.tipo : 'DESCONOCIDO';

      /*
       * Necesita persona TODO lo que no se va a arreglar solo.
       *
       * Antes se preguntaba `requiereIntervencion`, que es una lista corta de
       * problemas conocidos —sin stock, precio cambiado, dirección inválida,
       * credenciales—. Cualquier otro fallo, incluido el rechazo del proveedor
       * sin explicación, se guardaba con `needsReview: false`: el sub-pedido
       * quedaba FALLIDO y **desaparecía de la cola de incidencias**.
       *
       * Eso es el peor estado posible y pasó en producción: un pedido cobrado,
       * sin comprar al proveedor, que no salía en ninguna pantalla. Nadie podía
       * ni reintentarlo, porque no había dónde.
       *
       * La pregunta correcta no es «¿es un problema conocido?» sino «¿va a
       * volver a intentarse solo?». Si no —y un error no reintentable no lo
       * hará— hace falta una persona, sepamos o no qué ha pasado.
       */
      const necesitaPersona = esProveedor ? !error.reintentable : true;

      await this.prisma.client.supplierOrder.update({
        where: { id: supplierOrderId },
        data: {
          status: 'FAILED',
          needsReview: necesitaPersona,
          lastError: mensaje.slice(0, 500),
          lastErrorType: tipo,
        },
      });

      await this.registrarEvento(
        orderId,
        'supplier_order.failed',
        `Fallo al enviar a ${grupo.supplierName}: ${mensaje}`,
      );

      this.logger.error(`Sub-pedido a ${grupo.supplierName} fallido: ${mensaje}`);

      // Los transitorios se relanzan: BullMQ reintentará el trabajo completo.
      if (esProveedor && error.reintentable) throw error;

      return necesitaPersona ? 'revision' : 'fallido';
    }
  }

  /**
   * Comprueba que el coste no ha subido por encima de lo tolerable.
   *
   * Entre que el cliente paga y el worker procesa pueden pasar minutos, y en
   * dropshipping los precios del proveedor cambian solos. Comprar sin mirar
   * significa que un producto vendido con 60% de margen se sirva con un 5%, o
   * directamente a pérdida, y no enterarse hasta cuadrar cuentas.
   */
  private async comprobarCoste(
    adaptador: { consultarEstado: (ids: string[]) => Promise<EstadoProducto[]> },
    grupo: GrupoProveedor,
  ): Promise<string | null> {
    try {
      const ids = [...new Set(grupo.lineas.map((l) => l.externalProductId))];
      const estados = await adaptador.consultarEstado(ids);

      for (const linea of grupo.lineas) {
        const estadoProducto = estados.find((e) => e.externalId === linea.externalProductId);
        if (!estadoProducto) continue;

        /*
         * El estado de LA VARIANTE pedida, no el del producto.
         *
         * Los campos de cabecera de AliExpress llevan el precio y el stock de la
         * primera variante. Comparando contra ellos, un pedido de la variante de
         * 13,99 € se medía contra los 28,39 € de otra y salía una subida del
         * 102 % que no existía: el pedido, cobrado, se quedaba parado en
         * incidencia esperando a que alguien lo mirara.
         */
        const estado = estadoDeVariante(
          { externalVariantId: linea.externalVariantId ?? null },
          estadoProducto,
        );

        const queEs = linea.externalVariantId
          ? `${linea.externalProductId} (variante ${linea.externalVariantId})`
          : linea.externalProductId;

        if (estado.descatalogado) {
          return `El proveedor ha retirado ${queEs} de su catálogo después de cobrar al cliente`;
        }

        if (!estado.disponible) {
          return `El proveedor se ha quedado sin stock de ${queEs} después de cobrar al cliente`;
        }

        const subidaPct =
          linea.expectedCostCents > 0
            ? ((estado.costCents - linea.expectedCostCents) / linea.expectedCostCents) * 100
            : 0;

        if (subidaPct > this.TOLERANCIA_SUBIDA_PCT) {
          return (
            `El coste de ${queEs} ha subido un ${subidaPct.toFixed(1)}% ` +
            `(de ${(linea.expectedCostCents / 100).toFixed(2)} € a ${(estado.costCents / 100).toFixed(2)} €). ` +
            `Revisa si sigue interesando servirlo.`
          );
        }
      }

      return null;
    } catch (error) {
      // Si no se puede comprobar el coste, se sigue adelante: bloquear todos
      // los pedidos porque la consulta de precios falla sería peor que el
      // riesgo de un margen algo menor en alguno.
      this.logger.warn(
        `No se ha podido verificar el coste antes de comprar: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async marcarIncidencia(orderId: string, motivo: string): Promise<void> {
    await this.orders.cambiarEstado(orderId, 'FAILED', { origen: 'sistema', motivo });
    this.logger.error(`Pedido ${orderId} en incidencia: ${motivo}`);
  }

  private async registrarEvento(orderId: string, tipo: string, descripcion: string): Promise<void> {
    await this.prisma.client.orderEvent.create({
      data: { id: newId(), orderId, type: tipo, description: descripcion, actorType: 'system' },
    });
  }

  private direccionDesde(
    almacenada: unknown,
    email: string,
    telefono: string | null,
  ): DireccionEnvio {
    const d = (almacenada ?? {}) as Record<string, string | undefined>;
    return {
      firstName: d['firstName'] ?? '',
      lastName: d['lastName'] ?? '',
      ...(d['company'] ? { company: d['company'] } : {}),
      line1: d['line1'] ?? '',
      ...(d['line2'] ? { line2: d['line2'] } : {}),
      city: d['city'] ?? '',
      province: d['province'] ?? '',
      postalCode: d['postalCode'] ?? '',
      countryCode: d['countryCode'] ?? 'ES',
      ...((d['phone'] ?? telefono) ? { phone: d['phone'] ?? telefono ?? '' } : {}),
      email,
      ...(d['taxId'] ? { taxId: d['taxId'] } : {}),
    };
  }

  // ── Cola de incidencias del admin ─────────────────────────

  /**
   * Sub-pedidos que esperan que una persona decida qué hacer.
   *
   * **Todos los fallidos, no solo los marcados para revisión.** El filtro por
   * `needsReview` dejó fuera un pedido cobrado cuyo sub-pedido había fallado con
   * un error que la marca no contemplaba: quedó FALLIDO, invisible en el panel y
   * sin forma de reintentarlo, porque el botón vive en esta lista.
   *
   * Un sub-pedido fallido significa siempre lo mismo: alguien pagó y su
   * mercancía no se ha comprado. Que además tengamos clasificado el motivo no
   * cambia eso. Si el fallo era pasajero y la cola lo reintenta con éxito, la
   * fila deja de estar fallida y desaparece de aquí sola; ver una tarjeta un par
   * de minutos de más no cuesta nada, y no verla cuesta un cliente.
   */
  async incidencias() {
    const pendientes = await this.prisma.client.supplierOrder.findMany({
      where: {
        OR: [
          { status: 'FAILED' },
          /*
           * Y las compras que hay que hacer a mano.
           *
           * No han fallado —el proveedor no tiene API y nunca las iba a
           * recibir—, pero están igual de paradas: alguien pagó y su mercancía
           * no está comprada. Si no salieran aquí, un pedido de Dreamlove se
           * quedaría esperando para siempre sin aparecer en ninguna pantalla.
           */
          { status: 'PENDING', needsReview: true },
        ],
      },
      include: { supplier: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const orderIds = [...new Set(pendientes.map((p) => p.orderId))];
    const pedidos = await this.prisma.client.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, number: true, email: true, totalCents: true, createdAt: true },
    });

    const compras = await this.listasDeCompra(pendientes);

    return pendientes.map((p) => {
      const pedido = pedidos.find((o) => o.id === p.orderId);
      const esManual = p.lastErrorType === 'COMPRA_MANUAL';

      return {
        supplierOrderId: p.id,
        orderId: p.orderId,
        numeroPedido: pedido?.number ?? '—',
        cliente: pedido?.email ?? '—',
        proveedor: p.supplier.name,
        /**
         * Qué clase de tarjeta es.
         *
         * La pantalla las pinta distinto porque son cosas distintas: una es un
         * error que hay que investigar y la otra es un recado. Mezcladas, el
         * trabajo rutinario de cada día parece una avería.
         */
        tipo: esManual ? ('compra_manual' as const) : ('incidencia' as const),
        error: p.lastError,
        tipoError: p.lastErrorType,
        intentos: p.attempts,
        costeCents: p.costTotalCents,
        desde: p.createdAt,
        // Qué hay que comprar exactamente, con los códigos del proveedor.
        ...(esManual ? { compra: compras.get(p.id) ?? [] } : {}),
        // Sugerencia de qué hacer, según el tipo de error.
        accionSugerida: this.accionSugerida(p.lastErrorType),
      };
    });
  }

  /**
   * Qué hay que comprarle a cada proveedor, en su idioma.
   *
   * Las líneas guardadas llevan nuestros identificadores del proveedor, que no
   * son lo que se teclea en su web: allí se busca por el código «D-237595» o se
   * entra directamente por la URL de la ficha. Traerlo aquí es la diferencia
   * entre copiar y pegar tres campos y buscar a mano cada color en un catálogo
   * de 12.913 artículos.
   */
  private async listasDeCompra(
    subPedidos: { id: string; supplierId: string; linesSnapshot: Prisma.JsonValue }[],
  ): Promise<Map<string, LineaDeCompra[]>> {
    const manuales = subPedidos.filter((s) => Array.isArray(s.linesSnapshot));
    if (manuales.length === 0) return new Map();

    const referencias = new Set<string>();
    for (const sub of manuales) {
      for (const linea of lineasDe(sub.linesSnapshot)) {
        referencias.add(linea.externalVariantId ?? linea.externalProductId);
      }
    }

    const articulos = await this.prisma.client.supplierCatalogItem.findMany({
      where: {
        supplierId: { in: [...new Set(manuales.map((s) => s.supplierId))] },
        externalId: { in: [...referencias] },
      },
      select: {
        externalId: true,
        code: true,
        title: true,
        supplierUrl: true,
        stock: true,
        available: true,
        costCents: true,
      },
    });
    const porId = new Map(articulos.map((a) => [a.externalId, a]));

    const salida = new Map<string, LineaDeCompra[]>();
    for (const sub of manuales) {
      salida.set(
        sub.id,
        lineasDe(sub.linesSnapshot).map((linea) => {
          const referencia = linea.externalVariantId ?? linea.externalProductId;
          const articulo = porId.get(referencia);

          return {
            referencia,
            // El código del proveedor si lo tenemos; si su catálogo ya no lo
            // trae, al menos el identificador con el que se compró.
            codigo: articulo?.code ?? referencia,
            titulo: articulo?.title ?? '(no está en el catálogo actual)',
            url: articulo?.supplierUrl ?? null,
            cantidad: linea.quantity,
            costeUnitarioCents: linea.expectedCostCents,
            // Para avisar antes de entrar en su web: si ya no hay stock, lo
            // que toca no es comprar sino hablar con el cliente.
            disponible: articulo?.available ?? false,
            stock: articulo?.stock ?? 0,
          };
        }),
      );
    }

    return salida;
  }

  private accionSugerida(tipoError: string | null): string {
    const sugerencias: Record<string, string> = {
      COMPRA_MANUAL:
        'Este proveedor no tiene API: entra en su web, compra los artículos de la lista y ' +
        'anota aquí la referencia de su pedido.',
      SIN_STOCK: 'Buscar otro proveedor para esa línea, o cancelar y reembolsar al cliente.',
      PRECIO_CAMBIADO:
        'Decidir si se sirve asumiendo menos margen, o se cancela y se reembolsa explicando el motivo.',
      DIRECCION_INVALIDA: 'Contactar con el cliente para corregir la dirección de envío.',
      CREDENCIALES: 'Renovar las credenciales del proveedor en Ajustes → Proveedores.',
      NO_ENCONTRADO: 'El producto ya no existe en el proveedor: despublicarlo y reembolsar.',
      /*
       * Esta entra por el seguimiento del transportista, no por la compra, y
       * necesita decirlo claro: la mercancía YA está comprada y pagada.
       *
       * Sin esta línea caía en el texto genérico —«revisar el error y
       * reintentar manualmente»— y ahí «reintentar» significa volver a comprar
       * al proveedor. Un paquete retenido en aduana no se arregla comprando
       * otro: se arregla hablando con el transportista.
       */
      INCIDENCIA_TRANSPORTE:
        'El paquete ya salió: lo que falla es la entrega (aduana, dirección o un intento ' +
        'fallido). Mira el detalle del seguimiento y habla con el transportista o con el ' +
        'cliente. NO reintentes la compra: la mercancía ya está pagada.',
    };
    return sugerencias[tipoError ?? ''] ?? 'Revisar el error y reintentar manualmente.';
  }

  /**
   * Reintenta un sub-pedido tras resolver la incidencia.
   *
   * Queda en el registro de auditoría porque a partir de aquí se vuelve a
   * comprar mercancía con dinero real: si acaban saliendo dos paquetes del mismo
   * pedido, lo primero que hay que poder responder es quién le dio a reintentar
   * y cuándo. La clave de idempotencia lo impide, pero un registro no sobra
   * justo donde el error cuesta dinero.
   */
  async reintentar(
    supplierOrderId: string,
    ctx?: ContextoActor,
  ): Promise<{ ok: boolean; mensaje: string }> {
    const sub = await this.prisma.client.supplierOrder.findUnique({
      where: { id: supplierOrderId },
    });
    if (!sub) return { ok: false, mensaje: 'Sub-pedido no encontrado' };

    await this.prisma.client.supplierOrder.update({
      where: { id: supplierOrderId },
      data: { status: 'PENDING', needsReview: false, lastError: null },
    });

    await this.audit.registrar({
      action: 'supplier_order.retried',
      resource: 'supplier_order',
      resourceId: supplierOrderId,
      ...(ctx?.actorId ? { actorId: ctx.actorId } : {}),
      ...(ctx?.actorIp ? { actorIp: ctx.actorIp } : {}),
      metadata: {
        orderId: sub.orderId,
        intentosPrevios: sub.attempts,
        errorPrevio: sub.lastErrorType,
      },
    });

    const resultado = await this.procesar(sub.orderId);
    return {
      ok: resultado.fallidos === 0,
      mensaje:
        resultado.fallidos === 0
          ? 'Reenviado correctamente'
          : `Sigue fallando: ${resultado.fallidos} sub-pedido(s)`,
    };
  }

  /**
   * Cierra la incidencia porque la compra se ha hecho a mano.
   *
   * Es lo que ocurre de verdad en dropshipping cuando el pedido automático no
   * sale: alguien entra en la web del proveedor y lo compra. Sin esta acción, la
   * incidencia se queda abierta para siempre y el pedido nunca avanza —el
   * cliente pagó, la mercancía va en camino, y en el panel sigue como fallido—.
   *
   * Se pide la **referencia del proveedor** y no es opcional: es lo que permite
   * seguir el paquete después y lo único que distingue «lo compré» de «creo que
   * lo compré». Queda en la auditoría porque a partir de aquí el sistema da por
   * hecho que hay mercancía pagada.
   */
  async resolverAMano(
    supplierOrderId: string,
    datos: { referencia: string; nota?: string },
    ctx: ContextoActor,
  ): Promise<{ ok: boolean; mensaje: string }> {
    const sub = await this.prisma.client.supplierOrder.findUnique({
      where: { id: supplierOrderId },
    });
    if (!sub) return { ok: false, mensaje: 'Sub-pedido no encontrado' };

    if (sub.status === 'PLACED' || sub.status === 'SHIPPED' || sub.status === 'DELIVERED') {
      return { ok: false, mensaje: 'Este sub-pedido ya estaba colocado en el proveedor' };
    }

    await this.prisma.client.supplierOrder.update({
      where: { id: supplierOrderId },
      data: {
        status: 'PLACED',
        needsReview: false,
        lastError: null,
        externalOrderId: datos.referencia,
        placedAt: new Date(),
      },
    });

    await this.prisma.client.orderEvent.create({
      data: {
        id: newId(),
        orderId: sub.orderId,
        type: 'supplier_order.resolved_manually',
        description:
          `Comprado a mano en el proveedor (referencia ${datos.referencia})` +
          (datos.nota ? `: ${datos.nota}` : ''),
        actorType: 'staff',
        actorId: ctx.actorId ?? null,
        metadata: { supplierOrderId, referencia: datos.referencia },
      },
    });

    await this.audit.registrar({
      action: 'supplier_order.resolved_manually',
      resource: 'supplier_order',
      resourceId: supplierOrderId,
      ...(ctx.actorId ? { actorId: ctx.actorId } : {}),
      ...(ctx.actorIp ? { actorIp: ctx.actorIp } : {}),
      metadata: { orderId: sub.orderId, referencia: datos.referencia, errorPrevio: sub.lastError },
    });

    // El pedido avanza solo si ya no queda ningún sub-pedido pendiente: con dos
    // proveedores, uno resuelto a mano no significa que el otro haya salido.
    const pendientes = await this.prisma.client.supplierOrder.count({
      where: { orderId: sub.orderId, status: { in: ['PENDING', 'PLACING', 'FAILED'] } },
    });

    if (pendientes === 0) {
      await this.orders
        .cambiarEstado(sub.orderId, 'SENT_TO_SUPPLIER', {
          origen: 'sistema',
          motivo: `Compra hecha a mano (${datos.referencia})`,
          ...(ctx.actorId ? { actorId: ctx.actorId } : {}),
        })
        .catch((error: unknown) => {
          // Que el pedido no pueda avanzar de estado no puede deshacer una
          // compra que ya está hecha: se avisa y se deja la incidencia cerrada.
          this.logger.error(
            `Sub-pedido ${supplierOrderId} resuelto a mano pero el pedido no ha avanzado: ` +
              (error instanceof Error ? error.message : String(error)),
          );
        });
    }

    return {
      ok: true,
      mensaje:
        pendientes === 0
          ? 'Incidencia cerrada y pedido marcado como enviado al proveedor'
          : 'Incidencia cerrada; el pedido sigue esperando a otro proveedor',
    };
  }
}
