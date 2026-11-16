import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { StorageService } from './storage.service.js';

/** Anchos generados para servir imágenes responsive. */
const ANCHOS = [320, 640, 960, 1280, 1920] as const;

/** Formatos de entrada aceptados. */
const FORMATOS_VALIDOS = new Set(['jpeg', 'jpg', 'png', 'webp', 'avif', 'gif']);

const MAX_BYTES = 15 * 1024 * 1024;

export interface ImagenProcesada {
  key: string;
  url: string;
  width: number;
  height: number;
  sizeBytes: number;
  blurhash: string;
  variantes: { width: number; url: string; format: string }[];
}

/**
 * Procesado de imágenes de producto.
 *
 * Cada imagen se convierte a AVIF y WebP en cinco anchos. Las fotos que
 * entregan los proveedores suelen ser JPEG de 2 MB sin optimizar; servirlas tal
 * cual castiga los Core Web Vitals en móvil, que es donde compra la mayoría, y
 * el buscador lo penaliza.
 */
@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(private readonly storage: StorageService) {}

  async procesar(
    original: Buffer,
    carpeta = 'productos',
    /**
     * El lado mínimo que se acepta.
     *
     * 200 px para una foto de producto: por debajo se ve borrosa y una foto
     * borrosa cuesta ventas. Un logotipo de marca es otra cosa —suele ser
     * apaisado y estrecho, 400×80 es normal— y con ese mínimo se rechazaría
     * casi cualquiera, así que quien lo sube dice cuál es el suyo.
     */
    opciones: { ladoMinimoPx?: number } = {},
  ): Promise<ImagenProcesada> {
    if (original.length > MAX_BYTES) {
      throw new BadRequestException(
        `La imagen supera el máximo de ${Math.round(MAX_BYTES / 1024 / 1024)} MB`,
      );
    }

    let metadatos: Metadata;
    try {
      metadatos = await sharp(original).metadata();
    } catch {
      throw new BadRequestException('El fichero no es una imagen válida');
    }

    if (!metadatos.format || !FORMATOS_VALIDOS.has(metadatos.format)) {
      throw new BadRequestException(
        `Formato no admitido${metadatos.format ? ` (${metadatos.format})` : ''}. Usa JPEG, PNG, WebP o AVIF.`,
      );
    }

    const anchoOriginal = metadatos.width ?? 0;
    const altoOriginal = metadatos.height ?? 0;

    const minimo = opciones.ladoMinimoPx ?? 200;

    if (anchoOriginal < minimo || altoOriginal < minimo) {
      throw new BadRequestException(
        `La imagen es demasiado pequeña (mínimo ${minimo}×${minimo}). Una imagen borrosa cuesta ventas.`,
      );
    }

    // El original se guarda en WebP de alta calidad como copia maestra: si un
    // día cambiamos los tamaños, se regenera desde aquí sin volver a pedirlo
    // al proveedor.
    const maestra = await sharp(original)
      .rotate() // respeta la orientación EXIF; sin esto, las fotos de móvil salen giradas
      .webp({ quality: 90 })
      .toBuffer();

    const subidaMaestra = await this.storage.subir(maestra, {
      carpeta: `${carpeta}/original`,
      extension: 'webp',
      mimeType: 'image/webp',
    });

    const variantes: ImagenProcesada['variantes'] = [];

    for (const ancho of ANCHOS) {
      // No se amplía: escalar una foto de 400px a 1920 solo la emborrona.
      if (ancho > anchoOriginal) continue;

      for (const formato of ['avif', 'webp'] as const) {
        const redimensionada = sharp(original)
          .rotate()
          .resize({ width: ancho, withoutEnlargement: true });

        const buffer =
          formato === 'avif'
            ? await redimensionada.avif({ quality: 60 }).toBuffer()
            : await redimensionada.webp({ quality: 82 }).toBuffer();

        const subida = await this.storage.subir(buffer, {
          carpeta: `${carpeta}/${ancho}`,
          extension: formato,
          mimeType: `image/${formato}`,
        });

        variantes.push({ width: ancho, url: subida.url, format: formato });
      }
    }

    return {
      key: subidaMaestra.key,
      url: subidaMaestra.url,
      width: anchoOriginal,
      height: altoOriginal,
      sizeBytes: maestra.length,
      blurhash: await this.marcadorBorroso(original),
      variantes,
    };
  }

  /**
   * Miniatura diminuta en base64 que se pinta mientras carga la real.
   *
   * Evita el salto de layout (CLS) y el rectángulo gris: el usuario ve desde el
   * primer momento los colores de la foto. 20 píxeles de ancho ocupan menos de
   * un kilobyte, así que puede viajar en el propio HTML.
   */
  private async marcadorBorroso(original: Buffer): Promise<string> {
    try {
      const diminuta = await sharp(original)
        .rotate()
        .resize({ width: 20 })
        .webp({ quality: 40 })
        .toBuffer();
      return `data:image/webp;base64,${diminuta.toString('base64')}`;
    } catch {
      return '';
    }
  }

  /** Comprueba que un buffer es realmente una imagen, sin fiarse del nombre. */
  async esImagenValida(buffer: Buffer): Promise<boolean> {
    try {
      const m = await sharp(buffer).metadata();
      return Boolean(m.format && FORMATOS_VALIDOS.has(m.format));
    } catch {
      return false;
    }
  }

  /** Descarga una imagen del proveedor para incorporarla al catálogo. */
  async descargar(url: string): Promise<Buffer> {
    const respuesta = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!respuesta.ok) {
      throw new BadRequestException(`No se ha podido descargar la imagen (${respuesta.status})`);
    }

    const longitud = Number(respuesta.headers.get('content-length') ?? 0);
    if (longitud > MAX_BYTES) {
      throw new BadRequestException('La imagen del proveedor es demasiado grande');
    }

    return Buffer.from(await respuesta.arrayBuffer());
  }
}
