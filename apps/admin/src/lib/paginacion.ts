import { useInfiniteQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';

/**
 * Listas paginadas por cursor.
 *
 * La API pagina por cursor desde el principio —pedidos, productos, usuarios,
 * reseñas y auditoría devuelven todos `nextCursor`— pero el panel nunca lo
 * usó: pedía las primeras 50 filas y se quedaba ahí. **Con más de 50 pedidos,
 * los siguientes no había forma de verlos desde el panel.** No era un problema
 * de estética: la tienda dejaba de poder gestionarse en cuanto crecía un poco.
 *
 * Y encima el número que se enseñaba junto al título era `items.length`, o
 * sea el de la página, presentado como si fuera el total. La pantalla decía
 * «Pedidos 50» con trescientos en la base, sin ninguna señal de que faltaba
 * algo.
 *
 * Este hook resuelve las dos cosas a la vez: acumula las páginas conforme se
 * piden y expone `hayMas`, que es lo que permite decir «50 y más» en vez de
 * mentir con un 50 a secas.
 */

interface Pagina<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListaPaginada<T> {
  items: T[];
  cargando: boolean;
  error: unknown;
  /** Quedan más en el servidor. */
  hayMas: boolean;
  /** Se está trayendo la página siguiente (no la primera). */
  cargandoMas: boolean;
  cargarMas: () => void;
  recargar: () => void;
}

/**
 * @param clave     clave de caché; incluir aquí los filtros, o al cambiarlos se
 *                  seguirían acumulando las páginas de la búsqueda anterior
 * @param ruta      construye la URL; recibe el cursor de la página que toca
 */
export function useListaPaginada<T>(
  clave: readonly unknown[],
  ruta: (cursor?: string) => string,
): ListaPaginada<T> {
  const consulta = useInfiniteQuery({
    queryKey: clave,
    queryFn: ({ pageParam }) => get<Pagina<T>>(ruta(pageParam)),
    initialPageParam: undefined as string | undefined,
    // `?? undefined` y no `?? null`: react-query entiende `undefined` como
    // "no hay más" y deja `hasNextPage` en false. Con null seguiría pidiendo.
    getNextPageParam: (ultima) => ultima.nextCursor ?? undefined,
  });

  return {
    items: consulta.data?.pages.flatMap((p) => p.items) ?? [],
    cargando: consulta.isLoading,
    error: consulta.error,
    hayMas: consulta.hasNextPage,
    cargandoMas: consulta.isFetchingNextPage,
    cargarMas: () => void consulta.fetchNextPage(),
    recargar: () => void consulta.refetch(),
  };
}

/**
 * Construye la query de una petición de lista.
 *
 * Deja fuera los filtros vacíos: mandar `busqueda=` es una cadena vacía que el
 * servidor tiene que interpretar, y en varias pantallas ya provocaba que el
 * filtro «todos» se tratara como «los que tienen el campo en blanco».
 */
export function consulta(
  base: Record<string, string | number | undefined>,
  cursor?: string,
): string {
  const p = new URLSearchParams();
  for (const [clave, valor] of Object.entries(base)) {
    if (valor === undefined || valor === '') continue;
    p.set(clave, String(valor));
  }
  if (cursor) p.set('cursor', cursor);
  return p.toString();
}
