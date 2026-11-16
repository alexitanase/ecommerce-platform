import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env, Locale } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  construirFeed,
  feedAXml,
  type ProductoParaFeed,
  type ResultadoFeed,
} from './feed-merchant.js';

/**
 * Genera el feed de productos para Google Merchant Center.
 *
 * Lee el catálogo publicado y lo pasa por `feed-merchant`, que es donde vive
 * toda la decisión. Aquí solo se consulta la base de datos, y a propósito: la
 * exclusión de productos +18 —la regla que, si falla, cuesta la cuenta de
 * Merchant entera— tiene que poder probarse caso a caso sin levantar nada.
 */
@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Construye el feed de un idioma.
   *
   * Va por la réplica de lectura: lo descarga un robot de Google una vez al
   * día y recorre el catálogo entero, así que es exactamente el tipo de
   * consulta que no debe competir con el checkout por el primario.
   */
  async construir(locale: Locale): Promise<ResultadoFeed> {
    const productos = await this.prisma.lectura.product.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        /*
         * Los +18 NO se filtran aquí, y es deliberado.
         *
         * Filtrarlos en la consulta parecía una segunda barrera de seguridad,
         * pero costaba lo único que hace útil el diagnóstico: al no llegar a
         * la lógica, no se podían declarar como descartados, y quien lleva la
         * tienda veía "0 artículos" sin ningún motivo que lo explicara.
         *
         * Quien decide es `construirFeed`, que los excluye ANTES que cualquier
         * otra comprobación y tiene cuatro pruebas dedicadas, una de ellas
         * verificando que el identificador no aparece en el XML generado.
         */
      },
      include: {
        translations: { where: { locale } },
        brand: { select: { name: true } },
        category: { include: { translations: { where: { locale } } } },
        media: { where: { deletedAt: null }, orderBy: { position: 'asc' }, take: 1 },
        variants: { where: { deletedAt: null, isActive: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const paraFeed: ProductoParaFeed[] = productos.map((p) => {
      const t = p.translations[0];

      return {
        id: p.id,
        handle: p.handle,
        isAdult: p.isAdult,
        marca: p.brand?.name,
        categoria: p.category?.translations[0]?.name,
        nombre: t?.name,
        // La descripción corta es la que se escribe pensando en un listado;
        // la larga suele traer HTML del proveedor y Google no lo admite.
        descripcion: t?.shortDescription ?? t?.description ?? undefined,
        slug: t?.slug,
        imagenes: p.media.map((m) => m.url),
        variantes: p.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          barcode: v.barcode ?? undefined,
          priceCents: v.priceCents,
          stock: v.stock,
          allowBackorder: v.allowBackorder,
        })),
      };
    });

    const resultado = construirFeed(paraFeed, {
      urlTienda: this.env.STOREFRONT_URL,
      locale,
    });

    if (resultado.descartados.length > 0) {
      // En el log y no en silencio: "tengo 400 productos y en Shopping salen
      // 120" es un problema que, sin esto, nadie relaciona con el feed.
      this.logger.warn(
        `Feed ${locale}: ${String(resultado.articulos.length)} artículos, ` +
          `${String(resultado.descartados.length)} descartados`,
      );
    }

    return resultado;
  }

  /** El XML que descarga Google. */
  async xml(locale: Locale): Promise<string> {
    const { articulos } = await this.construir(locale);

    return feedAXml(articulos, {
      titulo: 'Catálogo',
      enlace: `${this.env.STOREFRONT_URL}/${locale}`,
      descripcion: 'Feed de productos para Google Merchant Center',
    });
  }

  /**
   * Qué se ha quedado fuera y por qué.
   *
   * Es la mitad útil de esto para quien lleva la tienda: el feed en sí lo lee
   * un robot, pero saber que faltan treinta productos porque no tienen
   * descripción es lo que permite arreglarlo.
   */
  async diagnostico(locale: Locale) {
    const { articulos, descartados } = await this.construir(locale);

    const porMotivo = new Map<string, number>();
    for (const d of descartados) {
      porMotivo.set(d.motivo, (porMotivo.get(d.motivo) ?? 0) + 1);
    }

    return {
      locale,
      articulos: articulos.length,
      descartados: descartados.length,
      motivos: [...porMotivo.entries()]
        .map(([motivo, cuantos]) => ({ motivo, cuantos }))
        .sort((a, b) => b.cuantos - a.cuantos),
      detalle: descartados.slice(0, 100),
    };
  }
}
