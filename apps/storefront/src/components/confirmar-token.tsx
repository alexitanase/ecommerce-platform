'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { Pagina, TituloPagina } from '@/components/ui/pagina';
import { Cargando, ErrorCarga } from '@/components/ui/estados';
import { Icono } from '@/components/ui/icono';

/**
 * Pantalla de "hemos recibido tu clic".
 *
 * Sirve para los dos enlaces de un solo uso que manda la tienda: verificar el
 * correo de la cuenta y confirmar el alta en la newsletter. Los dos hacen lo
 * mismo —canjear un token contra la API y decir cómo ha ido— y los dos
 * llevaban a un 404 porque la pantalla no existía.
 *
 * Se canjea al abrir, sin pedir que se pulse nada. El clic en el correo ya
 * fue la acción; añadir un segundo botón solo consigue que una parte se quede
 * a medias sin saber que faltaba algo.
 */
export function ConfirmarToken({ tipo }: { tipo: 'email' | 'newsletter' }) {
  const t = useTranslations('auth');
  const token = useSearchParams().get('token');

  // Sin token no hay nada que canjear, y el estado nace ya resuelto: ponerlo
  // desde dentro del efecto obliga a un render de más solo para decir que no.
  const [estado, setEstado] = useState<'cargando' | 'hecho' | 'fallo'>(
    token ? 'cargando' : 'fallo',
  );
  const [motivo, setMotivo] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    // Las dos rutas no tienen la misma forma: verificar el email manda el
    // token en el cuerpo y la newsletter lo lleva en la URL. Se respeta cada
    // una en lugar de uniformarlas aquí, que es donde no se ve.
    const peticion =
      tipo === 'email'
        ? api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
        : api(`/consent/newsletter/confirmar/${encodeURIComponent(token)}`, { method: 'POST' });

    void peticion
      .then(() => {
        setEstado('hecho');
      })
      .catch((fallo: unknown) => {
        // El motivo real importa: un enlace caducado se arregla pidiendo otro,
        // y uno ya usado significa que todo está bien. Decir "error" a secas
        // manda a soporte a quien no tiene ningún problema.
        setMotivo(fallo instanceof Error ? fallo.message : null);
        setEstado('fallo');
      });
  }, [token, tipo]);

  const titulo = tipo === 'email' ? t('verificar_email') : t('confirmar_newsletter');

  if (estado === 'cargando') {
    return (
      <Pagina ancho="formulario">
        <TituloPagina titulo={titulo} />
        <Cargando etiqueta={titulo} filas={1} />
      </Pagina>
    );
  }

  if (estado === 'fallo') {
    return (
      <Pagina ancho="formulario">
        <TituloPagina titulo={titulo} />
        <ErrorCarga
          titulo={t('enlace_no_valido')}
          descripcion={motivo ?? t('enlace_no_valido_ayuda')}
        >
          <Link href="/" className="btn btn-secundario">
            {t('ir_a_la_tienda')}
          </Link>
        </ErrorCarga>
      </Pagina>
    );
  }

  return (
    <Pagina ancho="formulario">
      <TituloPagina titulo={titulo} />
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

        <p className="font-medium">
          {tipo === 'email' ? t('email_verificado') : t('newsletter_confirmada')}
        </p>
        <p className="mt-1 text-sm text-[var(--texto-suave)]">
          {tipo === 'email' ? t('email_verificado_ayuda') : t('newsletter_confirmada_ayuda')}
        </p>

        <Link href={tipo === 'email' ? '/cuenta' : '/'} className="btn btn-primario mt-5">
          {tipo === 'email' ? t('ir_a_mi_cuenta') : t('ir_a_la_tienda')}
        </Link>
      </div>
    </Pagina>
  );
}
