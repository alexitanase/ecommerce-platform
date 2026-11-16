// Arranque de Sentry en el navegador. Next carga este fichero automáticamente.
import * as Sentry from '@sentry/nextjs';
import { opcionesComunes } from './src/lib/sentry-comun';

Sentry.init(opcionesComunes());

// Necesario para que Next informe de las transiciones de ruta del App Router.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
