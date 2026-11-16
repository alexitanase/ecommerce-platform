'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Puerta de acceso al catálogo +18.
 *
 * Importante entender qué es y qué no es: **esto no verifica nada**. La
 * comprobación de verdad la hace el servidor, que responde 403 en la ficha de
 * un producto restringido mientras la cookie de verificación no exista —y ni
 * siquiera manda su contenido. Este componente solo pide el dato y lo envía.
 *
 * Confiar la restricción a una ventana modal sería regalarla: se cierra desde
 * la consola del navegador en una línea. Por eso la cookie es httpOnly y la
 * pone el servidor — el JavaScript de esta página ni la lee ni la puede
 * falsificar.
 *
 * Se pide el año de nacimiento y no un "confirmo que soy mayor de edad":
 * una casilla se marca sin leer, mientras que escribir un año es un acto
 * deliberado y deja constancia de qué se declaró.
 */
export function PuertaEdad({ onVerificado }: { onVerificado?: () => void }) {
  const t = useTranslations('adulto');
  const [anio, setAnio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [denegado, setDenegado] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const valor = Number(anio);
    if (!Number.isInteger(valor) || anio.length !== 4) {
      setError(t('anio_invalido'));
      return;
    }

    setEnviando(true);

    try {
      const base = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
      const respuesta = await fetch(`${base}/api/v1/age/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Imprescindible: la cookie httpOnly que devuelve el servidor es lo
        // único que da acceso, y sin esto no viajaría.
        credentials: 'include',
        body: JSON.stringify({ anioNacimiento: valor }),
      });

      const datos = (await respuesta.json()) as { verificado?: boolean };

      if (datos.verificado) {
        onVerificado?.();
        // Recarga para que el servidor vuelva a renderizar con la cookie ya
        // puesta: la página actual se generó sin acceso al contenido.
        window.location.reload();
        return;
      }

      setDenegado(true);
    } catch {
      setError(t('anio_invalido'));
    } finally {
      setEnviando(false);
    }
  };

  if (denegado) {
    return (
      <Marco>
        <h1 id="titulo-puerta-edad" className="text-lg font-semibold">
          {t('denegado')}
        </h1>
        <p className="mt-2 text-sm text-[var(--texto-suave)]">{t('denegado_ayuda')}</p>
        <a className="btn btn-secundario mt-5 inline-block" href="https://www.google.com">
          {t('salir')}
        </a>
      </Marco>
    );
  }

  return (
    <Marco>
      <h1 id="titulo-puerta-edad" className="text-lg font-semibold">
        {t('titulo')}
      </h1>
      <p className="mt-2 text-sm text-[var(--texto-suave)]">{t('descripcion')}</p>

      <form onSubmit={enviar} className="mt-5">
        <label className="etiqueta" htmlFor="anio-nacimiento">
          {t('anio_nacimiento')}
        </label>
        <input
          id="anio-nacimiento"
          className="campo mt-1 w-full"
          // `inputMode` numérico saca el teclado de números en el móvil sin
          // heredar las flechas de incremento de un input[type=number], que
          // aquí solo estorban.
          inputMode="numeric"
          autoComplete="bday-year"
          maxLength={4}
          placeholder="1990"
          value={anio}
          onChange={(e) => setAnio(e.target.value.replace(/\D/g, ''))}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'anio-error' : undefined}
        />

        {error ? (
          <p id="anio-error" role="alert" className="mt-2 text-sm text-[var(--error)]">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primario" disabled={enviando}>
            {t('confirmar')}
          </button>
          <a className="btn btn-fantasma" href="https://www.google.com">
            {t('salir')}
          </a>
        </div>
      </form>

      <p className="mt-4 text-xs text-[var(--texto-tenue)]">{t('aviso_dispositivo')}</p>
    </Marco>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      // Apunta al título del propio diálogo: sin esto, un lector de pantalla
      // anuncia "diálogo" y nada más, y no hay forma de saber qué pide.
      aria-labelledby="titulo-puerta-edad"
      className="fixed inset-0 z-[60] grid place-items-center bg-[var(--fondo)] p-4"
    >
      <div className="card w-full max-w-md p-6">{children}</div>
    </div>
  );
}

/**
 * Cierra el acceso +18 en este dispositivo.
 *
 * Un ordenador compartido no puede quedar abierto: es el escenario que más
 * probablemente pone el catálogo delante de un menor.
 */
export function CerrarAccesoAdulto() {
  const t = useTranslations('adulto');
  const [verificado, setVerificado] = useState(false);

  // Solo aparece si hay acceso abierto. Enseñárselo a quien nunca ha entrado
  // en la sección +18 sería anunciar que existe.
  useEffect(() => {
    const base = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
    fetch(`${base}/api/v1/age/status`, { credentials: 'include' })
      .then((r) => r.json() as Promise<{ verificado?: boolean }>)
      .then((d) => setVerificado(d.verificado === true))
      .catch(() => setVerificado(false));
  }, []);

  const cerrar = async () => {
    const base = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
    await fetch(`${base}/api/v1/age`, { method: 'DELETE', credentials: 'include' });
    window.location.href = '/';
  };

  if (!verificado) return null;

  return (
    <button type="button" className="underline" onClick={() => void cerrar()}>
      {t('cerrar_acceso')}
    </button>
  );
}
