import { Injectable } from '@nestjs/common';
import { addTax, extractBase, taxAmount, type Cents } from '@ecom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  cargoFijoAplicable,
  costeDeCompra,
  margenDeVenta,
  pvpParaMargen,
  type ParametrosPvp,
} from './margen.js';

/**
 * Reglas de precio del catálogo.
 *
 * Nota importante sobre el IVA: en España los precios mostrados al consumidor
 * deben incluir impuestos. Por eso `priceCents` es siempre el precio FINAL que
 * paga el cliente, y la base imponible se extrae de él. Guardar la base y sumar
 * el IVA al mostrarlo produce precios como 12,09 € en el escaparate.
 */
export interface DesglosePrecio {
  /** Precio final que paga el cliente, con IVA incluido. */
  totalCents: Cents;
  /** Base imponible. */
  baseCents: Cents;
  /** Cuota de IVA. */
  ivaCents: Cents;
  taxRate: number;
  /** Precio tachado, si hay promoción. */
  compareAtCents: Cents | null;
  descuentoPorcentaje: number | null;
}

export interface AnalisisMargen {
  precioVenta: Cents;
  /** Lo que queda del precio una vez descontado el IVA: el ingreso real. */
  ingresoCents: Cents;
  coste: Cents;
  /** Beneficio antes de comisiones de pasarela. */
  margenBrutoCents: Cents;
  margenPorcentaje: number;
  /** Multiplicador sobre el coste (markup). */
  multiplicador: number;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Desglosa un precio con IVA incluido en base y cuota. */
  desglosar(precioConIva: Cents, taxRate: number, compareAt?: Cents | null): DesglosePrecio {
    const base = extractBase(precioConIva, taxRate);
    const iva = taxAmount(precioConIva, taxRate);

    const descuento =
      compareAt && compareAt > precioConIva
        ? Math.round(((compareAt - precioConIva) / compareAt) * 100)
        : null;

    return {
      totalCents: precioConIva,
      baseCents: base,
      ivaCents: iva,
      taxRate,
      compareAtCents: compareAt ?? null,
      descuentoPorcentaje: descuento,
    };
  }

  /**
   * El margen de vender a `precioVenta` algo que cuesta `coste`.
   *
   * `taxRate` no es opcional a propósito. Cuando lo era, todo el sistema medía
   * el margen contra el precio con IVA y daba cifras infladas en veinte puntos:
   * un artículo «al 26 %» dejaba un 11 %. Ver `margen.ts`.
   */
  analizarMargen(precioVenta: Cents, coste: Cents, taxRate: number): AnalisisMargen {
    const m = margenDeVenta(precioVenta, coste, taxRate);
    return {
      precioVenta,
      ingresoCents: m.ingresoCents,
      coste,
      margenBrutoCents: m.margenCents,
      margenPorcentaje: m.porcentaje,
      multiplicador: m.multiplicador,
    };
  }

  /**
   * Calcula el PVP a partir del coste del proveedor.
   *
   * Se aplica el margen objetivo sobre la BASE, se le añade el IVA y se redondea
   * a una terminación psicológica (x,99), que mide mejor en conversión. La
   * cuenta vive en `margen.ts`, que es donde está explicado por qué el orden de
   * esos tres pasos es lo que decide si se gana o se pierde dinero.
   */
  calcularPvp(parametros: ParametrosPvp) {
    return pvpParaMargen(parametros);
  }

  /** Aplica el IVA a un precio sin impuestos (para importar costes de proveedor). */
  aplicarIva(baseCents: Cents, taxRate: number): Cents {
    return addTax(baseCents, taxRate);
  }

  /**
   * Productos vendiéndose por debajo del margen indicado.
   * Detecta el caso típico del dropshipping: el proveedor sube el precio y
   * nosotros seguimos vendiendo al mismo PVP, perdiendo dinero en cada pedido.
   */
  async variantesBajoMargen(margenMinimo = 20) {
    const variantes = await this.prisma.client.productVariant.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        sku: true,
        priceCents: true,
        costCents: true,
        product: { select: { id: true, handle: true, status: true, taxRate: true } },
      },
    });

    /*
     * El coste que manda es el del proveedor, no la copia de la variante: esa
     * se queda atrás cuando el proveedor sube el precio, que es justamente el
     * caso que este informe existe para encontrar. Y lleva aparte el porte, que
     * también se paga.
     *
     * Una consulta para todas las variantes: `supplier_products` no tiene
     * relación declarada con `ProductVariant`, así que se cruzan aquí.
     */
    const enlaces = await this.prisma.client.supplierProduct.findMany({
      where: { variantId: { in: variantes.map((v) => v.id) } },
      select: {
        variantId: true,
        costCents: true,
        shippingCents: true,
        supplier: {
          select: {
            purchaseSurchargePct: true,
            importFeeCents: true,
            importFeeThresholdCents: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const costeDeProveedor = new Map<string, number>();
    for (const e of enlaces) {
      if (e.variantId && !costeDeProveedor.has(e.variantId)) {
        costeDeProveedor.set(
          e.variantId,
          costeDeCompra(
            {
              costCents: e.costCents,
              envioCents: e.shippingCents,
              cargoFijoCents: cargoFijoAplicable(e.costCents, {
                importeCents: e.supplier.importFeeCents,
                umbralCents: e.supplier.importFeeThresholdCents,
              }),
            },
            Number(e.supplier.purchaseSurchargePct),
          ),
        );
      }
    }

    return (
      variantes
        .map((v) => {
          const coste = costeDeProveedor.get(v.id) ?? v.costCents ?? 0;

          return {
            variantId: v.id,
            sku: v.sku,
            productId: v.product.id,
            handle: v.product.handle,
            status: v.product.status,
            ...this.analizarMargen(v.priceCents, coste, Number(v.product.taxRate)),
          };
        })
        // Sin coste conocido no se puede decir nada: aparecerían todas al 100 %
        // de margen o todas a pérdida según de dónde saliera el cero.
        .filter((v) => v.coste > 0 && v.margenPorcentaje < margenMinimo)
        .sort((a, b) => a.margenPorcentaje - b.margenPorcentaje)
    );
  }
}
