import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useEstadoUrl } from './estado-url';

/**
 * Filtros globales del lienzo.
 *
 * El rango de fechas no puede ser de cada widget. Cuando cada tarjeta trae su
 * propio periodo, dos cifras que están una al lado de la otra no son
 * comparables y nadie se da cuenta: los ingresos son del mes y los pedidos de
 * hoy. Aquí el rango se elige una vez y lo obedece todo lo que hay en pantalla.
 *
 * Va a la URL (para compartir la vista) y a `localStorage` (para que al volver
 * mañana siga puesto lo que se mira siempre).
 *
 * Y con el rango viaja **el periodo anterior equivalente**, que es lo que
 * permite que ninguna cifra se enseñe sola: 30 días se comparan con los 30 días
 * anteriores, no con «el mes pasado» ni con nada aproximado.
 */

export type PresetRango = 'hoy' | '7d' | '30d' | '90d' | 'anio' | 'personalizado';

export interface Rango {
  desde: Date;
  hasta: Date;
}

interface Filtros {
  preset: PresetRango;
  rango: Rango;
  /** Mismo número de días, justo antes. Base de toda comparativa. */
  anterior: Rango;
  dias: number;
  cambiarPreset: (preset: PresetRango) => void;
  cambiarRango: (desde: string, hasta: string) => void;
  /** Para las queries: `desde=…&hasta=…` ya montado. */
  query: (rango?: Rango) => string;
}

const CLAVE = 'filtros-rango';
const Contexto = createContext<Filtros | null>(null);

const DIAS_DE: Record<Exclude<PresetRango, 'personalizado'>, number> = {
  hoy: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  anio: 365,
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Inicio del día, en local: un rango que empieza a las 14:32 deja fuera media mañana. */
function inicioDelDia(d: Date): Date {
  const copia = new Date(d);
  copia.setHours(0, 0, 0, 0);
  return copia;
}

function rangoDePreset(preset: Exclude<PresetRango, 'personalizado'>): Rango {
  const hasta = new Date();
  const desde = inicioDelDia(new Date(hasta.getTime() - (DIAS_DE[preset] - 1) * 86_400_000));
  return { desde, hasta };
}

export function ProveedorFiltros({ children }: { children: ReactNode }) {
  const [estado, actualizar] = useEstadoUrl({
    rango: localStorage.getItem(CLAVE) ?? '30d',
    desde: undefined as string | undefined,
    hasta: undefined as string | undefined,
  });

  const preset = (estado.rango ?? '30d') as PresetRango;

  const rango = useMemo<Rango>(() => {
    if (preset === 'personalizado' && estado.desde && estado.hasta) {
      return {
        desde: inicioDelDia(new Date(estado.desde)),
        hasta: new Date(`${estado.hasta}T23:59:59`),
      };
    }
    return rangoDePreset(preset === 'personalizado' ? '30d' : preset);
  }, [preset, estado.desde, estado.hasta]);

  const dias = Math.max(
    1,
    Math.round((rango.hasta.getTime() - rango.desde.getTime()) / 86_400_000),
  );

  const anterior = useMemo<Rango>(() => {
    const duracion = rango.hasta.getTime() - rango.desde.getTime();
    return {
      desde: new Date(rango.desde.getTime() - duracion),
      hasta: new Date(rango.desde.getTime() - 1),
    };
  }, [rango]);

  const cambiarPreset = useCallback(
    (nuevo: PresetRango) => {
      localStorage.setItem(CLAVE, nuevo);
      actualizar(
        nuevo === 'personalizado'
          ? { rango: nuevo }
          : { rango: nuevo, desde: undefined, hasta: undefined },
      );
    },
    [actualizar],
  );

  const cambiarRango = useCallback(
    (desde: string, hasta: string) => {
      localStorage.setItem(CLAVE, 'personalizado');
      actualizar({ rango: 'personalizado', desde, hasta });
    },
    [actualizar],
  );

  const query = useCallback(
    (r: Rango = rango) => `desde=${r.desde.toISOString()}&hasta=${r.hasta.toISOString()}`,
    [rango],
  );

  const valor: Filtros = {
    preset,
    rango,
    anterior,
    dias,
    cambiarPreset,
    cambiarRango,
    query,
  };

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useFiltros(): Filtros {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useFiltros debe usarse dentro de ProveedorFiltros');
  return ctx;
}

export { iso };
