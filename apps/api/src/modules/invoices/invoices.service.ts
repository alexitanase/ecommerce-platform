import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { extractBase, newId, objeto, taxAmount, texto } from '@ecom/shared';
import type { Prisma } from '@ecom/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { repartirProporcional } from '../orders/calculo-iva.js';
import { SettingsService } from '../settings/settings.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContextoActor } from '../roles/roles.service.js';

interface LineaFactura {
  descripcion: string;
  sku: string;
  cantidad: number;
  precioUnitarioCents: number;
  baseCents: number;
  ivaCents: number;
  totalCents: number;
  tipoIva: number;
}

/**
 * Lee el desglose por tipos guardado en una factura.
 *
 * Tolerante a propósito: las facturas emitidas antes de que existiera el campo
 * no lo tienen, y una rectificativa de una factura antigua tiene que poder
 * emitirse igual. Devolver una lista vacía deja que quien llama recurra al
 * tipo único, que es lo que esas facturas sí guardaban.
 */
function leerDesglose(valor: unknown): { tipo: number; totalCents: number }[] {
  if (!Array.isArray(valor)) return [];

  return valor.flatMap((entrada) => {
    if (!entrada || typeof entrada !== 'object') return [];
    const r = entrada as Record<string, unknown>;
    return typeof r['tipo'] === 'number' && typeof r['totalCents'] === 'number'
      ? [{ tipo: r['tipo'], totalCents: r['totalCents'] }]
      : [];
  });
}

/**
 * Emisión de facturas.
 *
 * Tres reglas que en España no son opcionales:
 *
 *  1. **Numeración correlativa sin huecos**, por serie y ejercicio. Es lo
 *     primero que revisa una inspección. Se garantiza con un contador en base
 *     de datos actualizado dentro de la misma transacción y con bloqueo de
 *     fila: sin él, dos pedidos simultáneos obtendrían el mismo número.
 *
 *  2. **Una factura emitida no se modifica ni se borra.** Si hay un error o una
 *     devolución, se emite una rectificativa que la corrige. Por eso todos los
 *     datos se congelan en la propia factura.
 *
 *  3. **La factura va siempre en euros**, aunque el cobro fuera en cripto. El
 *     importe en la moneda de pago y el tipo de cambio quedan como referencia
 *     para el asesor, pero la base imponible y la cuota son en euros.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Reserva el siguiente número de la serie.
   *
   * Va dentro de la transacción de creación de la factura y bloquea la fila del
   * contador. Es la única forma de garantizar que no hay huecos ni duplicados
   * con varios pedidos entrando a la vez.
   */
  private async siguienteNumero(
    tx: Prisma.TransactionClient,
    series: string,
    year: number,
  ): Promise<number> {
    const filas = await tx.$queryRaw<{ last: number }[]>`
      INSERT INTO invoice_counters (id, series, year, last)
      VALUES (${newId()}, ${series}, ${year}, 1)
      ON CONFLICT (series, year)
      DO UPDATE SET last = invoice_counters.last + 1
      RETURNING last
    `;

    const ultimo = filas[0]?.last;
    if (ultimo === undefined) {
      throw new Error('No se ha podido reservar el número de factura');
    }
    return ultimo;
  }

  /** Datos fiscales del emisor, congelados en cada factura. */
  private async datosEmisor(): Promise<Record<string, string>> {
    const ajustes = await this.settings.publicos();
    const texto = (clave: string): string =>
      typeof ajustes[clave] === 'string' ? ajustes[clave] : '';

    const razonSocial = texto('legal.companyName');
    const nif = texto('legal.taxId');

    // Sin datos fiscales la factura no es válida. Es preferible fallar aquí
    // con un mensaje claro que emitir un documento que no sirve.
    if (!razonSocial || !nif) {
      throw new BadRequestException(
        'Faltan los datos fiscales de la empresa. Complétalos en Ajustes → Datos fiscales ' +
          'antes de emitir facturas: sin razón social y NIF, la factura no es válida.',
      );
    }

    return {
      razonSocial,
      nif,
      domicilio: texto('legal.address'),
      email: texto('shop.contactEmail'),
    };
  }

  /**
   * Emite la factura de un pedido.
   *
   * Idempotente: si el pedido ya tiene factura, devuelve la existente en lugar
   * de emitir una segunda. Facturar dos veces el mismo pedido descuadra el
   * libro de IVA y obliga a rectificar.
   */
  async emitir(orderId: string, ctx?: ContextoActor) {
    const existente = await this.prisma.client.invoice.findFirst({
      where: { orderId, type: 'INVOICE' },
    });
    if (existente) return existente;

    const pedido = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: { where: { status: 'PAID' }, take: 1 } },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    // Solo se factura lo cobrado: una factura de un pedido sin pagar declara
    // un IVA que todavía no se ha repercutido.
    if (pedido.paymentStatus !== 'PAID') {
      throw new BadRequestException(
        `El pedido ${pedido.number} no está pagado; no se puede facturar todavía.`,
      );
    }

    const emisor = await this.datosEmisor();
    const ajustes = await this.settings.publicos();
    const serie =
      typeof ajustes['legal.invoicePrefix'] === 'string' ? ajustes['legal.invoicePrefix'] : 'ES';
    const anio = new Date().getFullYear();

    // El precio de venta lleva el IVA incluido (obligatorio en España): la
    // base se extrae, no se suma.
    const lineas: LineaFactura[] = pedido.items.map((i) => ({
      descripcion: i.name + (i.variantName ? ` · ${i.variantName}` : ''),
      sku: i.sku,
      cantidad: i.quantity,
      precioUnitarioCents: i.unitPriceCents,
      baseCents: extractBase(i.totalCents, Number(i.taxRate)),
      ivaCents: taxAmount(i.totalCents, Number(i.taxRate)),
      totalCents: i.totalCents,
      tipoIva: Number(i.taxRate),
    }));

    // Tipos presentes en el pedido, con lo que pesa cada uno. El envío y el
    // descuento no tienen tipo propio —acompañan a la mercancía— y hay que
    // repartirlos entre ellos: un pedido con un libro al 4 % y unas botas al
    // 21 % no puede llevar todo el porte a un solo tipo.
    const porTipo = new Map<number, number>();
    for (const i of pedido.items) {
      const tipo = Number(i.taxRate);
      porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + i.totalCents);
    }
    const tipos = [...porTipo.keys()].sort((a, b) => b - a);
    const pesos = tipos.map((tipo) => porTipo.get(tipo) ?? 0);

    /** Añade una línea por cada tipo, repartiendo el importe entre ellos. */
    const anadirRepartida = (importeCents: number, descripcion: string, sku: string) => {
      if (importeCents === 0 || tipos.length === 0) return;

      const partes = repartirProporcional(importeCents, pesos);

      tipos.forEach((tipo, i) => {
        const parte = partes[i] ?? 0;
        if (parte === 0) return;

        lineas.push({
          // El tipo va en la descripción cuando hay varios: en la factura
          // impresa, dos líneas de envío sin distintivo parecen un error.
          descripcion: tipos.length > 1 ? `${descripcion} (IVA ${String(tipo)} %)` : descripcion,
          sku,
          cantidad: 1,
          precioUnitarioCents: parte,
          baseCents: extractBase(parte, tipo),
          ivaCents: taxAmount(parte, tipo),
          totalCents: parte,
          tipoIva: tipo,
        });
      });
    };

    anadirRepartida(pedido.shippingCents, 'Gastos de envío', 'ENVIO');

    // Sin esta línea la factura no cuadra: las líneas sumarían el pedido sin
    // descontar mientras el total sí lo lleva descontado. No da ningún error
    // al emitirla; se ve al sumarla, con la factura ya entregada al cliente.
    anadirRepartida(-pedido.discountCents, 'Descuento', 'DESCUENTO');

    const desglose = tipos.map((tipo) => {
      const deEsteTipo = lineas.filter((l) => l.tipoIva === tipo);
      return {
        tipo,
        baseCents: deEsteTipo.reduce((a, l) => a + l.baseCents, 0),
        cuotaCents: deEsteTipo.reduce((a, l) => a + l.ivaCents, 0),
        totalCents: deEsteTipo.reduce((a, l) => a + l.totalCents, 0),
      };
    });

    // El tipo del pedido cuando hay varios no significa nada: se guarda el
    // mayoritario para los listados y el desglose es el dato bueno.
    const tipoIva =
      desglose.reduce(
        (mayor, d) => (d.totalCents > (mayor?.totalCents ?? -1) ? d : mayor),
        desglose[0],
      )?.tipo ?? 0;

    const sumaLineas = lineas.reduce((a, l) => a + l.totalCents, 0);
    if (sumaLineas !== pedido.totalCents) {
      // Emitir una factura descuadrada obliga a rectificarla, y una
      // rectificativa deja rastro permanente en la numeración. Mejor no
      // emitirla y que alguien lo mire.
      throw new BadRequestException(
        `Las líneas de la factura suman ${String(sumaLineas)} y el pedido ${pedido.number} vale ` +
          `${String(pedido.totalCents)}. No se emite una factura que no cuadra.`,
      );
    }

    const pago = pedido.payments[0];
    const direccion = pedido.billingAddress ?? pedido.shippingAddress;

    const factura = await this.prisma.client.$transaction(async (tx) => {
      const numero = await this.siguienteNumero(tx, serie, anio);
      const completo = `${serie}${String(anio)}-${String(numero).padStart(6, '0')}`;

      return tx.invoice.create({
        data: {
          id: newId(),
          type: 'INVOICE',
          series: `${serie}${String(anio)}`,
          number: numero,
          fullNumber: completo,
          orderId,
          issuerSnapshot: emisor,
          customerSnapshot: {
            ...objeto(direccion),
            email: pedido.email,
          },
          // Prisma exige InputJsonValue y un array tipado no lo satisface
          // directamente; la conversión es necesaria aquí.
          linesSnapshot: lineas as unknown as Prisma.InputJsonValue,
          taxBreakdown: desglose,
          subtotalCents: lineas.reduce((a, l) => a + l.baseCents, 0),
          taxCents: lineas.reduce((a, l) => a + l.ivaCents, 0),
          totalCents: pedido.totalCents,
          taxRate: tipoIva,
          currency: pedido.currency,
          // Referencia del cobro en cripto, para que el asesor pueda conciliar.
          cryptoAmount: pago?.payAmount ?? null,
          cryptoCurrency: pago?.payCurrency ?? null,
          exchangeRate: pago?.exchangeRate ?? null,
        },
      });
    });

    await this.prisma.client.orderEvent.create({
      data: {
        id: newId(),
        orderId,
        type: 'invoice.issued',
        description: `Factura ${factura.fullNumber} emitida`,
        actorType: ctx ? 'staff' : 'system',
        actorId: ctx?.actorId ?? null,
      },
    });

    await this.audit.registrar({
      action: 'invoice.issue',
      resource: 'invoice',
      resourceId: factura.id,
      actorId: ctx?.actorId,
      actorIp: ctx?.actorIp,
      after: { numero: factura.fullNumber, totalCents: factura.totalCents },
    });

    this.logger.log(`Factura ${factura.fullNumber} emitida para el pedido ${pedido.number}`);
    return factura;
  }

  /**
   * Emite una rectificativa.
   *
   * Es la única forma legal de corregir una factura: la original se conserva
   * intacta y la rectificativa la anula total o parcialmente.
   */
  async rectificar(
    invoiceId: string,
    datos: { motivo: string; importeCents?: number },
    ctx: ContextoActor,
  ) {
    const original = await this.prisma.client.invoice.findUnique({ where: { id: invoiceId } });
    if (!original) throw new NotFoundException('Factura no encontrada');

    if (original.type === 'CREDIT_NOTE') {
      throw new BadRequestException('No se puede rectificar una factura rectificativa');
    }

    const importe = datos.importeCents ?? original.totalCents;
    if (importe > original.totalCents) {
      throw new BadRequestException(
        'El importe a rectificar no puede superar el de la factura original',
      );
    }

    const anio = new Date().getFullYear();
    const serieBase = original.series.replace(/\d{4}$/, '');

    // La rectificativa devuelve el IVA con los mismos tipos con que se
    // repercutió. Si la factura original mezclaba tipos y se abonara todo al
    // mayoritario, se devolvería a Hacienda una cuota distinta de la ingresada
    // y las dos facturas no se compensarían entre sí.
    const tramosOriginal = leerDesglose(original.taxBreakdown);
    const tramos =
      tramosOriginal.length > 0
        ? tramosOriginal
        : [{ tipo: Number(original.taxRate), totalCents: original.totalCents }];

    const partes = repartirProporcional(
      importe,
      tramos.map((tr) => tr.totalCents),
    );

    const lineasRect = tramos
      .map((tr, i) => ({ tipo: tr.tipo, parte: partes[i] ?? 0 }))
      .filter((x) => x.parte !== 0)
      .map(({ tipo, parte }) => ({
        descripcion:
          `Rectificación de la factura ${original.fullNumber}: ${datos.motivo}` +
          (tramos.length > 1 ? ` (IVA ${String(tipo)} %)` : ''),
        sku: 'RECT',
        cantidad: 1,
        // En negativo: es un abono, no un cobro.
        precioUnitarioCents: -parte,
        baseCents: -extractBase(parte, tipo),
        ivaCents: -taxAmount(parte, tipo),
        totalCents: -parte,
        tipoIva: tipo,
      }));

    const desgloseRect = tramos
      .map((tr, i) => {
        const parte = partes[i] ?? 0;
        return {
          tipo: tr.tipo,
          baseCents: -extractBase(parte, tr.tipo),
          cuotaCents: -taxAmount(parte, tr.tipo),
          totalCents: -parte,
        };
      })
      .filter((d) => d.totalCents !== 0);

    const tipoIva = tramos.reduce(
      (mayor, tr) => (tr.totalCents > mayor.totalCents ? tr : mayor),
      tramos[0] ?? { tipo: 0, totalCents: 0 },
    ).tipo;

    const rectificativa = await this.prisma.client.$transaction(async (tx) => {
      // Las rectificativas llevan su propia serie: mezclarlas con las
      // ordinarias rompería la correlatividad de ambas.
      const serieRect = `R${serieBase}`;
      const numero = await this.siguienteNumero(tx, serieRect, anio);

      return tx.invoice.create({
        data: {
          id: newId(),
          type: 'CREDIT_NOTE',
          series: `${serieRect}${String(anio)}`,
          number: numero,
          fullNumber: `${serieRect}${String(anio)}-${String(numero).padStart(6, '0')}`,
          orderId: original.orderId,
          correctsInvoiceId: original.id,
          issuerSnapshot: original.issuerSnapshot ?? {},
          customerSnapshot: original.customerSnapshot ?? {},
          linesSnapshot: lineasRect,
          taxBreakdown: desgloseRect,
          subtotalCents: lineasRect.reduce((a, l) => a + l.baseCents, 0),
          taxCents: lineasRect.reduce((a, l) => a + l.ivaCents, 0),
          totalCents: -importe,
          taxRate: tipoIva,
          currency: original.currency,
        },
      });
    });

    await this.audit.registrar({
      action: 'invoice.credit_note',
      resource: 'invoice',
      resourceId: rectificativa.id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      metadata: { original: original.fullNumber, motivo: datos.motivo, importeCents: importe },
    });

    return rectificativa;
  }

  async porPedido(orderId: string) {
    return this.prisma.client.invoice.findMany({
      where: { orderId },
      orderBy: { issuedAt: 'asc' },
    });
  }

  /**
   * La factura de un pedido, pedida por el cliente desde su cuenta.
   *
   * Hasta ahora la factura solo la podía emitir el equipo desde el panel: el
   * cliente que la necesitaba —y en compras de empresa la necesita siempre—
   * tenía que escribir y esperar. Con esto se la emite él, que además es lo que
   * marca la ley: la factura se entrega cuando el destinatario la pide.
   *
   * Tres condiciones, y las tres se comprueban aquí y no en el panel de la
   * tienda, porque un `if` en el navegador no es una comprobación:
   *
   *  · **El pedido es suyo.** Se compara con el usuario autenticado. Sin esto,
   *    cambiar un identificador en la URL devolvería la factura de otra
   *    persona, con su nombre, su NIF y su dirección dentro.
   *  · **Está pagado.** Lo exige `emitir`, que es donde tiene que estar: una
   *    factura de algo no cobrado declara un IVA que no se ha repercutido.
   *  · **Se emite una sola vez.** `emitir` es idempotente, así que pulsar dos
   *    veces no rompe la correlatividad de la numeración, que es justo lo que
   *    revisa Hacienda.
   */
  async miFactura(orderId: string, userId: string) {
    const pedido = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, number: true, paymentStatus: true },
    });

    /*
     * Un pedido de otro se responde como «no encontrado», no como «no
     * autorizado». Con un 403, probar identificadores diría cuáles existen.
     */
    if (!pedido || pedido.userId !== userId) {
      throw new NotFoundException('Pedido no encontrado');
    }

    if (pedido.paymentStatus !== 'PAID') {
      throw new BadRequestException(
        `El pedido ${pedido.number} todavía no consta como pagado, así que aún no se puede ` +
          'facturar. En cuanto se confirme el cobro podrás descargarla desde aquí.',
      );
    }

    return this.emitir(orderId, { actorId: userId });
  }

  async detalle(invoiceId: string) {
    const factura = await this.prisma.client.invoice.findUnique({ where: { id: invoiceId } });
    if (!factura) throw new NotFoundException('Factura no encontrada');
    return factura;
  }

  /**
   * Libro de facturas emitidas de un periodo.
   *
   * Es lo que entrega el asesor para el modelo 303. Incluye las rectificativas,
   * que restan.
   */
  async libroIva(desde: Date, hasta: Date) {
    const facturas = await this.prisma.client.invoice.findMany({
      where: { issuedAt: { gte: desde, lte: hasta } },
      orderBy: [{ series: 'asc' }, { number: 'asc' }],
    });

    const baseTotal = facturas.reduce((a, f) => a + f.subtotalCents, 0);
    const ivaTotal = facturas.reduce((a, f) => a + f.taxCents, 0);

    return {
      periodo: { desde, hasta },
      facturas: facturas.map((f) => {
        // El snapshot es JSON sin tipar: se convierte con los conversores
        // seguros. Un nombre mal convertido saldría como "[object Object]" en
        // un documento fiscal que va al asesor y a Hacienda.
        const cliente = objeto(f.customerSnapshot);
        const nombreCompleto =
          texto(cliente['company']) ||
          `${texto(cliente['firstName'])} ${texto(cliente['lastName'])}`.trim();

        return {
          numero: f.fullNumber,
          tipo: f.type,
          fecha: f.issuedAt,
          cliente: nombreCompleto,
          nif: texto(cliente['taxId']),
          baseCents: f.subtotalCents,
          ivaCents: f.taxCents,
          totalCents: f.totalCents,
          tipoIva: Number(f.taxRate),
        };
      }),
      // El modelo 303 no pide un total: pide la base y la cuota de CADA tipo
      // en casillas distintas. Sin este resumen el asesor tiene que abrir
      // factura por factura para separar el 21 del 10 y del 4.
      porTipo: this.agruparPorTipo(facturas),
      totales: {
        facturas: facturas.filter((f) => f.type === 'INVOICE').length,
        rectificativas: facturas.filter((f) => f.type === 'CREDIT_NOTE').length,
        baseCents: baseTotal,
        ivaCents: ivaTotal,
        totalCents: baseTotal + ivaTotal,
      },
    };
  }

  /**
   * Suma base y cuota por tipo de IVA en un conjunto de facturas.
   *
   * Se lee del desglose guardado en cada factura. Las emitidas antes de que
   * existiera ese campo llevaban un solo tipo, así que para ellas la propia
   * factura ya es el tramo: sin ese respaldo, un trimestre antiguo saldría a
   * cero y el asesor lo daría por bueno.
   */
  private agruparPorTipo(
    facturas: {
      taxBreakdown: unknown;
      subtotalCents: number;
      taxCents: number;
      totalCents: number;
      taxRate: unknown;
    }[],
  ) {
    const porTipo = new Map<
      number,
      { baseCents: number; cuotaCents: number; totalCents: number }
    >();

    const acumular = (tipo: number, base: number, cuota: number, total: number) => {
      const actual = porTipo.get(tipo) ?? { baseCents: 0, cuotaCents: 0, totalCents: 0 };
      porTipo.set(tipo, {
        baseCents: actual.baseCents + base,
        cuotaCents: actual.cuotaCents + cuota,
        totalCents: actual.totalCents + total,
      });
    };

    for (const f of facturas) {
      const tramos = Array.isArray(f.taxBreakdown) ? f.taxBreakdown : [];
      let leidos = 0;

      for (const entrada of tramos) {
        if (!entrada || typeof entrada !== 'object') continue;
        const r = entrada as Record<string, unknown>;
        if (typeof r['tipo'] !== 'number') continue;

        acumular(
          r['tipo'],
          typeof r['baseCents'] === 'number' ? r['baseCents'] : 0,
          typeof r['cuotaCents'] === 'number' ? r['cuotaCents'] : 0,
          typeof r['totalCents'] === 'number' ? r['totalCents'] : 0,
        );
        leidos++;
      }

      if (leidos === 0) {
        acumular(Number(f.taxRate), f.subtotalCents, f.taxCents, f.totalCents);
      }
    }

    return [...porTipo.entries()]
      .map(([tipo, importes]) => ({ tipo, ...importes }))
      .sort((a, b) => b.tipo - a.tipo);
  }

  /**
   * Comprueba que no hay huecos en la numeración.
   *
   * Un hueco significa que se reservó un número y la factura no llegó a
   * crearse. Detectarlo antes de que lo haga una inspección permite emitir la
   * que falta o justificar la anulación.
   */
  async comprobarCorrelatividad(anio: number = new Date().getFullYear()) {
    const contadores = await this.prisma.client.invoiceCounter.findMany({ where: { year: anio } });
    const problemas: { serie: string; huecos: number[] }[] = [];

    for (const contador of contadores) {
      const emitidas = await this.prisma.client.invoice.findMany({
        where: { series: { startsWith: contador.series }, number: { lte: contador.last } },
        select: { number: true },
        orderBy: { number: 'asc' },
      });

      const numeros = new Set(emitidas.map((e) => e.number));
      const huecos: number[] = [];

      for (let n = 1; n <= contador.last; n++) {
        if (!numeros.has(n)) huecos.push(n);
      }

      if (huecos.length > 0) problemas.push({ serie: contador.series, huecos });
    }

    return { anio, correlativo: problemas.length === 0, problemas };
  }
}
