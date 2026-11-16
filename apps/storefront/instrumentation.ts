import * as Sentry from '@sentry/nextjs';

/**
 * Next llama a este hook una vez por entorno de ejecución.
 *
 * La importación es dinámica a propósito: el bundle de edge no puede cargar el
 * de servidor ni al revés, y un import estático los arrastraría a los dos.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Captura los errores de los componentes de servidor, que no pasan por
// ningún error boundary del navegador.
export const onRequestError = Sentry.captureRequestError;
