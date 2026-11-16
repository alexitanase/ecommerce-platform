import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { iso, useFiltros, type PresetRango } from '@/lib/filtros-globales';
import { urlDeLaVista } from '@/lib/estado-url';
import { Boton, GrupoBotones } from './boton';
import { Desplegable } from './overlays';
import { useToast } from './toast';

/**
 * Selector de rango con presets.
 *
 * Es el filtro global del lienzo: lo que se elija aquí lo obedece todo lo que
 * hay debajo. Los presets cubren lo que se mira el 95 % de las veces y evitan
 * el error clásico de los selectores de fecha —elegir un rango de un día por
 * equivocación y creer que las ventas se han hundido—.
 *
 * El rango personalizado valida que el inicio no sea posterior al fin: es el
 * fallo más habitual al teclear fechas, y devuelve una pantalla en blanco que
 * parece un error del panel.
 */
const PRESETS: Exclude<PresetRango, 'personalizado'>[] = ['hoy', '7d', '30d', '90d', 'anio'];

export function FiltrosRango() {
  const { t } = useTranslation();
  const { preset, rango, cambiarPreset, cambiarRango } = useFiltros();
  const toast = useToast();
  const [desde, setDesde] = useState(iso(rango.desde));
  const [hasta, setHasta] = useState(iso(rango.hasta));
  const invalido = desde > hasta;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <GrupoBotones etiqueta={t('filtros.rango')}>
        {PRESETS.map((p) => (
          <Boton
            key={p}
            tamano="sm"
            variante={preset === p ? 'primario' : 'secundario'}
            aria-pressed={preset === p}
            onClick={() => cambiarPreset(p)}
          >
            {t(`filtros.presets.${p}`)}
          </Boton>
        ))}
      </GrupoBotones>

      <Desplegable
        etiqueta={t('filtros.personalizado')}
        tamano="sm"
        variante={preset === 'personalizado' ? 'contorno' : 'secundario'}
        ancho={280}
      >
        {(cerrar) => (
          <div className="space-y-3">
            <div>
              <label htmlFor="rango-desde" className="etiqueta-campo">
                {t('filtros.desde')}
              </label>
              <input
                id="rango-desde"
                type="date"
                className="campo"
                value={desde}
                max={hasta}
                onChange={(e) => setDesde(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="rango-hasta" className="etiqueta-campo">
                {t('filtros.hasta')}
              </label>
              <input
                id="rango-hasta"
                type="date"
                className="campo"
                value={hasta}
                min={desde}
                aria-invalid={invalido}
                aria-describedby={invalido ? 'rango-error' : undefined}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
            {invalido && (
              <p id="rango-error" className="texto-error">
                {t('filtros.rango_invalido')}
              </p>
            )}
            <Boton
              variante="primario"
              tamano="sm"
              ancho
              disabled={invalido}
              onClick={() => {
                cambiarRango(desde, hasta);
                cerrar();
              }}
            >
              {t('filtros.aplicar')}
            </Boton>
          </div>
        )}
      </Desplegable>

      {/*
       * Compartir la vista.
       *
       * La URL ya lleva el rango y los filtros; copiarla es la forma más corta
       * de decir «mira exactamente esto».
       */}
      <Boton
        tamano="sm"
        variante="fantasma"
        soloIcono
        etiqueta={t('filtros.copiar_enlace')}
        onClick={() => {
          void navigator.clipboard
            .writeText(urlDeLaVista())
            .then(() => toast.exito(t('filtros.enlace_copiado')))
            .catch(() => toast.error(t('filtros.enlace_fallo')));
        }}
        icono={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        }
      />
    </div>
  );
}
