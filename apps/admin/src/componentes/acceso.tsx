import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSesion } from '@/lib/sesion';
import { ErrorApi } from '@/lib/api';

/**
 * Pantalla de acceso.
 *
 * El campo de 2FA solo aparece cuando la API lo pide (error TOTP_REQUIRED):
 * mostrarlo siempre confundiría a quien no lo tenga activo, y ocultarlo del
 * todo dejaría fuera a quien sí.
 */
export function Acceso() {
  const { t } = useTranslation();
  const { entrar } = useSesion();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [pideTotp, setPideTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);

    try {
      await entrar(email, password, totp || undefined);
    } catch (err) {
      if (err instanceof ErrorApi) {
        // La API distingue "falta el segundo factor" de "credenciales mal".
        if (err.message.includes('dos pasos') || err.message.includes('verificación en dos')) {
          setPideTotp(true);
          setError(null);
        } else {
          setError(err.message);
        }
      } else {
        setError(t('app.error'));
      }
      setEnviando(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={(e) => void enviar(e)} className="panel w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold tracking-tight">{t('auth.titulo')}</h1>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t('auth.email')}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              autoFocus
              className="campo"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t('auth.password')}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="campo"
            />
          </label>

          {pideTotp && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium">{t('auth.codigo_2fa')}</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                required
                autoFocus
                autoComplete="one-time-code"
                className="campo text-center font-mono text-lg tracking-[0.4em]"
              />
              <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
                {t('auth.codigo_2fa_ayuda')}
              </span>
            </label>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg px-3 py-2 text-sm"
            style={{
              background: 'color-mix(in srgb, var(--error) 10%, transparent)',
              color: 'var(--error)',
            }}
          >
            {error}
          </p>
        )}

        <button type="submit" disabled={enviando} className="btn btn-primario mt-5 w-full">
          {enviando ? t('auth.entrando') : t('auth.entrar')}
        </button>
      </form>
    </div>
  );
}
