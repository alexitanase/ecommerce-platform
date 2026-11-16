import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import type { Prisma } from '@ecom/db';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import type { ActualizarActivoDto, ListarActivosDto } from './dto/studio.dto.js';

/** Formatos que se aceptan como material de diseño. */
const FORMATOS = new Map<string, { extension: string; mimeType: string }>([
  ['jpeg', { extension: 'jpg', mimeType: 'image/jpeg' }],
  ['png', { extension: 'png', mimeType: 'image/png' }],
  ['webp', { extension: 'webp', mimeType: 'image/webp' }],
  ['avif', { extension: 'avif', mimeType: 'image/avif' }],
  ['gif', { extension: 'gif', mimeType: 'image/gif' }],
]);

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Ancho del marcador borroso.
 *
 * 20 píxeles, igual que en las fotos de producto: ocupa menos de un kilobyte y
 * cabe en la propia fila. Con 400 —que era la primera idea— la biblioteca se
 * traería megabytes de base64 en cada listado para enseñar una rejilla.
 */
const ANCHO_MARCADOR = 20;

/**
 * Biblioteca de activos del Studio.
 *
 * Es deliberadamente distinta del procesado de fotos de producto, y la
 * diferencia importa: **aquí el original se guarda tal cual**. Una foto de
 * producto se sirve a quien navega, así que se recomprime y se generan cinco
 * anchos; un activo de diseño es materia prima —se recorta, se escala, se
 * compone— y recomprimirlo de entrada arrastra los artefactos a todas las
 * piezas que salgan de él. Lo único que se genera es un marcador borroso para
 * que la rejilla de la biblioteca no salga en gris.
 *
 * Cada activo guarda de dónde salió: subida, generado con IA (con qué modelo y
 * qué instrucción), del catálogo o del proveedor. Sirve para dos cosas que no
 * son opcionales: saber qué se puede usar comercialmente, y poder responder si
 * alguien reclama.
 */
@Injectable()
export class ActivosService {
  private readonly logger = new Logger(ActivosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async listar(filtros: ListarActivosDto) {
    const where: Prisma.StudioAssetWhereInput = {
      deletedAt: null,
      ...(filtros.tipo ? { kind: filtros.tipo } : {}),
      ...(filtros.origen ? { source: filtros.origen } : {}),
      ...(filtros.productId ? { productId: filtros.productId } : {}),
      ...(filtros.texto
        ? {
            OR: [
              { name: { contains: filtros.texto, mode: 'insensitive' as const } },
              { tags: { has: filtros.texto.toLowerCase() } },
            ],
          }
        : {}),
    };

    return this.prisma.client.studioAsset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  async obtener(id: string) {
    const activo = await this.prisma.client.studioAsset.findFirst({
      where: { id, deletedAt: null },
    });
    if (!activo) throw new NotFoundException('Activo no encontrado');
    return activo;
  }

  async subirImagen(buffer: Buffer, nombre: string, ctx: ContextoActor) {
    if (buffer.length > MAX_BYTES) {
      throw new BadRequestException(
        `El fichero supera el máximo de ${Math.round(MAX_BYTES / 1024 / 1024)} MB`,
      );
    }

    // Se mira el contenido real y no la extensión ni el Content-Type que
    // declara el navegador: los dos se falsifican, y subir un ejecutable con
    // nombre .jpg es el vector de siempre.
    let metadatos;
    try {
      metadatos = await sharp(buffer).metadata();
    } catch {
      throw new BadRequestException('El fichero no es una imagen válida');
    }

    const formato = metadatos.format ? FORMATOS.get(metadatos.format) : undefined;
    if (!formato) {
      throw new BadRequestException(
        `Formato no admitido${metadatos.format ? ` (${metadatos.format})` : ''}. Usa JPEG, PNG, WebP, AVIF o GIF.`,
      );
    }

    const ancho = metadatos.width ?? 0;
    const alto = metadatos.height ?? 0;
    if (ancho < 16 || alto < 16) {
      throw new BadRequestException('La imagen es demasiado pequeña para usarla en un diseño.');
    }

    const subida = await this.storage.subir(buffer, {
      carpeta: 'studio/activos',
      extension: formato.extension,
      mimeType: formato.mimeType,
    });

    const activo = await this.prisma.client.studioAsset.create({
      data: {
        id: newId(),
        kind: 'IMAGEN',
        name: this.nombreLimpio(nombre),
        storageKey: subida.key,
        url: subida.url,
        mimeType: formato.mimeType,
        width: ancho,
        height: alto,
        sizeBytes: buffer.length,
        blurhash: await this.marcadorBorroso(buffer),
        source: 'SUBIDA',
        createdById: ctx.actorId ?? null,
      },
    });

    await this.audit.registrar({
      action: 'studio.asset.upload',
      resource: 'studio_asset',
      resourceId: activo.id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { name: activo.name, sizeBytes: buffer.length, width: ancho, height: alto },
    });

    return activo;
  }

  /**
   * Trae una foto del catálogo a la biblioteca.
   *
   * No copia el fichero: apunta al mismo objeto del almacenamiento. Duplicarlo
   * costaría espacio y, peor, crearía dos verdades — si mañana se retoca la
   * foto del producto, el banner seguiría enseñando la vieja sin que nadie se
   * entere.
   */
  async importarDelCatalogo(mediaId: string, ctx: ContextoActor) {
    const medio = await this.prisma.client.media.findFirst({
      where: { id: mediaId, deletedAt: null },
      include: {
        product: {
          select: { id: true, translations: { where: { locale: 'es' }, select: { name: true } } },
        },
      },
    });
    if (!medio) throw new NotFoundException('Esa imagen no existe en el catálogo');

    const yaEsta = await this.prisma.client.studioAsset.findFirst({
      where: { storageKey: medio.storageKey, deletedAt: null },
    });
    if (yaEsta) return yaEsta;

    const nombre = medio.product?.translations[0]?.name ?? 'Imagen del catálogo';

    return this.prisma.client.studioAsset.create({
      data: {
        id: newId(),
        kind: medio.kind === 'VIDEO' ? 'VIDEO' : 'IMAGEN',
        name: this.nombreLimpio(nombre),
        storageKey: medio.storageKey,
        url: medio.url,
        mimeType: medio.mimeType,
        width: medio.width,
        height: medio.height,
        sizeBytes: medio.sizeBytes,
        blurhash: medio.blurhash,
        source: 'CATALOGO',
        productId: medio.productId,
        createdById: ctx.actorId ?? null,
      },
    });
  }

  async actualizar(id: string, dto: ActualizarActivoDto) {
    await this.obtener(id);

    return this.prisma.client.studioAsset.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: this.nombreLimpio(dto.name) } : {}),
        ...(dto.tags !== undefined
          ? { tags: [...new Set(dto.tags.map((t) => t.toLowerCase()))] }
          : {}),
      },
    });
  }

  /**
   * Retira un activo de la biblioteca.
   *
   * Borrado lógico y sin tocar el almacenamiento: puede haber documentos
   * guardados que lo usan, y borrar el objeto dejaría huecos en creatividades
   * que ya están corriendo en una red de anuncios.
   */
  async retirar(id: string, ctx: ContextoActor) {
    await this.obtener(id);

    await this.prisma.client.studioAsset.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.registrar({
      action: 'studio.asset.delete',
      resource: 'studio_asset',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
    });

    return { ok: true };
  }

  private nombreLimpio(nombre: string): string {
    const limpio = nombre.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
    return limpio.slice(0, 160) || 'Sin nombre';
  }

  /** Marcador diminuto en base64, para que la rejilla no salga en gris. */
  private async marcadorBorroso(buffer: Buffer): Promise<string | null> {
    try {
      const pequena = await sharp(buffer)
        .rotate()
        .resize({ width: ANCHO_MARCADOR, withoutEnlargement: true })
        .webp({ quality: 50 })
        .toBuffer();
      return `data:image/webp;base64,${pequena.toString('base64')}`;
    } catch (error) {
      // Un GIF animado o un formato raro pueden fallar aquí. Sin miniatura la
      // biblioteca se ve igual, solo tarda un poco más en pintar.
      this.logger.warn(`No se ha podido generar la miniatura: ${String(error)}`);
      return null;
    }
  }
}
