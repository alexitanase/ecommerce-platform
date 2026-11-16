// Primero de todo: al importarse arranca las instrumentaciones, que parchean
// http, pg e ioredis. Los imports se evalúan en orden, así que este tiene que
// ir antes que Nest y Prisma o el parche llega tarde.
import './observabilidad.js';
import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';
import { loadEnv } from '@ecom/shared';
import { OPCIONES_FASTIFY } from './config/fastify.js';
import { pararObservabilidad } from './observabilidad.js';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { registrarEndurecimiento } from './common/security/endurecimiento.js';
import { registrarCuerpoCrudo } from './common/security/cuerpo-crudo.js';

/**
 * Traduce `TRUST_PROXY` a lo que espera Fastify.
 *
 * Se acepta una lista de IP o CIDR además de los booleanos porque es lo que
 * hace falta de verdad: en producción hay UN proxy delante y solo de él hay
 * que fiarse. `true` deja la puerta abierta a que cualquiera falsifique su IP.
 */
function interpretarTrustProxy(valor: string): boolean | string[] {
  const limpio = valor.trim();
  if (limpio === '' || limpio.toLowerCase() === 'false') return false;
  if (limpio.toLowerCase() === 'true') return true;
  return limpio
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

async function bootstrap(): Promise<void> {
  // Se valida la configuración antes de construir nada: si falta una variable,
  // fallamos aquí con un mensaje claro en vez de a mitad del arranque.
  const env = loadEnv();
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // De quién nos fiamos al leer X-Forwarded-For. Por defecto de nadie:
      // esa cabecera la escribe quien quiera, y confiar en ella sin filtrar
      // permite inventarse una IP por petición y saltarse todos los límites.
      // En producción se pone la dirección del proxy que haya delante.
      trustProxy: interpretarTrustProxy(env.TRUST_PROXY),
      ...OPCIONES_FASTIFY,
      // Fastify genera un id por petición; lo usamos para correlacionar logs.
      genReqId: () => crypto.randomUUID(),
    }),
    { bufferLogs: false },
  );

  // ── Seguridad ──────────────────────────────────────────────
  await app.register(helmet, {
    // La API sirve JSON, no HTML: la CSP restrictiva la aplica el storefront.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // Un año, subdominios incluidos. Sin HSTS, la primera visita por http:// de
    // un cliente en una wifi pública es interceptable aunque el sitio redirija:
    // el atacante se sitúa antes de la redirección.
    hsts:
      env.NODE_ENV === 'production'
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    // Cabecera obsoleta que llegó a introducir vulnerabilidades propias; los
    // navegadores actuales la ignoran y helmet la manda a 0 a propósito.
    xXssProtection: false,
    referrerPolicy: { policy: 'no-referrer' },
  });

  // Comprobación de origen, límites de anidamiento y bloqueo de claves que
  // contaminan prototipos. Va antes que cualquier otra cosa de Nest.
  registrarEndurecimiento(app.getHttpAdapter().getInstance(), {
    origenesPermitidos: env.CORS_ORIGINS,
  });

  // Guarda el cuerpo sin tocar en las rutas de webhook: las firmas de las
  // pasarelas se calculan sobre los bytes exactos, no sobre el JSON vuelto a
  // serializar. Va antes de que Nest registre nada porque sustituye el
  // analizador de JSON de Fastify.
  registrarCuerpoCrudo(app.getHttpAdapter().getInstance());

  await app.register(compress, { encodings: ['gzip', 'deflate', 'br'] });

  // Subida de imágenes de producto. El límite lo impone también el servicio,
  // pero cortarlo aquí evita leer en memoria un fichero que se va a rechazar.
  await app.register(multipart, {
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  });

  await app.register(cookie, {
    secret: env.JWT_REFRESH_SECRET,
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      path: '/',
    },
  });

  // Solo los orígenes declarados; `credentials` es necesario porque el refresh
  // token viaja en cookie httpOnly.
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // Sin esto el navegador oculta la cabecera al panel y las exportaciones se
    // descargan con un nombre genérico. En desarrollo no se nota porque el
    // proxy de Vite las deja en el mismo origen; en producción, con el panel y
    // la API en dominios distintos, sí.
    exposedHeaders: ['Content-Disposition'],
  });

  // ── Convenciones de la API ─────────────────────────────────
  app.setGlobalPrefix('api', {
    // /metrics y /health son infraestructura, no contrato público: Prometheus y
    // el balanceador apuntan a la ruta desnuda y no deben moverse al subir de
    // versión la API.
    exclude: ['health', 'health/live', 'health/ready', 'metrics'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Validación con Zod en toda la API: los mismos esquemas que validan la
  // entrada generan la documentación OpenAPI, así que no pueden desincronizarse.
  app.useGlobalPipes(new ZodValidationPipe());

  app.useGlobalFilters(new AllExceptionsFilter());

  // Cierra conexiones de Postgres y Redis antes de morir; sin esto un
  // despliegue corta peticiones a medio procesar.
  app.enableShutdownHooks();

  // Vuelca las trazas pendientes al apagar: sin esto se pierde justo el último
  // minuto antes de un despliegue, que es el que explica por qué se desplegó.
  for (const senal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(senal, () => {
      void pararObservabilidad().finally(() => process.exit(0));
    });
  }

  // ── Documentación ──────────────────────────────────────────
  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('API · Plataforma Ecommerce')
      .setDescription(
        'API de la plataforma de ecommerce con dropshipping multi-proveedor. ' +
          'Todos los importes se expresan en céntimos como número entero.',
      )
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addServer(env.API_URL)
      .build();

    // cleanupOpenApiDoc convierte los esquemas Zod de los DTO en OpenAPI válido.
    const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs/openapi.json',
      swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    });
  }

  await app.listen({ port: env.API_PORT, host: env.API_HOST });

  logger.log(`API escuchando en ${env.API_URL}`);
  logger.log(`Salud       → ${env.API_URL}/health`);
  if (env.NODE_ENV !== 'production') {
    logger.log(`Documentación → ${env.API_URL}/docs`);
  }
}

bootstrap().catch((error: unknown) => {
  console.error('No se ha podido arrancar la API:\n', error);
  process.exit(1);
});
