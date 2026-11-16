import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Enlace } from '@/componentes/enlace';
import { Ico, ICONOS } from '@/lib/navegacion';
import { useAvisos } from '@/lib/avisos';
import { fechaRelativa } from '@/lib/formato';
import { Boton } from './boton';

/**
 * Campana de avisos.
 *
 * Lo que enseña no son notificaciones guardadas, sino el estado real de la
 * operativa: pedidos fallidos, colas caídas, devoluciones sin responder. Por
 * eso no hay "marcar como leído" —lo que quita un aviso es arreglarlo— y por
 * eso cada línea es un enlace a la pantalla donde se arregla.
 *
 * El contador no lleva solo color: lleva número y, cuando hay algo roto, un
 * punto con forma propia. Quien no distingue el rojo tiene que poder ver que
 * hay algo urgente.
 */
export function Campana() {
  const { t, i18n } = useTranslation();
  const { avisos, total, hayError, cargando, fallo, refrescar, actualizado } = useAvisos();
  const [abierta, setAbierta] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierta(false);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierta]);

  return (
    <div
      ref={caja}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && abierta) {
          e.stopPropagation();
          setAbierta(false);
          caja.current?.querySelector('button')?.focus();
        }
      }}
    >
      <button
        type="button"
        className="btn btn-fantasma objetivo relative h-9 w-9 p-0"
        aria-haspopup="dialog"
        aria-expanded={abierta}
        // El nombre lleva el número: un lector de pantalla no ve la burbuja.
        aria-label={t('avisos.abrir', { n: total })}
        onClick={() => setAbierta((v) => !v)}
      >
        <Ico d={ICONOS.campana} />
        {total > 0 && (
          <span
            className="burbuja"
            // Tokens propios: los de error y aviso son claros en el tema
            // oscuro y el blanco encima no llega al contraste mínimo.
            style={{ background: hayError ? 'var(--burbuja-error)' : 'var(--burbuja-aviso)' }}
            aria-hidden="true"
          >
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {abierta && (
        <div role="dialog" aria-label={t('avisos.titulo')} className="flotante avisos-panel">
          <header className="avisos-cabecera">
            <h2 className="text-sm font-semibold">{t('avisos.titulo')}</h2>
            <Boton
              variante="fantasma"
              tamano="sm"
              onClick={refrescar}
              cargando={cargando}
              icono={<Ico d="M3 7v6h6M3 13a9 9 0 106-8.5" />}
            >
              {t('ui.actualizar')}
            </Boton>
          </header>

          {fallo ? (
            <div className="avisos-vacio">
              <p style={{ color: 'var(--error)' }}>{t('avisos.fallo')}</p>
              <Boton variante="secundario" tamano="sm" onClick={refrescar} className="mt-3">
                {t('app.reintentar')}
              </Boton>
            </div>
          ) : avisos.length === 0 ? (
            <div className="avisos-vacio">
              <p className="font-medium">{t('avisos.nada')}</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                {t('avisos.nada_ayuda')}
              </p>
            </div>
          ) : (
            <ul className="avisos-lista">
              {avisos.map((a) => (
                <li key={a.id}>
                  <Enlace a={a.ruta} className="aviso-linea" onClick={() => setAbierta(false)}>
                    {/* Forma además de color: un cuadrado para lo roto, un
                        círculo para lo que espera, un guion para lo informativo. */}
                    <span
                      aria-hidden="true"
                      className="aviso-marca"
                      style={{
                        background: `var(--${a.tono === 'aviso' ? 'aviso' : a.tono})`,
                        borderRadius: a.tono === 'error' ? '2px' : '999px',
                        height: a.tono === 'info' ? '3px' : '10px',
                      }}
                    />
                    <span className="flex-1">{a.texto}</span>
                    <span className="cifra text-xs" style={{ color: 'var(--texto-tenue)' }}>
                      {a.cantidad}
                    </span>
                  </Enlace>
                </li>
              ))}
            </ul>
          )}

          <footer className="avisos-pie flex items-center justify-between gap-2">
            <span>
              {t('ui.actualizado_hace', {
                cuando: fechaRelativa(new Date(actualizado), i18n.language),
              })}
            </span>
            <Enlace a="/notificaciones" className="enlace-sutil" onClick={() => setAbierta(false)}>
              {t('avisos.ver_todos')}
            </Enlace>
          </footer>
        </div>
      )}
    </div>
  );
}
