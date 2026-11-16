'use client';

import { useEffect } from 'react';

/**
 * Registra el service worker en producción y lo RETIRA fuera de ella.
 *
 * Lo segundo es tan importante como lo primero, y costó una tarde averiguarlo.
 * Un worker se registra una vez y a partir de ahí controla el origen entero
 * —`localhost:3000` incluido— hasta que alguien lo retira a mano. Basta con
 * levantar un `next build && next start` una tarde para que el worker quede
 * instalado; al volver a `next dev`, el mismo navegador sigue sirviendo de su
 * caché el CSS de aquella compilación.
 *
 * En producción no se nota porque Next pone un hash en el nombre de cada
 * fichero: si el contenido cambia, la URL cambia y la caché no llega a
 * usarse. En desarrollo el nombre es estable —`…globals_0e8-m_n.css`— así que
 * la primera versión cacheada se sirve para siempre.
 *
 * El síntoma es de los peores que hay: la maqueta se ve rota en una pantalla y
 * bien en todas las demás, los cambios en el CSS no hacen absolutamente nada,
 * y no hay ningún error en ninguna consola. Pasó de verdad, con la cabecera
 * partida en tres filas porque faltaban las clases `md:` que sí estaban en el
 * código.
 *
 * Y solo después de `load`: registrarlo antes compite por el ancho de banda
 * justo cuando el navegador está pintando la primera pantalla, que es lo único
 * que el visitante nota.
 */
export function RegistrarSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      void limpiarWorkerViejo();
      return;
    }

    const registrar = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Que falle no puede romper la tienda: sin worker sigue funcionando
        // todo, simplemente sin caché propia ni página de cortesía.
      });
    };

    if (document.readyState === 'complete') {
      registrar();
      return;
    }

    window.addEventListener('load', registrar);
    return () => {
      window.removeEventListener('load', registrar);
    };
  }, []);

  return null;
}

/**
 * Retira el worker y vacía sus cachés.
 *
 * Hace falta borrar las dos cosas. Con solo desregistrar, el worker deja de
 * controlar la página pero sus cachés siguen en el disco y vuelven a usarse en
 * cuanto se registre otro. Y con solo vaciar cachés, el worker sigue mandando.
 */
async function limpiarWorkerViejo(): Promise<void> {
  try {
    const registros = await navigator.serviceWorker.getRegistrations();
    if (registros.length === 0) return;

    await Promise.all(registros.map((r) => r.unregister()));
    if ('caches' in window) {
      const nombres = await caches.keys();
      await Promise.all(nombres.map((n) => caches.delete(n)));
    }

    // Con el worker fuera pero la página ya pintada con lo que él sirvió, lo
    // que se ve sigue siendo lo viejo. Una recarga y ya está bien.
    window.location.reload();
  } catch {
    // Si el navegador no deja tocarlo, no se puede hacer más desde aquí.
  }
}
