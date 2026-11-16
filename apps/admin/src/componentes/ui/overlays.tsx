import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Boton } from './boton';
import { Menu, type OpcionMenu } from './menu';

/**
 * Capas flotantes del panel: modal, drawer, desplegable, popover, tooltip y
 * menú contextual.
 *
 * El modal y el drawer se apoyan en `<dialog>` nativo a propósito. Un `div` con
 * `role="dialog"` obliga a reimplementar a mano cuatro cosas que el navegador
 * ya hace bien —atrapar el foco, cerrar con Escape, inertizar el fondo y
 * gestionar la pila cuando se abren dos— y cada una de esas reimplementaciones
 * es un sitio donde el foco se escapa al contenido de detrás.
 *
 * Lo que sí hay que poner a mano es la vuelta del foco al elemento que abrió la
 * capa: sin eso, cerrar un modal deja el foco en el `body` y el teclado empieza
 * de cero en la barra del navegador.
 */

/* ────────────────────────────── Modal ────────────────────────────── */

export function Modal({
  abierto,
  alCerrar,
  titulo,
  descripcion,
  children,
  pie,
  ancho = 'md',
}: {
  abierto: boolean;
  alCerrar: () => void;
  titulo: string;
  descripcion?: string;
  children?: ReactNode;
  /** Acciones del pie. La principal va a la derecha, que es donde se busca. */
  pie?: ReactNode;
  ancho?: 'sm' | 'md' | 'lg';
}) {
  const { t } = useTranslation();
  const dialogo = useRef<HTMLDialogElement>(null);
  const activador = useRef<HTMLElement | null>(null);
  const idTitulo = useId();
  const idDesc = useId();

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;

    if (abierto && !d.open) {
      activador.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!abierto && d.open) {
      d.close();
    }
  }, [abierto]);

  const cerrar = () => {
    alCerrar();
    // En el mismo tick el diálogo aún tiene el foco; se devuelve después de
    // que el navegador lo suelte.
    queueMicrotask(() => activador.current?.focus());
  };

  return (
    <dialog
      ref={dialogo}
      aria-labelledby={idTitulo}
      aria-describedby={descripcion ? idDesc : undefined}
      className={`modal modal-${ancho}`}
      // Escape dispara `cancel`: se intercepta para pasar por nuestro cierre y
      // no dejar el estado de React diciendo que sigue abierto.
      onCancel={(e) => {
        e.preventDefault();
        cerrar();
      }}
      onClose={() => {
        if (abierto) cerrar();
      }}
      // Pulsar en el velo cierra. El clic del velo llega con `target` igual al
      // propio `<dialog>`, porque el contenido está dentro de un hijo.
      onMouseDown={(e) => {
        if (e.target === dialogo.current) cerrar();
      }}
    >
      <div className="modal-caja">
        <header className="modal-cabecera">
          <div className="min-w-0">
            <h2 id={idTitulo} className="text-base font-semibold">
              {titulo}
            </h2>
            {descripcion && (
              <p id={idDesc} className="mt-1 text-sm" style={{ color: 'var(--texto-tenue)' }}>
                {descripcion}
              </p>
            )}
          </div>
          <Boton
            variante="fantasma"
            tamano="sm"
            soloIcono
            etiqueta={t('app.cerrar')}
            onClick={cerrar}
            icono={<IconoX />}
          />
        </header>

        {children && <div className="modal-cuerpo">{children}</div>}
        {pie && <footer className="modal-pie">{pie}</footer>}
      </div>
    </dialog>
  );
}

/**
 * Confirmación destructiva.
 *
 * Un modal con el texto ya puesto, porque la mitad de las confirmaciones del
 * panel decían «¿Seguro?» y la otra mitad «¿Estás seguro de que quieres
 * continuar?». Lo que hace falta saber es QUÉ se va a borrar y que no hay
 * vuelta atrás, así que eso es lo que se pide.
 */
export function ConfirmarPeligro({
  abierto,
  alCerrar,
  alConfirmar,
  titulo,
  descripcion,
  textoConfirmar,
  trabajando = false,
}: {
  abierto: boolean;
  alCerrar: () => void;
  alConfirmar: () => void;
  titulo: string;
  descripcion: string;
  textoConfirmar?: string;
  trabajando?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Modal
      abierto={abierto}
      alCerrar={alCerrar}
      titulo={titulo}
      descripcion={descripcion}
      ancho="sm"
      pie={
        <>
          <Boton variante="secundario" onClick={alCerrar}>
            {t('app.cancelar')}
          </Boton>
          <Boton variante="peligro" onClick={alConfirmar} cargando={trabajando}>
            {textoConfirmar ?? t('app.confirmar')}
          </Boton>
        </>
      }
    />
  );
}

/* ────────────────────────────── Drawer ────────────────────────────── */

/**
 * Panel lateral.
 *
 * Para editar algo sin perder de vista la lista de la que viene: al cerrarlo,
 * la fila sigue donde estaba y el scroll no se ha movido. Se usa `<dialog>` por
 * lo mismo que el modal —foco atrapado y Escape—, con la caja pegada al borde.
 */
export function Drawer({
  abierto,
  alCerrar,
  titulo,
  descripcion,
  children,
  pie,
  lado = 'derecha',
  ancho = 480,
}: {
  abierto: boolean;
  alCerrar: () => void;
  titulo: string;
  descripcion?: string;
  children?: ReactNode;
  pie?: ReactNode;
  lado?: 'derecha' | 'izquierda';
  ancho?: number;
}) {
  const { t } = useTranslation();
  const dialogo = useRef<HTMLDialogElement>(null);
  const activador = useRef<HTMLElement | null>(null);
  const idTitulo = useId();
  const idDesc = useId();

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (abierto && !d.open) {
      activador.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!abierto && d.open) {
      d.close();
    }
  }, [abierto]);

  const cerrar = () => {
    alCerrar();
    queueMicrotask(() => activador.current?.focus());
  };

  return (
    <dialog
      ref={dialogo}
      aria-labelledby={idTitulo}
      aria-describedby={descripcion ? idDesc : undefined}
      className={`drawer drawer-${lado}`}
      onCancel={(e) => {
        e.preventDefault();
        cerrar();
      }}
      onClose={() => {
        if (abierto) cerrar();
      }}
      onMouseDown={(e) => {
        if (e.target === dialogo.current) cerrar();
      }}
      style={{ ['--ancho-drawer' as string]: `${ancho}px` }}
    >
      <div className="drawer-caja">
        <header className="modal-cabecera">
          <div className="min-w-0">
            <h2 id={idTitulo} className="text-base font-semibold">
              {titulo}
            </h2>
            {descripcion && (
              <p id={idDesc} className="mt-1 text-sm" style={{ color: 'var(--texto-tenue)' }}>
                {descripcion}
              </p>
            )}
          </div>
          <Boton
            variante="fantasma"
            tamano="sm"
            soloIcono
            etiqueta={t('app.cerrar')}
            onClick={cerrar}
            icono={<IconoX />}
          />
        </header>
        <div className="drawer-cuerpo">{children}</div>
        {pie && <footer className="modal-pie">{pie}</footer>}
      </div>
    </dialog>
  );
}

/* ──────────────────────────── Desplegable ──────────────────────────── */

/**
 * Botón que abre un panel colgado de él.
 *
 * La diferencia con `Menu` es lo que va dentro: `Menu` son acciones y se
 * recorre con flechas; esto es contenido —un formulario de filtros, la lista de
 * columnas— y se recorre con Tab, que es lo que espera quien lo usa.
 */
export function Desplegable({
  etiqueta,
  children,
  icono,
  variante = 'secundario',
  tamano = 'md',
  alineacion = 'derecha',
  ancho,
}: {
  etiqueta: string;
  children: ReactNode | ((cerrar: () => void) => ReactNode);
  icono?: ReactNode;
  variante?: 'primario' | 'secundario' | 'fantasma' | 'contorno';
  tamano?: 'sm' | 'md';
  alineacion?: 'izquierda' | 'derecha';
  ancho?: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const id = useId();

  useCerrarFuera(caja, abierto, () => setAbierto(false));

  return (
    <div
      ref={caja}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && abierto) {
          e.stopPropagation();
          setAbierto(false);
          caja.current?.querySelector('button')?.focus();
        }
      }}
    >
      <Boton
        variante={variante}
        tamano={tamano}
        icono={icono}
        aria-expanded={abierto}
        aria-controls={abierto ? id : undefined}
        onClick={() => setAbierto((v) => !v)}
        iconoDerecha={<IconoChevron />}
      >
        {etiqueta}
      </Boton>
      {abierto && (
        <div
          id={id}
          className="flotante"
          style={{
            [alineacion === 'derecha' ? 'right' : 'left']: 0,
            width: ancho ? `${ancho}px` : undefined,
          }}
        >
          {typeof children === 'function' ? children(() => setAbierto(false)) : children}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Popover ───────────────────────────── */

/**
 * Explicación anclada a un elemento.
 *
 * A diferencia del tooltip, puede llevar enlaces y botones dentro, así que se
 * abre al pulsar y no al pasar por encima: un panel que aparece al rozar y
 * contiene un enlace es imposible de alcanzar con el ratón.
 */
export function Popover({
  disparador,
  titulo,
  children,
  alineacion = 'izquierda',
}: {
  disparador: (props: { abierto: boolean; alternar: () => void }) => ReactNode;
  titulo?: string;
  children: ReactNode;
  alineacion?: 'izquierda' | 'derecha';
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useCerrarFuera(caja, abierto, () => setAbierto(false));

  return (
    <span
      ref={caja}
      className="relative inline-flex"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && abierto) {
          e.stopPropagation();
          setAbierto(false);
        }
      }}
    >
      {disparador({ abierto, alternar: () => setAbierto((v) => !v) })}
      {abierto && (
        <div
          role="dialog"
          aria-label={titulo}
          className="flotante"
          style={{ [alineacion === 'derecha' ? 'right' : 'left']: 0, width: '280px' }}
        >
          {titulo && <p className="mb-1 text-sm font-semibold">{titulo}</p>}
          <div className="text-sm" style={{ color: 'var(--texto-suave)' }}>
            {children}
          </div>
        </div>
      )}
    </span>
  );
}

/* ───────────────────────────── Tooltip ───────────────────────────── */

/**
 * Aclaración corta.
 *
 * Solo texto, y siempre como `aria-describedby` del elemento que describe: un
 * tooltip que solo aparece al pasar el ratón no existe para quien navega con
 * teclado ni para quien usa lector, así que también se abre con el foco.
 *
 * No sustituye a la etiqueta: si un control necesita el tooltip para saber qué
 * hace, lo que le falta es nombre, no explicación.
 *
 * La posición «derecha» no se coloca igual que las otras dos. Se usa en el menú
 * lateral contraído, y ahí el menú tiene scroll propio: cualquier hijo colocado
 * en absoluto lo recorta la caja del menú. El síntoma era que la etiqueta de un
 * icono salía cortada por la mitad —«etenidos» en vez de «Pedidos
 * retenidos»—, lo que dejaba el menú contraído sin forma de saber qué era cada
 * icono. Por eso esta variante se mide y se coloca en `fixed`: así no la
 * recorta ningún antepasado con scroll.
 */
export function Tooltip({
  texto,
  children,
  posicion = 'arriba',
  className = '',
}: {
  texto: string;
  children: ReactNode;
  posicion?: 'arriba' | 'abajo' | 'derecha';
  /** Para que el envoltorio no encoja el hijo cuando debe ocupar todo el ancho. */
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [sitio, setSitio] = useState<{ top: number; left: number } | null>(null);
  const ancla = useRef<HTMLSpanElement>(null);
  const id = useId();

  const mostrar = () => {
    if (posicion === 'derecha') {
      const r = ancla.current?.getBoundingClientRect();
      // Centrado verticalmente sobre el icono y pegado a su derecha.
      if (r) setSitio({ top: r.top + r.height / 2, left: r.right + 8 });
    }
    setVisible(true);
  };

  return (
    <span
      ref={ancla}
      className={`relative inline-flex ${className}`.trim()}
      onMouseEnter={mostrar}
      onMouseLeave={() => setVisible(false)}
      onFocus={mostrar}
      onBlur={() => setVisible(false)}
      // Escape cierra también el tooltip: es un requisito de WCAG 1.4.13, para
      // que lo que aparece al pasar por encima se pueda quitar sin mover el
      // ratón cuando tapa lo que hay debajo.
      onKeyDown={(e) => {
        if (e.key === 'Escape') setVisible(false);
      }}
      aria-describedby={visible ? id : undefined}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          id={id}
          className={`tooltip tooltip-${posicion}`}
          {...(posicion === 'derecha' && sitio ? { style: sitio } : {})}
        >
          {texto}
        </span>
      )}
    </span>
  );
}

/* ────────────────────────── Menú contextual ────────────────────────── */

/**
 * Menú del botón derecho.
 *
 * Se usa en el tablero y en las tablas para las acciones de una fila. Mantiene
 * el menú nativo accesible con Shift+F10 y con la tecla de menú, porque quien
 * no usa ratón no tiene «botón derecho».
 */
export function MenuContextual({
  opciones,
  children,
  className = '',
}: {
  opciones: OpcionMenu[];
  children: ReactNode;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={caja}
      className={`relative ${className}`}
      onContextMenu={(e) => {
        e.preventDefault();
        setAbierto(true);
      }}
      onKeyDown={(e) => {
        if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
          e.preventDefault();
          setAbierto(true);
        }
      }}
    >
      {children}
      <Menu
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        ancla={caja}
        opciones={opciones}
        alineacion="izquierda"
      />
    </div>
  );
}

/* ───────────────────────────── Auxiliares ───────────────────────────── */

/** Cierra al pulsar fuera del contenedor. */
function useCerrarFuera(
  caja: RefObject<HTMLElement | null>,
  activo: boolean,
  alCerrar: () => void,
) {
  useEffect(() => {
    if (!activo) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) alCerrar();
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [activo, alCerrar, caja]);
}

export function IconoX() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconoChevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m6 9 6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
