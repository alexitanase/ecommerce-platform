import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import crypto from 'node:crypto';
import { newId, type Locale } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { cambiosDePrecio, fusionarCarritos, type LineaFusion } from './fusion-carrito.js';

/**
 * Carrito persistente.
 *
 * Regla que gobierna todo el módulo: **aquí no se guardan importes**. El precio
 * se lee del catálogo en cada consulta. Guardarlo convertiría un carrito de
 * hace tres semanas en un derecho a comprar al precio de entonces, y en
 * dropshipping los costes del proveedor cambian cada pocos días.
 *
 * `priceWhenAddedCents` es la única excepción y no se cobra nunca: sirve solo
 * para avisar al cliente de que el precio ha cambiado desde que lo añadió.
 */

/** Un carrito de invitado vive 30 días; el de un cliente identificado, 90. */
const DIAS_INVITADO = 30;
const DIAS_REGISTRADO = 90;

/** Tope por línea. El mismo que acepta el pedido. */
const MAX_POR_LINEA = 99;

export interface CarritoVisible {
  id: string;
  token: string;
  locale: string;
  lineas: {
    id: string;
    variantId: string;
    /** Necesario para que la tienda pueda reconstruir su carrito local. */
    productId: string;
    sku: string;
    nombre: string;
    variante: string | null;
    imagen: string | null;
    slug: string | null;
    cantidad: number;
    precioUnitarioCents: number;
    totalCents: number;
    /** Stock disponible ahora mismo, para poder avisar en la interfaz. */
    disponible: number;
    /** El precio ha cambiado desde que se añadió. */
    precioAnteriorCents: number | null;
  }[];
  subtotalCents: number;
  totalUnidades: number;
  /** Líneas que hubo que ajustar o descartar al cargar el carrito. */
  avisos: string[];
}

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(private readonly prisma: PrismaService) {}

  private caducidad(registrado: boolean): Date {
    const dias = registrado ? DIAS_REGISTRADO : DIAS_INVITADO;
    return new Date(Date.now() + dias * 86_400_000);
  }

  /** Token opaco de invitado: no puede ser adivinable ni delatar volumen. */
  private nuevoToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  // ── Obtener o crear ───────────────────────────────────────

  /**
   * Devuelve el carrito del usuario o del token, creándolo si no existe.
   *
   * Un cliente identificado tiene siempre UN carrito. Si llega con token de
   * invitado y además está identificado, se fusionan: es el caso de quien
   * añade cosas y luego entra en su cuenta.
   */
  async obtenerOCrear(opciones: {
    token?: string;
    userId?: string;
    locale?: Locale;
  }): Promise<{ id: string; token: string }> {
    const { token, userId, locale = 'es' } = opciones;

    if (userId) {
      const suyo = await this.prisma.client.cart.findFirst({
        where: { userId, convertedAt: null },
        orderBy: { lastActivityAt: 'desc' },
      });

      if (token) {
        const invitado = await this.prisma.client.cart.findUnique({ where: { token } });

        // Solo se fusiona un carrito de invitado de verdad: si el token ya
        // pertenece a otra persona, mezclarlos le enseñaría a un cliente el
        // carrito de otro.
        if (invitado && !invitado.userId && invitado.id !== suyo?.id) {
          return this.fusionar(invitado.id, suyo?.id ?? null, userId, locale);
        }
      }

      if (suyo) return { id: suyo.id, token: suyo.token };

      return this.crear({ userId, locale });
    }

    if (token) {
      const existente = await this.prisma.client.cart.findUnique({ where: { token } });
      // Un carrito ya convertido en pedido no se reutiliza: el cliente vería
      // dentro lo que acaba de comprar.
      if (existente && !existente.convertedAt && existente.expiresAt > new Date()) {
        return { id: existente.id, token: existente.token };
      }
    }

    return this.crear({ locale });
  }

  /**
   * Refleja en el servidor el carrito que el cliente lleva en el navegador.
   *
   * Se sustituyen las líneas en lugar de fusionarlas: la copia buena es la del
   * navegador, y fusionar dejaría en el correo de abandono productos que el
   * cliente ya había quitado.
   *
   * Las líneas que ya no se pueden vender se descartan en silencio, sin
   * romper: esto no es un checkout, es una copia para poder escribirle.
   */
  async sincronizar(
    cartId: string,
    datos: { email?: string; lineas: { variantId: string; cantidad: number }[] },
  ): Promise<void> {
    const variantes = await this.prisma.client.productVariant.findMany({
      where: {
        id: { in: datos.lineas.map((l) => l.variantId) },
        deletedAt: null,
        isActive: true,
        product: { status: 'ACTIVE', deletedAt: null },
      },
      select: { id: true, priceCents: true },
    });

    await this.prisma.client.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { cartId } });

      const items = datos.lineas.flatMap((l) => {
        const v = variantes.find((x) => x.id === l.variantId);
        if (!v) return [];

        return [
          {
            id: newId(),
            cartId,
            variantId: v.id,
            quantity: l.cantidad,
            priceWhenAddedCents: v.priceCents,
          },
        ];
      });

      if (items.length > 0) await tx.cartItem.createMany({ data: items });

      await tx.cart.update({
        where: { id: cartId },
        data: {
          lastActivityAt: new Date(),
          ...(datos.email ? { email: datos.email.toLowerCase() } : {}),
          // Volver a tocar el carrito reabre la secuencia: quien vuelve, lo
          // amplía y se va otra vez merece otro recordatorio, no seguir en la
          // etapa donde se quedó hace tres días.
          recoveryStage: 0,
          lastRecoveryAt: null,
        },
      });
    });
  }

  /**
   * Carrito por su token, para el enlace del correo de abandono.
   *
   * Un carrito ya comprado o caducado no se devuelve: quien pulsa el enlace
   * dos semanas después debe ver que ya no está, no un carrito revivido con
   * precios de hace un mes.
   */
  async porToken(token: string): Promise<{ id: string; token: string }> {
    const carrito = await this.prisma.client.cart.findUnique({ where: { token } });

    if (!carrito || carrito.convertedAt || carrito.expiresAt <= new Date()) {
      throw new NotFoundException('Este carrito ya no está disponible');
    }

    // Volver desde el correo cuenta como actividad: si no, el carrito seguiría
    // pareciendo abandonado y recibiría el siguiente aviso mientras el cliente
    // lo está mirando.
    await this.prisma.client.cart.update({
      where: { id: carrito.id },
      data: { lastActivityAt: new Date() },
    });

    return { id: carrito.id, token: carrito.token };
  }

  private async crear(datos: { userId?: string; locale?: string }): Promise<{
    id: string;
    token: string;
  }> {
    const carrito = await this.prisma.client.cart.create({
      data: {
        id: newId(),
        token: this.nuevoToken(),
        userId: datos.userId ?? null,
        locale: datos.locale ?? 'es',
        expiresAt: this.caducidad(Boolean(datos.userId)),
      },
    });

    return { id: carrito.id, token: carrito.token };
  }

  /**
   * Une el carrito de invitado con el de la cuenta.
   *
   * Todo en una transacción: si fallara a medias, el cliente podría quedarse
   * con las líneas duplicadas en los dos carritos.
   */
  private async fusionar(
    invitadoId: string,
    cuentaId: string | null,
    userId: string,
    locale: string,
  ): Promise<{ id: string; token: string }> {
    return this.prisma.client.$transaction(async (tx) => {
      const [invitado, cuenta] = await Promise.all([
        tx.cart.findUniqueOrThrow({ where: { id: invitadoId }, include: { items: true } }),
        cuentaId
          ? tx.cart.findUnique({ where: { id: cuentaId }, include: { items: true } })
          : Promise.resolve(null),
      ]);

      const aLinea = (i: { variantId: string; quantity: number; priceWhenAddedCents: number }) =>
        ({
          variantId: i.variantId,
          quantity: i.quantity,
          priceWhenAddedCents: i.priceWhenAddedCents,
        }) satisfies LineaFusion;

      const variantIds = [
        ...new Set([
          ...invitado.items.map((i) => i.variantId),
          ...(cuenta?.items ?? []).map((i) => i.variantId),
        ]),
      ];

      const variantes = await tx.productVariant.findMany({
        where: { id: { in: variantIds }, deletedAt: null },
        select: { id: true, stock: true },
      });
      const stock = new Map(variantes.map((v) => [v.id, v.stock]));

      const { lineas, recortadas } = fusionarCarritos(
        (cuenta?.items ?? []).map(aLinea),
        invitado.items.map(aLinea),
        stock,
        MAX_POR_LINEA,
      );

      if (recortadas.length > 0) {
        this.logger.log(
          `Fusión de carritos para ${userId}: ${recortadas.length} línea(s) ajustadas por stock`,
        );
      }

      // Se conserva el carrito de la cuenta si existía, para no perder su
      // historial de actividad ni el cupón que pudiera tener aplicado.
      const destinoId = cuenta?.id ?? invitado.id;

      await tx.cartItem.deleteMany({ where: { cartId: destinoId } });
      await tx.cartItem.createMany({
        data: lineas.map((l) => ({
          id: newId(),
          cartId: destinoId,
          variantId: l.variantId,
          quantity: l.quantity,
          priceWhenAddedCents: l.priceWhenAddedCents,
        })),
      });

      if (cuenta && invitado.id !== cuenta.id) {
        // El de invitado se elimina: ya no aporta nada y dejarlo vivo haría
        // que un aviso de carrito abandonado saliera por duplicado.
        await tx.cart.delete({ where: { id: invitado.id } });
      }

      const destino = await tx.cart.update({
        where: { id: destinoId },
        data: {
          userId,
          locale,
          lastActivityAt: new Date(),
          expiresAt: this.caducidad(true),
        },
      });

      return { id: destino.id, token: destino.token };
    });
  }

  // ── Consulta ──────────────────────────────────────────────

  /**
   * Contenido del carrito con precios y stock frescos del catálogo.
   */
  async ver(cartId: string, locale: Locale = 'es'): Promise<CarritoVisible> {
    const carrito = await this.prisma.client.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            variant: {
              include: {
                optionValues: { include: { optionValue: true } },
                product: {
                  include: {
                    translations: true,
                    media: { where: { deletedAt: null }, orderBy: { position: 'asc' }, take: 1 },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!carrito) throw new NotFoundException('Carrito no encontrado');

    const avisos: string[] = [];
    const lineas: CarritoVisible['lineas'] = [];
    let subtotal = 0;
    let unidades = 0;

    const cambios = cambiosDePrecio(
      carrito.items.map((i) => ({
        variantId: i.variantId,
        priceWhenAddedCents: i.priceWhenAddedCents,
      })),
      new Map(carrito.items.map((i) => [i.variantId, i.variant.priceCents])),
    );

    for (const item of carrito.items) {
      const v = item.variant;

      // Un producto retirado del catálogo no puede seguir en el carrito: al
      // pagar fallaría, y el cliente ya se habría hecho a la idea.
      if (v.deletedAt || v.product.status !== 'ACTIVE' || v.product.deletedAt) {
        avisos.push(`"${v.sku}" ya no está disponible y se ha quitado del carrito.`);
        await this.prisma.client.cartItem.delete({ where: { id: item.id } });
        continue;
      }

      const traduccion =
        v.product.translations.find((t) => t.locale === locale) ?? v.product.translations[0];
      const cantidad = Math.min(item.quantity, v.stock);

      if (cantidad === 0) {
        avisos.push(`"${traduccion?.name ?? v.sku}" se ha quedado sin stock.`);
        await this.prisma.client.cartItem.delete({ where: { id: item.id } });
        continue;
      }

      if (cantidad < item.quantity) {
        avisos.push(
          `De "${traduccion?.name ?? v.sku}" solo quedan ${cantidad}; se ha ajustado la cantidad.`,
        );
        await this.prisma.client.cartItem.update({
          where: { id: item.id },
          data: { quantity: cantidad },
        });
      }

      const cambio = cambios.find((c) => c.variantId === item.variantId);
      const totalLinea = v.priceCents * cantidad;

      subtotal += totalLinea;
      unidades += cantidad;

      lineas.push({
        id: item.id,
        variantId: v.id,
        productId: v.product.id,
        sku: v.sku,
        nombre: traduccion?.name ?? v.sku,
        variante: v.optionValues.map((ov) => ov.optionValue.value).join(' / ') || null,
        imagen: v.product.media[0]?.url ?? null,
        slug: traduccion?.slug ?? null,
        cantidad,
        precioUnitarioCents: v.priceCents,
        totalCents: totalLinea,
        disponible: v.stock,
        precioAnteriorCents: cambio ? cambio.anteriorCents : null,
      });
    }

    return {
      id: carrito.id,
      token: carrito.token,
      locale: carrito.locale,
      lineas,
      subtotalCents: subtotal,
      totalUnidades: unidades,
      avisos,
    };
  }

  // ── Modificación ──────────────────────────────────────────

  async añadir(cartId: string, variantId: string, cantidad: number): Promise<void> {
    if (cantidad < 1) throw new BadRequestException('La cantidad debe ser al menos 1');

    const variante = await this.prisma.client.productVariant.findFirst({
      where: { id: variantId, deletedAt: null, isActive: true },
      include: { product: { select: { status: true, deletedAt: true } } },
    });

    if (!variante || variante.product.status !== 'ACTIVE' || variante.product.deletedAt) {
      throw new NotFoundException('El producto no está disponible');
    }

    const existente = await this.prisma.client.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId } },
    });

    // Se suma sobre lo que ya hubiera: añadir dos veces el mismo producto es
    // pedir tres unidades, no crear dos líneas de uno.
    const total = (existente?.quantity ?? 0) + cantidad;
    const permitida = Math.min(total, variante.stock, MAX_POR_LINEA);

    if (permitida <= 0) {
      throw new BadRequestException('No queda stock de este producto');
    }

    await this.prisma.client.cartItem.upsert({
      where: { cartId_variantId: { cartId, variantId } },
      create: {
        id: newId(),
        cartId,
        variantId,
        quantity: permitida,
        priceWhenAddedCents: variante.priceCents,
      },
      update: { quantity: permitida },
    });

    await this.tocar(cartId);
  }

  async cambiarCantidad(cartId: string, itemId: string, cantidad: number): Promise<void> {
    if (cantidad < 0) throw new BadRequestException('La cantidad no puede ser negativa');

    const item = await this.prisma.client.cartItem.findFirst({
      where: { id: itemId, cartId },
      include: { variant: { select: { stock: true } } },
    });

    if (!item) throw new NotFoundException('La línea no está en este carrito');

    if (cantidad === 0) {
      await this.prisma.client.cartItem.delete({ where: { id: itemId } });
      await this.tocar(cartId);
      return;
    }

    const permitida = Math.min(cantidad, item.variant.stock, MAX_POR_LINEA);

    if (permitida < cantidad) {
      throw new BadRequestException(`Solo quedan ${item.variant.stock} unidades disponibles`);
    }

    await this.prisma.client.cartItem.update({
      where: { id: itemId },
      data: { quantity: permitida },
    });

    await this.tocar(cartId);
  }

  async quitar(cartId: string, itemId: string): Promise<void> {
    // deleteMany y no delete: filtrando también por cartId, nadie puede borrar
    // una línea del carrito de otra persona adivinando su id.
    const { count } = await this.prisma.client.cartItem.deleteMany({
      where: { id: itemId, cartId },
    });

    if (count === 0) throw new NotFoundException('La línea no está en este carrito');

    await this.tocar(cartId);
  }

  async vaciar(cartId: string): Promise<void> {
    await this.prisma.client.cartItem.deleteMany({ where: { cartId } });
    await this.tocar(cartId);
  }

  /** Guarda el email para poder avisar de un carrito abandonado. */
  async guardarEmail(cartId: string, email: string): Promise<void> {
    await this.prisma.client.cart.update({
      where: { id: cartId },
      data: { email, lastActivityAt: new Date() },
    });
  }

  /** Marca el carrito como convertido, sin borrarlo, al crearse el pedido. */
  async marcarConvertido(cartId: string, orderId: string): Promise<void> {
    await this.prisma.client.cart.updateMany({
      where: { id: cartId, convertedAt: null },
      data: { convertedAt: new Date(), convertedToId: orderId },
    });
  }

  private async tocar(cartId: string): Promise<void> {
    await this.prisma.client.cart.update({
      where: { id: cartId },
      data: { lastActivityAt: new Date() },
    });
  }

  /**
   * Retira los carritos caducados.
   *
   * Los convertidos se conservan aunque caduquen: son el dato con el que se
   * mide la conversión del embudo.
   */
  async limpiarCaducados(): Promise<number> {
    const { count } = await this.prisma.client.cart.deleteMany({
      where: { expiresAt: { lt: new Date() }, convertedAt: null },
    });

    if (count > 0) this.logger.log(`Retirados ${count} carritos caducados`);
    return count;
  }
}
