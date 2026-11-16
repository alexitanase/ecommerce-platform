import { describe, expect, it } from 'vitest';
import type { Env } from '@ecom/shared';
import { ThrottlerStorageRedisService } from './throttler-redis.storage.js';
import type { RedisService } from '../modules/redis/redis.service.js';

/**
 * Quién pasa y quién se queda fuera.
 *
 * Este almacén es el que de verdad decide: el guard de @nestjs/throttler se
 * limita a mirar el `isBlocked` que devuelve `increment`. Un fallo aquí no da
 * ningún error en el arranque; da una de dos cosas, las dos malas. O deja
 * pasar sin freno —y entonces registrarse mil veces para agotar cupones sale
 * gratis— o frena de más, y el cliente que se equivoca de contraseña dos veces
 * se queda una hora fuera de su cuenta.
 *
 * De ahí que se pruebe el comportamiento en los dos entornos: el ensanchado de
 * desarrollo existe para que la tanda de pruebas no falle en falso, y sería un
 * desastre silencioso que se colara en producción.
 */

/** Un Redis de mentira, pero con la semántica que importa: TTL y contador. */
function redisFalso() {
  const valores = new Map<string, number>();
  const caducidad = new Map<string, number>();

  const pttl = (clave: string) => Promise.resolve(caducidad.get(clave) ?? -1);

  const cliente = {
    pttl,
    pexpire: (clave: string, ms: number) => {
      caducidad.set(clave, ms);
      return Promise.resolve(1);
    },
    set: (clave: string, _v: string, _px: string, ms: number) => {
      valores.set(clave, 1);
      caducidad.set(clave, ms);
      return Promise.resolve('OK');
    },
    multi: () => {
      const ordenes: (() => number)[] = [];
      const cadena = {
        incr: (clave: string) => {
          ordenes.push(() => {
            const siguiente = (valores.get(clave) ?? 0) + 1;
            valores.set(clave, siguiente);
            return siguiente;
          });
          return cadena;
        },
        pttl: (clave: string) => {
          ordenes.push(() => caducidad.get(clave) ?? -1);
          return cadena;
        },
        exec: () => Promise.resolve(ordenes.map((o) => [null, o()])),
      };
      return cadena;
    },
  };

  return { servicio: { client: cliente } as unknown as RedisService, valores, caducidad };
}

const almacen = (entorno: string, redis: RedisService) =>
  new ThrottlerStorageRedisService(redis, { NODE_ENV: entorno } as Env);

/** Diez peticiones seguidas contra el mismo cupo. */
async function golpear(
  servicio: ThrottlerStorageRedisService,
  veces: number,
  cupo = 10,
): Promise<boolean[]> {
  const frenadas: boolean[] = [];
  for (let i = 0; i < veces; i += 1) {
    const registro = await servicio.increment('ip:1.2.3.4', 60_000, cupo, 3_600_000, 'defecto');
    frenadas.push(registro.isBlocked);
  }
  return frenadas;
}

describe('almacén del limitador', () => {
  describe('en producción', () => {
    it('frena al pasarse del cupo', async () => {
      const { servicio } = redisFalso();
      const frenadas = await golpear(almacen('production', servicio), 12);

      // Las diez primeras pasan; a partir de ahí, fuera.
      expect(frenadas.slice(0, 10)).toEqual(Array<boolean>(10).fill(false));
      expect(frenadas.slice(10)).toEqual([true, true]);
    });

    it('respeta un bloqueo ya puesto sin volver a contar', async () => {
      const { servicio, valores, caducidad } = redisFalso();
      caducidad.set('throttle:defecto:ip:1.2.3.4:bloqueado', 900_000);

      const registro = await almacen('production', servicio).increment(
        'ip:1.2.3.4',
        60_000,
        10,
        3_600_000,
        'defecto',
      );

      expect(registro.isBlocked).toBe(true);
      expect(registro.timeToBlockExpire).toBe(900);
      // Y no gasta una escritura en contar a quien ya está fuera.
      expect(valores.has('throttle:defecto:ip:1.2.3.4')).toBe(false);
    });
  });

  describe('fuera de producción', () => {
    it('ensancha el cupo en vez de apagarlo', async () => {
      const { servicio, valores } = redisFalso();
      const frenadas = await golpear(almacen('development', servicio), 40);

      // Cuarenta peticiones contra un cupo de diez y ninguna frenada: es lo
      // que evita que la suite falle en falso a la tercera pasada.
      expect(frenadas).toEqual(Array<boolean>(40).fill(false));

      // Pero el camino se recorre entero. Si el contador dejara de subir, una
      // clave mal formada o un Redis caído pasarían inadvertidos hasta el día
      // del despliegue.
      expect(valores.get('throttle:defecto:ip:1.2.3.4')).toBe(40);
    });

    it('sigue frenando si se pasa del cupo ensanchado', async () => {
      // Ensanchado no es infinito: un bucle desbocado en desarrollo debe
      // seguir topando con algo.
      const { servicio } = redisFalso();
      const frenadas = await golpear(almacen('test', servicio), 205, 2);

      expect(frenadas.slice(0, 200)).toEqual(Array<boolean>(200).fill(false));
      expect(frenadas.slice(200)).toEqual([true, true, true, true, true]);
    });

    it('ignora un bloqueo heredado', async () => {
      // El caso real: se prueban los límites con NODE_ENV=production, la IP
      // queda bloqueada una hora y la máquina se vuelve inservible para
      // seguir probando. El bloqueo existe, pero aquí no estorba.
      const { servicio, caducidad } = redisFalso();
      caducidad.set('throttle:defecto:ip:1.2.3.4:bloqueado', 3_600_000);

      const registro = await almacen('development', servicio).increment(
        'ip:1.2.3.4',
        60_000,
        10,
        3_600_000,
        'defecto',
      );

      expect(registro.isBlocked).toBe(false);
    });
  });
});
