'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { TituloPagina } from '@/components/ui/pagina';
import { Cargando, ErrorCarga } from '@/components/ui/estados';

/**
 * Centro de preferencias de correo.
 *
 * Se llega desde el pie de cualquier correo comercial, sin iniciar sesión: la
 * mayoría de quienes compran lo hacen como invitados, y pedirles una cuenta
 * para dejar de recibir correos convierte la baja en un trámite —además de
 * incumplir el artículo 21 de la LSSI, que exige un medio sencillo y gratuito.
 *
 * Se ofrece canal por canal y no solo "baja de todo": quien no quiere ofertas
 * muchas veces sí quiere el recordatorio del carrito. Con un único botón, se
 * pierde al cliente entero.
 */

const CANALES = ['cartRecovery', 'reviewInvites', 'offers', 'newsletter'] as const;
type Canal = (typeof CANALES)[number];

type Preferencias = Record<Canal, boolean> & { email: string };

export function PreferenciasCorreo() {
  const t = useTranslations('preferencias');
  const parametros = useSearchParams();
  const token = parametros.get('token');

  const [preferencias, setPreferencias] = useState<Preferencias | null>(null);
  // Sin token no hay nada que cargar: el estado se deriva, no se fija dentro
  // de un efecto, que provocaría un render extra para nada.
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'guardado' | 'error'>(
    token ? 'cargando' : 'error',
  );

  useEffect(() => {
    if (!token) return;

    void api<Preferencias>(`/consent/preferences/${token}`)
      .then((p) => {
        setPreferencias(p);
        setEstado('listo');
      })
      .catch(() => {
        setEstado('error');
      });
  }, [token]);

  const cambiar = (canal: Canal, valor: boolean) => {
    if (!token || !preferencias) return;

    // Se aplica al instante y se guarda a la vez: un cambio que solo se guarda
    // al pulsar un botón acaba perdiéndose cuando el cliente cierra la pestaña
    // creyendo que ya está.
    setPreferencias({ ...preferencias, [canal]: valor });

    void api<Preferencias>(`/consent/preferences/${token}`, {
      method: 'POST',
      body: JSON.stringify({ [canal]: valor }),
    })
      .then((p) => {
        setPreferencias(p);
        setEstado('guardado');
      })
      .catch(() => {
        setEstado('error');
      });
  };

  const bajaDeTodo = () => {
    if (!token) return;

    void api(`/consent/preferences/${token}/unsubscribe-all`, { method: 'POST' })
      .then(() => {
        setPreferencias((p) =>
          p
            ? { ...p, cartRecovery: false, reviewInvites: false, offers: false, newsletter: false }
            : p,
        );
        setEstado('guardado');
      })
      .catch(() => {
        setEstado('error');
      });
  };

  if (estado === 'cargando') {
    return <Cargando etiqueta={t('titulo')} filas={2} />;
  }

  if (estado === 'error' && !preferencias) {
    return (
      <>
        <TituloPagina titulo={t('titulo')} />
        <ErrorCarga titulo={t('enlace_no_valido')} />
      </>
    );
  }

  if (!preferencias) return null;

  return (
    <>
      <TituloPagina
        titulo={t('titulo')}
        descripcion={t('descripcion', { email: preferencias.email })}
      />
      <div className="card p-6">
        <ul className="mt-5 space-y-3">
          {CANALES.map((canal) => (
            <li key={canal}>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={preferencias[canal]}
                  onChange={(e) => cambiar(canal, e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">{t(`canal_${canal}`)}</span>
                  <span className="block text-sm text-[var(--texto-suave)]">
                    {t(`canal_${canal}_ayuda`)}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        {/* Los correos del pedido no se pueden apagar: no son publicidad, son la
          ejecución de una compra en curso. Se dice para que nadie piense que
          se le ha olvidado un interruptor. */}
        <p className="mt-5 text-xs text-[var(--texto-tenue)]">{t('transaccionales')}</p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={bajaDeTodo} className="btn btn-secundario text-sm">
            {t('baja_de_todo')}
          </button>

          {estado === 'guardado' && (
            <span role="status" className="text-sm" style={{ color: 'var(--exito)' }}>
              {t('guardado')}
            </span>
          )}
          {estado === 'error' && (
            <span role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
              {t('error')}
            </span>
          )}
        </div>
      </div>
    </>
  );
}
