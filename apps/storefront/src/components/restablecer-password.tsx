'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { api, ErrorApi } from '@/lib/api';
import { Pagina, TituloPagina } from '@/components/ui/pagina';
import { ErrorCarga } from '@/components/ui/estados';

/**
 * Elegir contraseña nueva desde el enlace del correo.
 *
 * Esta pantalla no existía y el correo llevaba semanas apuntando aquí: quien
 * pedía recuperar su contraseña recibía el correo, pulsaba el botón y se
 * encontraba un 404. No daba ningún error en ningún log — la API había hecho
 * su parte perfectamente.
 *
 * Al terminar se lleva a entrar y no se inicia sesión sola: el token del
 * correo demuestra acceso al buzón, no que quien está delante sea la persona.
 * En un ordenador compartido con el correo abierto, entrar automáticamente
 * regalaría la sesión.
 */
export function RestablecerPassword() {
  const t = useTranslations('auth');
  const tc = useTranslations('comun');
  const router = useRouter();
  const token = useSearchParams().get('token');

  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errores, setErrores] = useState<string[]>([]);

  if (!token) {
    return (
      <Pagina ancho="tarjeta" className="sm:py-16">
        <TituloPagina centrado titulo={t('nueva_password')} />
        <ErrorCarga titulo={t('enlace_no_valido')} descripcion={t('enlace_no_valido_ayuda')}>
          <Link href="/recuperar" className="btn btn-primario">
            {t('recuperar')}
          </Link>
        </ErrorCarga>
      </Pagina>
    );
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault();

    // Se comprueba antes de llamar: es un error de quien escribe, no del
    // servidor, y gastar una petición para decirlo hace esperar sin motivo.
    if (password !== repetida) {
      setError(t('no_coinciden'));
      return;
    }

    setEnviando(true);
    setError(null);
    setErrores([]);

    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      // El aviso de "ya está cambiada" viaja como query, no como ruta: el
      // enrutador tipado solo conoce rutas, y meter la query dentro haría
      // falta declararla como una ruta distinta que no lo es.
      router.replace({ pathname: '/entrar', query: { restablecida: '1' } });
    } catch (fallo) {
      if (fallo instanceof ErrorApi) {
        // Los requisitos de la contraseña vienen por campo: se enseñan todos,
        // no solo el primero, para no obligar a adivinar de uno en uno.
        if (fallo.campos?.['password']) setErrores(fallo.campos['password']);
        else setError(fallo.message);
      } else {
        setError(tc('error'));
      }
      setEnviando(false);
    }
  };

  return (
    <Pagina ancho="tarjeta" className="sm:py-16">
      <TituloPagina centrado titulo={t('nueva_password')} descripcion={t('nueva_password_ayuda')} />

      <form onSubmit={(e) => void enviar(e)} className="card space-y-4 p-5">
        {/* La ayuda va fuera de la etiqueta y enlazada con `aria-describedby`:
            dentro pasaría a formar parte del nombre del campo, y el lector de
            pantalla anunciaría los requisitos enteros como si fueran su
            nombre. */}
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            {t('password')}
          </label>
          <input
            id="password"
            name="password"
            className="campo"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={errores.length > 0 ? true : undefined}
            aria-describedby="password-requisitos"
            required
          />
          <span id="password-requisitos" className="mt-1 block text-xs text-[var(--texto-tenue)]">
            {t('password_requisitos')}
          </span>
        </div>

        <div>
          <label htmlFor="repetida" className="mb-1 block text-sm font-medium">
            {t('repetir_password')}
          </label>
          <input
            id="repetida"
            name="repetida"
            className="campo"
            type="password"
            autoComplete="new-password"
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            required
          />
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

        <button type="submit" className="btn btn-primario btn-grande w-full" disabled={enviando}>
          {enviando ? tc('cargando') : t('guardar_password')}
        </button>
      </form>
    </Pagina>
  );
}
