import type { ReactNode } from 'react';
import { CabeceraPagina, type Miga } from './ui/navegacion-pagina';

/**
 * Encabezado de pantalla.
 *
 * Es el nombre con el que lo llaman las 27 pantallas del panel; la
 * implementación vive en `CabeceraPagina`, que además pinta las migas de pan y
 * la marca de frescura del dato. Se mantiene este envoltorio para no tocar 27
 * ficheros en un cambio que es de presentación, y para que la firma que ya
 * conocen las pantallas siga siendo válida.
 */
export function Encabezado(props: {
  titulo: string;
  descripcion?: string;
  /** Cuántos elementos se están mostrando. */
  cargados?: number;
  /** Si el servidor tiene más por dar; cambia «12» por «12 y más». */
  hayMas?: boolean;
  acciones?: ReactNode;
  /** Niveles extra de migas para las pantallas de detalle. */
  migas?: Miga[];
  frescura?: ReactNode;
}) {
  return <CabeceraPagina {...props} />;
}
