import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { generarCsv, importe, type Columna } from './csv.js';
import { newId } from '@ecom/shared';
import {
  calcularFifo,
  obligaModelo721,
  resumirEjercicio,
  UMBRAL_MODELO_721_CENTS,
  type EntradaCripto,
  type SalidaCripto,
} from './contabilidad-cripto.js';
import {
  agruparDeclaracion,
  rangoTrimestre,
  type DeclaracionOss,
  type TramoGuardado,
  type VentaDeclarable,
} from './informe-oss.js';

/**
 * Informes.
 *
 * El que de verdad importa en dropshipping es el de **margen**, no el de
 * ventas. Facturar 10.000 € suena bien hasta que se descuenta lo que se pagó
 * al proveedor, el porte y la comisión de la pasarela: el número que queda es
 * el único que dice si el negocio gana dinero.
 *
 * Los pedidos guardan `supplierCostCents` y `gatewayFeeCents` congelados en el
 * momento de la venta, así que el margen histórico no se altera aunque el
 * proveedor cambie sus precios después.
 */

export interface RangoFechas {
  desde: Date;
  hasta: Date;
}

/** Estados que cuentan como venta consumada. */
const VENDIDOS = [
  'PAID',
  'PREPARING',
  'SENT_TO_SUPPLIER',
  'IN_TRANSIT',
  'DELIVERED',
  'PENDING_CLOSE',
  'CLOSED',
] as const;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private filtroVentas(rango: RangoFechas) {
    return {
      createdAt: { gte: rango.desde, lte: rango.hasta },
      status: { in: [...VENDIDOS] },
      paymentStatus: 'PAID' as const,
    };
  }

  /**
   * Resumen del periodo con el margen desglosado.
   *
   * Se devuelven los tres costes por separado y no solo el margen final: si el
   * margen cae, saber si fue por el proveedor, por el porte o por la comisión
   * es la diferencia entre poder arreglarlo y solo saber que va mal.
   */
  async resumen(rango: RangoFechas) {
    const pedidos = await this.prisma.client.order.findMany({
      where: this.filtroVentas(rango),
      select: {
        totalCents: true,
        subtotalCents: true,
        shippingCents: true,
        discountCents: true,
        taxCents: true,
        supplierCostCents: true,
        gatewayFeeCents: true,
      },
    });

    const suma = (f: (p: (typeof pedidos)[number]) => number) =>
      pedidos.reduce((a, p) => a + f(p), 0);

    const ingresos = suma((p) => p.totalCents);
    const costeProveedor = suma((p) => p.supplierCostCents);
    const comisiones = suma((p) => p.gatewayFeeCents);
    const iva = suma((p) => p.taxCents);

    // El IVA no es ingreso: se recauda para Hacienda. Contarlo como margen es
    // el error que hace que un negocio se crea rentable hasta el trimestre.
    const ingresoSinIva = ingresos - iva;
    const margen = ingresoSinIva - costeProveedor - comisiones;

    return {
      desde: rango.desde,
      hasta: rango.hasta,
      pedidos: pedidos.length,
      ingresosCents: ingresos,
      ivaRepercutidoCents: iva,
      ingresoSinIvaCents: ingresoSinIva,
      costeProveedorCents: costeProveedor,
      comisionesPasarelaCents: comisiones,
      descuentosCents: suma((p) => p.discountCents),
      envioCobradoCents: suma((p) => p.shippingCents),
      margenNetoCents: margen,
      margenPorcentaje: ingresoSinIva > 0 ? Math.round((margen / ingresoSinIva) * 100) : 0,
      ticketMedioCents: pedidos.length > 0 ? Math.round(ingresos / pedidos.length) : 0,
    };
  }

  /** Ventas por día, para ver la tendencia y detectar un día caído. */
  async porDia(rango: RangoFechas) {
    const filas = await this.prisma.client.$queryRaw<
      { dia: Date; pedidos: bigint; ingresos: bigint; coste: bigint }[]
    >`
      SELECT
        date_trunc('day', "createdAt") AS dia,
        count(*)                       AS pedidos,
        -- Sin el IVA, para que la línea de ingresos sea comparable con la de
        -- coste: si no, la gráfica enseña un hueco entre las dos que en
        -- realidad es de Hacienda.
        sum("totalCents") - sum("taxCents") AS ingresos,
        sum("supplierCostCents") + sum("gatewayFeeCents") AS coste
      FROM orders
      WHERE "createdAt" >= ${rango.desde}
        AND "createdAt" <= ${rango.hasta}
        AND "paymentStatus" = 'PAID'
        AND status NOT IN ('CANCELLED', 'REFUNDED', 'DRAFT', 'AWAITING_PAYMENT')
      GROUP BY 1
      ORDER BY 1
    `;

    return filas.map((f) => ({
      dia: f.dia,
      pedidos: Number(f.pedidos),
      ingresosCents: Number(f.ingresos),
      costesCents: Number(f.coste),
    }));
  }

  /**
   * Productos más vendidos, con su margen.
   *
   * Ordenados por margen y no por unidades: el producto que más se vende puede
   * ser el que menos aporta, y en dropshipping eso pasa a menudo con los
   * artículos baratos de coste alto.
   */
  async productos(rango: RangoFechas, limite = 50) {
    const filas = await this.prisma.client.$queryRaw<
      {
        sku: string;
        nombre: string;
        unidades: bigint;
        ingresos: bigint;
        coste: bigint;
      }[]
    >`
      SELECT
        oi.sku,
        -- El nombre viene congelado en la línea del pedido, en el idioma que
        -- usó el cliente: el mismo SKU puede aparecer en castellano y en
        -- catalán. Se coge uno cualquiera porque lo que identifica al producto
        -- es el SKU, no el nombre traducido.
        max(oi.name)                                AS nombre,
        sum(oi.quantity)                            AS unidades,
        sum(oi."totalCents")                        AS ingresos,
        sum(oi."unitCostCents" * oi.quantity)       AS coste
      FROM order_items oi
      JOIN orders o ON o.id = oi."orderId"
      WHERE o."createdAt" >= ${rango.desde}
        AND o."createdAt" <= ${rango.hasta}
        AND o."paymentStatus" = 'PAID'
        AND o.status NOT IN ('CANCELLED', 'REFUNDED', 'DRAFT', 'AWAITING_PAYMENT')
      GROUP BY oi.sku
      ORDER BY (sum(oi."totalCents") - sum(oi."unitCostCents" * oi.quantity)) DESC
      LIMIT ${limite}
    `;

    return filas.map((f) => {
      const ingresos = Number(f.ingresos);
      const coste = Number(f.coste);
      return {
        sku: f.sku,
        nombre: f.nombre,
        unidades: Number(f.unidades),
        ingresosCents: ingresos,
        costeCents: coste,
        margenCents: ingresos - coste,
        margenPorcentaje: ingresos > 0 ? Math.round(((ingresos - coste) / ingresos) * 100) : 0,
      };
    });
  }

  // ── Exportación ───────────────────────────────────────────

  async csvPedidos(rango: RangoFechas): Promise<string> {
    const pedidos = await this.prisma.client.order.findMany({
      where: {
        createdAt: { gte: rango.desde, lte: rango.hasta },
      },
      select: {
        number: true,
        createdAt: true,
        status: true,
        paymentStatus: true,
        email: true,
        subtotalCents: true,
        discountCents: true,
        shippingCents: true,
        taxCents: true,
        totalCents: true,
        supplierCostCents: true,
        gatewayFeeCents: true,
        taxRate: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    type Fila = (typeof pedidos)[number];

    const columnas: Columna<Fila>[] = [
      { titulo: 'Pedido', valor: (p) => p.number },
      { titulo: 'Fecha', valor: (p) => p.createdAt },
      { titulo: 'Estado', valor: (p) => p.status },
      { titulo: 'Pago', valor: (p) => p.paymentStatus },
      { titulo: 'Cliente', valor: (p) => p.email },
      { titulo: 'Subtotal', valor: (p) => importe(p.subtotalCents) },
      { titulo: 'Descuento', valor: (p) => importe(p.discountCents) },
      { titulo: 'Envío', valor: (p) => importe(p.shippingCents) },
      { titulo: 'IVA', valor: (p) => importe(p.taxCents) },
      { titulo: 'Tipo IVA', valor: (p) => `${Number(p.taxRate)}%` },
      { titulo: 'Total', valor: (p) => importe(p.totalCents) },
      { titulo: 'Coste proveedor', valor: (p) => importe(p.supplierCostCents) },
      { titulo: 'Comisión pasarela', valor: (p) => importe(p.gatewayFeeCents) },
      {
        titulo: 'Margen',
        valor: (p) => importe(p.totalCents - p.taxCents - p.supplierCostCents - p.gatewayFeeCents),
      },
    ];

    return generarCsv(pedidos, columnas);
  }

  async csvProductos(rango: RangoFechas): Promise<string> {
    const productos = await this.productos(rango, 1000);

    return generarCsv(productos, [
      { titulo: 'SKU', valor: (p) => p.sku },
      { titulo: 'Producto', valor: (p) => p.nombre },
      { titulo: 'Unidades', valor: (p) => p.unidades },
      { titulo: 'Ingresos', valor: (p) => importe(p.ingresosCents) },
      { titulo: 'Coste', valor: (p) => importe(p.costeCents) },
      { titulo: 'Margen', valor: (p) => importe(p.margenCents) },
      { titulo: 'Margen %', valor: (p) => `${p.margenPorcentaje}%` },
    ]);
  }

  /**
   * Libro de IVA repercutido, para el modelo 303.
   *
   * Sale de las facturas emitidas, no de los pedidos: es lo que la Agencia
   * Tributaria considera el dato bueno, y lo que tiene que cuadrar con la
   * declaración.
   */
  async csvIva(rango: RangoFechas): Promise<string> {
    const facturas = await this.prisma.client.invoice.findMany({
      where: { issuedAt: { gte: rango.desde, lte: rango.hasta } },
      select: {
        fullNumber: true,
        issuedAt: true,
        customerSnapshot: true,
        subtotalCents: true,
        taxCents: true,
        totalCents: true,
        type: true,
      },
      orderBy: { issuedAt: 'asc' },
    });

    type Fila = (typeof facturas)[number];

    return generarCsv(facturas, [
      { titulo: 'Factura', valor: (f) => f.fullNumber },
      { titulo: 'Fecha', valor: (f) => f.issuedAt },
      { titulo: 'Tipo', valor: (f) => (f.type === 'CREDIT_NOTE' ? 'Rectificativa' : 'Factura') },
      {
        titulo: 'Cliente',
        valor: (f: Fila) => {
          const c = f.customerSnapshot as Record<string, unknown> | null;
          const nombre = [c?.['firstName'], c?.['lastName']].filter(Boolean).join(' ');
          return nombre || (typeof c?.['email'] === 'string' ? c['email'] : '');
        },
      },
      { titulo: 'Base imponible', valor: (f) => importe(f.subtotalCents) },
      { titulo: 'Cuota IVA', valor: (f) => importe(f.taxCents) },
      { titulo: 'Total', valor: (f) => importe(f.totalCents) },
    ]);
  }

  // ── Ventanilla única (OSS/IOSS) ───────────────────────────

  /**
   * Declaración trimestral del modelo 369.
   *
   * Sale de lo que se congeló en cada pedido, no de un recálculo: el régimen y
   * el tipo dependían del umbral acumulado en aquel momento, y ese número ya
   * ha cambiado. Volver a calcularlo ahora daría una declaración que no cuadra
   * con las facturas entregadas.
   */
  async declaracionOss(anio: number, trimestre: number): Promise<DeclaracionOss> {
    const { desde, hasta } = rangoTrimestre(anio, trimestre);

    const pedidos = await this.prisma.client.order.findMany({
      where: {
        taxRegime: { in: ['OSS', 'IOSS', 'MIXTO'] },
        paymentStatus: 'PAID',
        status: { in: [...VENDIDOS] },
        // Por fecha de cobro: la declaración va por cuándo se devengó el
        // impuesto, no por cuándo se metió el pedido en el carrito.
        paidAt: { gte: desde, lte: hasta },
      },
      select: {
        number: true,
        taxRegime: true,
        taxCountry: true,
        taxBreakdown: true,
        taxNeedsReview: true,
        taxCents: true,
        taxRate: true,
        totalCents: true,
      },
      orderBy: { paidAt: 'asc' },
    });

    const ventas: VentaDeclarable[] = pedidos.map((p) => {
      const guardados = Array.isArray(p.taxBreakdown) ? p.taxBreakdown : [];

      const tramos: TramoGuardado[] = guardados
        .map((t) => t as Record<string, unknown>)
        .map((t) => ({
          tipo: Number(t['tipo'] ?? 0),
          baseCents: Number(t['baseCents'] ?? 0),
          cuotaCents: Number(t['cuotaCents'] ?? 0),
        }));

      return {
        numero: p.number,
        regimen: p.taxRegime,
        paisRecaudador: p.taxCountry,
        // Un pedido sin desglose guardado —de antes de que existiera— se
        // reconstruye con el tipo y la cuota del propio pedido antes que
        // dejarlo fuera de la declaración.
        tramos:
          tramos.length > 0
            ? tramos
            : [
                {
                  tipo: Number(p.taxRate),
                  baseCents: p.totalCents - p.taxCents,
                  cuotaCents: p.taxCents,
                },
              ],
        necesitaRevision: p.taxNeedsReview,
      };
    });

    return agruparDeclaracion(ventas, anio, trimestre);
  }

  /** La declaración en CSV, para pasársela al asesor. */
  async csvOss(anio: number, trimestre: number): Promise<string> {
    const d = await this.declaracionOss(anio, trimestre);

    const filas = [
      ...d.regimenUnion.map((l) => ({ apartado: 'Régimen de la Unión (OSS)', ...l })),
      ...d.regimenImportacion.map((l) => ({ apartado: 'Régimen de importación (IOSS)', ...l })),
    ];

    return generarCsv(filas, [
      { titulo: 'Apartado', valor: (f) => f.apartado },
      { titulo: 'País', valor: (f) => f.pais },
      { titulo: 'Tipo', valor: (f) => `${String(f.tipo)}%` },
      { titulo: 'Base imponible', valor: (f) => importe(f.baseCents) },
      { titulo: 'Cuota', valor: (f) => importe(f.cuotaCents) },
      { titulo: 'Pedidos', valor: (f) => f.pedidos },
    ]);
  }

  // ── Cripto ────────────────────────────────────────────────

  /**
   * Libro de cobros y conversiones en cripto.
   *
   * Es lo que se entrega al asesor y lo que no sale de ningún otro informe: el
   * de ventas cuenta el ingreso en euros de la factura, pero no lo que pasó
   * después con la moneda recibida.
   */
  async cripto(rango: RangoFechas) {
    const cobros = await this.prisma.client.payment.findMany({
      where: {
        status: { in: ['PAID', 'REFUNDED'] },
        payCurrency: { not: null },
        payAmount: { not: null },
        paidAt: { not: null },
      },
      select: {
        id: true,
        paidAt: true,
        payCurrency: true,
        payAmount: true,
        exchangeRate: true,
        receivedCents: true,
        amountCents: true,
        feeCents: true,
        txHash: true,
        order: { select: { number: true } },
      },
      orderBy: { paidAt: 'asc' },
    });

    const conversiones = await this.prisma.client.cryptoSettlement.findMany({
      orderBy: { settledAt: 'asc' },
    });

    // El FIFO se calcula sobre el histórico COMPLETO, no sobre el rango: el
    // coste de lo que se vende hoy puede venir de una moneda recibida hace dos
    // años. Recortar antes de calcular daría una ganancia inventada.
    const entradas: EntradaCripto[] = cobros.map((c) => ({
      id: c.id,
      fecha: c.paidAt ?? new Date(),
      moneda: c.payCurrency ?? '',
      cantidad: c.payAmount ?? '0',
      valorEurCents: c.receivedCents > 0 ? c.receivedCents : c.amountCents,
      referencia: c.order.number,
    }));

    const salidas: SalidaCripto[] = conversiones.map((s) => ({
      id: s.id,
      fecha: s.settledAt,
      moneda: s.currency,
      cantidad: s.amount,
      valorEurCents: s.proceedsCents,
      ...(s.reference ? { referencia: s.reference } : {}),
    }));

    const resumen = resumirEjercicio(entradas, salidas);
    const { resultados } = calcularFifo(entradas, salidas);

    const enRango = <T extends { fecha: Date }>(items: T[]) =>
      items.filter((i) => i.fecha >= rango.desde && i.fecha <= rango.hasta);

    return {
      desde: rango.desde,
      hasta: rango.hasta,
      cobros: enRango(entradas).map((e) => {
        const cobro = cobros.find((c) => c.id === e.id);
        return {
          fecha: e.fecha,
          pedido: e.referencia,
          // Siempre en mayúscula: la pasarela las devuelve en minúscula y el
          // libro quedaba con "btc" y "BTC" mezclados en la misma columna.
          moneda: e.moneda.toUpperCase(),
          cantidad: e.cantidad,
          valorEurCents: e.valorEurCents,
          tipoCambio: cobro?.exchangeRate ?? null,
          comisionCents: cobro?.feeCents ?? 0,
          txHash: cobro?.txHash ?? null,
        };
      }),
      conversiones: enRango(resultados),
      // El resumen es del histórico completo: el saldo pendiente y su coste no
      // tienen sentido recortados a un trimestre.
      resumen,
      modelo721: {
        umbralCents: UMBRAL_MODELO_721_CENTS,
        // Con el coste en libros, no con el valor de mercado: la tienda no
        // consulta cotizaciones. Sirve para avisar de que conviene mirarlo,
        // no para decidir por el asesor.
        costeSaldosCents: resumen.costeSaldosCents,
        posibleObligacion: obligaModelo721(resumen.costeSaldosCents),
      },
    };
  }

  /** Registra una conversión a euros. */
  async registrarConversion(
    datos: {
      currency: string;
      amount: string;
      proceedsCents: number;
      feeCents?: number;
      venue?: string;
      reference?: string;
      txHash?: string;
      settledAt: string;
    },
    actorId?: string,
  ) {
    return this.prisma.client.cryptoSettlement.create({
      data: {
        id: newId(),
        currency: datos.currency.toUpperCase(),
        amount: datos.amount,
        proceedsCents: datos.proceedsCents,
        feeCents: datos.feeCents ?? 0,
        venue: datos.venue ?? null,
        reference: datos.reference ?? null,
        txHash: datos.txHash ?? null,
        settledAt: new Date(datos.settledAt),
        createdBy: actorId ?? null,
      },
    });
  }

  async conversiones() {
    return this.prisma.client.cryptoSettlement.findMany({ orderBy: { settledAt: 'desc' } });
  }

  /** Libro de cripto en CSV, para el asesor. */
  async csvCripto(rango: RangoFechas): Promise<string> {
    const datos = await this.cripto(rango);
    const porId = new Map((await this.conversiones()).map((c) => [c.id, c]));

    const filas = [
      ...datos.cobros.map((c) => ({
        tipo: 'Cobro',
        fecha: c.fecha,
        referencia: c.pedido ?? '',
        moneda: c.moneda,
        cantidad: c.cantidad,
        eur: c.valorEurCents,
        coste: 0,
        ganancia: 0,
      })),
      ...datos.conversiones.map((c) => ({
        tipo: 'Conversión',
        fecha: c.fecha,
        // La referencia del justificante, no el identificador interno: es lo
        // que permite localizar el documento en una comprobación.
        referencia: porId.get(c.salidaId)?.reference ?? c.salidaId,
        moneda: c.moneda,
        cantidad: c.cantidad,
        eur: c.valorEurCents,
        coste: c.costeEurCents,
        ganancia: c.gananciaEurCents,
      })),
    ].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

    return generarCsv(filas, [
      { titulo: 'Tipo', valor: (f) => f.tipo },
      { titulo: 'Fecha', valor: (f) => f.fecha },
      { titulo: 'Referencia', valor: (f) => f.referencia },
      { titulo: 'Moneda', valor: (f) => f.moneda },
      { titulo: 'Cantidad', valor: (f) => f.cantidad },
      { titulo: 'Valor en euros', valor: (f) => importe(f.eur) },
      {
        titulo: 'Coste de adquisición',
        valor: (f) => (f.tipo === 'Cobro' ? '' : importe(f.coste)),
      },
      { titulo: 'Ganancia/pérdida', valor: (f) => (f.tipo === 'Cobro' ? '' : importe(f.ganancia)) },
    ]);
  }
}
