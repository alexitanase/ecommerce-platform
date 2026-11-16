import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client/client.js';

export * from './generated/client/client.js';
export * from './generated/client/enums.js';
export type * from './generated/client/models.js';

/**
 * Cliente Prisma único por proceso.
 *
 * Desde Prisma 7 la conexión ya no vive en el esquema: se pasa un driver
 * adapter (`@prisma/adapter-pg`) al construir el cliente. Guardamos la
 * instancia en `globalThis` porque en desarrollo la recarga en caliente vuelve
 * a evaluar este módulo, y sin eso abriríamos un pool nuevo en cada recarga
 * hasta agotar las conexiones de Postgres.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Conexiones por proceso.
 *
 * Es la cuenta que revienta un despliegue al escalar y nadie hace hasta que
 * pasa: cada réplica abre su propio pool, así que el total es
 * `réplicas × pool`. Con el `max_connections` de Postgres en 100 y un pool de
 * 10, la undécima réplica ya no conecta y la tienda empieza a dar errores 500
 * sin que haya cambiado ni una línea de código.
 *
 * Diez por proceso es un punto de partida razonable para una API que responde
 * en milisegundos: más conexiones no dan más rendimiento, dan más contención
 * dentro de Postgres. Se ajusta con `DATABASE_POOL_SIZE` cuando el
 * dimensionamiento real lo pida.
 */
const POOL_POR_DEFECTO = 10;

function tamanoDelPool(): number {
  const declarado = Number(process.env['DATABASE_POOL_SIZE']);
  return Number.isInteger(declarado) && declarado > 0 ? declarado : POOL_POR_DEFECTO;
}

export function createPrismaClient(connectionString?: string): PrismaClient {
  const url = connectionString ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('Falta DATABASE_URL: no se puede crear el cliente de base de datos.');
  }

  const adapter = new PrismaPg({
    connectionString: url,
    max: tamanoDelPool(),
    // Una conexión ociosa retenida es una conexión que otra réplica no puede
    // usar. Treinta segundos basta para reutilizarla entre peticiones sin
    // acaparar el cupo del servidor.
    idleTimeoutMillis: 30_000,
    // Si el pool está lleno y no se libera ninguna en cinco segundos, es mejor
    // fallar rápido que dejar la petición colgada: el cliente ya se ha ido.
    connectionTimeoutMillis: 5_000,
  });

  return new PrismaClient({
    adapter,
    log:
      process.env['NODE_ENV'] === 'development'
        ? [
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ]
        : [{ emit: 'stdout', level: 'error' }],
  });
}

/**
 * Devuelve el cliente compartido, creándolo la primera vez que se usa.
 *
 * La creación es perezosa a propósito. Antes se construía al evaluar el módulo,
 * y eso significaba que importar `@ecom/db` —aunque fuera solo para usar un
 * tipo— fallaba si no había `DATABASE_URL`. Rompía los tests unitarios de
 * cualquier fichero que tocara la cadena de imports, sin que esos tests
 * necesitasen base de datos para nada.
 */
export function getPrisma(): PrismaClient {
  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
}

/**
 * Cliente compartido como propiedad.
 *
 * Se expone mediante un Proxy para conservar la ergonomía de `prisma.user…`
 * sin que el simple hecho de importar el módulo abra una conexión. La primera
 * propiedad que se lea dispara la creación real.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_destino, propiedad, receptor) {
    return Reflect.get(getPrisma(), propiedad, receptor) as unknown;
  },
  has(_destino, propiedad) {
    return Reflect.has(getPrisma(), propiedad);
  },
});
