import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verifySync } from 'otplib';
import crypto from 'node:crypto';
import QRCode from 'qrcode';

/**
 * Verificación en dos pasos con TOTP (Google Authenticator, Authy, 1Password…).
 *
 * `epochTolerance` acepta códigos hasta 30 segundos por delante o por detrás,
 * para tolerar relojes ligeramente desfasados sin alargar de más la ventana en
 * la que un código interceptado seguiría sirviendo.
 */
const TOLERANCIA_SEGUNDOS = 30;

@Injectable()
export class TotpService {
  generarSecreto(): string {
    return generateSecret();
  }

  /** URI `otpauth://` que la app de autenticación lee del QR. */
  uriDeAprovisionamiento(email: string, secreto: string, marca: string): string {
    return generateURI({ issuer: marca, label: email, secret: secreto });
  }

  async generarQr(uri: string): Promise<string> {
    return QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  }

  verificar(secreto: string, codigo: string): boolean {
    try {
      const resultado = verifySync({
        secret: secreto,
        token: codigo,
        epochTolerance: TOLERANCIA_SEGUNDOS,
      });
      return resultado.valid;
    } catch {
      return false;
    }
  }

  /**
   * Códigos de recuperación de un solo uso, para cuando se pierde el móvil.
   * Se devuelven en claro una única vez y se guardan hasheados.
   */
  generarCodigosRecuperacion(cantidad = 10): { claros: string[]; hasheados: string[] } {
    const claros = Array.from({ length: cantidad }, () => {
      const bruto = crypto.randomBytes(5).toString('hex').toUpperCase();
      return (bruto.match(/.{1,5}/g) ?? [bruto]).join('-');
    });
    return { claros, hasheados: claros.map((c) => this.hashCodigo(c)) };
  }

  hashCodigo(codigo: string): string {
    return crypto.createHash('sha256').update(codigo.replace(/-/g, '').toUpperCase()).digest('hex');
  }

  /**
   * Consume un código de recuperación. Devuelve la lista restante si acierta,
   * o null si el código no era válido. Cada código sirve una sola vez.
   */
  consumirCodigoRecuperacion(codigo: string, hasheados: string[]): string[] | null {
    const hash = this.hashCodigo(codigo);
    const indice = hasheados.indexOf(hash);
    if (indice === -1) return null;
    return hasheados.filter((_, i) => i !== indice);
  }
}
