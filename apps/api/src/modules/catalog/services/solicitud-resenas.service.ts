import { Injectable, Logger } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MailService } from '../../mail/mail.service.js';

/**
 * Pedirle al cliente que valore lo que ya ha recibido.
 *
 * Una tienda nueva no tiene ni una reseña, y sin reseñas cada ficha es la
 * palabra del vendedor contra la duda del comprador. Nadie entra a valorar por
 * su cuenta: hay que pedirlo, y hay que pedirlo bien.
 *
 * **Por qué no se manda al entregar.** El correo de «tu pedido ha llegado» ya
 * sale en ese momento y ahí el cliente todavía no ha abierto la caja: pedirle
 * una opinión del producto es pedirle que opine de la foto. Unos días después
 * ya lo ha usado, y además el correo no compite con el de la entrega.
 *
 * Se manda UNA sola vez por pedido. El registro de que se pidió es un evento
 * del propio pedido y no una columna nueva: sirve igual para no repetir, queda
 * en la cronología —«se pidió valoración el día tal»— y evita una migración.
 */
@Injectable()
export class SolicitudResenasService {
  private readonly logger = new Logger(SolicitudResenasService.name);

  /** Tipo del evento que marca que ya se pidió. Es la marca de «no repetir». */
  private static readonly EVENTO = 'review.requested';

  /**
   * Días desde la entrega antes de pedir la opinión.
   *
   * Cinco: lo suficiente para haberlo usado y no tanto como para haberse
   * olvidado de la compra. Por debajo de tres, la mitad de los envíos ni han
   * llegado de verdad —el transportista marca «entregado» al dejarlo en un
   * punto de recogida—.
   */
  private static readonly DIAS_DE_ESPERA = 5;

  /**
   * Tope por vuelta.
   *
   * El repaso es diario y el ritmo normal son unos pocos pedidos al día. El
   * tope existe para el primer arranque, cuando puede haber meses de pedidos
   * entregados esperando: sin él, la primera ejecución mandaría cientos de
   * correos de golpe, que es la forma más rápida de que el proveedor de envío
   * corte la cuenta por sospecha de spam.
   */
  private static readonly POR_VUELTA = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async solicitarPendientes(): Promise<{ enviados: number }> {
    const limite = new Date(Date.now() - SolicitudResenasService.DIAS_DE_ESPERA * 86_400_000);

    const pedidos = await this.prisma.client.order.findMany({
      where: {
        deliveredAt: { not: null, lte: limite },
        // Cancelados y reembolsados fuera: pedirle su opinión a quien acaba de
        // devolver el producto es la peor forma de recordarle la compra.
        status: { in: ['DELIVERED', 'PENDING_CLOSE', 'CLOSED'] },
        // Quien pidió que borrásemos sus datos no recibe correos de marketing,
        // y esto lo es aunque parezca de servicio.
        personalDataBlockedAt: null,
        events: { none: { type: SolicitudResenasService.EVENTO } },
      },
      select: {
        id: true,
        number: true,
        email: true,
        locale: true,
        shippingAddress: true,
        items: {
          select: { productId: true, name: true, imageUrl: true },
        },
      },
      orderBy: { deliveredAt: 'asc' },
      take: SolicitudResenasService.POR_VUELTA,
    });

    let enviados = 0;

    for (const pedido of pedidos) {
      /*
       * Los productos que se pueden valorar, sin repetir.
       *
       * Un pedido con dos tallas del mismo artículo son dos líneas y un solo
       * producto: pedir dos veces la misma opinión es lo que hace que el
       * correo parezca automático y se ignore.
       */
      const productos = [
        ...new Map(
          pedido.items.filter((i) => i.productId !== null).map((i) => [i.productId, i]),
        ).values(),
      ];

      if (productos.length === 0) continue;

      /*
       * Los slugs del idioma del pedido, para poder enlazar cada ficha.
       *
       * Se resuelven aquí y no en el servicio de correo a propósito: el correo
       * compone y envía, no consulta el catálogo. Un producto sin traducir a
       * ese idioma se queda fuera en vez de generar un enlace roto.
       */
      const traducciones = await this.prisma.lectura.productTranslation.findMany({
        where: {
          locale: pedido.locale,
          productId: { in: productos.map((p) => p.productId ?? '') },
        },
        select: { productId: true, slug: true },
      });
      const slugs = new Map(traducciones.map((t) => [t.productId, t.slug]));

      const enlazables = productos.flatMap((p) => {
        const slug = p.productId ? slugs.get(p.productId) : undefined;
        return slug ? [{ nombre: p.name, slug }] : [];
      });

      if (enlazables.length === 0) continue;

      // El nombre vive dentro de la dirección de envío, como en los demás
      // correos del pedido: no hay una columna propia.
      const direccion = pedido.shippingAddress as Record<string, string | undefined>;

      const ok = await this.mail.pedirValoracion({
        email: pedido.email,
        nombre: direccion['firstName'] ?? null,
        numero: pedido.number,
        locale: pedido.locale,
        productos: enlazables,
      });

      /*
       * Se anota aunque el correo no saliera.
       *
       * Si no, un pedido cuyo envío falla —dirección rebotada, buzón lleno— se
       * reintentaría cada día para siempre. El correo de valoración es lo
       * menos importante que manda la tienda: no merece una cola de reintentos,
       * y el fallo queda registrado en el aviso del panel de integraciones.
       */
      await this.prisma.client.orderEvent.create({
        data: {
          id: newId(),
          orderId: pedido.id,
          type: SolicitudResenasService.EVENTO,
          description: ok
            ? `Se ha pedido valoración de ${enlazables.length} producto(s)`
            : 'No se pudo enviar la petición de valoración (correo no disponible)',
          actorType: 'system',
          metadata: { productos: enlazables.length, enviado: ok },
        },
      });

      if (ok) enviados++;
    }

    if (pedidos.length > 0) {
      this.logger.log(
        `Peticiones de valoración: ${enviados} enviadas de ${pedidos.length} pedidos entregados`,
      );
    }

    return { enviados };
  }
}
