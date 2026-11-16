import crypto from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OrderStatus, Prisma } from '@ecom/db';
import { allocate, formatOrderNumber, newId, type Locale, texto } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  decidirIvaDelPedido,
  estadoDelUmbral,
  exigeNetificar,
  necesitaRevisionDeTipo,
  tipoAplicable,
  UMBRAL_OSS_CENTS,
  type DecisionIva,
  type DecisionPedido,
} from './iva-transfronterizo.js';
import {
  baseImponible,
  desglosarIva,
  netificarAccesorioParcial,
  tipoPredominante,
  type LineaImponible,
} from './calculo-iva.js';
import { elegirEnlace } from './eleccion-proveedor.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../queue/outbox.service.js';
import { InventoryService } from '../catalog/services/inventory.service.js';
import { MailService } from '../mail/mail.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { ShippingService } from '../shipping/shipping.service.js';
import { CartService } from '../cart/cart.service.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import { CouponsService } from '../coupons/coupons.service.js';
import { ReferidosService } from '../coupons/referidos.service.js';
import { ExperimentsService } from '../experiments/experiments.service.js';
import { ChannelsService } from '../channels/channels.service.js';
import { marcar } from '../../common/trazas.js';
import {
  ESTADOS_KANBAN,
  ETIQUETAS,
  destinosManuales,
  exigirTransicionValida,
} from './order-state-machine.js';
import {
  hayDineroCobrado,
  motivoNoCancelable,
  planDeCancelacion,
  puedeCambiarDireccion,
} from './cancelacion.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { RiesgoService } from './riesgo.service.js';
import { estadoPublico, historialPublico, TIPOS_PUBLICOS } from './historial-publico.js';

export interface LineaCarrito {
  variantId: string;
  quantity: number;
}

export interface DatosPedido {
  email: string;
  phone?: string;
  locale?: Locale;
  userId?: string;
  lineas: LineaCarrito[];
  shippingAddress: Record<string, unknown>;
  billingAddress?: Record<string, unknown>;
  customerNote?: string;
  /** Tarifa de envío elegida en el checkout. Su precio se recalcula aquí. */
  shippingRateId?: string;
  /** Código de cupón. El descuento se calcula en el servidor, nunca se acepta. */
  couponCode?: string;
  /** Código de invitación; no descuenta en este pedido, premia al cobrarlo. */
  referralCode?: string;
  /** Identificador anónimo del navegador, para atribuir las pruebas A/B. */
  visitorId?: string;
  /**
   * De dónde vino quien compra.
   *
   * Se guarda con el pedido y no se recalcula después: el canal que trajo esta
   * venta es el que era en ese momento, aunque esa persona vuelva por otro.
   */
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** La creatividad concreta, cuando el clic vino de una pieza del Studio. */
  utmContent?: string;
  /** IP de quien compra; es una de las señales del control de riesgo. */
  ip?: string;
  /**
   * Segundos entre abrir el checkout y enviarlo.
   *
   * Lo mide la tienda. Es una señal débil a propósito —el autocompletado del
   * navegador rellena en dos segundos— y se usa como apoyo, nunca sola.
   */
  segundosEnElCheckout?: number;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly inventory: InventoryService,
    private readonly mail: MailService,
    private readonly metrics: MetricsService,
    private readonly shipping: ShippingService,
    private readonly cart: CartService,
    private readonly suppliers: SuppliersService,
    private readonly coupons: CouponsService,
    private readonly riesgo: RiesgoService,
    private readonly referidos: ReferidosService,
    private readonly experimentos: ExperimentsService,
    private readonly canales: ChannelsService,
  ) {}

  /**
   * Crea el pedido a partir del carrito.
   *
   * Los precios se recalculan aquí desde la base de datos, nunca se aceptan
   * los que envía el cliente: confiar en un importe que llega del navegador es
   * regalar la tienda a quien edite la petición.
   */
  /**
   * Precio de envío del pedido, siempre recalculado en el servidor.
   *
   * Si no se eligió tarifa se coge la más barata disponible para el destino, en
   * lugar de cobrar cero: un pedido con envío gratis por descuido se sirve
   * pagando nosotros el porte desde China.
   */
  private async resolverEnvio(
    datos: DatosPedido,
    subtotalCents: number,
    pesoGramos: number,
  ): Promise<{ precioCents: number; sinIva: boolean; rateId: string | null }> {
    const direccion = datos.shippingAddress as { countryCode?: string; postalCode?: string };
    const destino = {
      countryCode: texto(direccion.countryCode) || 'ES',
      postalCode: texto(direccion.postalCode),
    };

    if (!destino.postalCode) {
      throw new BadRequestException('Falta el código postal de la dirección de envío');
    }

    if (datos.shippingRateId) {
      const opcion = await this.shipping.precioDe(
        datos.shippingRateId,
        destino,
        subtotalCents,
        pesoGramos,
      );
      return { precioCents: opcion.precioCents, sinIva: opcion.sinIva, rateId: opcion.rateId };
    }

    const { opciones } = await this.shipping.opciones(destino, subtotalCents, pesoGramos);
    const masBarata = opciones[0];

    if (!masBarata) {
      throw new BadRequestException(
        'No hay ninguna opción de envío disponible para esa dirección.',
      );
    }

    return {
      precioCents: masBarata.precioCents,
      sinIva: masBarata.sinIva,
      rateId: masBarata.rateId,
    };
  }

  /** Ajustes que deciden el IVA. Con los valores por defecto: tienda española sin OSS ni IOSS. */
  private async ajustesFiscales(): Promise<{
    paisTienda: string;
    tipoNacional: number;
    tieneIoss: boolean;
    ossDadoDeAlta: boolean;
  }> {
    const ajustes = await this.prisma.client.setting.findMany({
      where: { namespace: { in: ['tax', 'checkout'] } },
      select: { namespace: true, key: true, value: true },
    });

    const valor = (namespace: string, key: string): unknown =>
      ajustes.find((a) => a.namespace === namespace && a.key === key)?.value;

    const pais = valor('tax', 'homeCountry');
    const tipo = valor('checkout', 'defaultTaxRate');

    return {
      paisTienda: typeof pais === 'string' && pais ? pais.toUpperCase() : 'ES',
      tipoNacional: typeof tipo === 'number' ? tipo : 21,
      tieneIoss: valor('tax', 'iossRegistered') === true,
      ossDadoDeAlta: valor('tax', 'ossRegistered') === true,
    };
  }

  /**
   * Régimen de IVA del pedido, envío a envío.
   *
   * Quién sirve cada línea decide desde dónde sale, y desde dónde sale decide
   * el impuesto: la misma camiseta al mismo cliente de Madrid lleva 21 % si
   * viene del almacén y va sin IVA —con aduana a cargo del cliente— si viene de
   * China. Se usa el mismo criterio de elección de proveedor que el
   * fulfillment, para que la factura y el paquete cuenten lo mismo.
   */
  private async regimenDeIva(
    datos: DatosPedido,
    variantes: { id: string; priceCents: number }[],
  ): Promise<{
    decision: DecisionPedido;
    decisionDe: (variantId: string) => DecisionIva;
    paisDestino: string;
    tipoNacional: number;
    ossDadoDeAlta: boolean;
    acumuladoPrevioCents: number;
  }> {
    const direccion = datos.shippingAddress as { countryCode?: string; postalCode?: string };
    const ajustes = await this.ajustesFiscales();
    const acumulado = await this.acumuladoTransfronterizo();

    const enlaces = await this.prisma.client.supplierProduct.findMany({
      where: {
        variantId: { in: datos.lineas.map((l) => l.variantId) },
        available: true,
        discontinued: false,
        supplier: { isActive: true, deletedAt: null },
      },
      include: { supplier: { select: { priority: true, shipsFromCountry: true } } },
    });

    /** De dónde sale cada variante y cuánto vale la mercancía de cada envío. */
    const origenDe = new Map<string, string>();
    const envios = new Map<string, { paisOrigen: string; valorCents: number }>();

    for (const linea of datos.lineas) {
      const variante = variantes.find((v) => v.id === linea.variantId);
      if (!variante) continue;

      const enlace = elegirEnlace(enlaces, linea.variantId, linea.quantity);
      // Sin proveedor con stock sale de nuestro almacén: es lo que hará el
      // fulfillment, que deja la línea en revisión en vez de comprarla fuera.
      const id = enlace?.supplierId ?? 'tienda';
      const paisOrigen = enlace?.supplier.shipsFromCountry ?? ajustes.paisTienda;

      origenDe.set(linea.variantId, id);

      const envio = envios.get(id) ?? { paisOrigen, valorCents: 0 };
      // Solo la mercancía: el límite de 150 € del IOSS mira el valor
      // intrínseco, sin transporte ni seguro.
      envio.valorCents += variante.priceCents * linea.quantity;
      envios.set(id, envio);
    }

    if (envios.size === 0) {
      envios.set('tienda', { paisOrigen: ajustes.paisTienda, valorCents: 0 });
    }

    const paisDestino = (texto(direccion.countryCode) || ajustes.paisTienda).toUpperCase();

    const decision = decidirIvaDelPedido(
      {
        paisDestino,
        codigoPostalDestino: texto(direccion.postalCode),
        acumuladoAnualCents: acumulado,
        tieneIoss: ajustes.tieneIoss,
        tipoNacional: ajustes.tipoNacional,
      },
      [...envios].map(([id, e]) => ({ id, ...e })),
    );

    const porEnvio = new Map(decision.envios.map((e) => [e.id, e.decision]));
    const primera = decision.envios[0]!.decision;

    return {
      decision,
      decisionDe: (variantId) => porEnvio.get(origenDe.get(variantId) ?? '') ?? primera,
      paisDestino,
      tipoNacional: ajustes.tipoNacional,
      ossDadoDeAlta: ajustes.ossDadoDeAlta,
      acumuladoPrevioCents: acumulado,
    };
  }

  /**
   * Avisa cuando este pedido es el que cruza los 10.000 €.
   *
   * Se manda una sola vez, en la operación que lo cruza, y no en cada venta
   * posterior: un aviso que llega en todos los pedidos deja de leerse, y este
   * hay que leerlo. A partir de aquí las ventas a la UE tributan en destino,
   * esté uno dado de alta o no, así que el alta pendiente cuesta dinero.
   */
  private async avisarDelUmbral(
    numero: string,
    regimen: {
      decision: DecisionPedido;
      ossDadoDeAlta: boolean;
      acumuladoPrevioCents: number;
    },
  ): Promise<void> {
    const despues = regimen.acumuladoPrevioCents + regimen.decision.consumeUmbralCents;
    const cruzaAhora =
      regimen.acumuladoPrevioCents <= UMBRAL_OSS_CENTS && despues > UMBRAL_OSS_CENTS;

    if (!cruzaAhora) return;

    const motivo = regimen.ossDadoDeAlta
      ? 'Superado el umbral de 10.000 € en ventas a otros países de la UE. A partir de ahora se ' +
        'repercute el IVA del país del cliente y hay que declararlo en el modelo 369 trimestral.'
      : 'Superado el umbral de 10.000 € en ventas a otros países de la UE y la tienda NO está dada ' +
        'de alta en OSS. Las ventas ya tributan en destino: hasta que se tramite el alta, el IVA ' +
        'repercutido no se puede declarar por la ventanilla única.';

    this.logger.warn(`${numero}: ${motivo}`);
    await this.mail.avisoIncidencia({ numero, motivo });
  }

  async crear(datos: DatosPedido, cartId: string) {
    if (datos.lineas.length === 0) {
      throw new BadRequestException('El pedido no tiene líneas');
    }

    const variantes = await this.prisma.client.productVariant.findMany({
      where: { id: { in: datos.lineas.map((l) => l.variantId) }, deletedAt: null },
      include: {
        product: {
          select: {
            id: true,
            status: true,
            taxRate: true,
            translations: true,
            media: { orderBy: { position: 'asc' }, take: 1 },
          },
        },
        optionValues: { include: { optionValue: true } },
      },
    });

    if (variantes.length !== datos.lineas.length) {
      throw new BadRequestException('Alguna de las variantes no existe o ya no está disponible');
    }

    const inactivos = variantes.filter((v) => v.product.status !== 'ACTIVE');
    if (inactivos.length > 0) {
      throw new BadRequestException(
        `Estos productos ya no están a la venta: ${inactivos.map((v) => v.sku).join(', ')}`,
      );
    }

    // El stock se reserva antes de crear nada: si no hay, el pedido no nace.
    const reserva = await this.inventory.reservar(cartId, datos.lineas);
    if (!reserva.ok) {
      const sinStock = reserva.insuficientes
        .map((i) => {
          const v = variantes.find((x) => x.id === i.variantId);
          return `${v?.sku ?? i.variantId} (quedan ${i.disponible})`;
        })
        .join(', ');
      throw new BadRequestException(`No hay stock suficiente de: ${sinStock}`);
    }

    const locale = datos.locale ?? 'es';

    // El envío se calcula ANTES de abrir la transacción y con datos nuestros:
    // el subtotal sale de los precios de la base y el peso del catálogo. Si se
    // aceptara el importe que manda el navegador, cualquiera pondría 0.
    const subtotalPrevio = datos.lineas.reduce((suma, linea) => {
      const v = variantes.find((x) => x.id === linea.variantId);
      return suma + (v?.priceCents ?? 0) * linea.quantity;
    }, 0);

    const pesoGramos = datos.lineas.reduce((suma, linea) => {
      const v = variantes.find((x) => x.id === linea.variantId);
      return suma + (v?.weightGrams ?? 0) * linea.quantity;
    }, 0);

    const calculoEnvio = await this.resolverEnvio(datos, subtotalPrevio, pesoGramos);

    const orderId = newId();
    let numero = await this.siguienteNumero();
    // 48 bytes: no adivinable ni por fuerza bruta. Es la única llave que
    // tendrá quien compre sin cuenta para consultar su pedido.
    const publicToken = crypto.randomBytes(48).toString('base64url');

    // Qué IVA lleva el pedido: depende del país del cliente, de desde dónde
    // sale cada producto y del umbral de ventas a la UE, no solo del catálogo.
    const regimen = await this.regimenDeIva(datos, variantes);

    // La zona de envío puede marcar el destino como fuera del territorio IVA
    // por su cuenta —por prefijos configurados a mano en el admin— además de
    // por el código postal. Manda la exención: cobrar IVA español donde no toca
    // es un cobro indebido, y no cobrarlo donde sí tocaba se corrige en la
    // liquidación.
    const exentaPorZona = calculoEnvio.sinIva;

    const decisionDe = (variantId: string): DecisionIva => regimen.decisionDe(variantId);

    // Cada producto lleva su propio tipo: un carrito con un libro (4 %) y unas
    // botas (21 %) tiene dos. Netificar todo con el tipo del primer producto
    // cobra de más o de menos sin dar ningún error.
    const tipoDe = (v: { id: string; product: { taxRate: unknown } }): number =>
      exentaPorZona ? 0 : tipoAplicable(decisionDe(v.id), Number(v.product.taxRate));

    // Cuando la línea no puede llevar IVA español —entrega exenta o importación
    // que el cliente despachará en aduana— hay que quitárselo al precio, que lo
    // lleva dentro. Y quitarlo de CADA línea y del porte, no solo del total: si
    // solo se ajustara el total, las líneas no sumarían el total y la factura
    // no cuadraría.
    const netificar = (v: { id: string }): boolean =>
      exentaPorZona || exigeNetificar(decisionDe(v.id).regimen);
    const neto = (conIva: number, tipoCatalogo: number, v: { id: string }): number =>
      netificar(v) ? baseImponible(conIva, tipoCatalogo) : conIva;

    const crearPedido = () =>
      this.prisma.client.$transaction(async (tx) => {
        let subtotal = 0;
        let costeProveedor = 0;
        const items: Prisma.OrderItemCreateManyInput[] = [];
        /** Líneas con su tipo, para desglosar el IVA por tramos. */
        const imponibles: LineaImponible[] = [];
        /**
         * Las mismas líneas con el tipo del CATÁLOGO y si van sin IVA.
         *
         * Hace falta aparte porque para quitarle el IVA al porte hay que saber
         * cuál lleva dentro (el español), no cuál se acaba aplicando: con el
         * aplicado —0 en una línea exenta— no se quitaría nada y el porte se
         * cobraría con IVA español incluido.
         */
        const accesorias: { totalCents: number; tipoCatalogo: number; exenta: boolean }[] = [];
        /** Algún producto con tipo reducido se vende con IVA de destino. */
        let revisarTipo = false;

        for (const linea of datos.lineas) {
          const v = variantes.find((x) => x.id === linea.variantId);
          if (!v) continue;

          const traduccion =
            v.product.translations.find((t) => t.locale === locale) ?? v.product.translations[0];
          const nombreVariante = v.optionValues.map((ov) => ov.optionValue.value).join(' / ');

          const tipoCatalogo = Number(v.product.taxRate);
          const precioUnitario = neto(v.priceCents, tipoCatalogo, v);
          const totalLinea = precioUnitario * linea.quantity;
          subtotal += totalLinea;
          costeProveedor += (v.costCents ?? 0) * linea.quantity;

          // Se guarda con el tipo YA aplicado (0 si la entrega es exenta): es lo
          // que debe salir impreso en la factura, no lo que dice el catálogo.
          imponibles.push({ totalCents: totalLinea, tipo: tipoDe(v) });
          accesorias.push({ totalCents: totalLinea, tipoCatalogo, exenta: netificar(v) });

          // Un producto con reducido español vendido con IVA de destino lleva el
          // tipo general de ese país: puede que allí también tenga reducido, pero
          // eso hay que confirmarlo producto a producto y país a país.
          const regimenLinea = decisionDe(v.id).regimen;
          if (
            (regimenLinea === 'OSS' || regimenLinea === 'IOSS') &&
            necesitaRevisionDeTipo(tipoCatalogo, regimen.tipoNacional)
          ) {
            revisarTipo = true;
          }

          items.push({
            id: newId(),
            orderId,
            productId: v.product.id,
            variantId: v.id,
            // Nombre, imagen y precio se congelan: la factura no puede cambiar
            // porque alguien edite el catálogo tres meses después.
            sku: v.sku,
            name: traduccion?.name ?? v.sku,
            variantName: nombreVariante || null,
            imageUrl: v.product.media[0]?.url ?? null,
            quantity: linea.quantity,
            unitPriceCents: precioUnitario,
            unitCostCents: v.costCents ?? 0,
            totalCents: totalLinea,
            // En una entrega exenta el tipo aplicado es 0, no el del catálogo:
            // es lo que tiene que salir impreso en la factura.
            taxRate: tipoDe(v),
          });
        }

        // El descuento lo calcula el servidor desde el cupón: aceptar un importe
        // del navegador sería dejar que el cliente elija cuánto paga.
        let descuentoBruto = 0;
        let envioGratisPorCupon = false;

        if (datos.couponCode) {
          const aplicado = await this.coupons.consumir(
            tx,
            datos.couponCode,
            orderId,
            items.map((i) => ({
              productId: i.productId ?? '',
              categoryId: null,
              totalCents: i.totalCents,
            })),
            subtotal,
            { ...(datos.userId ? { userId: datos.userId } : {}), email: datos.email },
          );

          descuentoBruto = aplicado.descuentoCents;
          envioGratisPorCupon = aplicado.envioGratis;
        }

        // El descuento y el porte no tienen tipo propio: acompañan a la
        // mercancía y siguen el suyo. Con varios tipos hay que repartirlos antes
        // de quitarles el IVA, y si solo parte del pedido va sin IVA solo esa
        // parte se netifica.
        const descuento = netificarAccesorioParcial(descuentoBruto, accesorias);
        const envio = envioGratisPorCupon
          ? 0
          : netificarAccesorioParcial(calculoEnvio.precioCents, accesorias);
        const total = subtotal - descuento + envio;

        /*
         * Control de riesgo, con el importe ya calculado por el servidor.
         *
         * Nunca con el que mande el navegador: el importe es una de las
         * señales, y aceptarlo de fuera permitiría declarar un pedido de un
         * euro para esquivar la revisión y luego cobrar cuatrocientos.
         */
        const riesgo = await this.riesgo.evaluar({
          email: datos.email,
          totalCents: total,
          paisEnvio: texto(datos.shippingAddress['countryCode'], 'ES'),
          ...(datos.billingAddress?.['countryCode']
            ? { paisFacturacion: texto(datos.billingAddress['countryCode']) }
            : {}),
          ...(datos.userId ? { userId: datos.userId } : {}),
          ...(datos.ip ? { ip: datos.ip } : {}),
          ...(datos.segundosEnElCheckout !== undefined
            ? { segundosEnElCheckout: datos.segundosEnElCheckout }
            : {}),
        });

        if (riesgo.decision === 'RECHAZAR') {
          // Se rechaza antes de crear nada. El mensaje es deliberadamente
          // vago: detallar qué señal saltó es enseñarle a quien lo intenta
          // cómo esquivarla la próxima vez.
          throw new BadRequestException(
            'No hemos podido procesar este pedido. Si crees que es un error, escríbenos y lo revisamos.',
          );
        }

        // El IVA va incluido en el precio (obligatorio en España), así que se
        // extrae en lugar de sumarse, tramo a tramo. En una entrega exenta la
        // cuota es cero porque los importes ya vienen netos.
        const todoExento = imponibles.length > 0 && imponibles.every((i) => i.tipo === 0);
        const desglose = desglosarIva(imponibles, envio, descuento, todoExento);
        const iva = desglose.cuotaCents;
        const tipoIva = tipoPredominante(desglose);

        await tx.order.create({
          data: {
            id: orderId,
            number: numero,
            publicToken,
            userId: datos.userId ?? null,
            email: datos.email,
            phone: datos.phone ?? null,
            locale,
            // Solo para atribuir la venta a la variante de la prueba A/B que
            // esa persona vio. No identifica a nadie.
            visitorId: datos.visitorId ?? null,
            utmSource: datos.utmSource ?? null,
            utmMedium: datos.utmMedium ?? null,
            utmCampaign: datos.utmCampaign ?? null,
            utmContent: datos.utmContent ?? null,
            status: 'AWAITING_PAYMENT',
            paymentStatus: 'PENDING',
            subtotalCents: subtotal,
            discountCents: descuento,
            shippingCents: envio,
            taxCents: iva,
            totalCents: total,
            taxBreakdown: desglose.tramos as unknown as Prisma.InputJsonValue,
            supplierCostCents: costeProveedor,
            taxRate: tipoIva,
            // El régimen se congela con el pedido. No se puede recalcular después:
            // depende del umbral acumulado en ese momento, y ese número ya habrá
            // cambiado cuando llegue el trimestre.
            taxRegime: exentaPorZona ? 'EXENTA' : regimen.decision.regimen,
            taxCountry: exentaPorZona ? regimen.paisDestino : regimen.decision.paisRecaudador,
            ...(regimen.decision.avisos.length > 0 ? { taxNotices: regimen.decision.avisos } : {}),
            taxThresholdCents: exentaPorZona ? 0 : regimen.decision.consumeUmbralCents,
            taxNeedsReview: revisarTipo,
            // La decisión de riesgo se congela con el pedido: se calculó con el
            // historial de este instante y recalcularla después daría otro
            // número, así que dejaría de explicar por qué se retuvo.
            riskScore: riesgo.puntuacion,
            riskDecision: riesgo.decision,
            riskReasons: riesgo.motivos as unknown as Prisma.InputJsonValue,
            shippingAddress: datos.shippingAddress as Prisma.InputJsonValue,
            billingAddress: (datos.billingAddress ??
              datos.shippingAddress) as Prisma.InputJsonValue,
            customerNote: datos.customerNote ?? null,
          },
        });

        await tx.orderItem.createMany({ data: items });

        // El teléfono del checkout también rellena la ficha de la cuenta.
        //
        // El pedido ya lo guarda arriba, y esa copia es la que vale para ese
        // envío: congela el número con el que se pidió y no debe cambiar si
        // luego se edita el perfil. Pero quien compra y después entra en «mi
        // cuenta» ve el teléfono vacío, teclea el mismo número otra vez y no
        // entiende por qué no estaba.
        //
        // Solo se rellena si está vacío, con `updateMany` para que la
        // condición viaje en el `where` y no haga falta leer antes. Sobrescribir
        // el del perfil sería peor: un pedido enviado a la dirección del
        // trabajo, con el teléfono de la oficina, cambiaría el de la cuenta sin
        // que nadie lo haya pedido.
        if (datos.userId && datos.phone) {
          await tx.user.updateMany({
            where: { id: datos.userId, OR: [{ phone: null }, { phone: '' }] },
            data: { phone: datos.phone },
          });
        }

        await tx.orderEvent.create({
          data: {
            id: newId(),
            orderId,
            type: 'order.created',
            description: `Pedido creado con ${items.length} línea(s) por ${(total / 100).toFixed(2)} €`,
            actorType: datos.userId ? 'customer' : 'guest',
            actorId: datos.userId ?? null,
          },
        });

        // Por qué este pedido no lleva el IVA español de siempre. Queda en el
        // historial porque es lo primero que se pregunta cuando el asesor mira
        // una factura al 25 % danés o sin cuota ninguna.
        if (!exentaPorZona && regimen.decision.regimen !== 'INTERIOR') {
          await tx.orderEvent.create({
            data: {
              id: newId(),
              orderId,
              type: 'order.tax_regime',
              description: regimen.decision.envios
                .map((e) => e.decision.motivo)
                .filter((m, i, todos) => todos.indexOf(m) === i)
                .join(' '),
              actorType: 'system',
              ...(revisarTipo
                ? {
                    metadata: {
                      revisarTipo: true,
                      aviso:
                        'Hay productos con tipo reducido en España vendidos con el tipo general del ' +
                        'país de destino. Confirma el tipo que les corresponde allí.',
                    },
                  }
                : {}),
            },
          });
        }

        return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
      });

    /**
     * Dos pedidos a la vez pueden pedir el mismo número correlativo.
     *
     * El índice único evita el duplicado, pero sin reintento el segundo cliente
     * ve un error 500 con el pago listo para hacerse: la venta se pierde por
     * una colisión que se resuelve pidiendo el siguiente número.
     */
    const pedido = await this.reintentandoElNumero(crearPedido, () => {
      numero = formatOrderNumber(
        Number(numero.split('-')[2] ?? 0) + 1,
        new Date().getFullYear(),
        'ES',
      );
    });

    this.logger.log(`Pedido ${numero} creado por ${(pedido.totalCents / 100).toFixed(2)} €`);

    // Enterarse tarde de haber cruzado el umbral significa regularizar ventas
    // ya facturadas con un tipo que no era, y esa diferencia sale del margen.
    void this.avisarDelUmbral(numero, regimen).catch((e: unknown) => {
      this.logger.error(`No se pudo avisar del umbral OSS en ${numero}: ${String(e)}`);
    });

    // La invitación se anota ahora y se resuelve al cobrar. Anotarla no premia
    // nada, así que un código equivocado —o repetido— no puede estropear un
    // pedido que ya existe.
    if (datos.referralCode) {
      void this.referidos
        .registrarUso({
          codigo: datos.referralCode,
          emailReferido: datos.email,
          orderId: pedido.id,
          ...(datos.userId ? { referredUserId: datos.userId } : {}),
        })
        .catch((e: unknown) => {
          this.logger.error(`No se pudo anotar el referido de ${numero}: ${String(e)}`);
        });
    }

    // El carrito queda marcado como convertido, no borrado: deja de contar
    // como abandonado —y de recibir el aviso de recuperación— pero se conserva
    // para poder medir la conversión del embudo.
    void this.cart.marcarConvertido(cartId, orderId).catch(() => {
      // Que esto falle no puede tumbar un pedido que ya está creado y cobrado.
    });

    // La confirmación se envía sin bloquear la respuesta: si el servidor de
    // correo tarda tres segundos, el cliente no debe esperarlos mirando una
    // pantalla de carga con el pedido ya creado.
    const direccion = datos.shippingAddress as Record<string, string | undefined>;
    void this.mail
      .confirmacionPedido({
        email: datos.email,
        nombre: direccion['firstName'] ?? null,
        numero,
        token: publicToken,
        lineas: pedido.items.map((i) => ({
          nombre: i.name,
          cantidad: i.quantity,
          totalCents: i.totalCents,
        })),
        totalCents: pedido.totalCents,
        direccion: [
          direccion['line1'],
          direccion['postalCode'],
          direccion['city'],
          direccion['countryCode'],
        ]
          .filter(Boolean)
          .join(', '),
        locale,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `No se ha podido enviar la confirmación de ${numero}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      });

    return pedido;
  }

  /**
   * Marca el pedido como pagado y dispara el fulfillment.
   *
   * El cambio de estado y el evento se escriben en la MISMA transacción: es lo
   * que garantiza que un pedido cobrado siempre acabe enviándose al proveedor,
   * aunque el servidor se caiga justo después de confirmar el pago.
   */
  async marcarPagado(
    orderId: string,
    datos: { paymentId: string; cartId?: string; gatewayFeeCents?: number },
  ) {
    const pedido = await this.exigirPedido(orderId);
    exigirTransicionValida(pedido.status, 'PAID', 'sistema');

    await this.prisma.client.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'PAID',
          paymentStatus: 'PAID',
          paidAt: new Date(),
          ...(datos.gatewayFeeCents !== undefined
            ? { gatewayFeeCents: datos.gatewayFeeCents }
            : {}),
        },
      });

      await tx.orderEvent.create({
        data: {
          id: newId(),
          orderId,
          type: 'order.paid',
          description: 'Pago confirmado',
          actorType: 'system',
          metadata: { paymentId: datos.paymentId },
        },
      });

      // El evento va en la transacción: si algo falla, no queda un pedido
      // pagado con un trabajo de fulfillment encolado sobre datos inexistentes.
      await this.outbox.registrar(tx, {
        eventType: 'order.paid',
        aggregateType: 'order',
        aggregateId: orderId,
        payload: { orderId, paymentId: datos.paymentId },
      });
    });

    // El stock se descuenta de verdad solo cuando el dinero está confirmado.
    if (datos.cartId) {
      const items = await this.prisma.client.orderItem.findMany({
        where: { orderId },
        select: { variantId: true, quantity: true },
      });
      await this.inventory.confirmarVenta(
        datos.cartId,
        orderId,
        items
          .filter((i) => i.variantId)
          .map((i) => ({ variantId: i.variantId!, quantity: i.quantity })),
      );
    }

    // La conversión de las pruebas A/B se anota al cobrar, no al crear: un
    // pedido sin pagar no es una venta, y contarlo como tal haría ganar a la
    // variante que más carritos abandonados produce.
    if (pedido.visitorId) {
      await this.experimentos
        .registrarConversion(pedido.visitorId, orderId, pedido.totalCents)
        .catch((error: unknown) => {
          this.logger.error(
            `No se pudo atribuir la conversión de ${pedido.number}: ` +
              (error instanceof Error ? error.message : String(error)),
          );
        });
    }

    // La comisión del afiliado se devenga al cobrar y queda PENDIENTE: el
    // pedido todavía puede devolverse, y pagar antes de que venza el plazo de
    // desistimiento es regalar el dinero dos veces.
    await this.canales.devengarComision(orderId).catch((error: unknown) => {
      this.logger.error(
        `No se pudo devengar la comisión de ${pedido.number}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    });

    // El referido se resuelve aquí y no al crear el pedido: la diferencia
    // entre las dos cosas es la diferencia entre una venta y una intención.
    // Va fuera de la transacción y con el error tragado a propósito — que
    // falle el reparto de un descuento no puede dejar sin cobrar un pedido que
    // ya está pagado.
    await this.referidos.alPagarPedido(orderId).catch((error: unknown) => {
      this.logger.error(
        `No se ha podido resolver el referido del pedido ${pedido.number}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    });

    this.logger.log(`Pedido ${pedido.number} pagado; fulfillment encolado`);
  }

  /**
   * Marca un pedido como pagado a mano, desde el panel.
   *
   * Hace falta porque el aviso de la pasarela puede no llegar nunca: si el
   * webhook no está dado de alta —o la pasarela falla, o el pago se hizo por
   * transferencia— el dinero está en la cuenta y el pedido se queda esperando
   * para siempre. Sin esta vía, la única salida sería tocar la base de datos a
   * mano, que no deja rastro y se salta el fulfillment.
   *
   * **La máquina de estados prohíbe a propósito el paso manual a PAID** y eso NO
   * se toca: sigue prohibido arrastrando una tarjeta en el Kanban, que es donde
   * el error sería un descuido. Aquí se pasa por `sistema` porque lo que ocurre
   * es exactamente lo mismo que con un webhook —se ha comprobado que el dinero
   * está— y el pedido tiene que seguir el mismo camino: descontar stock, encolar
   * la compra al proveedor y avisar al cliente. Un pago marcado que no dispara
   * nada de eso es peor que no marcarlo.
   *
   * Tres cosas lo distinguen de un cobro automático, y las tres son a propósito:
   *
   *  · **Pide motivo** y lo guarda. «Transferencia recibida el 3/8» explica en
   *    seis meses lo que un booleano no explica nunca.
   *  · **Deja un evento propio** en el historial del pedido, con quién lo hizo:
   *    el historial no puede decir «pago confirmado» a secas, porque nadie lo
   *    confirmó salvo una persona.
   *  · **Registra el cobro con proveedor `manual`**, para que la contabilidad
   *    cuadre y se distinga de lo que cobró una pasarela.
   */
  async marcarPagadoAMano(
    orderId: string,
    datos: { motivo: string; importeCents?: number },
    ctx: { actorId?: string; actorIp?: string },
  ) {
    const pedido = await this.exigirPedido(orderId);

    if (pedido.paymentStatus === 'PAID') {
      throw new BadRequestException('Este pedido ya está marcado como pagado');
    }

    // Se valida ANTES de tocar nada: desde «cancelado» o «reembolsado» esto no
    // tiene sentido, y el mensaje de la máquina de estados explica por qué mejor
    // que cualquier texto que se escriba aquí.
    exigirTransicionValida(pedido.status, 'PAID', 'sistema');

    const importe = datos.importeCents ?? pedido.totalCents;

    /*
     * El cobro queda registrado, reutilizando el que hubiera.
     *
     * Si el cliente empezó a pagar por la pasarela hay una fila PENDING: se
     * cierra esa en lugar de crear una segunda, o el pedido acabaría con dos
     * cobros y el importe contado dos veces en los informes.
     */
    const enCurso = await this.prisma.client.payment.findFirst({
      where: { orderId, status: { in: ['PENDING', 'AWAITING_CONFIRMATION', 'EXPIRED', 'FAILED'] } },
      orderBy: { createdAt: 'desc' },
    });

    const pago = enCurso
      ? await this.prisma.client.payment.update({
          where: { id: enCurso.id },
          data: { status: 'PAID', receivedCents: importe, paidAt: new Date() },
        })
      : await this.prisma.client.payment.create({
          data: {
            id: newId(),
            orderId,
            provider: 'manual',
            status: 'PAID',
            amountCents: importe,
            receivedCents: importe,
            currency: pedido.currency,
            paidAt: new Date(),
          },
        });

    // El mismo camino que sigue un webhook: stock, fulfillment, correo,
    // conversión y comisión. Es el motivo de que esto no sea un UPDATE.
    await this.marcarPagado(orderId, { paymentId: pago.id });

    // Y el rastro humano, después de que el pago sea firme.
    await this.prisma.client.orderEvent.create({
      data: {
        id: newId(),
        orderId,
        type: 'order.paid_manually',
        description: `Pago marcado a mano: ${datos.motivo}`,
        actorType: 'staff',
        actorId: ctx.actorId ?? null,
        metadata: { paymentId: pago.id, motivo: datos.motivo, importeCents: importe },
      },
    });

    await this.audit.registrar({
      action: 'order.paid_manually',
      resource: 'order',
      resourceId: orderId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { estado: pedido.status, estadoPago: pedido.paymentStatus },
      after: { estado: 'PAID', estadoPago: 'PAID', motivo: datos.motivo, importeCents: importe },
    });

    this.logger.warn(
      `Pedido ${pedido.number} marcado como pagado a mano por ${ctx.actorId ?? 'desconocido'}: ${datos.motivo}`,
    );

    return this.detalle(orderId);
  }

  /** Cambio de estado, con validación y traza. */
  async cambiarEstado(
    orderId: string,
    nuevo: OrderStatus,
    opciones: {
      origen?: 'sistema' | 'manual';
      motivo?: string;
      actorId?: string;
      actorIp?: string;
    } = {},
  ) {
    const pedido = await this.exigirPedido(orderId);
    const origen = opciones.origen ?? 'sistema';

    exigirTransicionValida(pedido.status, nuevo, origen);

    const marcasDeTiempo: Partial<Record<string, Date>> = {};
    if (nuevo === 'IN_TRANSIT') marcasDeTiempo['shippedAt'] = new Date();
    if (nuevo === 'DELIVERED') marcasDeTiempo['deliveredAt'] = new Date();
    if (nuevo === 'CANCELLED') marcasDeTiempo['cancelledAt'] = new Date();

    const actualizado = await this.prisma.client.$transaction(async (tx) => {
      const p = await tx.order.update({
        where: { id: orderId },
        data: {
          status: nuevo,
          ...marcasDeTiempo,
          ...(nuevo === 'CANCELLED' && opciones.motivo ? { cancelReason: opciones.motivo } : {}),
        },
      });

      await tx.orderEvent.create({
        data: {
          id: newId(),
          orderId,
          type: `order.status_changed`,
          description: `${ETIQUETAS[pedido.status]} → ${ETIQUETAS[nuevo]}${
            opciones.motivo ? ` · ${opciones.motivo}` : ''
          }`,
          actorType: origen === 'manual' ? 'staff' : 'system',
          actorId: opciones.actorId ?? null,
          metadata: { desde: pedido.status, hasta: nuevo },
        },
      });

      if (nuevo === 'CANCELLED') {
        await this.outbox.registrar(tx, {
          eventType: 'order.cancelled',
          aggregateType: 'order',
          aggregateId: orderId,
          payload: { orderId, motivo: opciones.motivo ?? null },
        });
      }

      /*
       * Entregar el pedido entrega también sus compras al proveedor.
       *
       * Con un proveedor sin API nadie nos va a avisar de que el paquete llegó:
       * lo marca una persona en el panel. Sin esto, el sub-pedido se quedaba en
       * ENVIADO para siempre y pasaban dos cosas: el pedido constaba entregado
       * mientras la compra constaba en camino, y a las tres semanas el paquete
       * aparecía en la lista de envíos posiblemente perdidos siendo uno que ya
       * está en casa del cliente.
       *
       * Solo hacia abajo y solo desde los estados en vuelo: un sub-pedido
       * cancelado o fallido no se entrega por mover el pedido.
       */
      if (nuevo === 'DELIVERED') {
        await tx.supplierOrder.updateMany({
          where: { orderId, status: { in: ['PLACED', 'SHIPPED'] } },
          data: { status: 'DELIVERED', deliveredAt: new Date() },
        });
      }

      return p;
    });

    // El throughput por estado es la métrica de negocio: una caída de pedidos
    // con toda la infraestructura en verde es la alerta más útil que hay.
    // Con esto la traza se busca en Jaeger por pedido.id y sale su historia
    // entera: petición, cola, llamada al proveedor.
    marcar({ 'pedido.id': orderId, 'pedido.estado': nuevo });

    this.metrics.pedidosTotal.inc({ estado: nuevo });
    if (nuevo === 'PAID') {
      this.metrics.ingresosCents.inc({ moneda: actualizado.currency }, actualizado.totalCents);
    }

    if (origen === 'manual') {
      await this.audit.registrar({
        action: 'order.status_change',
        resource: 'order',
        resourceId: orderId,
        actorId: opciones.actorId,
        actorIp: opciones.actorIp,
        before: { status: pedido.status },
        after: { status: nuevo },
        metadata: { motivo: opciones.motivo },
      });
    }

    return actualizado;
  }

  /**
   * Resuelve una clave de seguimiento al id interno del pedido.
   *
   * Existe aparte de `porTokenPublico` porque esa vista NO devuelve el id a
   * propósito: es la que se manda al navegador y no tiene por qué exponer
   * identificadores internos. Esta es para uso del servidor.
   */
  async idPorTokenPublico(token: string): Promise<string> {
    const pedido = await this.prisma.client.order.findUnique({
      where: { publicToken: token },
      select: { id: true },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    return pedido.id;
  }

  /**
   * Pedido visto por su dueño, sin datos internos.
   *
   * Se busca por el token y NO por el número: el número es correlativo, así
   * que aceptar una consulta por número permitiría recorrer todos los pedidos
   * de la tienda y leer nombres, direcciones y teléfonos de los clientes.
   *
   * Se omiten a propósito el coste del proveedor, el margen y los datos del
   * proveedor: son información de negocio, no del cliente.
   */
  async porTokenPublico(token: string) {
    const pedido = await this.prisma.client.order.findUnique({
      where: { publicToken: token },
      include: {
        items: {
          select: {
            id: true,
            name: true,
            variantName: true,
            sku: true,
            imageUrl: true,
            quantity: true,
            unitPriceCents: true,
            totalCents: true,
          },
        },
        events: {
          /*
           * Ni una sola `description` sale de aquí.
           *
           * Ese campo es el cuaderno interno —proveedores, referencias, lo que
           * nos costó, con qué pasarela se cobró— y esta consulta la sirve una
           * página pública: basta tener el enlace. Se filtra por tipo con la
           * lista de `historial-publico.ts` y el texto lo pone la tienda a
           * partir de la clave. Ver ese fichero para el porqué.
           */
          where: { type: { in: TIPOS_PUBLICOS } },
          orderBy: { createdAt: 'asc' },
          select: { type: true, metadata: true, createdAt: true },
        },
      },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    // Los sub-pedidos del proveedor van en consulta aparte porque el modelo no
    // declara relación inversa: guarda orderId suelto para poder archivar un
    // pedido sin arrastrar su histórico de proveedores.
    const envios = await this.prisma.client.supplierOrder.findMany({
      where: { orderId: pedido.id, trackingNumber: { not: null } },
      select: {
        trackingCarrier: true,
        trackingNumber: true,
        trackingUrl: true,
        trackingStatus: true,
        shippedAt: true,
        deliveredAt: true,
      },
    });

    return {
      numero: pedido.number,
      estado: estadoPublico(pedido.status),
      pagado: pedido.paymentStatus === 'PAID',
      creadoEn: pedido.createdAt,
      pagadoEn: pedido.paidAt,
      enviadoEn: pedido.shippedAt,
      entregadoEn: pedido.deliveredAt,
      lineas: pedido.items,
      subtotalCents: pedido.subtotalCents,
      descuentoCents: pedido.discountCents,
      envioCents: pedido.shippingCents,
      ivaCents: pedido.taxCents,
      totalCents: pedido.totalCents,
      tipoIva: Number(pedido.taxRate),
      direccionEnvio: pedido.shippingAddress,
      email: pedido.email,
      historial: historialPublico(pedido.events),
      envios: envios.map((s) => ({
        transportista: s.trackingCarrier,
        seguimiento: s.trackingNumber,
        url: s.trackingUrl,
        estado: s.trackingStatus,
        enviadoEn: s.shippedAt,
        entregadoEn: s.deliveredAt,
      })),
    };
  }

  /**
   * Cierra el pedido: lo saca del Kanban.
   * Es una decisión humana explícita, no automática.
   */
  async cerrar(orderId: string, ctx: ContextoActor) {
    const pedido = await this.exigirPedido(orderId);
    exigirTransicionValida(pedido.status, 'CLOSED', 'manual');

    const cerrado = await this.prisma.client.order.update({
      where: { id: orderId },
      data: { status: 'CLOSED', closedAt: new Date(), closedBy: ctx.actorId },
    });

    await this.prisma.client.orderEvent.create({
      data: {
        id: newId(),
        orderId,
        type: 'order.closed',
        description: 'Pedido cerrado y archivado',
        actorType: 'staff',
        actorId: ctx.actorId,
      },
    });

    await this.audit.registrar({
      action: 'order.close',
      resource: 'order',
      resourceId: orderId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
    });

    return cerrado;
  }

  /**
   * Cancela un pedido y deshace todo lo que hubiera hecho.
   *
   * Cambiar el estado es lo de menos. Lo que importa es el orden en que se
   * deshace el resto:
   *
   *  1. **Primero el proveedor.** Si no se puede detener allí, no se cancela
   *     nada más: devolver el dinero de un paquete que va a llegar igual es
   *     perder la mercancía y el importe a la vez.
   *  2. Después el stock, que vuelve al inventario.
   *  3. Y por último el reembolso.
   *
   * @param quien el cliente puede cancelar en menos estados que el equipo
   */
  async cancelar(
    orderId: string,
    motivo: string,
    ctx: ContextoActor,
    quien: 'cliente' | 'equipo' = 'equipo',
  ) {
    const pedido = await this.exigirPedido(orderId);

    const impedimento = motivoNoCancelable(pedido.status, quien);
    if (impedimento) throw new BadRequestException(impedimento);

    /*
     * Qué hay que deshacer se decide con los HECHOS, no con el estado.
     *
     * Un pedido en incidencia puede estar cobrado y con el stock ya descontado, y
     * la lista de estados no lo sabía: cancelarlo devolvía el pedido sin devolver
     * el dinero. El estado del pago dice si hay dinero dentro, y el movimiento de
     * stock dice si hubo unidades que descontar.
     */
    const stockDescontado = await this.prisma.client.stockMovement.findFirst({
      where: { reference: orderId, reason: 'PURCHASE' },
      select: { id: true },
    });

    const plan = planDeCancelacion(pedido.status, {
      cobrado: hayDineroCobrado(pedido.paymentStatus),
      stockDescontado: stockDescontado !== null,
    });
    const incidencias: string[] = [];

    // ── 1. El proveedor ──
    if (plan.cancelarEnProveedor) {
      const resultado = await this.cancelarEnProveedor(orderId, motivo);

      if (!resultado.todosCancelados) {
        // No se detuvo en el proveedor: el pedido queda en revisión, sin
        // reembolsar. Un humano decide, con la información delante, si el
        // paquete llegó a salir.
        await this.cambiarEstado(orderId, 'FAILED', {
          origen: 'sistema',
          motivo: `Cancelación no confirmada por el proveedor: ${resultado.detalle}`,
        });

        throw new BadRequestException(
          'El proveedor no ha confirmado la cancelación; puede que el pedido ya haya salido. ' +
            'Se ha marcado para revisión manual y no se ha reembolsado nada todavía.',
        );
      }
    }

    // El uso del cupón vuelve a estar disponible: si no, cancelar consume la
    // promoción igual y el cliente se queda sin descuento y sin poder repetirlo.
    await this.coupons.devolverUso(orderId);

    // ── 2. El stock ──
    if (plan.devolverStock) {
      const lineas = await this.prisma.client.orderItem.findMany({
        where: { orderId, variantId: { not: null } },
        select: { variantId: true, quantity: true },
      });

      await this.inventory.devolverPorCancelacion(
        orderId,
        lineas.map((l) => ({ variantId: l.variantId!, quantity: l.quantity })),
      );
    }

    // ── 3. El estado ──
    const cancelado = await this.cambiarEstado(orderId, 'CANCELLED', {
      origen: quien === 'cliente' ? 'sistema' : 'manual',
      motivo,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
    });

    // ── 4. El reembolso ──
    //
    // Va a través del outbox y no aquí mismo: si la pasarela tarda o falla, el
    // pedido ya está cancelado y el reembolso se reintenta solo. Hacerlo en
    // línea dejaría pedidos a medio cancelar cuando la pasarela no responde.
    if (plan.reembolsar) {
      await this.prisma.client.$transaction(async (tx) => {
        await this.outbox.registrar(tx, {
          eventType: 'order.refund_requested',
          aggregateType: 'order',
          aggregateId: orderId,
          payload: { orderId, motivo, importeCents: pedido.totalCents },
        });
      });
    }

    // La comisión del afiliado se anula: sin esto se acabaría pagando por una
    // venta que se deshizo, y eso no da ningún error — se descubre al liquidar.
    await this.canales.anularComision(orderId).catch((error: unknown) => {
      this.logger.error(
        `No se pudo anular la comisión de ${pedido.number}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    });

    if (plan.requiereRevision) {
      incidencias.push(
        'El proveedor ya había aceptado el pedido: comprueba que no haya salido físicamente.',
      );
    }

    return { ...cancelado, reembolsoSolicitado: plan.reembolsar, incidencias };
  }

  /**
   * Pide al proveedor que cancele los sub-pedidos.
   *
   * Un proveedor que no admite cancelación por API cuenta como "no cancelado":
   * suponer que sí y devolver el dinero es exactamente el error que hay que
   * evitar. La capacidad se consulta, no se asume.
   */
  private async cancelarEnProveedor(
    orderId: string,
    motivo: string,
  ): Promise<{ todosCancelados: boolean; detalle: string }> {
    const subPedidos = await this.prisma.client.supplierOrder.findMany({
      where: { orderId, status: { in: ['PLACED', 'PENDING'] } },
    });

    if (subPedidos.length === 0) return { todosCancelados: true, detalle: 'sin sub-pedidos' };

    const problemas: string[] = [];

    for (const sub of subPedidos) {
      if (!sub.externalOrderId) {
        // Nunca llegó a crearse en el proveedor: no hay nada que cancelar.
        continue;
      }

      try {
        const adaptador = await this.suppliers.adaptador(sub.supplierId);

        if (!adaptador.capacidades.cancelarPedido) {
          problemas.push(`${adaptador.nombre} no admite cancelación por API`);
          continue;
        }

        const resultado = await adaptador.cancelarPedido(sub.externalOrderId, motivo);

        if (resultado.ok) {
          await this.prisma.client.supplierOrder.update({
            where: { id: sub.id },
            data: { status: 'CANCELLED' },
          });
        } else {
          problemas.push(resultado.mensaje ?? 'el proveedor rechazó la cancelación');
        }
      } catch (error) {
        problemas.push(error instanceof Error ? error.message : String(error));
      }
    }

    return {
      todosCancelados: problemas.length === 0,
      detalle: problemas.join('; ') || 'ok',
    };
  }

  /**
   * Cambia la dirección de envío antes de que el pedido salga.
   *
   * Una vez en el proveedor deja de admitirse: cambiarla aquí no cambiaría la
   * etiqueta del paquete y el cliente esperaría el pedido donde no va a llegar.
   */
  async cambiarDireccion(orderId: string, direccion: Record<string, unknown>, ctx: ContextoActor) {
    const pedido = await this.exigirPedido(orderId);

    if (!puedeCambiarDireccion(pedido.status)) {
      throw new BadRequestException(
        'El pedido ya está en preparación y la dirección no se puede cambiar. ' +
          'Escríbenos y comprobaremos si todavía se puede hacer algo.',
      );
    }

    const actualizado = await this.prisma.client.order.update({
      where: { id: orderId },
      data: { shippingAddress: direccion as Prisma.InputJsonValue },
    });

    await this.prisma.client.orderEvent.create({
      data: {
        id: newId(),
        orderId,
        type: 'order.address_changed',
        description: 'Dirección de envío modificada',
        actorType: ctx.actorId ? 'staff' : 'customer',
        actorId: ctx.actorId ?? null,
      },
    });

    await this.audit.registrar({
      action: 'order.address_change',
      resource: 'order',
      resourceId: orderId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { direccion: pedido.shippingAddress },
      after: { direccion },
    });

    return actualizado;
  }

  // ── Consultas ─────────────────────────────────────────────

  async detalle(orderId: string) {
    const pedido = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payments: { orderBy: { createdAt: 'desc' } },
        events: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    /*
     * Los sub-pedidos del proveedor.
     *
     * Van en consulta aparte porque el modelo no declara relación inversa:
     * guarda `orderId` suelto para poder archivar un pedido sin arrastrar su
     * histórico de proveedores.
     *
     * Sin esto, el panel enseñaba el margen y el coste del proveedor pero no
     * QUÉ se había comprado ni dónde: la referencia de AliExpress solo aparecía
     * como una línea de texto en el historial, así que para saber si un pedido
     * estaba realmente comprado había que leer la cronología entera.
     */
    const subPedidos = await this.prisma.client.supplierOrder.findMany({
      where: { orderId: pedido.id },
      include: { supplier: { select: { name: true, key: true } } },
      orderBy: { createdAt: 'asc' },
    });

    /*
     * El margen del pedido, sobre lo que se queda la tienda.
     *
     * `totalCents` lleva el IVA dentro y ese dinero no es nuestro: se recauda
     * para Hacienda. Contarlo como ingreso inflaba el margen de cada pedido
     * unos veinte puntos, que es como se llegó a vender por debajo de coste
     * creyendo ganar un 26 %.
     *
     * Se resta el IVA que el pedido guarda —no un 21 % supuesto— porque hay
     * pedidos exentos: una importación sin IOSS va con `taxCents` a cero, y
     * ahí el total ya es el ingreso.
     */
    const ingreso = pedido.totalCents - pedido.taxCents;
    const margen = ingreso - pedido.supplierCostCents - pedido.gatewayFeeCents;

    return {
      ...pedido,
      estadoLegible: ETIQUETAS[pedido.status],
      /*
       * A dónde puede moverse este pedido AHORA, decidido por el servidor.
       *
       * La ficha pinta un botón por cada uno en vez de llevar su propia copia
       * de las reglas. Duplicarlas garantiza que un día divergen: el panel
       * ofrecería un paso que la API rechaza —o peor, escondería uno legítimo y
       * el pedido se quedaría atascado sin que nadie supiera por qué—.
       *
       * Se excluyen las transiciones que hace el sistema solo: marcar a mano
       * «enviado al proveedor» un pedido que el proveedor nunca recibió deja al
       * cliente esperando un paquete que no existe.
       */
      transicionesPermitidas: destinosManuales(pedido.status).map((destino) => ({
        estado: destino,
        titulo: ETIQUETAS[destino],
      })),
      ingresoSinIvaCents: ingreso,
      margenNetoCents: margen,
      margenPorcentaje: ingreso > 0 ? Math.round((margen / ingreso) * 100) : 0,
      subPedidos: subPedidos.map((s) => ({
        id: s.id,
        proveedor: s.supplier.name,
        proveedorClave: s.supplier.key,
        estado: s.status,
        // El del proveedor, sin traducir: nuestro `estado` se queda quieto
        // durante días mientras el suyo avanza, y es el suyo el que dice si el
        // pedido está progresando o atascado.
        estadoProveedor: s.supplierStatus,
        externalOrderId: s.externalOrderId,
        costeCents: s.costTotalCents,
        intentos: s.attempts,
        necesitaRevision: s.needsReview,
        error: s.lastError,
        tipoError: s.lastErrorType,
        creadoEn: s.createdAt,
        enviadoEn: s.placedAt,
        transportista: s.trackingCarrier,
        seguimiento: s.trackingNumber,
        urlSeguimiento: s.trackingUrl,
        estadoSeguimiento: s.trackingStatus,
        entregadoEn: s.deliveredAt,
      })),
    };
  }

  /**
   * Adopta los pedidos que se hicieron sin haber entrado en la cuenta.
   *
   * Comprar sin registrarse tiene que seguir siendo posible, así que un pedido
   * puede nacer sin dueño. El problema aparece cuando quien lo hizo **sí** tiene
   * cuenta con ese mismo email: el pedido existe, le llega el correo, puede
   * seguirlo por su enlace… y en «mis pedidos» no está. Que es exactamente lo
   * que pasó aquí.
   *
   * **Solo si el email de la cuenta está verificado.** Sin esa condición, esto
   * sería una forma de leer los pedidos de otra persona: bastaría registrarse
   * con su dirección para adoptar todo lo que hubiera comprado como invitada.
   * Verificado el email, la dirección es demostrablemente suya.
   *
   * Es idempotente: la segunda vez no encuentra nada que adoptar.
   */
  async vincularPedidosDeInvitado(userId: string): Promise<number> {
    const usuario = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });

    if (!usuario?.emailVerifiedAt) return 0;

    const { count } = await this.prisma.client.order.updateMany({
      where: { userId: null, email: usuario.email },
      data: { userId },
    });

    if (count > 0) {
      this.logger.log(`${String(count)} pedido(s) de invitado vinculados a la cuenta ${userId}`);
    }

    return count;
  }

  async listar(filtros: {
    status?: OrderStatus;
    email?: string;
    /** Número de pedido o email, lo que se escriba en el buscador del panel. */
    busqueda?: string;
    userId?: string;
    desde?: Date;
    hasta?: Date;
    limite?: number;
    cursor?: string;
  }) {
    const limite = Math.min(filtros.limite ?? 30, 100);

    const pedidos = await this.prisma.client.order.findMany({
      where: {
        ...(filtros.status ? { status: filtros.status } : {}),
        ...(filtros.email ? { email: { contains: filtros.email, mode: 'insensitive' } } : {}),
        /*
         * El buscador del panel dice «Nº de pedido o email» y solo buscaba por
         * email: escribir el número no encontraba nada. Y buscar por número es
         * justo lo que se hace cuando un cliente escribe preguntando por su
         * pedido, o cuando hay que marcar un cobro a mano.
         */
        ...(filtros.busqueda
          ? {
              OR: [
                { email: { contains: filtros.busqueda, mode: 'insensitive' as const } },
                { number: { contains: filtros.busqueda, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        ...(filtros.userId ? { userId: filtros.userId } : {}),
        ...(filtros.desde || filtros.hasta
          ? {
              createdAt: {
                ...(filtros.desde ? { gte: filtros.desde } : {}),
                ...(filtros.hasta ? { lte: filtros.hasta } : {}),
              },
            }
          : {}),
      },
      include: { items: { select: { id: true, name: true, quantity: true, imageUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: limite + 1,
      ...(filtros.cursor ? { cursor: { id: filtros.cursor }, skip: 1 } : {}),
    });

    const hayMas = pedidos.length > limite;
    const items = hayMas ? pedidos.slice(0, limite) : pedidos;

    return {
      items: items.map((p) => ({ ...p, estadoLegible: ETIQUETAS[p.status] })),
      nextCursor: hayMas ? (items.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Tablero Kanban: pedidos agrupados por columna.
   *
   * Los cerrados quedan fuera a propósito: el tablero muestra lo que requiere
   * atención, no el histórico. Un tablero con mil tarjetas archivadas deja de
   * servir para trabajar.
   */
  async kanban(filtros: { supplierId?: string; soloIncidencias?: boolean } = {}) {
    const pedidos = await this.prisma.client.order.findMany({
      where: {
        status: filtros.soloIncidencias ? 'FAILED' : { in: ESTADOS_KANBAN },
      },
      include: {
        items: { select: { id: true, name: true, quantity: true, imageUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const ahora = Date.now();

    const columnas = (filtros.soloIncidencias ? (['FAILED'] as OrderStatus[]) : ESTADOS_KANBAN).map(
      (estado) => ({
        estado,
        titulo: ETIQUETAS[estado],
        tarjetas: pedidos
          .filter((p) => p.status === estado)
          .map((p) => {
            // Días parado en la columna actual: es lo que permite detectar los
            // pedidos atascados antes de que reclame el cliente.
            const diasEnEstado = Math.floor((ahora - p.updatedAt.getTime()) / 86_400_000);

            return {
              id: p.id,
              numero: p.number,
              email: p.email,
              totalCents: p.totalCents,
              // Sin el IVA, que no es ingreso. Ver `detalle()`.
              margenCents: p.totalCents - p.taxCents - p.supplierCostCents - p.gatewayFeeCents,
              lineas: p.items.length,
              articulos: p.items.reduce((a, i) => a + i.quantity, 0),
              imagen: p.items[0]?.imageUrl ?? null,
              creadoEn: p.createdAt,
              diasEnEstado,
              // Semáforo de antigüedad para pintar la tarjeta.
              alerta: diasEnEstado >= 7 ? 'critica' : diasEnEstado >= 3 ? 'aviso' : null,
            };
          }),
      }),
    );

    return {
      columnas,
      total: pedidos.length,
      incidencias: await this.prisma.client.order.count({ where: { status: 'FAILED' } }),
    };
  }

  // ── Internos ──────────────────────────────────────────────

  private async exigirPedido(orderId: string) {
    const pedido = await this.prisma.client.order.findUnique({ where: { id: orderId } });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    return pedido;
  }

  /**
   * Ejecuta la creación reintentando si el número de pedido ya existía.
   *
   * Tres intentos: si tres números seguidos están cogidos no es una colisión,
   * es que algo va mal, y seguir reintentando solo alargaría la espera del
   * cliente antes de darle el mismo error.
   */
  private async reintentandoElNumero<T>(
    crear: () => Promise<T>,
    siguienteNumero: () => void,
  ): Promise<T> {
    for (let intento = 0; ; intento++) {
      try {
        return await crear();
      } catch (error) {
        const codigo = (error as { code?: string }).code;
        const campos = (error as { meta?: { target?: unknown } }).meta?.target;
        const esNumeroRepetido =
          codigo === 'P2002' && JSON.stringify(campos ?? '').includes('number');

        if (!esNumeroRepetido || intento >= 2) throw error;

        this.logger.warn('Número de pedido repetido; se reintenta con el siguiente');
        siguienteNumero();
      }
    }
  }

  /**
   * Número de pedido correlativo por año.
   *
   * Sale del número más alto del año, no de contar los pedidos: contando, en
   * cuanto falta uno —borrado, o creado en un año y contado en otro— el
   * siguiente repite un número que ya existe, el índice único lo rechaza y el
   * cliente se queda sin poder comprar. No es hipotético: pasa a la primera
   * baja.
   *
   * Con mucha concurrencia dos pedidos simultáneos aún pueden pedir el mismo
   * número; para eso está el reintento de `crear`. Para volumen alto conviene
   * pasarlo a una secuencia de Postgres.
   */
  private async siguienteNumero(): Promise<string> {
    const anio = new Date().getFullYear();

    const ultimo = await this.prisma.client.order.findFirst({
      where: { number: { startsWith: `ES-${String(anio)}-` } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    // El número va con ceros a la izquierda y ancho fijo, así que el orden
    // alfabético coincide con el numérico y el primero es el más alto.
    const secuencia = Number(ultimo?.number.split('-')[2] ?? 0);

    return formatOrderNumber(secuencia + 1, anio, 'ES');
  }

  /** Reparte un descuento global entre las líneas sin perder céntimos. */
  repartirDescuento(totalDescuento: number, lineas: { totalCents: number }[]): number[] {
    return allocate(
      totalDescuento,
      lineas.map((l) => l.totalCents),
    );
  }

  /**
   * Ventas a distancia a otros países de la UE acumuladas en el año.
   *
   * Es lo que decide si hay que cobrar el IVA español o el del país del
   * cliente. Se calcula sobre pedidos ya cobrados: un carrito abandonado no
   * consume umbral.
   *
   * Cada pedido guarda cuánto consume (`taxThresholdCents`), decidido cuando se
   * creó. No se deduce aquí de la dirección: un pedido puede ser mitad venta a
   * Francia y mitad importación desde China, y solo la primera mitad cuenta.
   * Las entregas exentas —Canarias, Ceuta, Melilla— tampoco: son España, no
   * ventas a distancia intracomunitarias.
   */
  async acumuladoTransfronterizo(anio = new Date().getFullYear()): Promise<number> {
    const suma = await this.prisma.client.order.aggregate({
      _sum: { taxThresholdCents: true },
      where: {
        paymentStatus: 'PAID',
        status: { notIn: ['CANCELLED', 'REFUNDED', 'DRAFT', 'AWAITING_PAYMENT'] },
        createdAt: {
          gte: new Date(Date.UTC(anio, 0, 1)),
          lt: new Date(Date.UTC(anio + 1, 0, 1)),
        },
      },
    });

    return suma._sum.taxThresholdCents ?? 0;
  }

  /** Situación frente al umbral de los 10.000 €, para el panel. */
  async estadoUmbralOss(anio = new Date().getFullYear()) {
    const acumulado = await this.acumuladoTransfronterizo(anio);
    const ajustes = await this.ajustesFiscales();
    const estado = estadoDelUmbral(acumulado);

    return {
      anio,
      ...estado,
      ossDadoDeAlta: ajustes.ossDadoDeAlta,
      iossDadoDeAlta: ajustes.tieneIoss,
      // Superar el umbral sin el alta hecha no para las ventas: las obliga a
      // tributar en destino igualmente. El aviso tiene que decirlo.
      altaPendiente: estado.superado && !ajustes.ossDadoDeAlta,
    };
  }

  /**
   * Qué IVA llevará el pedido, antes de crearlo.
   *
   * Existe por el aviso de aduanas: si la mercancía viene de fuera de la UE y
   * no cabe en el IOSS, el cliente pagará el IVA de importación y los aranceles
   * al recibir el paquete. Decírselo después de cobrar es una omisión engañosa
   * —y en la práctica, un paquete rechazado en la entrega y una venta perdida
   * entera, con el porte pagado dos veces.
   */
  async previsualizarIva(datos: {
    countryCode: string;
    postalCode: string;
    lineas: LineaCarrito[];
  }) {
    const variantes = await this.prisma.client.productVariant.findMany({
      where: { id: { in: datos.lineas.map((l) => l.variantId) }, deletedAt: null },
      select: { id: true, priceCents: true, product: { select: { taxRate: true } } },
    });

    if (variantes.length === 0) {
      throw new BadRequestException('Ninguna de las variantes existe');
    }

    const regimen = await this.regimenDeIva(
      {
        email: '',
        lineas: datos.lineas,
        shippingAddress: { countryCode: datos.countryCode, postalCode: datos.postalCode },
      },
      variantes,
    );

    // Lo que se cobra no cambia con el régimen: el precio anunciado lleva el
    // impuesto dentro y es el que paga el cliente. Lo que cambia es cuánto de
    // ese importe es impuesto y quién lo recauda.
    const imponibles: LineaImponible[] = [];
    for (const linea of datos.lineas) {
      const v = variantes.find((x) => x.id === linea.variantId);
      if (!v) continue;

      const decision = regimen.decisionDe(v.id);
      const tipoCatalogo = Number(v.product.taxRate);
      const bruto = v.priceCents * linea.quantity;

      imponibles.push({
        totalCents: exigeNetificar(decision.regimen) ? baseImponible(bruto, tipoCatalogo) : bruto,
        tipo: tipoAplicable(decision, tipoCatalogo),
      });
    }

    const desglose = desglosarIva(imponibles);

    return {
      regimen: regimen.decision.regimen,
      paisRecaudador: regimen.decision.paisRecaudador,
      avisos: regimen.decision.avisos,
      tramos: desglose.tramos,
      baseCents: desglose.baseCents,
      ivaCents: desglose.cuotaCents,
      // Sin el envío ni el descuento: el checkout ya los tiene por su cuenta y
      // aquí solo se responde por el impuesto de la mercancía.
      mercanciaCents: desglose.totalCents,
    };
  }
}
