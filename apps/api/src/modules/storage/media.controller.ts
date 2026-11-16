import { BadRequestException, Body, Controller, Delete, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { newId } from '@ecom/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ImagesService } from './images.service.js';
import { StorageService } from './storage.service.js';

@ApiTags('Medios')
@ApiBearerAuth('access-token')
@Controller({ path: 'media', version: '1' })
export class MediaController {
  constructor(
    private readonly images: ImagesService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post('upload/:productId')
  @RequirePermissions('media:write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir una imagen a un producto' })
  async subir(
    @Param('productId') productId: string,
    @Req() req: FastifyRequest,
    @CurrentUser() u: UsuarioAutenticado,
  ) {
    const producto = await this.prisma.client.product.findUnique({
      where: { id: productId },
      select: { id: true, deletedAt: true },
    });
    if (!producto || producto.deletedAt) {
      throw new BadRequestException('Producto no encontrado');
    }

    const fichero = await req.file();
    if (!fichero) throw new BadRequestException('No se ha recibido ningún fichero');

    const buffer = await fichero.toBuffer();

    // Se valida el contenido real, no la extensión ni el Content-Type que
    // declara el cliente: ambos se falsifican trivialmente y subir un
    // ejecutable disfrazado de .jpg es el vector clásico.
    if (!(await this.images.esImagenValida(buffer))) {
      throw new BadRequestException('El fichero no es una imagen válida');
    }

    const procesada = await this.images.procesar(buffer, `productos/${productId}`);

    const ultima = await this.prisma.client.media.findFirst({
      where: { productId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const medio = await this.prisma.client.media.create({
      data: {
        id: newId(),
        productId,
        kind: 'IMAGE',
        storageKey: procesada.key,
        url: procesada.url,
        mimeType: 'image/webp',
        width: procesada.width,
        height: procesada.height,
        sizeBytes: procesada.sizeBytes,
        blurhash: procesada.blurhash,
        position: (ultima?.position ?? -1) + 1,
        source: 'upload',
      },
    });

    await this.audit.registrar({
      action: 'media.upload',
      resource: 'product',
      resourceId: productId,
      actorId: u.id,
      actorIp: req.ip,
      after: { mediaId: medio.id, sizeBytes: procesada.sizeBytes },
    });

    return { ...medio, variantes: procesada.variantes };
  }

  @Post(':id/alt')
  @RequirePermissions('media:write')
  @ApiOperation({ summary: 'Definir el texto alternativo por idioma' })
  async alt(@Param('id') id: string, @Body() body: { alt: Record<string, string> }) {
    // El alt es obligatorio para accesibilidad y lo lee el buscador de imágenes.
    return this.prisma.client.media.update({
      where: { id },
      data: { alt: body.alt },
      select: { id: true, alt: true },
    });
  }

  @Post('reorder')
  @RequirePermissions('media:write')
  @ApiOperation({ summary: 'Reordenar las imágenes de un producto' })
  async reordenar(@Body() body: { ids: string[] }) {
    await this.prisma.client.$transaction(
      body.ids.map((id, i) =>
        this.prisma.client.media.update({ where: { id }, data: { position: i } }),
      ),
    );
    return { reordenadas: body.ids.length };
  }

  @Delete(':id')
  @RequirePermissions('media:write')
  @ApiOperation({ summary: 'Eliminar una imagen' })
  async eliminar(@Param('id') id: string, @CurrentUser() u: UsuarioAutenticado) {
    const medio = await this.prisma.client.media.findUnique({ where: { id } });
    if (!medio) throw new BadRequestException('Imagen no encontrada');

    await this.prisma.client.media.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    // El objeto se borra del almacenamiento solo si ninguna otra fila lo
    // referencia: la clave se deriva del contenido, así que dos productos con
    // la misma foto comparten el mismo objeto.
    const otras = await this.prisma.client.media.count({
      where: { storageKey: medio.storageKey, deletedAt: null },
    });
    if (otras === 0) {
      await this.storage.eliminar(medio.storageKey);
    }

    await this.audit.registrar({
      action: 'media.delete',
      resource: 'media',
      resourceId: id,
      actorId: u.id,
    });

    return { eliminada: true, objetoBorrado: otras === 0 };
  }
}
