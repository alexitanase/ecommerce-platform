// Arranque de Sentry en el runtime edge, donde corre el middleware de idiomas.
import * as Sentry from '@sentry/nextjs';
import { opcionesComunes } from './src/lib/sentry-comun';

Sentry.init(opcionesComunes());
