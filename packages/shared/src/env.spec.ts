import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

/**
 * La validación que decide si el proceso arranca.
 *
 * Tiene que fallar en los dos sentidos, y los dos han pasado ya en este
 * proyecto: una vez la API no arrancaba porque una variable opcional venía
 * vacía en el propio `.env.example`, y el riesgo contrario —arrancar en
 * producción con los secretos de ejemplo— es de los que no se descubren hasta
 * que alguien los usa.
 */

/** Lo mínimo imprescindible para que la configuración sea válida. */
const MINIMO = {
  DATABASE_URL: 'postgresql://ecom:pass@localhost:5432/ecom',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde1',
};

describe('Lo que hace falta para arrancar', () => {
  it('con lo mínimo, arranca y rellena los valores por defecto', () => {
    const env = loadEnv(MINIMO);

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3001);
    expect(env.CORS_ORIGINS).toContain('http://localhost:3000');
  });

  it('sin base de datos no arranca, y lo dice', () => {
    // El mensaje importa tanto como el fallo: un volcado de Zod en el arranque
    // de un contenedor es lo que convierte un despiste de un minuto en una
    // hora de búsqueda.
    const { DATABASE_URL: _, ...sinBase } = MINIMO;

    expect(() => loadEnv(sinBase)).toThrow(/DATABASE_URL/);
    expect(() => loadEnv(sinBase)).toThrow(/\.env\.example/);
  });

  it('un secreto corto se rechaza', () => {
    // Firmar tokens con una cadena de ocho caracteres es no firmarlos.
    expect(() => loadEnv({ ...MINIMO, JWT_ACCESS_SECRET: 'corto' })).toThrow(/32 caracteres/);
  });

  it('una URL de base de datos que no es de Postgres se rechaza', () => {
    expect(() => loadEnv({ ...MINIMO, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });
});

describe('Variables opcionales que llegan vacías', () => {
  it('una vacía es lo mismo que no ponerla', () => {
    // `.env.example` deja sin valor todo lo que gestiona el panel, así que
    // llegan como cadena vacía. Sin esto, `z.url().optional()` responde
    // "Invalid URL" y la API no arranca con el ejemplo del propio proyecto.
    const env = loadEnv({ ...MINIMO, MEILI_HOST: '', S3_ENDPOINT: '', SENTRY_DSN: '' });

    expect(env.MEILI_HOST).toBeUndefined();
    expect(env.S3_ENDPOINT).toBeUndefined();
  });

  it('una vacía con espacios también', () => {
    expect(loadEnv({ ...MINIMO, MEILI_HOST: '   ' }).MEILI_HOST).toBeUndefined();
  });

  it('pero si trae un valor, se valida de verdad', () => {
    // Que se admita vacía no puede significar que se admita cualquier cosa.
    expect(() => loadEnv({ ...MINIMO, MEILI_HOST: 'esto-no-es-una-url' })).toThrow();
    expect(loadEnv({ ...MINIMO, MEILI_HOST: 'http://localhost:7700' }).MEILI_HOST).toBe(
      'http://localhost:7700',
    );
  });
});

describe('En producción no valen los valores de ejemplo', () => {
  const produccion = { ...MINIMO, NODE_ENV: 'production' };

  it('rechaza los secretos de plantilla', () => {
    expect(() =>
      loadEnv({ ...produccion, JWT_ACCESS_SECRET: `cambiame_${'x'.repeat(30)}` }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rechaza una clave de cifrado de solo ceros', () => {
    // Cifrar las credenciales de las pasarelas con una clave de ceros es
    // guardarlas en claro con pasos de más.
    expect(() => loadEnv({ ...produccion, ENCRYPTION_KEY: '0'.repeat(64) })).toThrow(
      /ENCRYPTION_KEY/,
    );
  });

  it('dice cómo generar uno bueno', () => {
    expect(() => loadEnv({ ...produccion, ENCRYPTION_KEY: '0'.repeat(64) })).toThrow(
      /openssl rand/,
    );
  });

  it('en desarrollo esos mismos valores se toleran', () => {
    // Si no, no se podría arrancar en local partiendo de `.env.example`.
    expect(() => loadEnv({ ...MINIMO, ENCRYPTION_KEY: '0'.repeat(64) })).not.toThrow();
  });

  it('con secretos de verdad, produccion arranca', () => {
    expect(loadEnv(produccion).NODE_ENV).toBe('production');
  });
});
