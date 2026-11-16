'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { api, ErrorApi } from '@/lib/api';
import { useSesion } from '@/lib/sesion';

/**
 * Nombre, apellidos y teléfono.
 *
 * Poco y aburrido, y sin embargo faltaba: quien se registró sin poner el
 * nombre no tenía forma de añadirlo después, y quien se equivocó al ponerlo lo
 * arrastraba en cada correo de pedido.
 *
 * El email NO se edita aquí a propósito. Cambiarlo es cambiar la identidad de
 * la cuenta y exige verificar el nuevo buzón antes de soltar el viejo; hacerlo
 * en el mismo formulario que el teléfono invita a tratarlo como un campo más.
 */
export function Perfil({ token }: { token: string | null }) {
  const [reenviando, setReenviando] = useState(false);
  const [reenviado, setReenviado] = useState(false);
  const t = useTranslations('cuenta');
  const ta = useTranslations('auth');
  const tc = useTranslations('comun');

  const { usuario, recuperar } = useSesion();

  const [nombre, setNombre] = useState(usuario?.firstName ?? '');
  const [apellidos, setApellidos] = useState(usuario?.lastName ?? '');
  const [telefono, setTelefono] = useState(usuario?.phone ?? '');
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setOcupado(true);
    setError(null);
    setErrores({});
    setGuardado(false);

    try {
      // Solo se mandan los que tienen algo: la API los valida si vienen, y una
      // cadena vacía en el teléfono sería "teléfono no válido" en lugar de
      // "sin teléfono".
      await api('/users/me', {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          ...(nombre.trim() ? { firstName: nombre.trim() } : {}),
          ...(apellidos.trim() ? { lastName: apellidos.trim() } : {}),
          ...(telefono.trim() ? { phone: telefono.trim() } : {}),
        }),
      });

      // Se recarga la sesión para que el nombre nuevo se vea sin recargar.
      await recuperar();
      setGuardado(true);
    } catch (fallo) {
      if (fallo instanceof ErrorApi && fallo.campos) setErrores(fallo.campos);
      else setError(fallo instanceof Error ? fallo.message : tc('error'));
    } finally {
      setOcupado(false);
    }
  };

  const campo = (
    nombreCampo: string,
    etiqueta: string,
    valor: string,
    alCambiar: (v: string) => void,
    autoComplete: string,
  ) => {
    const fallos = errores[nombreCampo];

    return (
      <div>
        <label htmlFor={`perfil-${nombreCampo}`} className="mb-1 block text-sm font-medium">
          {etiqueta}
        </label>
        <input
          id={`perfil-${nombreCampo}`}
          className="campo"
          value={valor}
          autoComplete={autoComplete}
          onChange={(e) => alCambiar(e.target.value)}
          aria-invalid={fallos ? true : undefined}
          aria-describedby={fallos ? `perfil-${nombreCampo}-error` : undefined}
        />
        {fallos && (
          <span
            id={`perfil-${nombreCampo}-error`}
            role="alert"
            className="mt-1 block text-xs"
            style={{ color: 'var(--error)' }}
          >
            {fallos.join('. ')}
          </span>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={(e) => void enviar(e)} className="card space-y-4 p-5">
      <h3 className="font-medium">{t('mis_datos')}</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        {campo('firstName', ta('nombre'), nombre, setNombre, 'given-name')}
        {campo('lastName', ta('apellidos'), apellidos, setApellidos, 'family-name')}
      </div>

      {campo('phone', t('telefono'), telefono, setTelefono, 'tel')}

      <div>
        <span className="mb-1 block text-sm font-medium">{ta('email')}</span>
        <p className="text-sm text-[var(--texto-suave)]">{usuario?.email}</p>
        <p className="mt-1 text-xs text-[var(--texto-tenue)]">{t('email_no_editable')}</p>

        {/*
         * Sin verificar, la cuenta funciona a medias y no se nota: entre otras
         * cosas, no puede adoptar los pedidos que se hicieran sin sesión con
         * este mismo email. Se dice aquí, con el botón al lado, porque es el
         * único sitio donde alguien va a mirar su dirección.
         */}
        {usuario && !usuario.emailVerified && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--aviso)' }}>
              {t('email_sin_verificar')}
            </span>
            <button
              type="button"
              className="btn btn-secundario text-xs"
              disabled={reenviando}
              onClick={() => {
                setReenviando(true);
                void api('/auth/resend-verification', {
                  method: 'POST',
                  body: JSON.stringify({ email: usuario.email }),
                })
                  .catch(() => null)
                  .finally(() => {
                    setReenviando(false);
                    setReenviado(true);
                  });
              }}
            >
              {t('reenviar_verificacion')}
            </button>
            {reenviado && (
              <span role="status" className="text-xs" style={{ color: 'var(--exito)' }}>
                {t('verificacion_enviada')}
              </span>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primario" disabled={ocupado}>
          {tc('guardar')}
        </button>
        {guardado && (
          <span role="status" className="text-sm" style={{ color: 'var(--exito)' }}>
            {t('datos_guardados')}
          </span>
        )}
      </div>
    </form>
  );
}
