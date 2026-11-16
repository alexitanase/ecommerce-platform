import { useCallback, useState } from 'react';

/**
 * Estado de la vista reflejado en la URL.
 *
 * Lo que se ve en pantalla —el rango de fechas, el filtro de estado, la
 * búsqueda, la pestaña abierta— tiene que poder pegarse en un chat y abrirse
 * igual al otro lado. Sin esto, «mira los pedidos de Francia bloqueados» son
 * cinco clics de instrucciones, y la mitad de las veces el otro acaba mirando
 * otra cosa.
 *
 * Detalles que importan:
 *
 *  · Se escribe con `replaceState`, no `pushState`: teclear en un buscador no
 *    puede generar veinte entradas en el historial que haya que deshacer una a
 *    una con el botón atrás.
 *  · Los valores vacíos se borran de la URL en vez de quedarse como `estado=`,
 *    que ensucia el enlace y en varias pantallas el servidor interpretaba como
 *    «los que tienen el campo en blanco».
 *  · El estado inicial se lee de la URL al montar, que es lo que hace que un
 *    enlace compartido abra la vista correcta.
 */
export function useEstadoUrl<T extends Record<string, string | undefined>>(
  inicial: T,
): [T, (parcial: Partial<T>) => void] {
  const [estado, setEstado] = useState<T>(() => {
    const params = new URLSearchParams(window.location.search);
    const leido = { ...inicial };
    for (const clave of Object.keys(inicial)) {
      const valor = params.get(clave);
      if (valor !== null) (leido as Record<string, string | undefined>)[clave] = valor;
    }
    return leido;
  });

  const actualizar = useCallback((parcial: Partial<T>) => {
    setEstado((anterior) => {
      const siguiente = { ...anterior, ...parcial };

      const params = new URLSearchParams(window.location.search);
      for (const [clave, valor] of Object.entries(siguiente)) {
        if (valor === undefined || valor === '') params.delete(clave);
        else params.set(clave, String(valor));
      }

      const query = params.toString();
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}`,
      );

      return siguiente;
    });
  }, []);

  return [estado, actualizar];
}

/** URL completa de la vista actual, para el botón de copiar enlace. */
export function urlDeLaVista(): string {
  return window.location.href;
}
