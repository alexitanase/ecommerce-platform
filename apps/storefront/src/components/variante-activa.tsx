'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * La variante que se está mirando.
 *
 * Existe para resolver un problema concreto: la galería, el precio y el selector
 * son componentes hermanos y ninguno puede ver el estado del otro. Sin esto,
 * elegir «Vino tinto» dejaba la foto del negro en pantalla —y el precio de otra
 * variante—, así que en un producto de once colores con precios entre 18,99 € y
 * 54,99 € el cliente veía un precio que no era el que iba a pagar. Solo cambiaba
 * el del botón.
 *
 * Son dos datos y no uno:
 *
 * - `variante` la elige el selector, y de ella salen el precio y el rótulo.
 * - `foto` es lo que la galería enseña, y la puede cambiar también una miniatura.
 *
 * Separarlos es lo que permite mirar la foto 4 del producto sin que el precio se
 * mueva, y a la vez que elegir un color cambie las dos cosas a la vez. Con un
 * solo dato hay que decidir quién gana y las dos respuestas son malas: o las
 * miniaturas dejan de funcionar en cuanto hay color elegido, o elegir color no
 * cambia la foto.
 *
 * De la foto se guarda la URL y no el índice a propósito: el selector no sabe en
 * qué posición de la galería está esa foto —ni tiene por qué—, y con un índice
 * cualquier reordenación de las imágenes movería la selección a otra foto sin
 * que nada fallara.
 *
 * La ficha sigue renderizándose en el servidor: esto es un proveedor de contexto
 * alrededor, y sus hijos se pintan igual. El valor inicial también lo calcula el
 * servidor, para que el primer pintado ya traiga el precio correcto en lugar de
 * un «desde» que cambia al hidratarse.
 */

export interface VarianteElegida {
  id: string;
  /** Nombre para el rótulo sobre la foto: «Vino tinto», «Rojo · M». */
  nombre: string | null;
  precioCents: number;
  /** Precio de referencia legal, ya validado por el histórico. */
  compareAtCents: number | null;
  descuentoPorcentaje: number | null;
  fotoUrl: string | null;
}

interface Contexto {
  variante: VarianteElegida | null;
  foto: string | null;
  elegirVariante: (v: VarianteElegida) => void;
  verFoto: (url: string) => void;
}

const VarianteActiva = createContext<Contexto>({
  variante: null,
  foto: null,
  elegirVariante: () => undefined,
  verFoto: () => undefined,
});

export function ProveedorVarianteActiva({
  children,
  inicial = null,
}: {
  children: ReactNode;
  inicial?: VarianteElegida | null;
}) {
  const [variante, setVariante] = useState<VarianteElegida | null>(inicial);
  const [foto, setFoto] = useState<string | null>(inicial?.fotoUrl ?? null);

  const elegirVariante = useCallback((v: VarianteElegida) => {
    setVariante(v);
    // Solo si la variante trae foto: las que el proveedor no ilustra deben
    // dejar la que ya se estaba viendo en lugar de vaciar la galería.
    if (v.fotoUrl) setFoto(v.fotoUrl);
  }, []);

  const verFoto = useCallback((url: string) => setFoto(url), []);

  const valor = useMemo<Contexto>(
    () => ({ variante, foto, elegirVariante, verFoto }),
    [variante, foto, elegirVariante, verFoto],
  );

  return <VarianteActiva.Provider value={valor}>{children}</VarianteActiva.Provider>;
}

export function useVarianteActiva(): Contexto {
  return useContext(VarianteActiva);
}
