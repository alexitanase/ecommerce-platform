import type { ReactNode } from 'react';

/**
 * Contenedor y cabecera de página.
 *
 * Hay **un solo carril**: el mismo ancho y el mismo relleno que la cabecera y
 * el pie. Todas las páginas empiezan en la misma columna que el logo, sin
 * excepción. Antes el catálogo se alineaba y el carrito no, así que al navegar
 * entre los dos el contenido se desplazaba 128 px sin motivo.
 *
 * Las páginas de una sola columna —un texto legal, un formulario— **también
 * empiezan en el carril**; lo que hacen es no llegar hasta el final. Se probó
 * a centrarlas dentro del carril, que es lo habitual, y el resultado era peor
 * que el problema original: en el aviso legal quedaban 256 px de margen a la
 * izquierda con el título flotando en mitad de la nada, sin nada encima con
 * lo que alinearse. Un bloque estrecho pegado al margen izquierdo se lee como
 * una columna; centrado y solo, se lee como un fallo de maqueta.
 *
 *  · `lectura` — una columna de texto. Más ancho cansa la vista.
 *  · `formulario` — un formulario de una sola columna.
 *  · `tarjeta` — una tarjeta suelta que es TODA la página: entrar, registro,
 *    recuperar la contraseña.
 *
 * **`tarjeta` es la excepción, y no contradice lo de arriba.** Aquello vale
 * para una página que se lee, donde el texto es una columna dentro de algo más
 * grande. Aquí no hay nada más: son dos campos y un botón, y no existe ninguna
 * otra cosa con la que alinearse. Pegada a la izquierda, en un escritorio de
 * 1500 px quedaban 800 px de vacío a la derecha y la pantalla parecía a medio
 * cargar. Centrada es lo que hace cualquier tienda, y aquí sí se lee como una
 * decisión.
 *
 * Todo lo demás ocupa el carril entero: catálogo, portada, ficha, carrito,
 * cuenta, checkout.
 */

/** El carril. Tiene que coincidir con el de `Cabecera` y `PieDePagina`. */
export const CARRIL = 'max-w-7xl';

/** Anchos de la columna interior. `pagina` no la lleva: ocupa el carril. */
const COLUMNAS = {
  pagina: null,
  lectura: 'max-w-3xl',
  formulario: 'max-w-2xl',
  // Estrecha a propósito: un formulario de acceso con 672 px de ancho tiene
  // los campos tan largos que no parecen campos.
  tarjeta: 'max-w-md mx-auto',
} as const;

export type Ancho = keyof typeof COLUMNAS;

export function Pagina({
  ancho = 'pagina',
  className = '',
  children,
}: {
  ancho?: Ancho;
  className?: string;
  children: ReactNode;
}) {
  const columna = COLUMNAS[ancho];

  return (
    <div className={`mx-auto w-full ${CARRIL} px-4 py-10 sm:px-6 ${className}`}>
      {columna ? <div className={`w-full ${columna}`}>{children}</div> : children}
    </div>
  );
}

/**
 * Título de página con su entradilla.
 *
 * Un solo tamaño para todos los `<h1>` de la tienda. Que la portada tenga un
 * título más grande es deliberado y vive en la portada; el resto de pantallas
 * no tienen ningún motivo para diferenciarse entre sí, y cuando lo hacían era
 * por descuido, no por decisión.
 */
export function TituloPagina({
  titulo,
  descripcion,
  centrado = false,
  children,
}: {
  titulo: string;
  descripcion?: ReactNode;
  /**
   * Para las pantallas de `ancho="tarjeta"`.
   *
   * Un título alineado a la izquierda encima de una tarjeta centrada se ve
   * descolgado, y es lo que pasaba en entrar y en registro.
   */
  centrado?: boolean;
  /** Acciones a la derecha del título: un botón, un contador. */
  children?: ReactNode;
}) {
  if (centrado) {
    return (
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{titulo}</h1>
        {descripcion && (
          <p className="mt-2 text-sm text-balance text-[var(--texto-suave)]">{descripcion}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{titulo}</h1>
        {descripcion && <p className="mt-1 text-sm text-[var(--texto-suave)]">{descripcion}</p>}
      </div>
      {children}
    </div>
  );
}

/** Título de sección dentro de una página. */
export function TituloSeccion({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{titulo}</h2>
        {descripcion && <p className="mt-0.5 text-sm text-[var(--texto-suave)]">{descripcion}</p>}
      </div>
      {children}
    </div>
  );
}
