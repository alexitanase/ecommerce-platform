import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

/**
 * Menú desplegable.
 *
 * Es la pieza que usan el botón partido, el menú de acciones de una fila y el
 * menú contextual del tablero. Se escribió una vez porque el comportamiento de
 * teclado es lo que más se olvida al copiar y pegar un desplegable:
 *
 *  · Las flechas recorren las opciones y se dan la vuelta al llegar al final.
 *  · Inicio y Fin saltan a la primera y a la última.
 *  · Escape cierra Y devuelve el foco al botón que lo abrió; si no, el foco se
 *    queda en el `body` y la siguiente pulsación de Tab empieza otra vez por el
 *    principio de la página.
 *  · Tab cierra: un menú abierto detrás del contenido es un rastro de foco
 *    invisible.
 *  · Pulsar fuera cierra, pero el `mousedown` no se traga, para que el clic que
 *    cierra el menú también active lo que hay debajo.
 */

export interface OpcionMenu {
  etiqueta: string;
  alElegir: () => void;
  icono?: ReactNode;
  peligro?: boolean;
  /** Deshabilitada pero visible: esconder acciones confunde más que atenuarlas. */
  desactivada?: boolean;
  /** Separador por encima de esta opción. */
  separada?: boolean;
}

export function Menu({
  id,
  abierto,
  alCerrar,
  ancla,
  opciones,
  alineacion = 'derecha',
}: {
  id?: string;
  abierto: boolean;
  alCerrar: () => void;
  /** Contenedor relativo del que cuelga el menú (posición y clic fuera). */
  ancla: RefObject<HTMLElement | null>;
  opciones: OpcionMenu[];
  alineacion?: 'izquierda' | 'derecha';
}) {
  const caja = useRef<HTMLDivElement>(null);
  const activadorPrevio = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!abierto) return;

    activadorPrevio.current = document.activeElement as HTMLElement | null;
    // El foco entra en la primera opción utilizable, no en el contenedor: así
    // las flechas funcionan desde el primer momento.
    const primera = caja.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    primera?.focus();

    const fuera = (e: MouseEvent) => {
      if (!ancla.current?.contains(e.target as Node)) alCerrar();
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto, alCerrar, ancla]);

  if (!abierto) return null;

  const cerrarYDevolverFoco = () => {
    alCerrar();
    activadorPrevio.current?.focus();
  };

  const mover = (desde: HTMLElement, paso: 1 | -1 | 'inicio' | 'fin') => {
    const items = Array.from(
      caja.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    if (items.length === 0) return;
    if (paso === 'inicio') return items[0]?.focus();
    if (paso === 'fin') return items[items.length - 1]?.focus();
    const i = items.indexOf(desde);
    const siguiente = items[(i + paso + items.length) % items.length];
    siguiente?.focus();
  };

  return (
    <div
      ref={caja}
      id={id}
      role="menu"
      className="menu"
      style={{ [alineacion === 'derecha' ? 'right' : 'left']: 0 }}
      onKeyDown={(e) => {
        const activo = document.activeElement as HTMLElement;
        if (e.key === 'Escape') {
          e.stopPropagation();
          cerrarYDevolverFoco();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          mover(activo, 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          mover(activo, -1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          mover(activo, 'inicio');
        } else if (e.key === 'End') {
          e.preventDefault();
          mover(activo, 'fin');
        } else if (e.key === 'Tab') {
          alCerrar();
        }
      }}
    >
      {opciones.map((o, i) => (
        <div key={`${o.etiqueta}-${i}`}>
          {o.separada && <div className="menu-separador" role="separator" />}
          <button
            type="button"
            role="menuitem"
            disabled={o.desactivada}
            onClick={() => {
              o.alElegir();
              cerrarYDevolverFoco();
            }}
            className="menu-opcion"
            style={o.peligro ? { color: 'var(--error)' } : undefined}
          >
            {o.icono && <span aria-hidden="true">{o.icono}</span>}
            {o.etiqueta}
          </button>
        </div>
      ))}
    </div>
  );
}
