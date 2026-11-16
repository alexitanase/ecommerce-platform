'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Último recurso: un error en el propio layout raíz.
 *
 * Cuando salta esto, ni el layout ni los proveedores de idioma y tema están
 * montados, así que la pantalla no puede depender de ellos. De ahí los estilos
 * en línea y el texto en castellano fijo: es preferible un mensaje entendible
 * en un idioma a una pantalla en blanco.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          display: 'grid',
          placeItems: 'center',
          minHeight: '100vh',
          margin: 0,
          fontFamily: 'system-ui, sans-serif',
          padding: '1rem',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
            La página no se ha podido cargar
          </h1>
          <p style={{ opacity: 0.7, fontSize: '0.9rem' }}>
            Ya lo estamos revisando. Vuelve a intentarlo en unos minutos.
          </p>
          {/* El digest identifica el error en los logs del servidor: es lo que
              permite a soporte encontrarlo sin pedir capturas de pantalla. */}
          {error.digest ? (
            <p style={{ opacity: 0.5, fontSize: '0.75rem', marginTop: '1rem' }}>
              Referencia: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
