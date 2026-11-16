import { Inject, Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import type { Env } from '@ecom/shared';
import { ENV } from '../config/config.module.js';

/**
 * Cifrado simétrico para secretos que hay que poder recuperar en claro
 * (credenciales de proveedores y pasarelas, no contraseñas de usuario).
 *
 * Se usa AES-256-GCM y no CBC porque GCM autentica el texto cifrado: si alguien
 * con acceso a la base de datos altera un byte, el descifrado falla en lugar de
 * devolver basura silenciosamente. Cada cifrado lleva su propio IV aleatorio,
 * así que dos credenciales idénticas producen textos cifrados distintos y no se
 * puede deducir cuáles se repiten.
 *
 * Formato almacenado: iv:authTag:cifrado, todo en hexadecimal.
 */
@Injectable()
export class CryptoService {
  private readonly clave: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.clave = Buffer.from(env.ENCRYPTION_KEY, 'hex');
    if (this.clave.length !== 32) {
      throw new Error('ENCRYPTION_KEY debe ser de 32 bytes (64 caracteres hexadecimales)');
    }
  }

  cifrar(textoPlano: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.clave, iv);

    const cifrado = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${cifrado.toString('hex')}`;
  }

  descifrar(almacenado: string): string {
    const partes = almacenado.split(':');
    if (partes.length !== 3) {
      throw new Error('Formato de dato cifrado no válido');
    }

    const [ivHex, tagHex, datosHex] = partes as [string, string, string];
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.clave, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

    return Buffer.concat([
      decipher.update(Buffer.from(datosHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Cifra un objeto de credenciales completo. */
  cifrarObjeto(objeto: Record<string, string | undefined>): string {
    return this.cifrar(JSON.stringify(objeto));
  }

  descifrarObjeto<T = Record<string, string>>(almacenado: string): T {
    return JSON.parse(this.descifrar(almacenado)) as T;
  }

  /**
   * Versión enmascarada para mostrar en el admin sin revelar el secreto.
   * `sk_live_abc123xyz` → `sk_l••••••••xyz`
   */
  enmascarar(valor: string): string {
    if (valor.length <= 8) return '••••••••';
    return `${valor.slice(0, 4)}${'•'.repeat(8)}${valor.slice(-3)}`;
  }
}
