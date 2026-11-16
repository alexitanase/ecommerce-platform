import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PROVEEDORES_DISPONIBLES } from '@ecom/suppliers';
import { newId } from '@ecom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ImportacionCatalogoService } from './importacion-catalogo.service.js';

/**
 * Tope de tamaño del catálogo subido.
 *
 * El de Dreamlove pesa 342 MB sin comprimir; se deja margen para que crezca
 * sin tener que tocar código. El límite general de la aplicación son 15 MB
 * —está pensado para fotos de producto— y por eso aquí se sube a propósito
 * solo en esta ruta: aflojarlo globalmente permitiría subir un fichero de dos
 * gigas a cualquier formulario de imagen.
 */
const MAXIMO_BYTES = 1024 * 1024 * 1024;

/**
 * Recibe el fichero de catálogo y lo deja en disco.
 *
 * Se guarda en un temporal y NO en memoria: `toBuffer()`, que es lo que usa la
 * subida de imágenes, cargaría 342 MB en el montón del proceso por cada
 * subida. En streaming la memoria no depende del tamaño del fichero.
 */
@Injectable()
export class SubidaCatalogoService {
  private readonly logger = new Logger(SubidaCatalogoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly importacion: ImportacionCatalogoService,
  ) {}

  async recibirFichero(
    supplierId: string,
    req: FastifyRequest,
    ctx: { actorId?: string; actorIp?: string },
  ): Promise<{ importId: string; nombre: string; bytes: number }> {
    const proveedor = await this.prisma.client.supplier.findUnique({
      where: { id: supplierId },
      select: { key: true, deletedAt: true, name: true },
    });

    if (!proveedor || proveedor.deletedAt) throw new NotFoundException('Proveedor no encontrado');

    const definicion = PROVEEDORES_DISPONIBLES.find((p) => p.key === proveedor.key);
    if (!definicion?.catalogoPorFichero) {
      // Subirle un fichero a un proveedor con API no haría nada malo, pero
      // tampoco nada útil: su catálogo se consulta en vivo y lo que se
      // guardara aquí no lo leería nadie.
      throw new BadRequestException(
        `${proveedor.name} tiene API propia: su catálogo se consulta en vivo y no se sube por fichero.`,
      );
    }

    const fichero = await req.file({ limits: { fileSize: MAXIMO_BYTES, files: 1 } });
    if (!fichero) throw new BadRequestException('No se ha recibido ningún fichero');

    const nombre = fichero.filename || 'catalogo.xml';

    /*
     * Las tres formas en que llega un catálogo.
     *
     * Dreamlove lo manda normalmente **en un ZIP**, que es como se descarga de
     * su web; a veces aparece el XML suelto o comprimido con gzip. Aquí solo se
     * filtra lo que evidentemente no es un catálogo —una hoja de cálculo, un
     * PDF— para no gastar una subida de 60 MB en descubrirlo después. Lo que
     * decide de verdad cómo se lee son los primeros bytes del fichero, no este
     * nombre: renombrar un `.zip` a `.xml` no lo convierte en XML.
     */
    if (!/\.(xml|gz|zip)$/i.test(nombre)) {
      throw new BadRequestException(
        `"${nombre}" no parece un catálogo: se espera el fichero del proveedor en ZIP (.zip), ` +
          'comprimido con gzip (.xml.gz) o el XML suelto (.xml).',
      );
    }

    const ruta = join(tmpdir(), `catalogo-${supplierId}-${newId()}-${nombreSeguro(nombre)}`);

    let bytes = 0;
    try {
      fichero.file.on('data', (trozo: Buffer) => {
        bytes += trozo.length;
      });

      await pipeline(fichero.file, createWriteStream(ruta));
    } catch (error) {
      await unlink(ruta).catch(() => undefined);
      throw error;
    }

    /*
     * Un fichero cortado por el límite no se procesa.
     *
     * Fastify no lanza al superarlo: corta el stream y marca `truncated`. Sin
     * mirarlo, un catálogo a medias se leería como un catálogo completo y
     * TODOS los artículos que faltasen se darían por retirados: la tienda
     * despublicaría medio inventario por una subida interrumpida.
     */
    if (fichero.file.truncated) {
      await unlink(ruta).catch(() => undefined);
      throw new BadRequestException(
        `El fichero supera el máximo de ${Math.round(MAXIMO_BYTES / 1024 / 1024)} MB y ha llegado incompleto.`,
      );
    }

    if (bytes === 0) {
      await unlink(ruta).catch(() => undefined);
      throw new BadRequestException('El fichero está vacío');
    }

    this.logger.log(
      `Catálogo recibido para ${proveedor.name}: ${nombre} (${Math.round(bytes / 1024 / 1024)} MB)`,
    );

    const { importId } = await this.importacion.lanzar(
      supplierId,
      { ruta, nombre, tamanoBytes: bytes },
      ctx,
    );

    return { importId, nombre, bytes };
  }
}

/**
 * El nombre subido, reducido a algo que se pueda escribir en disco.
 *
 * El nombre lo pone quien sube el fichero, así que llega con lo que sea: barras,
 * `..`, acentos o mil caracteres. Solo se conserva para que el temporal sea
 * reconocible mientras se procesa —y para que un `ls` en el servidor diga de
 * dónde salió—, así que se recorta a lo inofensivo en vez de confiar en él.
 */
const nombreSeguro = (nombre: string): string =>
  (nombre.split(/[\\/]/).pop() ?? 'catalogo')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(-60) || 'catalogo';
