import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheService } from './cache.service.js';
import type { RedisService } from '../redis/redis.service.js';

/**
 * Redis en memoria, con lo justo que usa CacheService.
 *
 * Se prueba contra un doble y no contra Redis de verdad porque lo que hay que
 * verificar es la lógica de concurrencia —cuántas veces se llama a la función
 * cara— y eso se mide igual sin red de por medio.
 */
function redisFalso() {
  const datos = new Map<string, { valor: string; expiraEn: number }>();

  const vivo = (clave: string) => {
    const e = datos.get(clave);
    if (!e) return null;
    if (e.expiraEn <= Date.now()) {
      datos.delete(clave);
      return null;
    }
    return e;
  };

  const client = {
    get: vi.fn((clave: string) => Promise.resolve(vivo(clave)?.valor ?? null)),

    set: vi.fn((clave: string, valor: string, ...resto: unknown[]) => {
      const nx = resto.includes('NX');
      if (nx && vivo(clave)) return Promise.resolve(null);

      const i = resto.findIndex((r) => r === 'EX' || r === 'PX');
      const unidad = resto[i];
      const cantidad = Number(resto[i + 1] ?? 0);
      const ms = unidad === 'EX' ? cantidad * 1000 : cantidad;

      datos.set(clave, { valor, expiraEn: Date.now() + ms });
      return Promise.resolve('OK');
    }),

    del: vi.fn((clave: string) => {
      datos.delete(clave);
      return Promise.resolve(1);
    }),

    // Como el INCR de verdad: sobre una clave que no existe cuenta desde 0 y
    // la deja en 1. Empezando en 1 —como hacía este doble— la primera
    // invalidación parecía funcionar en las pruebas y no funcionaba en Redis.
    incr: vi.fn((clave: string) => {
      const actual = Number(vivo(clave)?.valor ?? '0');
      datos.set(clave, { valor: String(actual + 1), expiraEn: Date.now() + 86_400_000 });
      return Promise.resolve(actual + 1);
    }),
  };

  return { client, datos } as unknown as RedisService & {
    client: typeof client;
    datos: typeof datos;
  };
}

describe('Caché de lectura', () => {
  let redis: ReturnType<typeof redisFalso>;
  let cache: CacheService;

  beforeEach(() => {
    redis = redisFalso();
    cache = new CacheService(redis);
  });

  it('calcula una vez y luego sirve lo guardado', async () => {
    const calcular = vi.fn().mockResolvedValue({ nombre: 'Camiseta' });

    const uno = await cache.recordar('producto', 'abc', 300, calcular);
    const dos = await cache.recordar('producto', 'abc', 300, calcular);

    expect(uno).toEqual({ nombre: 'Camiseta' });
    expect(dos).toEqual({ nombre: 'Camiseta' });
    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it('no repite la consulta cuando llegan muchas peticiones a la vez', async () => {
    // El escenario real: una clave caliente caduca en plena campaña y llegan
    // 50 peticiones simultáneas. Sin protección, las 50 consultan Postgres.
    let enCurso = 0;
    let simultaneasMaximas = 0;

    const calcular = vi.fn(async () => {
      enCurso += 1;
      simultaneasMaximas = Math.max(simultaneasMaximas, enCurso);
      await new Promise((r) => setTimeout(r, 60));
      enCurso -= 1;
      return { precio: 4199 };
    });

    const resultados = await Promise.all(
      Array.from({ length: 50 }, () => cache.recordar('producto', 'caliente', 300, calcular)),
    );

    expect(simultaneasMaximas).toBe(1);
    expect(calcular).toHaveBeenCalledTimes(1);
    // Y todas reciben el valor, ninguna se queda sin respuesta.
    expect(resultados.every((r) => r.precio === 4199)).toBe(true);
  });

  it('sirve el valor caducado mientras otro recalcula', async () => {
    let version = 1;
    const calcular = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { version: version++ };
    });

    // TTL de 1 segundo para que caduque durante la prueba.
    await cache.recordar('producto', 'x', 1, calcular);
    await new Promise((r) => setTimeout(r, 1100));

    // Dos a la vez sobre un valor caducado: una recalcula, la otra recibe el
    // valor viejo en lugar de esperar. Dos segundos de desfase valen más que
    // 300 ms de espera en la ficha de producto.
    const [a, b] = await Promise.all([
      cache.recordar('producto', 'x', 1, calcular),
      cache.recordar('producto', 'x', 1, calcular),
    ]);

    expect(calcular).toHaveBeenCalledTimes(2);
    expect([a.version, b.version].sort()).toEqual([1, 2]);
  });

  it('la PRIMERA invalidación de un espacio ya invalida', async () => {
    // El caso que se escapaba: sin contador previo, `INCR` deja la versión en
    // 1, que era justo la que se asumía por defecto. Las claves no cambiaban y
    // se seguía sirviendo lo viejo hasta que caducara solo: un cambio hecho en
    // el panel no se veía en la tienda, y no había forma de saber por qué.
    await cache.recordar('portada', 'es', 300, () => Promise.resolve('viejo'));

    await cache.invalidarEspacio('portada');

    expect(await cache.recordar('portada', 'es', 300, () => Promise.resolve('nuevo'))).toBe(
      'nuevo',
    );
  });

  it('subir la versión invalida todo el espacio de golpe', async () => {
    const calcular = vi.fn().mockResolvedValue('viejo');
    await cache.recordar('producto', 'a', 300, calcular);
    await cache.recordar('producto', 'b', 300, calcular);

    await cache.invalidarEspacio('producto');

    const nuevo = vi.fn().mockResolvedValue('nuevo');
    expect(await cache.recordar('producto', 'a', 300, nuevo)).toBe('nuevo');
    expect(await cache.recordar('producto', 'b', 300, nuevo)).toBe('nuevo');
  });

  it('no mezcla espacios de nombres distintos', async () => {
    await cache.recordar('producto', 'mismo-id', 300, () => Promise.resolve('producto'));
    await cache.recordar('categoria', 'mismo-id', 300, () => Promise.resolve('categoría'));

    expect(await cache.recordar('producto', 'mismo-id', 300, () => Promise.resolve('otro'))).toBe(
      'producto',
    );
    expect(await cache.recordar('categoria', 'mismo-id', 300, () => Promise.resolve('otro'))).toBe(
      'categoría',
    );
  });

  it('invalidar un espacio no toca los demás', async () => {
    await cache.recordar('producto', 'a', 300, () => Promise.resolve('p'));
    await cache.recordar('categoria', 'a', 300, () => Promise.resolve('c'));

    await cache.invalidarEspacio('producto');

    expect(await cache.recordar('categoria', 'a', 300, () => Promise.resolve('recalculado'))).toBe(
      'c',
    );
  });

  it('si Redis falla al guardar, la petición se responde igual', async () => {
    // Redis caído no puede convertir una lectura que ya tiene su resultado en
    // un error para el cliente.
    redis.client.set.mockRejectedValueOnce(new Error('Redis no disponible'));

    const valor = await cache.recordar('producto', 'z', 300, () => Promise.resolve('funciona'));
    expect(valor).toBe('funciona');
  });

  it('un valor corrupto se recalcula en vez de reventar', async () => {
    redis.client.get.mockResolvedValueOnce('{esto no es json');

    const valor = await cache.recordar('producto', 'roto', 300, () =>
      Promise.resolve('recalculado'),
    );
    expect(valor).toBe('recalculado');
  });

  it('las claves muy largas se resumen para no ocupar más que el valor', async () => {
    const idLargo = 'filtro='.repeat(50);
    await cache.recordar('listado', idLargo, 300, () => Promise.resolve([]));

    const claves = [...redis.datos.keys()].filter((k) => k.startsWith('cache:listado'));
    expect(claves).toHaveLength(1);
    expect(claves[0]!.length).toBeLessThan(80);
  });
});
