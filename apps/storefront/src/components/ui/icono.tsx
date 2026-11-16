/**
 * Iconos de la tienda.
 *
 * Estaban repetidos como SVG en línea por media docena de ficheros, y cada
 * copia había ido derivando: 18 px con trazo 2 en la cabecera, 18 con 1,8 en el
 * botón de deseos, 32 con 2,5 en el pago. Diferencias que por separado no se
 * ven y que juntas hacen que la interfaz parezca ensamblada de piezas de sitios
 * distintos — porque lo estaba.
 *
 * Aquí van una sola vez, con dos tamaños de trazo y ninguna decisión que tomar
 * en el sitio donde se usan:
 *
 *  · Los iconos pequeños (14-20 px) llevan trazo 2: por debajo de eso se
 *    deshacen en las pantallas sin retina.
 *  · Los grandes y decorativos (32 px o más) llevan trazo 1,5: mantener el 2 a
 *    ese tamaño los convierte en manchas.
 *
 * El corte está en 24 px y lo decide el propio componente, no quien lo llama.
 */

export type NombreIcono =
  | 'busqueda'
  | 'carrito'
  | 'corazon'
  | 'usuario'
  | 'sol'
  | 'luna'
  | 'imagen'
  | 'comprobado'
  | 'alerta'
  | 'flecha-derecha'
  | 'galon-abajo'
  | 'camion'
  | 'cerrar'
  | 'candado'
  | 'ubicacion'
  | 'escudo'
  | 'regalo'
  | 'caja'
  | 'reloj'
  | 'cuadricula'
  | 'lista'
  | 'ajustes'
  | 'flecha-izquierda'
  | 'compartir'
  | 'enlace'
  | 'sobre';

/** El trazo por debajo del cual un icono grande se convierte en una mancha. */
const TAMANO_GRANDE = 24;

const TRAZOS: Record<NombreIcono, React.ReactNode> = {
  busqueda: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </>
  ),
  carrito: (
    <>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
    </>
  ),
  corazon: (
    <path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1.1 1L12 21.2l7.7-7.7 1.1-1a5.5 5.5 0 000-7.9z" />
  ),
  usuario: (
    <>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  sol: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  ),
  luna: <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />,
  imagen: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  comprobado: <path d="M20 6L9 17l-5-5" />,
  alerta: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    </>
  ),
  'flecha-derecha': (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  'galon-abajo': <path d="M6 9l6 6 6-6" />,
  camion: (
    <>
      <path d="M1 3h14v13H1z" />
      <path d="M15 8h4l3 3v5h-7z" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </>
  ),
  cerrar: <path d="M18 6L6 18M6 6l12 12" />,
  candado: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 018 0v3" />
    </>
  ),
  ubicacion: (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1116 0z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  escudo: <path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3z" />,
  regalo: (
    <>
      <path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7" />
      <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
    </>
  ),
  // Un paquete: es lo que el cliente espera ver junto a «mis pedidos».
  caja: (
    <>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3.3 7L12 12l8.7-5M12 22V12" />
    </>
  ),
  // Búsquedas recientes: un reloj es lo que todo el mundo lee como «historial».
  reloj: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  cuadricula: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  lista: (
    <>
      <rect x="3" y="4" width="18" height="6" rx="1" />
      <rect x="3" y="14" width="18" height="6" rx="1" />
    </>
  ),
  // Los deslizadores de siempre: es el icono que la gente ya asocia a filtrar.
  ajustes: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </>
  ),
  compartir: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </>
  ),
  enlace: (
    <>
      <path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7" />
    </>
  ),
  sobre: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2.5 6.5l8.4 5.9a2 2 0 002.2 0l8.4-5.9" />
    </>
  ),
  'flecha-izquierda': (
    <>
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </>
  ),
};

export interface PropsIcono {
  nombre: NombreIcono;
  /** Lado en píxeles. 18 es el de la interfaz; 32 o más, decorativo. */
  tamano?: number;
  /** Rellena el trazo: para el corazón marcado, por ejemplo. */
  relleno?: boolean;
  className?: string;
  /**
   * Texto alternativo.
   *
   * Sin él el icono queda oculto a los lectores de pantalla, que es lo
   * correcto cuando acompaña a un texto que ya lo explica. Si el icono es la
   * única pista —un botón que solo lleva icono— hay que darle etiqueta, y va
   * en el botón, no aquí.
   */
  titulo?: string;
}

export function Icono({ nombre, tamano = 18, relleno = false, className, titulo }: PropsIcono) {
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill={relleno ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={tamano >= TAMANO_GRANDE ? 1.5 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={titulo ? undefined : 'true'}
      role={titulo ? 'img' : undefined}
      focusable="false"
    >
      {titulo && <title>{titulo}</title>}
      {TRAZOS[nombre]}
    </svg>
  );
}
