import { Injectable, Logger } from '@nestjs/common';
import crypto from 'node:crypto';
import { RedisService } from '../redis/redis.service.js';

/**
 * Caché de lectura en Redis.
 *
 * Tres decisiones que definen el comportamiento bajo carga:
 *
 * 1. **Antiestampida.** Cuando una clave caliente caduca en plena campaña, sin
 *    protección las 500 peticiones que llegan a la vez fallan todas y golpean
 *    Postgres a la vez. La primera toma un cerrojo y calcula; el resto espera
 *    su resultado en lugar de repetir la consulta.
 *
 * 2. **Sirve caducado mientras recalcula.** Un valor de hace dos segundos es
 *    mejor respuesta que 300 ms de espera. Solo se bloquea de verdad cuando no
 *    hay absolutamente nada guardado.
 *
 * 3. **Invalidación por versión, no por SCAN.** Para tirar el catálogo entero
 *    se incrementa un contador y todas las claves viejas quedan huérfanas.
 *    Recorrer Redis con SCAN en producción bloquea el servidor durante el
 *    barrido, justo cuando más tráfico hay.
 */

/** Cuánto se conserva un valor pasado su TTL, para poder servirlo caducado. */
const MARGEN_CADUCADO = 60;

/** Espera máxima a que otro proceso termine de calcular. */
const ESPERA_CERROJO_MS = 3000;

interface Envuelto<T> {
  valor: T;
  /** Momento en que el valor deja de considerarse fresco. */
  expira: number;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(private readonly redis: RedisService) {}

  // ── Versionado por espacio de nombres ─────────────────────

  /**
   * Versión actual de un espacio de nombres.
   *
   * Va incrustada en cada clave, así que subirla invalida todo el espacio de
   * golpe sin borrar nada: las claves viejas caducan solas.
   *
   * Sin contador todavía la versión es **0**, no 1. Con 1, la primera
   * invalidación no invalidaba nada: `INCR` sobre una clave que no existe la
   * deja justo en 1, que es la versión que ya se estaba usando, así que las
   * claves no cambiaban y se seguía sirviendo lo viejo hasta que caducara solo.
   */
  private async version(espacio: string): Promise<string> {
    try {
      const actual = await this.redis.client.get(`cache:v:${espacio}`);
      return actual ?? '0';
    } catch {
      // Redis caído: se usa la versión base. La lectura seguirá su curso y
      // terminará calculando, que es la degradación correcta de una caché.
      return '0';
    }
  }

  /** Invalida de una vez todo un espacio de nombres. */
  async invalidarEspacio(espacio: string): Promise<void> {
    await this.redis.client.incr(`cache:v:${espacio}`);
    this.logger.debug(`Caché invalidada: ${espacio}`);
  }

  private async clave(espacio: string, id: string): Promise<string> {
    const v = await this.version(espacio);
    // El id se resume si es largo (filtros de listado, combinaciones de
    // parámetros): una clave de 2 KB gasta más memoria que el propio valor.
    const parte = id.length > 100 ? crypto.createHash('sha1').update(id).digest('hex') : id;
    return `cache:${espacio}:v${v}:${parte}`;
  }

  // ── Lectura ───────────────────────────────────────────────

  /**
   * Devuelve el valor guardado o lo calcula.
   *
   * @param ttl segundos que el valor se considera fresco
   */
  async recordar<T>(
    espacio: string,
    id: string,
    ttl: number,
    calcular: () => Promise<T>,
  ): Promise<T> {
    const clave = await this.clave(espacio, id);

    const guardado = await this.leer<T>(clave);

    // Fresco: se devuelve tal cual.
    if (guardado && guardado.expira > Date.now()) {
      return guardado.valor;
    }

    const claveCerrojo = `${clave}:calculando`;
    // SET NX: solo uno lo consigue. Los demás verán que ya hay alguien.
    // Si Redis no responde se sigue sin cerrojo: sin caché el sistema va más
    // lento, pero convertir eso en un error para el cliente sería mucho peor.
    let tomado: string | null = null;
    try {
      tomado = await this.redis.client.set(claveCerrojo, '1', 'PX', ESPERA_CERROJO_MS, 'NX');
    } catch {
      return calcular();
    }

    if (tomado) {
      try {
        const valor = await calcular();
        await this.guardar(clave, valor, ttl);
        return valor;
      } finally {
        // Soltar el cerrojo tampoco puede romper la respuesta: si falla, el
        // PX de tres segundos lo libera solo.
        await this.redis.client.del(claveCerrojo).catch(() => null);
      }
    }

    // Otro proceso está calculando. Si tenemos algo caducado, se sirve: dos
    // segundos de desfase valen más que trescientos milisegundos de espera.
    if (guardado) return guardado.valor;

    // Sin nada que servir hay que esperar al que calcula. Solo pasa la primera
    // vez que se pide una clave, no en el uso normal.
    const esperado = await this.esperarA<T>(clave);
    if (esperado) return esperado;

    // El otro proceso falló o tardó demasiado: se calcula aquí. Es preferible
    // una consulta duplicada a devolver un error al cliente.
    const valor = await calcular();
    await this.guardar(clave, valor, ttl);
    return valor;
  }

  private async esperarA<T>(clave: string): Promise<T | null> {
    const limite = Date.now() + ESPERA_CERROJO_MS;

    while (Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 50));
      const guardado = await this.leer<T>(clave);
      if (guardado) return guardado.valor;
    }

    return null;
  }

  private async leer<T>(clave: string): Promise<Envuelto<T> | null> {
    try {
      const crudo = await this.redis.client.get(clave);
      if (!crudo) return null;
      return JSON.parse(crudo) as Envuelto<T>;
    } catch {
      // Un valor corrupto o de un formato anterior no puede tumbar la lectura:
      // se trata como si no estuviera y se recalcula.
      return null;
    }
  }

  private async guardar<T>(clave: string, valor: T, ttl: number): Promise<void> {
    const envuelto: Envuelto<T> = { valor, expira: Date.now() + ttl * 1000 };

    try {
      // El TTL de Redis va más allá del de frescura: ese margen es justo lo que
      // permite servir caducado mientras se recalcula.
      await this.redis.client.set(clave, JSON.stringify(envuelto), 'EX', ttl + MARGEN_CADUCADO);
    } catch (error) {
      // Redis caído no puede romper una lectura que ya tiene su resultado.
      this.logger.warn(
        `No se ha podido guardar en caché ${clave}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /** Borra una entrada concreta (tras editarla en el admin). */
  async olvidar(espacio: string, id: string): Promise<void> {
    await this.redis.client.del(await this.clave(espacio, id)).catch(() => null);
  }
}
