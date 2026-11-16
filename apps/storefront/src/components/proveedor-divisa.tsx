'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { SOLO_EUROS, formatearPrecio, type EstadoDivisa } from '@/lib/divisa-mostrar';

/**
 * La divisa de este visitante, disponible en todo el árbol de cliente.
 *
 * Hace falta un contexto y no un parámetro porque los precios se pintan en once
 * componentes de cliente distintos —la tarjeta de producto, el selector de
 * variante, la lista de deseos, los dos buscadores…— y todos están a varios
 * niveles de profundidad. Pasar la divisa y la tasa de padre en hijo por los once
 * caminos garantiza que el día que se añada el doceavo se olvide, y ese
 * componente enseñaría euros junto a los demás en libras sin que nada fallara.
 *
 * El valor lo calcula el servidor —lee la cookie y pide las tasas— y entra por
 * el layout. Aquí no se pide nada: un `fetch` desde el cliente para saber en qué
 * divisa pintar dejaría los precios parpadeando en cada carga.
 */

const Contexto = createContext<EstadoDivisa>(SOLO_EUROS);

export function ProveedorDivisa({
  estado,
  children,
}: {
  estado: EstadoDivisa;
  children: ReactNode;
}) {
  return <Contexto.Provider value={estado}>{children}</Contexto.Provider>;
}

export function useDivisa(): EstadoDivisa {
  return useContext(Contexto);
}

/**
 * Formatea un importe en la divisa del visitante.
 *
 * Recibe **céntimos de euro**, que es lo único que existe en la base de datos, y
 * devuelve el texto ya convertido y formateado. La conversión en sí está en
 * `lib/divisa-mostrar.ts`, compartida con las páginas de servidor, para que no
 * haya dos versiones de la misma cuenta.
 *
 * En euros no hace nada raro: la tasa es 1 y el importe pasa tal cual.
 */
export function usePrecio(locale: string): (centimosEnEuros: number) => string {
  const estado = useDivisa();

  return (centimosEnEuros: number) => formatearPrecio(centimosEnEuros, locale, estado);
}
