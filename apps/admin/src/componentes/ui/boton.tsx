import { useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu } from './menu';

/**
 * Botones del panel.
 *
 * Antes cada pantalla escribía `className="btn btn-secundario text-xs"` con sus
 * propios ajustes de tamaño, y acabaron conviviendo cinco alturas distintas de
 * botón secundario. Aquí las variantes y los tamaños son un conjunto cerrado:
 * si hace falta uno nuevo, se añade a este fichero y aparece en todas partes.
 *
 * Tres cosas que el `className` suelto no daba y aquí son obligatorias:
 *
 *  · **`cargando`** deja el botón inerte y anuncia el cambio, en vez de dejar
 *    que se pulse tres veces seguidas mientras la petición vuela.
 *  · **Solo icono** exige `etiqueta` por tipos: un botón sin texto accesible es
 *    invisible para un lector de pantalla, y era el fallo más repetido.
 *  · **Área táctil** de 24 px aunque el icono mida 16 (WCAG 2.2, 2.5.8).
 */

export type VarianteBoton =
  'primario' | 'secundario' | 'contorno' | 'fantasma' | 'peligro' | 'enlace';

export type TamanoBoton = 'sm' | 'md' | 'lg';

const TAMANOS: Record<TamanoBoton, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-xl',
};

const SOLO_ICONO: Record<TamanoBoton, string> = {
  sm: 'h-8 w-8 p-0 rounded-lg',
  md: 'h-9 w-9 p-0 rounded-lg',
  lg: 'h-11 w-11 p-0 rounded-xl',
};

/** Estilos por variante. Se resuelven con variables para respetar la marca. */
function estiloVariante(v: VarianteBoton): React.CSSProperties {
  switch (v) {
    case 'primario':
      return { background: 'var(--marca-primario)', color: '#fff' };
    case 'secundario':
      return {
        background: 'var(--fondo-panel)',
        border: '1px solid var(--borde-fuerte)',
        color: 'var(--texto)',
      };
    case 'contorno':
      return {
        background: 'transparent',
        border: '1px solid var(--marca-primario)',
        color: 'var(--marca-primario-texto)',
      };
    case 'fantasma':
      return { background: 'transparent', color: 'var(--texto-suave)' };
    case 'peligro':
      return { background: 'var(--error)', color: '#fff' };
    case 'enlace':
      return {
        background: 'transparent',
        color: 'var(--marca-primario-texto)',
        textDecoration: 'underline',
        textUnderlineOffset: '2px',
      };
  }
}

const CLASE_VARIANTE: Record<VarianteBoton, string> = {
  primario: 'boton-solido',
  secundario: 'boton-suave',
  contorno: 'boton-suave',
  fantasma: 'boton-suave',
  peligro: 'boton-solido',
  enlace: 'boton-enlace',
};

interface BaseBoton extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  /** Icono a la izquierda del texto. */
  icono?: ReactNode;
  /** Icono a la derecha; para menús desplegables y acciones que abren algo. */
  iconoDerecha?: ReactNode;
  cargando?: boolean;
  /** Ocupa todo el ancho disponible; útil en formularios y drawers. */
  ancho?: boolean;
  className?: string;
}

type PropsBoton =
  | (BaseBoton & { soloIcono: true; etiqueta: string; children?: never })
  | (BaseBoton & { soloIcono?: false; etiqueta?: string; children: ReactNode });

/** Rueda de espera. Decorativa: lo que se anuncia es el `aria-busy` del botón. */
export function Girador({ tamano = 14 }: { tamano?: number }) {
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="girando"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Boton({
  variante = 'secundario',
  tamano = 'md',
  icono,
  iconoDerecha,
  cargando = false,
  ancho = false,
  soloIcono = false,
  etiqueta,
  className = '',
  children,
  disabled,
  ...resto
}: PropsBoton) {
  const clases = [
    'boton objetivo',
    CLASE_VARIANTE[variante],
    soloIcono ? SOLO_ICONO[tamano] : TAMANOS[tamano],
    ancho ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      {...resto}
      // Un botón que ya está trabajando no se vuelve a pulsar. `aria-busy`
      // además lo dice, para quien no ve girar la rueda.
      disabled={disabled ?? cargando}
      aria-busy={cargando || undefined}
      aria-label={soloIcono ? etiqueta : resto['aria-label']}
      title={soloIcono ? etiqueta : resto.title}
      className={clases}
      style={{ ...estiloVariante(variante), ...resto.style }}
    >
      {cargando ? <Girador /> : icono}
      {!soloIcono && children}
      {!cargando && iconoDerecha}
    </button>
  );
}

/**
 * Grupo de botones.
 *
 * Une varias acciones del mismo rango en un solo bloque (densidad de tabla,
 * conmutadores de vista). Va en un `role="group"` con nombre para que se
 * anuncie como una unidad y no como tres botones sueltos.
 */
export function GrupoBotones({
  etiqueta,
  children,
  className = '',
}: {
  etiqueta: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="group" aria-label={etiqueta} className={`grupo-botones ${className}`}>
      {children}
    </div>
  );
}

/**
 * Botón partido: acción principal + desplegable con las variantes.
 *
 * Es para cuando hay una acción que se usa el 90 % de las veces y tres más que
 * no merecen sitio propio en la barra —«Exportar CSV» con PNG y PDF detrás—.
 * Los dos lados son botones reales: el segundo abre el menú con teclado.
 */
export function BotonPartido({
  etiqueta,
  alPulsar,
  opciones,
  variante = 'secundario',
  tamano = 'md',
  icono,
  cargando = false,
}: {
  etiqueta: string;
  alPulsar: () => void;
  opciones: { etiqueta: string; alElegir: () => void; icono?: ReactNode; peligro?: boolean }[];
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  icono?: ReactNode;
  cargando?: boolean;
}) {
  const { t } = useTranslation();
  const [abierto, setAbierto] = useState(false);
  const ancla = useRef<HTMLDivElement>(null);
  const id = useId();

  return (
    <div ref={ancla} className="grupo-botones relative">
      <Boton
        variante={variante}
        tamano={tamano}
        icono={icono}
        cargando={cargando}
        onClick={alPulsar}
      >
        {etiqueta}
      </Boton>
      <Boton
        variante={variante}
        tamano={tamano}
        soloIcono
        etiqueta={t('ui.mas_opciones', { defaultValue: 'Más opciones' })}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? id : undefined}
        onClick={() => setAbierto((v) => !v)}
        icono={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m6 9 6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        }
      />
      <Menu
        id={id}
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        ancla={ancla}
        opciones={opciones}
      />
    </div>
  );
}
