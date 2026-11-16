'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { api, ErrorApi } from '@/lib/api';

/**
 * Entrar con Google o con Apple.
 *
 * La API tenía esto entero desde hace tiempo —flujo de código con PKCE, `state`
 * en servidor, vinculación con la cuenta que ya existiera— y la tienda no lo
 * ofrecía en ninguna parte: quien configuraba la integración en el panel no veía
 * aparecer nada. Este componente es la mitad que faltaba.
 *
 * Qué botones se pintan lo decide el servidor, que sabe qué integraciones están
 * configuradas y activas. Enseñar «Continuar con Google» sin configurar lleva a
 * una pantalla de error de Google que el cliente lee como un fallo de la tienda,
 * y encima justo en el momento de entrar a comprar.
 *
 * El botón no es un enlace a Google. Primero se le pide a nuestra API la URL de
 * autorización, porque cada intento necesita su `state` y su `code_challenge`
 * nuevos: un enlace fijo en el HTML sería el mismo `state` para todo el mundo, y
 * el `state` es precisamente lo que impide que valga la vuelta de otra persona.
 */

/** Lo que la API sabe ofrecer. El orden es el de la pantalla. */
const PROVEEDORES = ['google', 'apple'] as const;
type Proveedor = (typeof PROVEEDORES)[number];

/**
 * El logotipo de Google, con sus cuatro colores.
 *
 * Va en línea y no como imagen porque sus normas de marca exigen el logo
 * exacto, y un `<img>` a un dominio de Google lo convertiría en una petición a
 * un tercero desde la pantalla de acceso —justo lo que el aviso de cookies dice
 * que no hacemos sin permiso—.
 */
function LogoGoogle() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 009 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 010-3.44V4.94H.96a9 9 0 000 8.12l3.01-2.34z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 00.96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

function LogoApple() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12.6 9.55c.02 2.1 1.84 2.8 1.86 2.81-.02.05-.29 1-.96 1.98-.58.85-1.18 1.69-2.13 1.71-.93.02-1.23-.55-2.3-.55-1.06 0-1.4.53-2.28.57-.91.03-1.6-.9-2.19-1.74-1.2-1.74-2.12-4.91-.89-7.05.61-1.06 1.71-1.74 2.9-1.75.9-.02 1.75.6 2.3.6.55 0 1.58-.74 2.66-.63.45.02 1.72.16 2.53 1.24-.07.04-1.49.87-1.47 2.6M10.9 3.3c.49-.59.82-1.41.73-2.23-.72.03-1.6.48-2.11 1.07-.46.52-.86 1.36-.75 2.16.8.06 1.63-.41 2.13-1z"
      />
    </svg>
  );
}

const LOGOS: Record<Proveedor, () => React.ReactElement> = {
  google: LogoGoogle,
  apple: LogoApple,
};

export function AccesosSociales({ proveedores }: { proveedores: string[] }) {
  const t = useTranslations('auth');
  const tc = useTranslations('comun');
  const locale = useLocale();

  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disponibles = PROVEEDORES.filter((p) => proveedores.includes(p));
  if (disponibles.length === 0) return null;

  const empezar = async (proveedor: Proveedor) => {
    setEnCurso(proveedor);
    setError(null);

    try {
      /*
       * El destino lleva el idioma porque lo va a usar el servidor para
       * construir una URL absoluta. Dentro de la tienda el idioma lo pone el
       * enrutador solo, pero aquí se sale del sitio y hay que decirlo.
       */
      const ruta = destinoDeVuelta();
      const volver = ruta.startsWith(`/${locale}/`) ? ruta : `/${locale}${ruta}`;
      const { url } = await api<{ url: string }>(
        `/auth/oauth/${proveedor}?redirect=${encodeURIComponent(volver)}`,
      );

      /*
       * Navegación del navegador, no del enrutador de Next: el destino es otro
       * dominio. `assign` en lugar de asignar `location.href` porque el
       * compilador de React trata la asignación como mutar algo de fuera del
       * componente y la marca como error.
       */
      window.location.assign(url);
    } catch (fallo) {
      // Si la integración se ha desactivado entre que se pintó la página y el
      // clic, la API responde 503. Se dice aquí en lugar de dejar al cliente
      // pulsando un botón que no hace nada.
      setError(fallo instanceof ErrorApi ? fallo.message : tc('error'));
      setEnCurso(null);
    }
  };

  return (
    <div className="space-y-3">
      {disponibles.map((proveedor) => {
        const Logo = LOGOS[proveedor];
        return (
          <button
            key={proveedor}
            type="button"
            onClick={() => void empezar(proveedor)}
            disabled={enCurso !== null}
            className="btn btn-secundario btn-grande w-full"
            data-prueba={`acceso-${proveedor}`}
          >
            <Logo />
            {enCurso === proveedor ? tc('cargando') : t(`continuar_con_${proveedor}`)}
          </button>
        );
      })}

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}

      {/* Separador con el texto centrado: dos líneas y una palabra, para que se
          entienda que abajo hay otra forma de entrar y no una continuación. */}
      <div className="flex items-center gap-3 text-xs text-[var(--texto-tenue)]">
        <span className="h-px flex-1" style={{ background: 'var(--borde)' }} />
        {t('o_bien')}
        <span className="h-px flex-1" style={{ background: 'var(--borde)' }} />
      </div>
    </div>
  );
}

/**
 * A dónde volver después de entrar con el proveedor.
 *
 * Lo mismo que hace el formulario de siempre: se respeta `?volver=` solo si es
 * una ruta interna. Aquí importa el doble, porque este valor sale de la tienda,
 * viaja a la API y vuelve convertido en una redirección; el servidor lo valida
 * otra vez de todas formas.
 */
function destinoDeVuelta(): string {
  if (typeof window === 'undefined') return '/cuenta';

  const pedido = new URLSearchParams(window.location.search).get('volver');
  if (!pedido || !pedido.startsWith('/') || pedido.startsWith('//')) return '/cuenta';

  return pedido;
}
