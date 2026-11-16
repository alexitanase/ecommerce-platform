import { z } from 'zod';

/**
 * Esquema de configuración de toda la plataforma.
 *
 * Se valida una sola vez al arrancar el proceso: si falta una variable o tiene
 * un valor imposible, el arranque falla ahí mismo con un mensaje claro. Es
 * preferible no arrancar a descubrir a las tres horas que `JWT_ACCESS_SECRET`
 * estaba vacío y llevamos toda la tarde firmando tokens con una cadena vacía.
 */

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['true', '1', 'yes'].includes(v.toLowerCase())));

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

/**
 * Variable opcional que en el fichero puede aparecer vacía.
 *
 * `.env.example` deja sin valor todo lo que no hace falta para arrancar, así
 * que estas variables llegan como cadena vacía y no como ausentes. Sin este
 * paso, `z.url().optional()` las rechaza —"Invalid URL"— y la API no arranca
 * por una línea que el propio ejemplo del proyecto trae vacía.
 */
const vacioEsAusente = <T extends z.ZodType>(esquema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    esquema.optional(),
  );

/** Duración tipo `15m`, `30d`, `24h`, `3600s`. */
const duration = z.string().regex(/^\d+[smhd]$/, 'Formato esperado: 15m, 24h, 30d…');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // ── API ──────────────────────────────────────────────────
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  API_URL: z.url().default('http://localhost:3001'),
  // En Zod 4 el valor por defecto NO pasa por el transform, así que va ya como lista.
  CORS_ORIGINS: csv.default(['http://localhost:3000', 'http://localhost:5173']),

  // ── Frontends ────────────────────────────────────────────
  STOREFRONT_URL: z.url().default('http://localhost:3000'),
  ADMIN_URL: z.url().default('http://localhost:5173'),

  /**
   * Dominio padre para las cookies que la TIENDA necesita leer en servidor.
   *
   * En producción la API vive en `api.midominio.com` y la tienda en
   * `midominio.com`. Una cookie sin `Domain` se queda en el subdominio que la
   * pone, así que la tienda —que pinta sus páginas en el servidor— nunca la
   * veía: quien verificaba su edad seguía encontrándose la puerta en la
   * siguiente página, para siempre. Con `.midominio.com` la comparten los dos.
   *
   * Vacío en local, donde todo es `localhost` y no hace falta.
   *
   * **No se aplica al refresh token a propósito.** Ampliar el alcance de una
   * cookie de sesión a todos los subdominios significa que cualquiera de ellos
   * —hoy y en el futuro— puede leerla; el token de sesión solo lo necesita la
   * API, que es quien lo pone y quien lo lee.
   */
  COOKIE_DOMAIN: vacioEsAusente(z.string().trim()),

  // ── Datos ────────────────────────────────────────────────
  DATABASE_URL: z.string().startsWith('postgresql://'),

  /**
   * Réplica de lectura, si la hay.
   *
   * Cuando se declara, todas las lecturas van a ella y solo las escrituras al
   * primario. Es lo que permite añadir capacidad de lectura —el catálogo, que
   * es el 90 % del tráfico— sin tocar el primario, que es el que no se puede
   * replicar. Sin ella todo va al primario, que es lo correcto hasta que haga
   * falta.
   */
  DATABASE_URL_REPLICA: vacioEsAusente(z.string().startsWith('postgresql://')),

  /**
   * Si este proceso ejecuta los workers de las colas.
   *
   * En desarrollo todo va junto y es cómodo. En producción se separan: un
   * proceso que sirve HTTP y a la vez procesa una sincronización de mil
   * productos reparte el mismo bucle de eventos entre las dos cosas, y quien
   * paga la latencia es el cliente que está en el checkout. Además, así se
   * escala cada mitad por lo suyo: la API por peticiones, los workers por
   * profundidad de cola.
   */
  WORKERS_ENABLED: bool.default(true),
  DATABASE_URL_TEST: vacioEsAusente(z.string().startsWith('postgresql://')),
  REDIS_URL: z.string().startsWith('redis'),

  /*
   * ── Servicios que se configuran en el PANEL ──────────────
   *
   * Buscador, almacenamiento, correo, pasarelas, traductor, acceso social e
   * imágenes con IA viven en Ajustes → Integraciones, con sus credenciales
   * cifradas. Lo que queda aquí solo se lee en el PRIMER arranque, para
   * importar al panel lo que ya estuviera configurado en el servidor y no
   * dejar una tienda en marcha sin cobros ni correo.
   *
   * Después de esa importación, estas variables se ignoran: manda el panel.
   * Se conservan como opcionales para que una instalación nueva pueda
   * arrancar preconfigurada —el `docker-compose` de desarrollo lo usa— sin
   * obligar a pasar por el panel antes de la primera pantalla.
   */
  MEILI_HOST: vacioEsAusente(z.url()),
  MEILI_MASTER_KEY: vacioEsAusente(z.string().min(1)),

  // ── Almacenamiento ───────────────────────────────────────
  S3_ENDPOINT: vacioEsAusente(z.url()),
  S3_REGION: vacioEsAusente(z.string()),
  S3_ACCESS_KEY: vacioEsAusente(z.string().min(1)),
  S3_SECRET_KEY: vacioEsAusente(z.string().min(1)),
  S3_BUCKET: vacioEsAusente(z.string().min(1)),
  S3_BUCKET_PRIVATE: vacioEsAusente(z.string().min(1)),
  S3_FORCE_PATH_STYLE: vacioEsAusente(bool),
  S3_PUBLIC_URL: vacioEsAusente(z.url()),

  // ── Traducción automática ────────────────────────────────
  /**
   * Motor de traducción de las fichas importadas.
   *
   * `ninguno` es el valor por defecto y no traduce nada: el producto se queda
   * en el idioma del proveedor y la tienda cae a ese idioma. Es preferible a
   * inventar una traducción, porque una ficha en inglés se entiende y una
   * traducción mala hace desconfiar del vendedor.
   *
   * `deepl` es el recomendado para español, catalán e inglés: tiene un plan
   * gratuito de 500.000 caracteres al mes, que da para unas mil fichas.
   * `libre` apunta a una instancia propia de LibreTranslate, sin coste por
   * carácter y con menos calidad.
   */
  TRANSLATION_PROVIDER: z.enum(['ninguno', 'deepl', 'libre']).default('ninguno'),
  TRANSLATION_API_KEY: vacioEsAusente(z.string()),
  /** URL del servicio; solo con `libre` o con DeepL Pro. */
  TRANSLATION_URL: vacioEsAusente(z.url()),

  // ── Email ────────────────────────────────────────────────
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool.default(false),
  MAIL_FROM: z.string().default('Tienda <no-reply@localhost>'),

  // ── Seguridad ────────────────────────────────────────────
  JWT_ACCESS_SECRET: z.string().min(32, 'Debe tener al menos 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'Debe tener al menos 32 caracteres'),
  /**
   * Secreto anterior, solo durante una rotación.
   *
   * Al cambiar `JWT_ACCESS_SECRET` todos los tokens en circulación dejan de
   * validar de golpe y cada usuario con sesión abierta recibe un 401. Dejando
   * aquí el secreto viejo durante un ciclo de caducidad (15 min) los tokens ya
   * emitidos siguen valiendo mientras los nuevos se firman con el actual.
   * Se retira en el despliegue siguiente.
   */
  JWT_ACCESS_SECRET_PREVIOUS: vacioEsAusente(z.string().min(32)),
  JWT_ACCESS_TTL: duration.default('15m'),
  JWT_REFRESH_TTL: duration.default('30d'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'Debe ser una clave de 32 bytes en hexadecimal (64 caracteres)'),

  // ── Acceso con proveedores externos ──────────────────────
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  /** Contenido del fichero .p8 de Apple, con los saltos de línea escapados. */
  APPLE_PRIVATE_KEY: z.string().optional(),

  // ── Localización ─────────────────────────────────────────
  DEFAULT_LOCALE: z.enum(['es', 'ca', 'en']).default('es'),
  SUPPORTED_LOCALES: csv.default(['es', 'ca', 'en']),
  DEFAULT_CURRENCY: z.string().length(3).default('EUR'),
  DEFAULT_COUNTRY: z.string().length(2).default('ES'),

  // ── Pagos ────────────────────────────────────────────────
  NOWPAYMENTS_API_KEY: z.string().optional(),
  NOWPAYMENTS_IPN_SECRET: z.string().optional(),
  NOWPAYMENTS_SANDBOX: bool.default(true),
  REVOLUT_API_KEY: z.string().optional(),
  REVOLUT_WEBHOOK_SECRET: z.string().optional(),
  REVOLUT_SANDBOX: bool.default(true),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),

  // ── Proveedores ──────────────────────────────────────────
  ALIEXPRESS_APP_KEY: z.string().optional(),
  ALIEXPRESS_APP_SECRET: z.string().optional(),
  ALIEXPRESS_CALLBACK_URL: z.string().optional(),

  // ── Imágenes IA ──────────────────────────────────────────
  COMFYUI_URL: z.string().optional(),
  AI_IMAGES_ENABLED: bool.default(false),

  // ── Observabilidad ───────────────────────────────────────
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  SENTRY_RELEASE: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('ecom-api'),
  /**
   * Quién puede leer /metrics. Prometheus raspa este endpoint y expone
   * volumen de pedidos e ingresos: publicarlo sin token es regalar la
   * facturación del negocio a cualquiera que sepa la URL.
   */
  METRICS_TOKEN: z.string().optional(),

  // ── Límite de peticiones ─────────────────────────────────
  /**
   * Peticiones por IP y ventana.
   *
   * Configurable porque el valor bueno depende del entorno: en producción
   * protege de abusos, pero una prueba de carga desde una sola máquina agota
   * el cupo en un segundo y acabaría midiendo el limitador en vez del sistema.
   */
  /**
   * De quién nos fiamos cuando dice cuál es la IP del cliente.
   *
   * La cabecera `X-Forwarded-For` la pone quien quiera: es texto en una
   * petición HTTP. Confiar en ella sin más —que es lo que hace
   * `trustProxy: true`— significa que cualquiera puede inventarse una IP
   * distinta en cada petición y **saltarse todos los límites por IP**: el
   * global, el de intentos de acceso, el de creación de pedidos y la señal de
   * velocidad por IP del control de riesgo.
   *
   * Valores:
   *  · vacío o `false` → no se confía en la cabecera; se usa la IP del socket.
   *    Es el valor por defecto, y el seguro.
   *  · lista de IP o CIDR separados por coma → se confía SOLO en esos saltos.
   *    Es lo que hay que poner en producción: la dirección del proxy o del
   *    balanceador que tenemos delante.
   *  · `true` → se confía en cualquiera. Solo para pruebas de carga desde una
   *    sola máquina, nunca en un entorno accesible desde internet.
   *
   * Sin proxy delante y con esto en `false`, todo funciona: la IP del socket
   * ES la del cliente.
   */
  TRUST_PROXY: z.string().default('false'),

  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
  THROTTLE_TTL_MS: z.coerce.number().int().min(1000).default(60_000),

  /**
   * Secreto compartido con la tienda para purgar su caché de páginas.
   *
   * Sin él, cualquiera podría forzar el recálculo del catálogo entero en bucle
   * y convertir el ISR en una denegación de servicio contra nuestra propia API.
   */
  REVALIDATE_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valida `process.env` y devuelve la configuración ya tipada.
 * Lanza un error legible (no un volcado de Zod) si algo falta.
 */
export function loadEnv(source: Record<string, unknown> = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((i) => `  · ${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Configuración de entorno inválida:\n${detalle}\n\n` +
        `Revisa tu fichero .env — puedes partir de .env.example.`,
    );
  }

  const env = parsed.data;

  // En producción no se toleran los valores de ejemplo.
  if (env.NODE_ENV === 'production') {
    const inseguros: string[] = [];
    if (env.JWT_ACCESS_SECRET.includes('cambiame')) inseguros.push('JWT_ACCESS_SECRET');
    if (env.JWT_REFRESH_SECRET.includes('cambiame')) inseguros.push('JWT_REFRESH_SECRET');
    if (/^0+$/.test(env.ENCRYPTION_KEY)) inseguros.push('ENCRYPTION_KEY');
    // La clave del buscador ya solo está aquí para la importación inicial, y
    // puede no venir: si viene, sigue sin poder ser la de ejemplo.
    if (env.MEILI_MASTER_KEY?.includes('change_me')) inseguros.push('MEILI_MASTER_KEY');
    if (inseguros.length > 0) {
      throw new Error(
        `Estas variables siguen con el valor de ejemplo y no pueden usarse en producción: ${inseguros.join(', ')}.\n` +
          `Genera valores nuevos con: openssl rand -base64 48`,
      );
    }
  }

  return env;
}
