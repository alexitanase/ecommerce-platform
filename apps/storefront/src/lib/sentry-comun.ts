import type { init } from '@sentry/nextjs';

type OpcionesSentry = Parameters<typeof init>[0];

/**
 * Configuración compartida por los tres entornos de ejecución de Next
 * (navegador, servidor y edge).
 *
 * Va en un módulo aparte porque Next exige un fichero de arranque por entorno y
 * repetir la política de privacidad tres veces garantiza que dentro de un año
 * solo dos estén actualizadas.
 */
export function opcionesComunes(): OpcionesSentry {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  return {
    dsn,
    // Sin DSN queda desactivado del todo: en desarrollo no interesa mandar
    // cada error de recarga en caliente a un panel compartido.
    enabled: Boolean(dsn),
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),

    // Nunca datos personales. En una tienda el navegador maneja direcciones,
    // emails y el contenido del carrito; nada de eso tiene por qué acabar en un
    // panel de errores, y el RGPD tampoco lo ampara.
    sendDefaultPii: false,

    // Grabación de sesión desactivada por el mismo motivo: reproduce la
    // pantalla del cliente, incluido el formulario de pago.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    ignoreErrors: [
      // Ruido del navegador que no es un fallo de la tienda: extensiones,
      // bots y pérdidas de red. Mandarlo ahoga los errores reales.
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      /^Failed to fetch$/,
      /^NetworkError/,
      /^Load failed$/,
      // Navegación abandonada a media carga: el usuario cambió de página.
      'AbortError',
    ],

    denyUrls: [
      // Extensiones del navegador inyectando código en nuestra página.
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
      /^safari-extension:\/\//,
    ],

    beforeSend(evento) {
      // La URL puede llevar el token de un enlace de recuperación o de
      // verificación de correo. Se recorta antes de salir del navegador.
      if (evento.request?.url) {
        evento.request.url = quitarSecretosDeUrl(evento.request.url);
      }
      return evento;
    },
  };
}

/**
 * Parámetros de consulta que nunca deben salir del navegador.
 *
 * `recuperar` y `baja` son los enlaces de los correos de carrito abandonado:
 * el primero abre el carrito de esa persona y el segundo la da de baja, así
 * que en un panel de errores compartido son credenciales, no metadatos.
 */
const PARAMETROS_SENSIBLES = [
  'token',
  'code',
  'access_token',
  'refresh_token',
  'email',
  'recuperar',
  'baja',
];

export function quitarSecretosDeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const parametro of PARAMETROS_SENSIBLES) {
      if (parsed.searchParams.has(parametro)) parsed.searchParams.set(parametro, '[oculto]');
    }
    return parsed.toString();
  } catch {
    // Una URL relativa o malformada se deja como está: no hay nada que parsear
    // y perder el dato entero haría el error inútil.
    return url;
  }
}
