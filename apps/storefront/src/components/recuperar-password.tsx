'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { Pagina, TituloPagina } from '@/components/ui/pagina';
import { Icono } from '@/components/ui/icono';

/**
 * "He olvidado mi contraseña".
 *
 * Responde siempre lo mismo, exista o no la cuenta. Decir "no hay ninguna
 * cuenta con ese correo" convierte este formulario en una forma de comprobar
 * si una dirección concreta es clienta de la tienda, y con catálogo +18 esa
 * información es sensible de verdad — no es un detalle de seguridad abstracto,
 * es que alguien puede usarlo para saber qué compra otra persona.
 *
 * La API ya se comporta así; aquí lo importante es no estropearlo enseñando un
 * error distinto según lo que responda.
 */
export function RecuperarPassword() {
  const t = useTranslations('auth');
  const tc = useTranslations('comun');

  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);

    await api('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }).catch(() => {
      // Ni siquiera un fallo de red cambia lo que se enseña: si el mensaje
      // dependiera de la respuesta, se podría deducir de él si la cuenta
      // existe.
    });

    setEnviando(false);
    setEnviado(true);
  };

  if (enviado) {
    return (
      <Pagina ancho="tarjeta" className="sm:py-16">
        <TituloPagina centrado titulo={t('recuperar')} />
        <div className="card p-6 text-center">
          <div
            className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full"
            style={{
              background: 'color-mix(in srgb, var(--exito) 14%, transparent)',
              color: 'var(--exito)',
            }}
          >
            <Icono nombre="comprobado" tamano={24} />
          </div>
          <p className="font-medium">{t('recuperar_enviado')}</p>
          <p className="mt-1 text-sm text-[var(--texto-suave)]">{t('recuperar_enviado_ayuda')}</p>
          <Link href="/entrar" className="btn btn-secundario mt-5">
            {t('volver_entrar')}
          </Link>
        </div>
      </Pagina>
    );
  }

  return (
    <Pagina ancho="tarjeta" className="sm:py-16">
      <TituloPagina centrado titulo={t('recuperar')} descripcion={t('recuperar_ayuda')} />

      <form onSubmit={(e) => void enviar(e)} className="card space-y-4 p-5">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t('email')}</span>
          <input
            className="campo"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <button type="submit" className="btn btn-primario btn-grande w-full" disabled={enviando}>
          {enviando ? tc('cargando') : t('recuperar_enviar')}
        </button>

        <Link href="/entrar" className="block text-sm text-[var(--marca-texto)] hover:underline">
          {t('volver_entrar')}
        </Link>
      </form>
    </Pagina>
  );
}
