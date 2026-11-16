/**
 * Catálogo de integraciones.
 *
 * Describe cada servicio externo que la tienda puede usar: qué credenciales
 * necesita, qué ajustes admite y de dónde se sacan. Es la fuente de la que el
 * panel construye el formulario, así que añadir una pasarela nueva es añadir
 * una entrada aquí —no tocar la interfaz.
 *
 * Regla que sostiene todo lo demás: **lo que no está configurado y activo, no
 * existe**. No se instancia, no se ofrece en el checkout y no aparece en la
 * tienda. Una pasarela a medio configurar que aparece en el checkout es un
 * cliente que elige pagar con ella y se queda a mitad.
 */

export type FamiliaIntegracion =
  | 'pago'
  | 'correo'
  | 'traduccion'
  | 'cambio'
  | 'acceso'
  | 'almacenamiento'
  | 'buscador'
  | 'imagenes'
  | 'analitica'
  | 'seguimiento';

export interface CampoIntegracion {
  clave: string;
  etiqueta: string;
  /** Un secreto no se devuelve nunca al panel una vez guardado. */
  secreto: boolean;
  /** Sin él la integración no puede funcionar. */
  obligatorio: boolean;
  ayuda?: string;
  /** Tipo de control en el formulario del panel. */
  tipo?: 'texto' | 'numero' | 'booleano';
  porDefecto?: string | number | boolean;
}

export interface DefinicionIntegracion {
  key: string;
  familia: FamiliaIntegracion;
  nombre: string;
  descripcion: string;
  /** Dónde se consiguen las credenciales; se enseña en el panel. */
  donde?: string;
  /**
   * URLs nuestras que hay que dar de alta en el panel del servicio.
   *
   * Sin ellas la integración queda «configurada» y no funciona, y el síntoma
   * aparece lejos: Google rechaza el acceso con `redirect_uri_mismatch`, y
   * NOWPayments cobra el pedido y no avisa nunca, así que el pago no se marca y
   * el pedido se queda esperando para siempre. Nada en el panel lo advertía.
   *
   * Se guarda la RUTA y no la URL completa porque el dominio depende del
   * servidor; se compone con `API_URL` al servirla. El `tipo` decide la etiqueta
   * y la explicación que enseña el panel, para no meter texto sin traducir aquí.
   */
  retornos?: { tipo: 'oauth' | 'ipn' | 'webhook'; ruta: string }[];
  /** Está implementada de verdad, no solo declarada. */
  implementada: boolean;
  /** Secretos: van cifrados. */
  credenciales: CampoIntegracion[];
  /** Ajustes no secretos: se guardan en claro y se pueden leer. */
  ajustes: CampoIntegracion[];
  /**
   * Variables de entorno de las que se importa la configuración la primera
   * vez, para no perder lo que ya estaba puesto en el servidor.
   */
  desdeEntorno?: Record<string, string>;
}

export const INTEGRACIONES: DefinicionIntegracion[] = [
  // ── Pasarelas de pago ──────────────────────────────────────
  {
    key: 'nowpayments',
    familia: 'pago',
    nombre: 'NOWPayments',
    descripcion: 'Cobros en criptomonedas. La pasarela principal de la tienda.',
    donde: 'Panel de NOWPayments → Settings → API keys. Tiene entorno de pruebas gratuito.',
    retornos: [{ tipo: 'ipn', ruta: '/api/v1/payments/webhook/nowpayments' }],
    implementada: true,
    credenciales: [
      { clave: 'apiKey', etiqueta: 'Clave de API', secreto: true, obligatorio: true },
      {
        clave: 'ipnSecret',
        etiqueta: 'Secreto IPN',
        secreto: true,
        obligatorio: true,
        ayuda:
          'Firma los avisos de pago. Sin él se aceptarían notificaciones de cobro falsas: es el ' +
          'secreto que más importa de los cuatro.',
      },
    ],
    ajustes: [
      {
        clave: 'sandbox',
        etiqueta: 'Modo de pruebas',
        secreto: false,
        obligatorio: false,
        tipo: 'booleano',
        porDefecto: true,
        ayuda: 'Con el entorno de pruebas no se mueve dinero real.',
      },
    ],
    desdeEntorno: {
      apiKey: 'NOWPAYMENTS_API_KEY',
      ipnSecret: 'NOWPAYMENTS_IPN_SECRET',
      sandbox: 'NOWPAYMENTS_SANDBOX',
    },
  },
  {
    key: 'revolut',
    familia: 'pago',
    nombre: 'Revolut',
    descripcion:
      'Tarjeta y Revolut Pay, con el pago en su página: los datos de la tarjeta no pasan por ' +
      'nuestro servidor. Requiere cuenta Business.',
    donde: 'Revolut Business → Merchant API → API keys.',
    retornos: [{ tipo: 'webhook', ruta: '/api/v1/payments/webhook/revolut' }],
    implementada: true,
    credenciales: [
      {
        clave: 'apiKey',
        etiqueta: 'Clave de API',
        secreto: true,
        obligatorio: true,
        ayuda:
          'La clave secreta (`sk_…`), no la pública. Ojo con el entorno: la de pruebas solo ' +
          'funciona con el modo de pruebas activado, y la de producción solo sin él.',
      },
      {
        clave: 'webhookSecret',
        etiqueta: 'Secreto del webhook',
        secreto: true,
        obligatorio: true,
        ayuda:
          'El `wsk_…` que devuelve Revolut al dar de alta el webhook, y que solo se enseña esa ' +
          'vez. Firma los avisos de pago: sin él se aceptarían cobros falsos.',
      },
    ],
    ajustes: [
      {
        clave: 'sandbox',
        etiqueta: 'Modo de pruebas',
        secreto: false,
        obligatorio: false,
        tipo: 'booleano',
        porDefecto: true,
        ayuda: 'Con el entorno de pruebas de Revolut no se mueve dinero real.',
      },
    ],
    desdeEntorno: {
      apiKey: 'REVOLUT_API_KEY',
      webhookSecret: 'REVOLUT_WEBHOOK_SECRET',
      sandbox: 'REVOLUT_SANDBOX',
    },
  },
  {
    key: 'stripe',
    familia: 'pago',
    nombre: 'Stripe',
    descripcion:
      'Tarjeta, Bizum, Apple Pay y Google Pay: los métodos se activan en su panel y aparecen ' +
      'solos en el checkout. Ojo: restringe el contenido para adultos, así que conviene leer ' +
      'sus condiciones antes de depender de ella.',
    donde: 'Dashboard de Stripe → Desarrolladores → Claves de API.',
    retornos: [{ tipo: 'webhook', ruta: '/api/v1/payments/webhook/stripe' }],
    implementada: true,
    credenciales: [
      {
        clave: 'secretKey',
        etiqueta: 'Clave secreta',
        secreto: true,
        obligatorio: true,
        ayuda:
          'La secreta (`sk_test_…` o `sk_live_…`), no la publicable `pk_…`. El modo lo decide ' +
          'la propia clave: con la de pruebas no se mueve dinero real y no hay ninguna casilla ' +
          'que se pueda dejar mal puesta.',
      },
      {
        clave: 'webhookSecret',
        etiqueta: 'Secreto del webhook',
        secreto: true,
        obligatorio: true,
        ayuda:
          'El `whsec_…` que da Stripe al crear el endpoint. Firma los avisos de pago: sin él se ' +
          'aceptarían cobros falsos. Suscribe solo los eventos `checkout.session.*`.',
      },
    ],
    ajustes: [],
    desdeEntorno: { secretKey: 'STRIPE_SECRET_KEY', webhookSecret: 'STRIPE_WEBHOOK_SECRET' },
  },
  {
    key: 'paypal',
    familia: 'pago',
    nombre: 'PayPal',
    descripcion: 'Muy conocido por el cliente. Restringe el contenido para adultos.',
    donde: 'PayPal Developer → My Apps & Credentials.',
    retornos: [{ tipo: 'webhook', ruta: '/api/v1/payments/webhook/paypal' }],
    implementada: false,
    credenciales: [
      { clave: 'clientId', etiqueta: 'Client ID', secreto: true, obligatorio: true },
      { clave: 'clientSecret', etiqueta: 'Client Secret', secreto: true, obligatorio: true },
    ],
    ajustes: [],
    desdeEntorno: { clientId: 'PAYPAL_CLIENT_ID', clientSecret: 'PAYPAL_CLIENT_SECRET' },
  },

  // ── Correo saliente ────────────────────────────────────────
  {
    key: 'smtp',
    familia: 'correo',
    nombre: 'Correo saliente (SMTP)',
    descripcion:
      'Por aquí salen la confirmación del pedido, el aviso de envío y los recordatorios. ' +
      'Sin un servicio de envío, los correos acaban en spam.',
    donde: 'Resend, Brevo, Postmark… El servicio da servidor, usuario y clave.',
    implementada: true,
    credenciales: [
      {
        clave: 'password',
        etiqueta: 'Contraseña o clave de API',
        secreto: true,
        obligatorio: false,
      },
    ],
    ajustes: [
      {
        clave: 'host',
        etiqueta: 'Servidor',
        secreto: false,
        obligatorio: true,
        porDefecto: 'localhost',
      },
      {
        clave: 'port',
        etiqueta: 'Puerto (465 en un buzón normal, 587 en un servicio de envío)',
        secreto: false,
        obligatorio: true,
        tipo: 'numero',
        porDefecto: 1025,
      },
      { clave: 'user', etiqueta: 'Usuario', secreto: false, obligatorio: false },
      {
        /*
         * Se deja porque hay servidores en puertos raros, pero en el 465 y en
         * el 587 el puerto manda sobre esta casilla: ahí no es una preferencia
         * sino cómo funciona el protocolo, y equivocarse deja la conexión
         * colgada hasta que salta el tiempo de espera —sin decir por qué—.
         */
        clave: 'secure',
        etiqueta: 'Conexión cifrada (TLS) — solo hace falta en puertos que no sean 465 o 587',
        secreto: false,
        obligatorio: false,
        tipo: 'booleano',
        porDefecto: false,
      },
      {
        clave: 'from',
        etiqueta: 'Remitente',
        secreto: false,
        obligatorio: true,
        porDefecto: 'Tienda <no-reply@localhost>',
        ayuda:
          'Tiene que ser del dominio verificado en el servicio de envío. Con un @gmail.com los ' +
          'correos se rechazan directamente.',
      },
    ],
    desdeEntorno: {
      password: 'SMTP_PASSWORD',
      host: 'SMTP_HOST',
      port: 'SMTP_PORT',
      user: 'SMTP_USER',
      secure: 'SMTP_SECURE',
      from: 'MAIL_FROM',
    },
  },

  // ── Traducción ─────────────────────────────────────────────
  /**
   * Tipo de cambio, para ENSEÑAR precios en otra divisa.
   *
   * La tienda cobra siempre en euros: esto no toca el pedido, ni la factura, ni
   * el IVA. Solo convierte lo que se muestra, y por eso puede estar apagado sin
   * consecuencias — que es el estado de salida: sin esta integración activa, la
   * tienda opera solo en euros y no aparece ningún selector de divisa.
   *
   * Por defecto apunta a Frankfurter, que publica los tipos de referencia del
   * BCE sin pedir credenciales. Se deja la URL configurable para poder cambiar a
   * un proveedor de pago —o a una copia propia— sin tocar código: los tipos son
   * un dato del que depende lo que ve el cliente, y quedarse sin él porque un
   * servicio gratuito deje de responder no debería obligar a un despliegue.
   *
   * La clave de API es opcional a propósito: Frankfurter no la pide y los
   * proveedores comerciales sí.
   */
  {
    key: 'tipo_cambio',
    familia: 'cambio',
    nombre: 'Tipo de cambio',
    descripcion:
      'Convierte los precios para enseñarlos en otras divisas. El cobro sigue siendo en euros. Sin esto, la tienda opera solo en euros.',
    donde: 'Frankfurter (frankfurter.dev) usa los tipos del BCE y no pide registro.',
    implementada: true,
    credenciales: [
      {
        clave: 'apiKey',
        etiqueta: 'Clave de API',
        secreto: true,
        obligatorio: false,
        ayuda: 'Solo para proveedores que la exijan. Frankfurter no la necesita.',
      },
    ],
    ajustes: [
      {
        clave: 'url',
        etiqueta: 'URL del proveedor',
        secreto: false,
        obligatorio: true,
        porDefecto: 'https://api.frankfurter.dev/v1/latest',
        ayuda: 'Se le pide con ?base=EUR y tiene que devolver un objeto "rates".',
      },
    ],
    desdeEntorno: { url: 'EXCHANGE_RATES_URL', apiKey: 'EXCHANGE_RATES_API_KEY' },
  },
  {
    key: 'deepl',
    familia: 'traduccion',
    nombre: 'DeepL',
    descripcion:
      'Traduce las fichas importadas. 500.000 caracteres al mes gratis, unas mil fichas.',
    donde: 'deepl.com/pro-api → cuenta → clave de autenticación.',
    implementada: true,
    credenciales: [
      {
        clave: 'apiKey',
        etiqueta: 'Clave de API',
        secreto: true,
        obligatorio: true,
        ayuda: 'Las claves del plan gratuito terminan en ":fx".',
      },
    ],
    ajustes: [
      {
        clave: 'url',
        etiqueta: 'URL del servicio',
        secreto: false,
        obligatorio: false,
        ayuda: 'Vacío para detectarla sola según el tipo de clave.',
      },
    ],
    desdeEntorno: { apiKey: 'TRANSLATION_API_KEY', url: 'TRANSLATION_URL' },
  },
  {
    key: 'libretranslate',
    familia: 'traduccion',
    nombre: 'LibreTranslate',
    descripcion: 'Traductor que puedes alojar tú: sin coste por carácter, menos calidad.',
    donde: 'Instancia propia (contenedor oficial) o un servicio público.',
    implementada: true,
    credenciales: [
      { clave: 'apiKey', etiqueta: 'Clave de API', secreto: true, obligatorio: false },
    ],
    ajustes: [
      {
        clave: 'url',
        etiqueta: 'URL del servicio',
        secreto: false,
        obligatorio: true,
        porDefecto: 'http://localhost:5000',
      },
    ],
  },

  // ── Almacenamiento de imágenes ─────────────────────────────
  {
    key: 's3',
    familia: 'almacenamiento',
    nombre: 'Almacenamiento de imágenes (S3)',
    descripcion:
      'Dónde se guardan las fotos de producto. Vale cualquier servicio compatible con S3: ' +
      'MinIO en tu servidor, Cloudflare R2, Backblaze B2 o el propio S3 de Amazon.',
    donde: 'El panel del servicio da el punto de acceso, la clave y el secreto.',
    implementada: true,
    credenciales: [
      { clave: 'accessKey', etiqueta: 'Clave de acceso', secreto: true, obligatorio: true },
      { clave: 'secretKey', etiqueta: 'Clave secreta', secreto: true, obligatorio: true },
    ],
    ajustes: [
      {
        clave: 'endpoint',
        etiqueta: 'Punto de acceso',
        secreto: false,
        obligatorio: true,
        porDefecto: 'http://localhost:9000',
      },
      {
        clave: 'region',
        etiqueta: 'Región',
        secreto: false,
        obligatorio: true,
        porDefecto: 'eu-west-1',
      },
      {
        clave: 'bucket',
        etiqueta: 'Cubo público',
        secreto: false,
        obligatorio: true,
        porDefecto: 'ecom-media',
      },
      {
        clave: 'bucketPrivado',
        etiqueta: 'Cubo privado',
        secreto: false,
        obligatorio: true,
        porDefecto: 'ecom-private',
        ayuda: 'Facturas y documentos que no deben ser accesibles por URL.',
      },
      {
        clave: 'urlPublica',
        etiqueta: 'URL pública',
        secreto: false,
        obligatorio: true,
        porDefecto: 'http://localhost:9000/ecom-media',
        ayuda:
          'La base con la que se construyen las URL de las fotos. Si cambia, las imágenes ya ' +
          'guardadas siguen apuntando a la anterior.',
      },
      {
        clave: 'estiloRuta',
        etiqueta: 'Rutas con el cubo delante',
        secreto: false,
        obligatorio: false,
        tipo: 'booleano',
        porDefecto: true,
        ayuda: 'Necesario con MinIO; los servicios en la nube suelen usar subdominios.',
      },
    ],
    desdeEntorno: {
      accessKey: 'S3_ACCESS_KEY',
      secretKey: 'S3_SECRET_KEY',
      endpoint: 'S3_ENDPOINT',
      region: 'S3_REGION',
      bucket: 'S3_BUCKET',
      bucketPrivado: 'S3_BUCKET_PRIVATE',
      urlPublica: 'S3_PUBLIC_URL',
      estiloRuta: 'S3_FORCE_PATH_STYLE',
    },
  },

  // ── Buscador ───────────────────────────────────────────────
  {
    key: 'meilisearch',
    familia: 'buscador',
    nombre: 'Buscador (Meilisearch)',
    descripcion:
      'El buscador del catálogo y el autocompletado. Sin él la tienda sigue vendiendo: los ' +
      'listados y la portada salen de la base de datos.',
    donde: 'Instancia propia o Meilisearch Cloud. La clave maestra la fijas tú al arrancarlo.',
    implementada: true,
    credenciales: [
      { clave: 'masterKey', etiqueta: 'Clave maestra', secreto: true, obligatorio: true },
    ],
    ajustes: [
      {
        clave: 'host',
        etiqueta: 'Dirección',
        secreto: false,
        obligatorio: true,
        porDefecto: 'http://localhost:7700',
      },
    ],
    desdeEntorno: { masterKey: 'MEILI_MASTER_KEY', host: 'MEILI_HOST' },
  },

  // ── Seguimiento de envíos ──────────────────────────────────
  //
  // Por qué un agregador y no la API de cada transportista: Nacex, SEUR y
  // Correos Express dan su webservice al firmar un contrato mercantil, con
  // credenciales y documentación privadas, y ese webservice solo responde por
  // los envíos facturados a TU cuenta. En dropshipping el paquete lo factura el
  // proveedor, así que sus propias APIs no nos devolverían nada aunque las
  // tuviéramos. Con el número basta aquí.
  {
    key: '17track',
    familia: 'seguimiento',
    nombre: 'Seguimiento de envíos (17TRACK)',
    descripcion:
      'Consulta dónde está cada paquete a partir de su número, sin contrato con el ' +
      'transportista. Cubre Nacex, SEUR y Correos Express —los tres que más se usan aquí— y otros ' +
      'dos mil. Sin configurar, la tienda sigue enseñando el enlace de seguimiento al cliente; lo ' +
      'que se pierde es que el pedido pase solo a «en tránsito» y a «entregado».',
    donde:
      'api.17track.net → Sign up → API key. El plan gratuito cubre 100 envíos al mes; a partir ' +
      'de ahí se compran paquetes de consultas.',
    implementada: true,
    credenciales: [
      {
        clave: 'apiKey',
        etiqueta: 'Clave de API',
        secreto: true,
        obligatorio: true,
        ayuda: 'La que aparece en su panel como «17token». Es la única credencial que piden.',
      },
    ],
    ajustes: [
      {
        clave: 'avisarEnTransito',
        etiqueta: 'Avisar al cliente cuando el paquete se mueve',
        secreto: false,
        obligatorio: false,
        tipo: 'booleano',
        porDefecto: false,
        ayuda:
          'Desactivado manda un solo correo, el de «va en camino». Activado manda también los ' +
          'cambios de estado intermedios, que en un envío internacional son ocho o diez: es la ' +
          'forma más rápida de acabar marcado como spam.',
      },
    ],
    desdeEntorno: { apiKey: 'SEGUIMIENTO_17TRACK_API_KEY' },
  },

  // ── Imágenes con IA (fase 4) ───────────────────────────────
  {
    key: 'comfyui',
    familia: 'imagenes',
    nombre: 'Estudio de imágenes (ComfyUI)',
    descripcion:
      'Retoque de las fotos del proveedor con IA: recorte, fondo limpio y escenas. Necesita una ' +
      'GPU propia o alquilada.',
    donde: 'Instancia de ComfyUI con la API abierta, en tu servidor o en RunPod.',
    implementada: false,
    credenciales: [
      { clave: 'apiKey', etiqueta: 'Clave de API', secreto: true, obligatorio: false },
    ],
    ajustes: [{ clave: 'url', etiqueta: 'URL del servicio', secreto: false, obligatorio: true }],
    desdeEntorno: { url: 'COMFYUI_URL' },
  },

  // ── Analítica ──────────────────────────────────────────────
  //
  // Sus identificadores NO son secretos: viajan en el HTML de cualquier página
  // y se ven con "ver código fuente". Se guardan como ajustes, no como
  // credenciales, para que el panel pueda mostrarlos y comprobarlos.
  //
  // Lo importante de tenerlos aquí y no en el `.env` es otra cosa: mientras no
  // haya identificador, la tienda **no carga ni un byte** de Google ni de Meta.
  // No es una optimización, es lo que evita el escenario clásico de una tienda
  // enviando datos a terceros antes de que nadie haya aceptado nada.
  {
    key: 'ga4',
    familia: 'analitica',
    nombre: 'Google Analytics 4',
    descripcion:
      'Medición de visitas y del embudo de compra. Solo se carga si el visitante acepta las ' +
      'cookies analíticas.',
    donde: 'Google Analytics → Administrar → Flujos de datos → ID de medición (G-XXXXXXXXXX).',
    implementada: true,
    credenciales: [],
    ajustes: [
      {
        clave: 'measurementId',
        etiqueta: 'ID de medición',
        secreto: false,
        obligatorio: true,
        ayuda: 'Empieza por G-. Sin él no se carga nada de Google.',
      },
    ],
    desdeEntorno: { measurementId: 'GA4_MEASUREMENT_ID' },
  },
  {
    key: 'gtm',
    familia: 'analitica',
    nombre: 'Google Tag Manager',
    descripcion:
      'Contenedor de etiquetas: permite añadir y cambiar píxeles y conversiones desde su panel, ' +
      'sin tocar la tienda ni desplegar. Solo se carga si el visitante acepta las cookies ' +
      'analíticas, y recibe el estado del consentimiento para que sus propias etiquetas lo ' +
      'respeten.',
    donde: 'Google Tag Manager → Espacio de trabajo → arriba, junto al nombre del contenedor.',
    implementada: true,
    credenciales: [],
    ajustes: [
      {
        clave: 'containerId',
        etiqueta: 'ID del contenedor',
        secreto: false,
        obligatorio: true,
        ayuda:
          'Empieza por GTM-. Ojo con ponerlo A LA VEZ que Google Analytics aquí arriba: si ' +
          'dentro del contenedor ya tienes una etiqueta de GA4, cada visita se contaría dos ' +
          'veces y las métricas dejan de servir. O uno, o el otro.',
      },
    ],
    desdeEntorno: { containerId: 'GTM_CONTAINER_ID' },
  },
  {
    key: 'meta_pixel',
    familia: 'analitica',
    nombre: 'Meta Pixel',
    descripcion:
      'Medición para campañas de Facebook e Instagram. Solo se carga si el visitante acepta las ' +
      'cookies de marketing.',
    donde: 'Meta Events Manager → Orígenes de datos → tu píxel → ID.',
    implementada: true,
    credenciales: [],
    ajustes: [
      {
        clave: 'pixelId',
        etiqueta: 'ID del píxel',
        secreto: false,
        obligatorio: true,
        ayuda:
          'Son 15 o 16 dígitos. Ojo: Meta restringe el contenido adulto y puede cerrar la ' +
          'cuenta publicitaria, así que revisa sus condiciones antes de depender de este canal.',
      },
    ],
    desdeEntorno: { pixelId: 'META_PIXEL_ID' },
  },

  // ── Acceso ─────────────────────────────────────────────────
  {
    key: 'google_oauth',
    familia: 'acceso',
    nombre: 'Entrar con Google',
    descripcion: 'Botón de acceso con cuenta de Google en la tienda.',
    donde: 'Google Cloud Console → APIs y servicios → Credenciales → ID de cliente OAuth.',
    retornos: [{ tipo: 'oauth', ruta: '/api/v1/auth/oauth/google/callback' }],
    implementada: true,
    credenciales: [
      { clave: 'clientId', etiqueta: 'Client ID', secreto: false, obligatorio: true },
      { clave: 'clientSecret', etiqueta: 'Client Secret', secreto: true, obligatorio: true },
    ],
    ajustes: [],
    desdeEntorno: { clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET' },
  },
  {
    key: 'apple_oauth',
    familia: 'acceso',
    nombre: 'Entrar con Apple',
    descripcion: 'Obligatorio en iOS si se ofrece otro acceso social.',
    donde: 'Apple Developer → Certificates, Identifiers & Profiles → Keys.',
    retornos: [{ tipo: 'oauth', ruta: '/api/v1/auth/oauth/apple/callback' }],
    implementada: true,
    credenciales: [
      { clave: 'clientId', etiqueta: 'Services ID', secreto: false, obligatorio: true },
      { clave: 'teamId', etiqueta: 'Team ID', secreto: false, obligatorio: true },
      { clave: 'keyId', etiqueta: 'Key ID', secreto: false, obligatorio: true },
      { clave: 'privateKey', etiqueta: 'Clave privada (.p8)', secreto: true, obligatorio: true },
    ],
    ajustes: [],
    desdeEntorno: {
      clientId: 'APPLE_CLIENT_ID',
      teamId: 'APPLE_TEAM_ID',
      keyId: 'APPLE_KEY_ID',
      privateKey: 'APPLE_PRIVATE_KEY',
    },
  },
];

export function definicionDe(key: string): DefinicionIntegracion | undefined {
  return INTEGRACIONES.find((i) => i.key === key);
}

/**
 * Qué le falta a una integración para poder usarse.
 *
 * Devuelve las etiquetas de los campos obligatorios vacíos. La lista vacía
 * significa "lista para funcionar", que es lo que decide si se carga o no.
 */
export function camposQueFaltan(
  definicion: DefinicionIntegracion,
  credenciales: Record<string, unknown>,
  ajustes: Record<string, unknown>,
): string[] {
  const vacio = (v: unknown) => v === undefined || v === null || v === '';

  return [
    ...definicion.credenciales.filter((c) => c.obligatorio && vacio(credenciales[c.clave])),
    ...definicion.ajustes.filter((a) => a.obligatorio && vacio(ajustes[a.clave])),
  ].map((c) => c.etiqueta);
}
