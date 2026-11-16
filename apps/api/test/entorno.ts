import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { VersioningType } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { newId } from '@ecom/shared';
import { OPCIONES_FASTIFY } from '../src/config/fastify.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { AppModule } from '../src/app.module.js';
import { WorkersService } from '../src/modules/queue/workers.service.js';
import { PrismaService } from '../src/modules/prisma/prisma.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { RedisService } from '../src/modules/redis/redis.service.js';

/**
 * Entorno para las pruebas de integración.
 *
 * Levanta la API de verdad —guardas, validación, servicios y base de datos—
 * contra una base aparte. Es lo que faltaba: la lógica pura ya tenía pruebas,
 * pero los fallos que han aparecido esta semana vivían justo en la costura
 * entre servicio y base de datos: un número de pedido que chocaba, una caché
 * que no se invalidaba, un campo leído con otro nombre. Nada de eso lo detecta
 * un test unitario.
 *
 * **Por qué no Testcontainers**, que es lo que decía el plan: el proyecto ya
 * levanta Postgres con Docker Compose en local y como servicio en CI, así que
 * arrancar otro contenedor por ejecución añadiría medio minuto y una
 * dependencia más para aislar algo que ya está aislado por base de datos. Si
 * algún día las pruebas tienen que correr sin Docker delante, este es el
 * fichero que hay que cambiar.
 */

/** La contraseña de las cuentas que crea `personal`, para poder entrar con ellas. */
export const CONTRASENA_DE_PRUEBAS = 'Contrasena-De-Prueba-1';

/** Índice de Redis reservado a las pruebas; el 0 es el de desarrollo. */
const BASE_REDIS_PRUEBAS = 1;

/** La misma instancia de Redis que use el entorno, pero en otra base. */
function redisDePruebas(): string {
  const url = new URL(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
  url.pathname = `/${String(BASE_REDIS_PRUEBAS)}`;
  return url.toString();
}

/** Se apaga en las pruebas: los workers consumirían las colas del entorno. */
const workersDesactivados = {
  onModuleInit: () => undefined,
  onModuleDestroy: () => undefined,
};

export interface OpcionesPeticion {
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  ruta: string;
  cuerpo?: unknown;
  token?: string;
  cabeceras?: Record<string, string>;
}

export interface Respuesta<T> {
  estado: number;
  datos: T;
  cabeceras: Record<string, unknown>;
}

/**
 * Cuerpo de error de la API, que es lo que se comprueba en los casos que fallan
 * a propósito.
 */
export interface ErrorApi {
  statusCode: number;
  error?: string;
  message: string;
}

export interface EntornoPruebas {
  app: NestFastifyApplication;
  prisma: PrismaService;
  redis: RedisService;
  /**
   * Petición HTTP contra la API, sin abrir un puerto.
   *
   * El tipo de la respuesta lo declara quien llama. Es algo más de escribir, y
   * a cambio la prueba dice qué forma espera y un cambio en la API la rompe al
   * compilar en vez de en mitad de una aserción.
   */
  peticion: <T = Record<string, unknown>>(opciones: OpcionesPeticion) => Promise<Respuesta<T>>;
  /**
   * Crea una persona del equipo con los permisos que se le indiquen y devuelve
   * su token.
   *
   * Los permisos se piden uno a uno a propósito: así cada prueba dice
   * exactamente con qué acceso se ejecuta, y comprobar que sin `settings:write`
   * no se puede tocar una integración es tan sencillo como no pedirlo.
   */
  personal: (permisos: string[]) => Promise<{ token: string; userId: string; email: string }>;
}

export async function crearEntorno(): Promise<EntornoPruebas> {
  // La base de pruebas es otra: si apuntara a la de desarrollo, cada ejecución
  // borraría el catálogo con el que se está trabajando.
  const urlPruebas = process.env['DATABASE_URL_TEST'];
  if (!urlPruebas) {
    throw new Error(
      'Falta DATABASE_URL_TEST. Las pruebas de integración no se ejecutan contra la base de desarrollo.',
    );
  }
  process.env['DATABASE_URL'] = urlPruebas;

  // Redis también va aparte, en otra base de datos de la misma instancia.
  // No es una manía: ahí viven los contadores del límite de peticiones y las
  // claves que descartan un webhook repetido, y ambas cosas sobreviven a la
  // ejecución. Compartiéndolas, la segunda pasada da 429 donde la primera dio
  // 201 y un aviso de cobro legítimo se descarta por duplicado —fallos que
  // parecen del código y son del entorno—. Además, vaciarlas sin separarlas
  // borraría la caché con la que se está trabajando en desarrollo.
  process.env['REDIS_URL'] = process.env['REDIS_URL_TEST'] ?? redisDePruebas();

  const modulo = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WorkersService)
    .useValue(workersDesactivados)
    .compile();

  // Las mismas opciones del adaptador que en `main.ts`. Se creaba vacío, y por
  // eso ninguna prueba reprodujo el 414 de los slugs largos: el servidor real
  // tenía un límite que aquí no existía.
  const app = modulo.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(OPCIONES_FASTIFY),
  );

  // La misma configuración que en `main.ts`, y por el mismo motivo: si aquí se
  // validara o se manejaran los errores de otra forma, las pruebas pasarían por
  // caminos que el servidor real no recorre. En particular el pipe tiene que
  // ser el de Zod —el genérico de Nest necesita class-validator, que este
  // proyecto no usa— y el filtro de excepciones es quien convierte un
  // `BadRequestException` en el 400 con mensaje que se comprueba abajo.
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
  await app.register(cookie, { secret: process.env['JWT_REFRESH_SECRET'] ?? 'secreto-de-pruebas' });

  app.setGlobalPrefix('api', {
    exclude: ['health', 'health/live', 'health/ready', 'metrics'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);

  // Antes de que ninguna prueba pueda llamar a `flushdb`. Si la conexión
  // hubiera acabado en la base 0 —porque alguien pusiera REDIS_URL_TEST sin
  // índice, por ejemplo— vaciarla borraría la caché de desarrollo.
  if (redis.client.options.db !== BASE_REDIS_PRUEBAS) {
    throw new Error(
      `Las pruebas están conectadas a la base ${String(redis.client.options.db)} de Redis, ` +
        `que no es la reservada (${String(BASE_REDIS_PRUEBAS)}). Revisa REDIS_URL_TEST.`,
    );
  }

  const peticion = async <T>({
    metodo,
    ruta,
    cuerpo,
    token,
    cabeceras,
  }: OpcionesPeticion): Promise<Respuesta<T>> => {
    const respuesta = await app.inject({
      method: metodo,
      url: ruta,
      ...(cuerpo !== undefined ? { payload: cuerpo as object } : {}),
      headers: {
        // Solo cuando de verdad se manda algo: Fastify rechaza con 400 una
        // petición que se declara JSON y llega sin cuerpo, y ese 400 se
        // confundiría con una validación fallida del endpoint.
        ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...cabeceras,
      },
    });

    return {
      estado: respuesta.statusCode,
      datos: (respuesta.body ? JSON.parse(respuesta.body) : null) as T,
      cabeceras: respuesta.headers,
    };
  };

  const passwords = app.get(PasswordService);

  const personal: EntornoPruebas['personal'] = async (permisos) => {
    const email = `personal-${newId().slice(0, 8)}@ejemplo.es`;
    const contrasena = CONTRASENA_DE_PRUEBAS;
    const userId = newId();
    const roleId = newId();

    await prisma.client.user.create({
      data: {
        id: userId,
        email,
        type: 'STAFF',
        password: await passwords.hash(contrasena),
        emailVerifiedAt: new Date(),
        firstName: 'Persona',
        lastName: 'De Pruebas',
      },
    });

    await prisma.client.role.create({
      data: {
        id: roleId,
        key: `rol-${roleId.slice(0, 8)}`,
        name: 'Rol de pruebas',
        permissions: {
          create: permisos.map((key) => ({
            permission: {
              connectOrCreate: {
                where: { key },
                create: {
                  id: newId(),
                  key,
                  resource: key.split(':')[0] ?? key,
                  action: key.split(':')[1] ?? 'read',
                },
              },
            },
          })),
        },
        users: { create: { userId } },
      },
    });

    // Se entra por la puerta de siempre en vez de firmar un token a mano: así
    // la prueba también cubre que el login del personal sigue funcionando.
    const sesion = await peticion<{ accessToken: string }>({
      metodo: 'POST',
      ruta: '/api/v1/auth/login',
      cuerpo: { email, password: contrasena },
    });

    if (sesion.estado !== 200) {
      throw new Error(`No se pudo iniciar sesión de prueba: ${JSON.stringify(sesion.datos)}`);
    }

    return { token: sesion.datos.accessToken, userId, email };
  };

  return { app, prisma, redis, peticion, personal };
}

/**
 * Deja el entorno como recién instalado: Postgres y Redis.
 *
 * Postgres se vacía por SQL y no borrando fila a fila con Prisma: con veinte
 * tablas enlazadas, el orden de borrado es un quebradero de cabeza que se rompe
 * en cuanto alguien añade una relación. `TRUNCATE ... CASCADE` no tiene ese
 * problema y tarda menos.
 *
 * Redis se vacía por el mismo motivo que la base: si no, una prueba hereda de
 * la anterior el contador del límite de peticiones y los webhooks ya vistos, y
 * el resultado depende del orden en que se ejecuten.
 */
export async function vaciarBase(entorno: EntornoPruebas): Promise<void> {
  const tablas = await entorno.prisma.client.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;

  const nombres = tablas.map((t) => `"public"."${t.tablename}"`).join(', ');
  if (nombres) {
    await entorno.prisma.client.$executeRawUnsafe(
      `TRUNCATE TABLE ${nombres} RESTART IDENTITY CASCADE`,
    );
  }

  await entorno.redis.client.flushdb();
}
