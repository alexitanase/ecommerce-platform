import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import crypto from 'node:crypto';

/**
 * Hashing de contraseñas con Argon2id.
 *
 * Argon2id es la recomendación actual de OWASP frente a bcrypt: resiste tanto
 * ataques con GPU como los de canal lateral. Los parámetros siguen la guía de
 * OWASP (19 MiB de memoria, 2 iteraciones, paralelismo 1); subirlos encarece el
 * ataque por fuerza bruta pero también cada login legítimo, así que no conviene
 * tocarlos sin medir.
 */
@Injectable()
export class PasswordService {
  private readonly opciones: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };

  hash(plano: string): Promise<string> {
    return argon2.hash(plano, this.opciones);
  }

  async verify(hash: string, plano: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plano);
    } catch {
      // Un hash corrupto o con formato desconocido no debe tumbar el login.
      return false;
    }
  }

  /**
   * ¿Hay que rehashear? Si endurecemos los parámetros más adelante, las
   * contraseñas antiguas se actualizan solas en el siguiente login correcto.
   */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, this.opciones);
    } catch {
      return true;
    }
  }

  /**
   * Compara contra un hash falso cuando el usuario no existe.
   *
   * Sin esto, un login con email inexistente responde en microsegundos y uno
   * con email real tarda ~50 ms, lo que permite enumerar qué cuentas existen
   * midiendo el tiempo de respuesta.
   */
  async fakeVerify(): Promise<void> {
    await argon2.hash(crypto.randomBytes(16).toString('hex'), this.opciones);
  }
}
