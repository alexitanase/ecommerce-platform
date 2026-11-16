import { Injectable, Logger } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  descuentoAnunciable,
  minimoUltimos30Dias,
  type Descuento,
  type PuntoPrecio,
} from './transparencia-precios.js';

/**
 * Histórico de precios.
 *
 * Se registra en TODOS los sitios que cambian un precio: importación, edición
 * en el admin y sincronización automática con el proveedor. Si alguno se
 * quedara fuera, el mínimo de los 30 días saldría mal y la tienda anunciaría
 * descuentos que no puede justificar ante una inspección.
 *
 * Por eso el registro vive aquí y no repartido: hay un único punto que
 * mantener cuando aparezca una cuarta forma de cambiar precios.
 */
@Injectable()
export class PriceHistoryService {
  private readonly logger = new Logger(PriceHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Anota el precio si ha cambiado.
   *
   * Solo cuando cambia: registrar el mismo precio en cada sincronización
   * llenaría la tabla de ruido y, peor, movería la fecha de inicio del precio
   * vigente, desplazando la ventana de referencia cada tres horas.
   */
  async registrarSiCambia(
    variantId: string,
    nuevoPrecioCents: number,
    origen: string,
  ): Promise<void> {
    const ultimo = await this.prisma.client.priceHistory.findFirst({
      where: { variantId },
      orderBy: { validFrom: 'desc' },
      select: { priceCents: true },
    });

    if (ultimo?.priceCents === nuevoPrecioCents) return;

    await this.prisma.client.priceHistory.create({
      data: {
        id: newId(),
        variantId,
        priceCents: nuevoPrecioCents,
        source: origen,
      },
    });
  }

  /** Igual, pero para varias variantes de una vez. */
  async registrarVarios(
    cambios: { variantId: string; priceCents: number }[],
    origen: string,
  ): Promise<void> {
    await Promise.all(
      cambios.map((c) => this.registrarSiCambia(c.variantId, c.priceCents, origen)),
    );
  }

  private async historicoDe(variantId: string): Promise<PuntoPrecio[]> {
    const filas = await this.prisma.client.priceHistory.findMany({
      // 60 días es de sobra para una ventana de 30 y evita arrastrar años de
      // historial en cada consulta de ficha de producto.
      where: { variantId, validFrom: { gte: new Date(Date.now() - 60 * 86_400_000) } },
      orderBy: { validFrom: 'asc' },
      select: { priceCents: true, validFrom: true },
    });

    return filas;
  }

  /**
   * Descuento que se puede anunciar para una variante.
   *
   * Lo consume la ficha de producto: es lo que decide si se tacha un precio y
   * con qué importe.
   */
  async descuentoDe(variantId: string, precioActualCents: number): Promise<Descuento> {
    return descuentoAnunciable(await this.historicoDe(variantId), precioActualCents);
  }

  /** Descuentos de varias variantes, para un listado. */
  async descuentosDe(
    variantes: { id: string; priceCents: number }[],
  ): Promise<Map<string, Descuento>> {
    const ids = variantes.map((v) => v.id);
    if (ids.length === 0) return new Map();

    const filas = await this.prisma.client.priceHistory.findMany({
      where: { variantId: { in: ids }, validFrom: { gte: new Date(Date.now() - 60 * 86_400_000) } },
      orderBy: { validFrom: 'asc' },
      select: { variantId: true, priceCents: true, validFrom: true },
    });

    const porVariante = new Map<string, PuntoPrecio[]>();
    for (const f of filas) {
      const lista = porVariante.get(f.variantId) ?? [];
      lista.push({ priceCents: f.priceCents, validFrom: f.validFrom });
      porVariante.set(f.variantId, lista);
    }

    return new Map(
      variantes.map((v) => [v.id, descuentoAnunciable(porVariante.get(v.id) ?? [], v.priceCents)]),
    );
  }

  /** Precio mínimo de referencia, para enseñarlo junto al descuento. */
  async minimoDe(variantId: string): Promise<number | null> {
    return minimoUltimos30Dias(await this.historicoDe(variantId));
  }

  /**
   * Rellena el histórico de las variantes que no lo tengan.
   *
   * Sin punto de partida no habría referencia y ningún producto podría
   * anunciarse rebajado. Se ejecuta una vez al desplegar esta funcionalidad.
   */
  async inicializar(): Promise<number> {
    const sinHistorico = await this.prisma.client.productVariant.findMany({
      where: { deletedAt: null, priceHistory: { none: {} } },
      select: { id: true, priceCents: true, createdAt: true },
    });

    if (sinHistorico.length === 0) return 0;

    await this.prisma.client.priceHistory.createMany({
      data: sinHistorico.map((v) => ({
        id: newId(),
        variantId: v.id,
        priceCents: v.priceCents,
        source: 'inicial',
        // Con la fecha de creación de la variante, no la de hoy: es cuando
        // ese precio empezó a regir de verdad.
        validFrom: v.createdAt,
      })),
    });

    this.logger.log(`Histórico de precios inicializado para ${sinHistorico.length} variantes`);
    return sinHistorico.length;
  }
}
