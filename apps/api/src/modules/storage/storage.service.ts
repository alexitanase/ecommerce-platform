import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import crypto from 'node:crypto';
import { IntegracionesService } from '../integrations/integraciones.service.js';
import { ajusteBooleano, ajusteTexto } from '../integrations/valores.js';

/**
 * Almacenamiento de objetos: MinIO en local, S3, R2 o Backblaze en producción.
 *
 * Se usa el SDK de S3 en vez de una librería por proveedor para que cambiar de
 * uno a otro sea cambiar cuatro campos en el panel, no reescribir el módulo.
 *
 * El cliente se construye con lo configurado en Ajustes → Integraciones y se
 * rehace solo cuando esa configuración cambia. Sin esto, mover las fotos a otro
 * proveedor obligaría a reiniciar el servidor.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  private cliente: S3Client | null = null;
  private huella = '';
  private cubos = { publico: '', privado: '', urlPublica: '' };

  constructor(private readonly integraciones: IntegracionesService) {}

  /**
   * Cliente listo para usar.
   *
   * Falla claro si no está configurado. Es lo correcto: sin almacenamiento no
   * se pueden guardar las fotos de un producto, y devolver un cliente a medias
   * daría un error del SDK sin decir qué hay que configurar.
   */
  private async conexion(): Promise<S3Client> {
    const config = await this.integraciones.configuracion('s3');

    if (!config?.operativa) {
      throw new ServiceUnavailableException(
        'El almacenamiento de imágenes no está configurado. Actívalo en Ajustes → Integraciones.',
      );
    }

    const endpoint = ajusteTexto(config, 'endpoint');
    const region = ajusteTexto(config, 'region', 'eu-west-1');
    const estiloRuta = ajusteBooleano(config, 'estiloRuta', true);
    const accessKeyId = config.credenciales['accessKey'] ?? '';
    const secretAccessKey = config.credenciales['secretKey'] ?? '';

    this.cubos = {
      publico: ajusteTexto(config, 'bucket'),
      privado: ajusteTexto(config, 'bucketPrivado'),
      urlPublica: ajusteTexto(config, 'urlPublica').replace(/\/$/, ''),
    };

    const huella = `${endpoint}|${region}|${String(estiloRuta)}|${accessKeyId}|${secretAccessKey}`;

    if (!this.cliente || this.huella !== huella) {
      this.cliente?.destroy();

      this.cliente = new S3Client({
        endpoint,
        region,
        credentials: { accessKeyId, secretAccessKey },
        // MinIO sirve los cubos como ruta (/cubo/objeto) en vez de como
        // subdominio, que es lo que hace S3 de verdad.
        forcePathStyle: estiloRuta,
      });

      this.huella = huella;
    }

    return this.cliente;
  }

  /**
   * Sube un fichero y devuelve su clave y URL pública.
   *
   * La clave incluye un hash del contenido: subir dos veces la misma imagen
   * reutiliza el objeto en lugar de duplicarlo, algo habitual al importar
   * catálogos de proveedor donde muchas fichas comparten fotos.
   */
  async subir(
    contenido: Buffer,
    opciones: { carpeta: string; extension: string; mimeType: string; privado?: boolean },
  ): Promise<{ key: string; url: string; hash: string }> {
    const s3 = await this.conexion();

    const hash = crypto.createHash('sha256').update(contenido).digest('hex').slice(0, 32);
    const key = `${opciones.carpeta}/${hash}.${opciones.extension}`;
    const bucket = opciones.privado ? this.cubos.privado : this.cubos.publico;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: contenido,
        ContentType: opciones.mimeType,
        // Un año de caché: la clave depende del contenido, así que si la imagen
        // cambia también cambia la URL y no hay que invalidar nada.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return {
      key,
      url: opciones.privado ? '' : `${this.cubos.urlPublica}/${key}`,
      hash,
    };
  }

  /** URL temporal para un objeto privado (facturas, exportaciones…). */
  async urlFirmada(key: string, segundos = 900): Promise<string> {
    const s3 = await this.conexion();

    return getSignedUrl(s3, new GetObjectCommand({ Bucket: this.cubos.privado, Key: key }), {
      expiresIn: segundos,
    });
  }

  async eliminar(key: string, privado = false): Promise<void> {
    try {
      const s3 = await this.conexion();

      await s3.send(
        new DeleteObjectCommand({
          Bucket: privado ? this.cubos.privado : this.cubos.publico,
          Key: key,
        }),
      );
    } catch (error) {
      // No se propaga: si el objeto ya no está, el resultado deseado se cumple
      // igual, y no queremos que un borrado fallido bloquee la operación.
      this.logger.warn(
        `No se ha podido eliminar ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async urlPublica(key: string): Promise<string> {
    await this.conexion();
    return `${this.cubos.urlPublica}/${key}`;
  }

  /**
   * Comprueba que el almacenamiento responde y que el cubo existe.
   *
   * Unas credenciales mal copiadas no fallan al guardarlas: fallan al subir la
   * primera imagen de un producto, con el importador a medias.
   */
  async probar(): Promise<{ ok: boolean; mensaje?: string }> {
    try {
      const s3 = await this.conexion();
      await s3.send(new HeadBucketCommand({ Bucket: this.cubos.publico }));

      return { ok: true };
    } catch (error) {
      return { ok: false, mensaje: error instanceof Error ? error.message : String(error) };
    }
  }
}
