'use client';

import Image from 'next/image';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { api, ErrorApi } from '@/lib/api';
import { useSesion } from '@/lib/sesion';
import { Icono } from '@/components/ui/icono';

/**
 * Contraseña, verificación en dos pasos y sesiones abiertas.
 *
 * Las tres cosas que la API ofrecía y la cuenta no dejaba tocar. La que más
 * importa de las tres no es el 2FA: es **ver dónde hay sesiones abiertas y
 * poder cerrarlas todas**. Es lo único que sirve cuando alguien se deja la
 * sesión puesta en un ordenador que no es suyo, y hasta ahora no había manera
 * ni de enterarse.
 */

interface Sesion {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  actual: boolean;
}

interface Alta2FA {
  secret: string;
  qrDataUrl: string;
  uri: string;
}

export function Seguridad({ locale }: { locale: string }) {
  const t = useTranslations('cuenta');
  const tc = useTranslations('comun');

  const { usuario, token, salir } = useSesion();

  const [sesiones, setSesiones] = useState<Sesion[]>([]);
  const [alta, setAlta] = useState<Alta2FA | null>(null);
  const [codigosRecuperacion, setCodigosRecuperacion] = useState<string[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!token) return;
    void api<Sesion[]>('/auth/sessions', { token })
      .then(setSesiones)
      .catch(() => {
        // Sin la lista, el resto de la pantalla sigue sirviendo.
      });
  }, [token]);

  const llamar = async (accion: () => Promise<unknown>, mensaje?: string) => {
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      await accion();
      if (mensaje) setAviso(mensaje);
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.message : tc('error'));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-4">
      {aviso && (
        <p className="card p-3 text-sm" style={{ color: 'var(--exito)' }} role="status">
          {aviso}
        </p>
      )}
      {error && (
        <p className="card p-3 text-sm" style={{ color: 'var(--error)' }} role="alert">
          {error}
        </p>
      )}

      <CambiarPassword token={token} onHecho={() => setAviso(t('password_cambiada'))} />

      {/* ── Dos pasos ── */}
      <section className="card p-5">
        <h3 className="font-medium">{t('dos_pasos')}</h3>
        <p className="mt-1 text-sm text-[var(--texto-suave)]">{t('dos_pasos_ayuda')}</p>

        {codigosRecuperacion ? (
          <div className="mt-4">
            {/* Se enseñan UNA vez. Guardarlos para poder repetirlos después
                sería guardar la llave de repuesto junto a la cerradura. */}
            <p className="text-sm font-medium">{t('codigos_recuperacion')}</p>
            <p className="mt-1 text-xs text-[var(--texto-suave)]">
              {t('codigos_recuperacion_ayuda')}
            </p>
            <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
              {codigosRecuperacion.map((c) => (
                <li key={c} className="rounded p-2" style={{ background: 'var(--fondo-sutil)' }}>
                  {c}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-secundario mt-4"
              onClick={() => setCodigosRecuperacion(null)}
            >
              {t('ya_los_he_guardado')}
            </button>
          </div>
        ) : usuario?.twoFactorEnabled ? (
          <Desactivar2FA
            token={token}
            onHecho={() => {
              setAviso(t('dos_pasos_desactivado'));
              void useSesion.getState().recuperar();
            }}
          />
        ) : alta ? (
          <Activar2FA
            alta={alta}
            token={token}
            onHecho={(codigos) => {
              setAlta(null);
              setCodigosRecuperacion(codigos);
              void useSesion.getState().recuperar();
            }}
          />
        ) : (
          <button
            type="button"
            className="btn btn-secundario mt-4"
            disabled={ocupado || !token}
            onClick={() =>
              void llamar(async () => {
                setAlta(await api<Alta2FA>('/auth/2fa/setup', { method: 'POST', token: token! }));
              })
            }
          >
            {t('activar_dos_pasos')}
          </button>
        )}
      </section>

      {/* ── Sesiones ── */}
      <section className="card p-5">
        <h3 className="font-medium">{t('sesiones')}</h3>
        <p className="mt-1 text-sm text-[var(--texto-suave)]">{t('sesiones_ayuda')}</p>

        <ul className="mt-4 space-y-2">
          {sesiones.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"
              style={{ borderColor: 'var(--borde)' }}
            >
              <div className="min-w-0">
                <p className="truncate">
                  {describirDispositivo(s.userAgent) || t('dispositivo_desconocido')}
                </p>
                <p className="text-xs text-[var(--texto-tenue)]">
                  {s.ip ?? '—'} · {new Date(s.lastUsedAt ?? s.createdAt).toLocaleString(locale)}
                </p>
              </div>
              {s.actual && (
                <span className="etiqueta" style={{ background: 'var(--fondo-sutil)' }}>
                  {t('esta_sesion')}
                </span>
              )}
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn btn-secundario mt-4"
          disabled={ocupado || !token}
          onClick={() => {
            if (!window.confirm(t('confirmar_cerrar_todas'))) return;
            // Cierra también la de aquí, y eso es lo correcto: quien pulsa
            // esto sospecha que alguien más tiene acceso, y dejar viva la
            // sesión actual dejaría viva la del atacante si el atacante es
            // quien está delante de la otra pantalla.
            void llamar(async () => {
              await api('/auth/logout-all', { method: 'POST', body: '{}', token: token! });
              await salir();
            });
          }}
        >
          {t('cerrar_todas')}
        </button>
      </section>
    </div>
  );
}

function CambiarPassword({ token, onHecho }: { token: string | null; onHecho: () => void }) {
  const t = useTranslations('cuenta');
  const ta = useTranslations('auth');
  const tc = useTranslations('comun');

  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [errores, setErrores] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setOcupado(true);
    setError(null);
    setErrores([]);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        token,
        body: JSON.stringify({ currentPassword: actual, newPassword: nueva }),
      });
      setActual('');
      setNueva('');
      onHecho();
    } catch (fallo) {
      if (fallo instanceof ErrorApi && fallo.campos?.['newPassword']) {
        setErrores(fallo.campos['newPassword']);
      } else {
        setError(fallo instanceof Error ? fallo.message : tc('error'));
      }
    } finally {
      setOcupado(false);
    }
  };

  return (
    <form onSubmit={(e) => void enviar(e)} className="card space-y-4 p-5">
      <h3 className="font-medium">{t('cambiar_password')}</h3>

      <div>
        <label htmlFor="actual" className="mb-1 block text-sm font-medium">
          {t('password_actual')}
        </label>
        <input
          id="actual"
          className="campo"
          type="password"
          autoComplete="current-password"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          required
        />
      </div>

      <div>
        <label htmlFor="nueva" className="mb-1 block text-sm font-medium">
          {ta('nueva_password')}
        </label>
        <input
          id="nueva"
          className="campo"
          type="password"
          autoComplete="new-password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          aria-describedby="nueva-requisitos"
          required
        />
        <span id="nueva-requisitos" className="mt-1 block text-xs text-[var(--texto-tenue)]">
          {ta('password_requisitos')}
        </span>
      </div>

      {errores.length > 0 && (
        <ul role="alert" className="space-y-1 text-sm" style={{ color: 'var(--error)' }}>
          {errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primario" disabled={ocupado}>
        {t('cambiar_password')}
      </button>
    </form>
  );
}

function Activar2FA({
  alta,
  token,
  onHecho,
}: {
  alta: Alta2FA;
  token: string | null;
  onHecho: (codigos: string[]) => void;
}) {
  const t = useTranslations('cuenta');
  const tc = useTranslations('comun');

  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setOcupado(true);
    setError(null);
    try {
      const r = await api<{ recoveryCodes: string[] }>('/auth/2fa/enable', {
        method: 'POST',
        token,
        body: JSON.stringify({ totpCode: codigo }),
      });
      onHecho(r.recoveryCodes);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : tc('error'));
      setOcupado(false);
    }
  };

  return (
    <form onSubmit={(e) => void enviar(e)} className="mt-4 space-y-4">
      <p className="text-sm">{t('escanea_qr')}</p>

      {/* `unoptimized`: es un data URL generado al vuelo, no un fichero que
          Next pueda transformar ni cachear. */}
      <Image
        src={alta.qrDataUrl}
        alt={t('codigo_qr')}
        width={180}
        height={180}
        unoptimized
        className="rounded"
        style={{ background: '#fff' }}
      />

      <details className="text-sm">
        <summary className="cursor-pointer text-[var(--marca-texto)]">{t('sin_camara')}</summary>
        <p className="mt-2 font-mono text-xs break-all">{alta.secret}</p>
      </details>

      <div>
        <label htmlFor="totp" className="mb-1 block text-sm font-medium">
          {t('codigo_de_la_app')}
        </label>
        <input
          id="totp"
          className="campo max-w-40"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
          required
        />
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primario" disabled={ocupado || codigo.length < 6}>
        {t('confirmar_dos_pasos')}
      </button>
    </form>
  );
}

function Desactivar2FA({ token, onHecho }: { token: string | null; onHecho: () => void }) {
  const t = useTranslations('cuenta');
  const tc = useTranslations('comun');

  const [password, setPassword] = useState('');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setOcupado(true);
    setError(null);
    try {
      await api('/auth/2fa/disable', {
        method: 'POST',
        token,
        body: JSON.stringify({ password, totpCode: codigo }),
      });
      onHecho();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : tc('error'));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <form onSubmit={(e) => void enviar(e)} className="mt-4 space-y-4">
      <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--exito)' }}>
        <Icono nombre="comprobado" tamano={16} />
        {t('dos_pasos_activo')}
      </p>

      {/* Se piden las dos cosas: quitar el segundo factor es justo lo que
          intentaría alguien que ha robado una sesión abierta. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="pass-2fa" className="mb-1 block text-sm font-medium">
            {t('password_actual')}
          </label>
          <input
            id="pass-2fa"
            className="campo"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="totp-2fa" className="mb-1 block text-sm font-medium">
            {t('codigo_de_la_app')}
          </label>
          <input
            id="totp-2fa"
            className="campo"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        className="btn btn-secundario"
        style={{ color: 'var(--error)' }}
        disabled={ocupado}
      >
        {t('desactivar_dos_pasos')}
      </button>
    </form>
  );
}

/**
 * Nombre legible del dispositivo a partir del user agent.
 *
 * Enseñar la cadena entera —«Mozilla/5.0 (X11; Linux x86_64) AppleWebKit…»— es
 * no enseñar nada: quien mira esta lista busca reconocer cuál es suya y cuál
 * no, y para eso hace falta "Chrome en Android", no cien caracteres.
 */
function describirDispositivo(userAgent: string | null): string {
  if (!userAgent) return '';

  const navegador = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : /Firefox\//.test(userAgent)
            ? 'Firefox'
            : '';

  const sistema = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : '';

  return [navegador, sistema].filter(Boolean).join(' · ');
}
