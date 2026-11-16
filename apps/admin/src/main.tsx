import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ProveedorSesion, useSesion } from '@/lib/sesion';
import { Acceso } from '@/componentes/acceso';
import { router } from '@/router';
import { Sentry, iniciarSentry } from '@/lib/sentry';
import { ProveedorToasts } from '@/componentes/ui/toast';
import { ProveedorFiltros } from '@/lib/filtros-globales';
import { prepararIdioma } from '@/i18n';
import '@/estilos.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // El admin trabaja con datos que cambian solos (los mueven los workers):
      // 30 segundos es el equilibrio entre frescura y no machacar la API.
      staleTime: 30_000,
      retry: (intentos, error) => {
        // No tiene sentido reintentar un 401 o un 403: reintentar no da
        // permisos que no se tienen.
        const status = (error as { status?: number }).status;
        if (status === 401 || status === 403 || status === 404) return false;
        return intentos < 2;
      },
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * Puerta de acceso.
 *
 * Mientras se comprueba si hay sesión no se pinta ni el panel ni el formulario:
 * mostrar el formulario y sustituirlo medio segundo después por el panel es un
 * parpadeo desagradable en cada recarga.
 */
function Aplicacion() {
  const { usuario, cargando } = useSesion();
  const { t } = useTranslation();

  if (cargando) {
    return (
      <div className="grid min-h-screen place-items-center">
        <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
          {t('app.cargando')}
        </p>
      </div>
    );
  }

  if (!usuario) return <Acceso />;

  // Un cliente que se autentica aquí no debe ver el panel: el tipo de cuenta
  // lo decide el servidor, pero se comprueba también aquí para no mostrar una
  // interfaz que después devolvería 403 en cada pantalla.
  if (usuario.type !== 'STAFF') {
    return (
      <div className="grid min-h-screen place-items-center p-4">
        <div className="panel max-w-sm p-6 text-center">
          <p>{t('auth.sin_permiso')}</p>
        </div>
      </div>
    );
  }

  // Los filtros globales envuelven al enrutador: el rango elegido tiene que
  // sobrevivir al cambio de pantalla, o cada navegación lo devolvería a los 30
  // días por defecto y las comparativas dejarían de cuadrar entre vistas.
  return (
    <ProveedorFiltros>
      <RouterProvider router={router} />
    </ProveedorFiltros>
  );
}

// Antes de montar nada: un error durante el primer render también cuenta.
iniciarSentry();

/**
 * Pantalla de último recurso.
 *
 * Sin esto, un error no capturado en React 19 deja la pantalla en blanco y el
 * administrador no sabe si el fallo es suyo, del navegador o de la aplicación.
 */
function PantallaDeError({ resetError }: { resetError: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="panel max-w-sm space-y-3 p-6 text-center">
        <p className="font-medium">Algo ha fallado en esta pantalla</p>
        <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
          El error ya se ha registrado. Puedes reintentar sin perder la sesión.
        </p>
        <button className="btn btn-secundario" onClick={resetError} type="button">
          Reintentar
        </button>
      </div>
    </div>
  );
}

const raiz = document.getElementById('root');
if (!raiz) throw new Error('No se ha encontrado el elemento #root');

// Se espera al idioma guardado antes de pintar: es lo que evita el parpadeo de
// castellano en las cuentas que trabajan en catalán o en inglés.
await prepararIdioma();

createRoot(raiz).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={PantallaDeError}>
      <QueryClientProvider client={queryClient}>
        {/* Por encima de la sesión: un fallo al entrar también necesita avisar. */}
        <ProveedorToasts>
          <ProveedorSesion>
            <Aplicacion />
          </ProveedorSesion>
        </ProveedorToasts>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
