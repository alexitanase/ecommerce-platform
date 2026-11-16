import path from 'node:path';
import * as Sentry from '@sentry/node';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/**
 * Arranque de trazas y captura de errores.
 *
 * El arranque ocurre al importar este módulo, no llamando a una función desde
 * main.ts: los `import` de ES se evalúan todos antes que cualquier sentencia
 * del fichero, así que una llamada colocada "arriba del todo" se ejecutaría
 * igualmente DESPUÉS de cargarse Nest y Prisma. Las instrumentaciones parchean
 * http, pg e ioredis al cargarlos; si llegan tarde, las trazas salen vacías sin
 * que nada falle de forma visible. Por eso main.ts lo importa el primero y el
 * efecto va aquí, en el cuerpo del módulo.
 *
 * Las dos piezas se complementan: OpenTelemetry cuenta dónde se fue el tiempo
 * de una petición que funcionó, y Sentry agrupa las que no funcionaron.
 */

let sdk: NodeSDK | null = null;

/**
 * Lee el .env por su cuenta.
 *
 * A esta altura del arranque `NestConfigModule` todavía no se ha construido, así
 * que `process.env` solo tiene lo que venga del shell. Y no se usa `loadEnv()`
 * completo a propósito: la observabilidad no puede ser lo que decida si la
 * aplicación levanta. Bootstrap valida el entorno entero un instante después y
 * ahí sí es correcto fallar.
 */
function cargarEnv(): void {
  for (const ruta of ['../../.env', '.env']) {
    try {
      process.loadEnvFile(path.resolve(process.cwd(), ruta));
    } catch {
      // No existe o no se puede leer: se sigue con lo que haya en el entorno.
    }
  }
}

interface ConfigObservabilidad {
  dsn?: string;
  entorno: string;
  release?: string;
  muestreo: number;
  otlp?: string;
  servicio: string;
}

function leerConfig(): ConfigObservabilidad {
  const e = process.env;
  const muestreo = Number(e['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1');

  return {
    dsn: e['SENTRY_DSN'] || undefined,
    entorno: e['NODE_ENV'] ?? 'development',
    release: e['SENTRY_RELEASE'] || undefined,
    muestreo: Number.isFinite(muestreo) ? Math.min(Math.max(muestreo, 0), 1) : 0.1,
    otlp: e['OTEL_EXPORTER_OTLP_ENDPOINT'] || undefined,
    servicio: e['OTEL_SERVICE_NAME'] ?? 'ecom-api',
  };
}

function iniciar(env: ConfigObservabilidad): void {
  if (env.dsn) {
    Sentry.init({
      dsn: env.dsn,
      environment: env.entorno,
      release: env.release,
      // Muestreo: en un pico de Black Friday, trazar el 100% cuesta más que
      // servir el tráfico. Los errores se capturan siempre; esto solo afecta
      // a las trazas de rendimiento.
      tracesSampleRate: env.muestreo,
      // Nunca mandamos cuerpos ni cabeceras: ahí van direcciones, emails y
      // tokens. Un panel de errores no es sitio para datos personales, y el
      // RGPD tampoco lo considera una finalidad legítima.
      sendDefaultPii: false,
      beforeSend(evento) {
        delete evento.request?.cookies;
        if (evento.request?.headers) {
          delete evento.request.headers['authorization'];
          delete evento.request.headers['cookie'];
        }
        return evento;
      },
    });
  }

  if (env.otlp) {
    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: env.servicio,
        [ATTR_SERVICE_VERSION]: env.release ?? 'dev',
      }),
      traceExporter: new OTLPTraceExporter({
        url: `${env.otlp}/v1/traces`,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Una traza por cada lectura de fichero ahoga las que importan.
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-http': {
            // Salud y métricas se consultan cada pocos segundos: trazarlas
            // llenaría el almacén de ruido y nada más.
            ignoreIncomingRequestHook: (peticion) => {
              const url = peticion.url ?? '';
              return url.startsWith('/health') || url.startsWith('/metrics');
            },
          },
        }),
      ],
    });

    sdk.start();
  }
}

/**
 * Cierra el SDK volcando lo que quede pendiente.
 *
 * Sin esto, las trazas del último minuto antes de un despliegue se pierden —
 * justo las que explican por qué hubo que desplegar.
 */
export async function pararObservabilidad(): Promise<void> {
  await sdk?.shutdown();
  await Sentry.close(2000);
}

cargarEnv();
iniciar(leerConfig());
