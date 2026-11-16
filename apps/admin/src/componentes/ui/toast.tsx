import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { IconoX } from './overlays';

/**
 * Avisos efímeros (toasts) con cola.
 *
 * Reglas que vienen de ver fallar la alternativa:
 *
 *  · **Cola, no pila infinita.** Guardar un producto con seis traducciones
 *    disparaba seis avisos que tapaban media pantalla. Se muestran tres como
 *    mucho; el resto espera turno.
 *  · **Los errores no se van solos.** Un fallo que desaparece a los cuatro
 *    segundos es un fallo que nadie leyó. Los de error se quedan hasta que se
 *    cierran; los demás caducan.
 *  · **El temporizador se pausa al pasar por encima o al enfocar.** Si no,
 *    intentar leer un aviso largo o pulsar su acción es una carrera contra el
 *    reloj.
 *  · **`aria-live`.** Dos regiones: `polite` para lo normal y `assertive` para
 *    los errores, que sí interrumpen. Una sola región con el nivel equivocado
 *    hace que o no se anuncie nada o se interrumpa por todo.
 */

export type TonoToast = 'exito' | 'error' | 'aviso' | 'info';

interface Toast {
  id: number;
  tono: TonoToast;
  texto: string;
  /** Acción opcional; por ejemplo «Deshacer». */
  accion?: { etiqueta: string; alPulsar: () => void };
}

interface ApiToasts {
  mostrar: (texto: string, tono?: TonoToast, accion?: Toast['accion']) => void;
  exito: (texto: string) => void;
  error: (texto: string) => void;
}

const Contexto = createContext<ApiToasts | null>(null);

const VISIBLES = 3;
const DURACION = 5000;

export function ProveedorToasts({ children }: { children: ReactNode }) {
  const [cola, setCola] = useState<Toast[]>([]);
  const siguienteId = useRef(1);

  const quitar = useCallback((id: number) => {
    setCola((c) => c.filter((t) => t.id !== id));
  }, []);

  const api = useMemo<ApiToasts>(() => {
    const mostrar = (texto: string, tono: TonoToast = 'info', accion?: Toast['accion']) => {
      setCola((c) => [...c, { id: siguienteId.current++, texto, tono, accion }]);
    };
    return {
      mostrar,
      exito: (texto: string) => mostrar(texto, 'exito'),
      error: (texto: string) => mostrar(texto, 'error'),
    };
  }, []);

  const visibles = cola.slice(0, VISIBLES);

  return (
    <Contexto.Provider value={api}>
      {children}

      {/* Dos regiones vivas separadas por urgencia; siempre presentes en el DOM,
          porque una región que aparece a la vez que su contenido no se anuncia. */}
      <div className="toasts" role="region" aria-label="">
        <div aria-live="polite" aria-atomic="false" className="toasts-pila">
          {visibles
            .filter((t) => t.tono !== 'error')
            .map((t) => (
              <Aviso key={t.id} toast={t} alCerrar={() => quitar(t.id)} />
            ))}
        </div>
        <div aria-live="assertive" aria-atomic="false" className="toasts-pila">
          {visibles
            .filter((t) => t.tono === 'error')
            .map((t) => (
              <Aviso key={t.id} toast={t} alCerrar={() => quitar(t.id)} />
            ))}
        </div>
      </div>
    </Contexto.Provider>
  );
}

function Aviso({ toast, alCerrar }: { toast: Toast; alCerrar: () => void }) {
  const { t } = useTranslation();
  const [pausado, setPausado] = useState(false);

  useEffect(() => {
    if (toast.tono === 'error' || pausado) return;
    const id = setTimeout(alCerrar, DURACION);
    return () => clearTimeout(id);
  }, [toast.tono, pausado, alCerrar]);

  const color = `var(--${toast.tono === 'exito' ? 'exito' : toast.tono})`;

  return (
    <div
      className="toast"
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      {/* Icono con forma distinta por tono: el color no puede ser lo único que
          distinga un error de una confirmación. */}
      <span aria-hidden="true" style={{ color }}>
        <IconoTono tono={toast.tono} />
      </span>
      <p className="flex-1 text-sm">{toast.texto}</p>
      {toast.accion && (
        <button
          type="button"
          className="toast-accion"
          onClick={() => {
            toast.accion?.alPulsar();
            alCerrar();
          }}
        >
          {toast.accion.etiqueta}
        </button>
      )}
      <button
        type="button"
        className="toast-cerrar objetivo"
        aria-label={t('app.cerrar')}
        onClick={alCerrar}
      >
        <IconoX />
      </button>
    </div>
  );
}

function IconoTono({ tono }: { tono: TonoToast }) {
  const d =
    tono === 'exito'
      ? 'M20 6 9 17l-5-5'
      : tono === 'error'
        ? 'M18 6 6 18M6 6l12 12'
        : tono === 'aviso'
          ? 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'
          : 'M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z';

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function useToast(): ApiToasts {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useToast debe usarse dentro de ProveedorToasts');
  return ctx;
}
