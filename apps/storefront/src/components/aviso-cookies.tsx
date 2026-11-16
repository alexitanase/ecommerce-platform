'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useEsCliente } from '@/lib/use-es-cliente';
import { guardarConsentimiento, leerConsentimiento } from '@/lib/consentimiento';
import { useHayDecision } from '@/lib/use-consentimiento';

/**
 * Banner de cookies conforme a la guía de la AEPD.
 *
 * Lo que se respeta aquí, y que se incumple a menudo:
 *
 *  · **Rechazar es tan fácil como aceptar**: los dos botones al mismo nivel,
 *    con el mismo tamaño, en el primer vistazo. Nada de esconder "rechazar"
 *    dentro de un submenú de configuración.
 *  · **Nada se carga antes de decidir**: la decisión se consulta ANTES de
 *    inyectar cualquier script (ver lib/consentimiento).
 *  · **Seguir navegando no es consentir**: el banner no se cierra solo ni al
 *    hacer scroll; hace falta pulsar.
 *  · **Se puede cambiar de opinión** desde el pie en cualquier momento.
 *  · **Enlace a la política** para saber qué se acepta antes de aceptarlo.
 */

/** Permite reabrir el banner desde el pie de página. */
export const EVENTO_ABRIR = 'abrir-preferencias-cookies';

export function AvisoCookies() {
  const t = useTranslations('cookies');
  const esCliente = useEsCliente();

  // El consentimiento vive fuera de React y puede cambiarlo otra pestaña:
  // se lee con useSyncExternalStore en vez de copiarlo a un estado local.
  const decidido = useHayDecision();
  const [abiertoAMano, setAbiertoAMano] = useState(false);
  const [detalle, setDetalle] = useState(false);
  const [analiticas, setAnaliticas] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const abrir = () => {
      const actual = leerConsentimiento();
      setAnaliticas(actual.analiticas);
      setMarketing(actual.marketing);
      setDetalle(true);
      setAbiertoAMano(true);
    };

    window.addEventListener(EVENTO_ABRIR, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR, abrir);
  }, []);

  const guardar = useCallback((eleccion: { analiticas: boolean; marketing: boolean }) => {
    guardarConsentimiento(eleccion);
    setAbiertoAMano(false);
    setDetalle(false);
  }, []);

  const visible = esCliente && (!decidido || abiertoAMano);
  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookies-titulo"
      className="fixed inset-x-0 bottom-0 z-50 p-4"
    >
      <div className="card mx-auto max-w-3xl p-5 shadow-[var(--sombra-elevada)]">
        <h2 id="cookies-titulo" className="font-semibold">
          {t('titulo')}
        </h2>
        <p className="mt-1 text-sm text-[var(--texto-suave)]">
          {t('descripcion')}{' '}
          {/* Poder leer qué se acepta ANTES de aceptarlo es parte del
              consentimiento informado, no un extra. */}
          <Link
            href={{ pathname: '/[slug]', params: { slug: 'cookies' } } as never}
            className="underline"
          >
            {t('mas_informacion')}
          </Link>
        </p>

        {detalle && (
          <div className="mt-4 space-y-3 border-t border-[var(--borde)] pt-4">
            <label className="flex items-start gap-3 opacity-60">
              <input type="checkbox" checked disabled className="mt-1" />
              <span>
                <span className="block text-sm font-medium">{t('necesarias')}</span>
                <span className="block text-xs text-[var(--texto-tenue)]">
                  {t('necesarias_desc')}
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={analiticas}
                onChange={(e) => setAnaliticas(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">{t('analiticas')}</span>
                <span className="block text-xs text-[var(--texto-tenue)]">
                  {t('analiticas_desc')}
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">{t('marketing')}</span>
                <span className="block text-xs text-[var(--texto-tenue)]">
                  {t('marketing_desc')}
                </span>
              </span>
            </label>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {/* Aceptar y rechazar siempre visibles y con el mismo peso, también
              con el detalle abierto: si para rechazar hubiera que desmarcar
              casillas una a una, rechazar dejaría de ser tan fácil como
              aceptar y el consentimiento no sería válido. */}
          <button
            type="button"
            className="btn btn-primario"
            onClick={() => guardar({ analiticas: true, marketing: true })}
          >
            {t('aceptar_todas')}
          </button>
          <button
            type="button"
            className="btn btn-secundario"
            onClick={() => guardar({ analiticas: false, marketing: false })}
          >
            {t('rechazar_todas')}
          </button>

          {detalle ? (
            <button
              type="button"
              className="btn btn-fantasma"
              onClick={() => guardar({ analiticas, marketing })}
            >
              {t('guardar_preferencias')}
            </button>
          ) : (
            <button type="button" className="btn btn-fantasma" onClick={() => setDetalle(true)}>
              {t('configurar')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Enlace del pie para volver a decidir.
 *
 * Sin esto, el consentimiento no se puede retirar y por tanto no es libre: la
 * AEPD exige que cambiar de opinión cueste lo mismo que aceptar.
 */
export function BotonPreferenciasCookies() {
  const t = useTranslations('cookies');

  return (
    <button
      type="button"
      className="underline"
      onClick={() => window.dispatchEvent(new Event(EVENTO_ABRIR))}
    >
      {t('preferencias')}
    </button>
  );
}
