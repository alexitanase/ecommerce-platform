import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../cache/cache.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import {
  elegirZona,
  opcionesAplicables,
  type ZonaEnvio,
  type TarifaEnvio,
} from './calculo-envio.js';

/**
 * Zonas y tarifas de envío.
 *
 * El cálculo puro vive en `calculo-envio.ts` y aquí solo se orquesta: así la
 * parte con reglas fiscales se prueba sin base de datos ni red.
 */

export interface DestinoEnvio {
  countryCode: string;
  postalCode: string;
}

export interface OpcionEnvio {
  rateId: string;
  nombre: string;
  transportista: string | null;
  precioCents: number;
  gratis: boolean;
  minDias: number;
  maxDias: number;
  /** La zona está fuera del territorio IVA (Canarias, Ceuta, Melilla). */
  sinIva: boolean;
  /** Hay que advertir de trámites aduaneros antes de comprar. */
  avisoAduanas: boolean;
}

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  /** Las zonas cambian muy de tanto en tanto y se consultan en cada checkout. */
  private static readonly ESPACIO = 'envios';
  private static readonly TTL = 600;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
  ) {}

  // ── Cálculo para el checkout ──────────────────────────────

  private async zonasActivas(): Promise<ZonaEnvio[]> {
    return this.cache.recordar(ShippingService.ESPACIO, 'zonas', ShippingService.TTL, async () => {
      const zonas = await this.prisma.client.shippingZone.findMany({
        where: { isActive: true, deletedAt: null },
        include: {
          rates: {
            where: { isActive: true, deletedAt: null },
            orderBy: { position: 'asc' },
          },
        },
        orderBy: { priority: 'desc' },
      });

      return zonas.map((z) => ({
        id: z.id,
        name: z.name,
        countries: z.countries,
        postalPrefixes: z.postalPrefixes,
        excludedPostalPrefixes: z.excludedPostalPrefixes,
        outsideVatTerritory: z.outsideVatTerritory,
        customsWarning: z.customsWarning,
        priority: z.priority,
        rates: z.rates.map((r): TarifaEnvio => ({
          id: r.id,
          name: r.name,
          carrier: r.carrier,
          type: r.type,
          priceCents: r.priceCents,
          freeFromCents: r.freeFromCents,
          minWeightGrams: r.minWeightGrams,
          maxWeightGrams: r.maxWeightGrams,
          minOrderCents: r.minOrderCents,
          maxOrderCents: r.maxOrderCents,
          minDays: r.minDays,
          maxDays: r.maxDays,
        })),
      }));
    });
  }

  /**
   * Opciones de envío para un destino y un carrito.
   *
   * @param subtotalCents importe de los productos, SIN envío
   * @param pesoGramos peso total; 0 si ningún producto lo declara
   */
  async opciones(
    destino: DestinoEnvio,
    subtotalCents: number,
    pesoGramos: number,
  ): Promise<{ zona: string; opciones: OpcionEnvio[] }> {
    const zonas = await this.zonasActivas();
    const zona = elegirZona(zonas, destino.countryCode, destino.postalCode);

    if (!zona) {
      // Mejor decirlo claro que devolver una lista vacía: el cliente tiene que
      // saber que no llegamos ahí antes de rellenar todo el checkout.
      throw new BadRequestException(
        'No hacemos envíos a esa dirección. Comprueba el país y el código postal.',
      );
    }

    const opciones = opcionesAplicables(zona, subtotalCents, pesoGramos).map((o): OpcionEnvio => ({
      rateId: o.tarifa.id,
      nombre: o.tarifa.name,
      transportista: o.tarifa.carrier,
      precioCents: o.precioCents,
      gratis: o.precioCents === 0,
      minDias: o.tarifa.minDays,
      maxDias: o.tarifa.maxDays,
      sinIva: zona.outsideVatTerritory,
      avisoAduanas: zona.customsWarning,
    }));

    return { zona: zona.name, opciones };
  }

  /**
   * Opciones de envío de un carrito, con el importe y el peso puestos por
   * nosotros.
   *
   * Es lo que usa el checkout para enseñar el porte antes de pagar, y busca los
   * precios y los pesos en el catálogo por el mismo motivo por el que lo hace la
   * creación del pedido: si se aceptara el subtotal que manda el navegador,
   * cualquiera pondría el que hace saltar el envío gratis. Y aunque nadie
   * hiciera trampa, el navegador **no conoce el peso**, así que una tarifa por
   * tramos daría un precio en el checkout y otro en la factura.
   *
   * Las variantes que ya no existen se ignoran en vez de tumbar la consulta:
   * esto solo informa, y el pedido volverá a comprobarlas una por una.
   */
  async opcionesDeCarrito(
    destino: DestinoEnvio,
    lineas: { variantId: string; quantity: number }[],
  ): Promise<{ zona: string; opciones: OpcionEnvio[]; subtotalCents: number }> {
    const variantes = await this.prisma.client.productVariant.findMany({
      where: { id: { in: lineas.map((l) => l.variantId) }, deletedAt: null },
      select: { id: true, priceCents: true, weightGrams: true },
    });

    let subtotalCents = 0;
    let pesoGramos = 0;

    for (const linea of lineas) {
      const variante = variantes.find((v) => v.id === linea.variantId);
      if (!variante) continue;
      subtotalCents += variante.priceCents * linea.quantity;
      pesoGramos += (variante.weightGrams ?? 0) * linea.quantity;
    }

    const { zona, opciones } = await this.opciones(destino, subtotalCents, pesoGramos);
    return { zona, opciones, subtotalCents };
  }

  /**
   * Vuelve a calcular el precio de una tarifa concreta al confirmar el pedido.
   *
   * Nunca se acepta el importe que manda el navegador: si se aceptara, cualquiera
   * podría enviar `precio: 0` y llevarse el envío gratis. Se recalcula aquí con
   * los mismos datos y se compara.
   */
  async precioDe(
    rateId: string,
    destino: DestinoEnvio,
    subtotalCents: number,
    pesoGramos: number,
  ): Promise<OpcionEnvio> {
    const { opciones } = await this.opciones(destino, subtotalCents, pesoGramos);
    const elegida = opciones.find((o) => o.rateId === rateId);

    if (!elegida) {
      throw new BadRequestException(
        'La opción de envío elegida ya no está disponible para esta dirección.',
      );
    }

    return elegida;
  }

  // ── Administración ────────────────────────────────────────

  async listarZonas() {
    return this.prisma.client.shippingZone.findMany({
      where: { deletedAt: null },
      include: { rates: { where: { deletedAt: null }, orderBy: { position: 'asc' } } },
      orderBy: { priority: 'desc' },
    });
  }

  async crearZona(datos: Omit<ZonaEnvio, 'id' | 'rates'>, ctx: ContextoActor) {
    const zona = await this.prisma.client.shippingZone.create({
      data: { id: newId(), ...datos },
    });

    await this.invalidar();
    await this.audit.registrar({
      action: 'shipping.zone.create',
      resource: 'shipping_zone',
      resourceId: zona.id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { nombre: zona.name },
    });

    return zona;
  }

  async actualizarZona(
    id: string,
    datos: Partial<Omit<ZonaEnvio, 'id' | 'rates'>>,
    ctx: ContextoActor,
  ) {
    const antes = await this.prisma.client.shippingZone.findUnique({ where: { id } });
    const zona = await this.prisma.client.shippingZone.update({ where: { id }, data: datos });

    await this.invalidar();
    await this.audit.registrar({
      action: 'shipping.zone.update',
      resource: 'shipping_zone',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { nombre: antes?.name },
      after: { nombre: zona.name },
    });

    return zona;
  }

  async borrarZona(id: string, ctx: ContextoActor) {
    await this.prisma.client.shippingZone.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.invalidar();
    await this.audit.registrar({
      action: 'shipping.zone.delete',
      resource: 'shipping_zone',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
    });
  }

  async crearTarifa(zoneId: string, datos: Omit<TarifaEnvio, 'id'> & { position?: number }) {
    const tarifa = await this.prisma.client.shippingRate.create({
      data: { id: newId(), zoneId, ...datos },
    });
    await this.invalidar();
    return tarifa;
  }

  async actualizarTarifa(id: string, datos: Partial<Omit<TarifaEnvio, 'id'>>) {
    const tarifa = await this.prisma.client.shippingRate.update({ where: { id }, data: datos });
    await this.invalidar();
    return tarifa;
  }

  async borrarTarifa(id: string) {
    await this.prisma.client.shippingRate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.invalidar();
  }

  private async invalidar(): Promise<void> {
    await this.cache.invalidarEspacio(ShippingService.ESPACIO);
  }
}
