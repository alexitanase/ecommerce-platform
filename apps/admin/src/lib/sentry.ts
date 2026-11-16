import * as Sentry from '@sentry/react';

/**
 * Captura de errores del panel de administración.
 *
 * El admin maneja datos personales de clientes constantemente: direcciones,
 * emails, pedidos, facturas. Todo lo que se manda fuera está filtrado a
 * propósito y la política es restrictiva por defecto.
 */
export function iniciarSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  // Sin DSN no se inicializa: en desarrollo no interesa mandar cada error de
  // recarga en caliente a un panel compartido.
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),

    // Nada de datos personales ni de grabación de sesión: la pantalla de un
    // administrador es una lista de clientes reales.
    sendDefaultPii: false,

    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      /^Failed to fetch$/,
      /^NetworkError/,
      'AbortError',
    ],

    denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-extension:\/\//],

    beforeSend(evento) {
      // Los identificadores de recurso van en la ruta (/pedidos/abc123), y en
      // el admin son datos de clientes reales. Se sustituyen por :id para que
      // los errores además se agrupen por pantalla en vez de por registro.
      if (evento.request?.url) {
        evento.request.url = anonimizarRuta(evento.request.url);
      }
      return evento;
    },
  });
}

/** cuid2 de 24-32 caracteres, que es lo que genera la API. */
const ID_EN_RUTA = /\/[a-z0-9]{24,32}(?=\/|$)/g;

export function anonimizarRuta(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(ID_EN_RUTA, '/:id');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url.replace(ID_EN_RUTA, '/:id');
  }
}

export { Sentry };
