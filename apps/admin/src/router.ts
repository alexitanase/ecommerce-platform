import { createRouter } from '@tanstack/react-router';
import { arbolDeRutas } from './enrutador';
import { NoEncontrada } from './rutas/error';

export const router = createRouter({
  routeTree: arbolDeRutas,
  defaultPreload: 'intent',
  // Una URL que no existe —un enlace viejo guardado en favoritos, una ruta mal
  // escrita— dejaba la zona de contenido en blanco, sin decir nada. Ahora sale
  // la pantalla de 404 con la salida al panel.
  defaultNotFoundComponent: NoEncontrada,
  // Sin restauración de scroll, volver atrás en una tabla larga deja al
  // usuario arriba del todo en lugar de donde estaba.
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
