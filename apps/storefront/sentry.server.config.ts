// Arranque de Sentry en el servidor de Next (renderizado y rutas de servidor).
import * as Sentry from '@sentry/nextjs';
import { opcionesComunes } from './src/lib/sentry-comun';

Sentry.init(opcionesComunes());
