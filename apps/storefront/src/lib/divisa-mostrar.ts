import { DIVISA_BASE, convertirImporte } from '@ecom/shared';
import { precio } from './formato';

/**
 * Convertir y formatear un precio, sin depender de dónde se pinte.
 *
 * Vive aparte porque lo necesitan los dos lados y ninguno puede importar al
 * otro: `lib/divisas.ts` lee la cookie con `next/headers` y es solo de servidor,
 * y `componentes/proveedor-divisa.tsx` es de cliente. Con la lógica en
 * cualquiera de los dos, el otro acabaría con una copia, y dos copias de una
 * conversión de precios divergen: la de la ficha diría 21,41 £ y la del carrito
 * 21,40 £ por el mismo producto.
 */

export interface EstadoDivisa {
  /** La que se está usando para mostrar. */
  actual: string;
  /** Todas las que se pueden elegir, incluida la base. */
  disponibles: string[];
  /** Unidades por euro. `1` cuando se muestra en euros. */
  tasa: number;
}

/** El estado de salida, y también el de cuando algo falla. */
export const SOLO_EUROS: EstadoDivisa = {
  actual: DIVISA_BASE,
  disponibles: [DIVISA_BASE],
  tasa: 1,
};

/**
 * Un importe en **céntimos de euro**, en la divisa del visitante.
 *
 * Recibe siempre euros porque es lo único que existe en la base de datos.
 * Sustituye a llamar a `precio()` a pelo: esa función formatea en la divisa que
 * se le diga y no sabe convertir, así que usarla directamente enseñaría el
 * número de euros con el símbolo de la libra delante, que es el peor de los
 * errores posibles aquí —parece un precio correcto y no lo es—.
 *
 * Si la conversión no sale se enseña el precio de verdad, en euros. Nunca un
 * cero ni un guion: el visitante tiene que poder saber cuánto cuesta.
 */
export function formatearPrecio(
  centimosEnEuros: number,
  locale: string,
  estado: EstadoDivisa,
): string {
  if (estado.actual === DIVISA_BASE) return precio(centimosEnEuros, locale, DIVISA_BASE);

  const convertido = convertirImporte(centimosEnEuros, estado.tasa, estado.actual);
  if (convertido === null) return precio(centimosEnEuros, locale, DIVISA_BASE);

  return precio(convertido, locale, estado.actual);
}
