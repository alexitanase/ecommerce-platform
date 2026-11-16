/**
 * Preparación del texto antes de mandarlo a traducir.
 *
 * Las fichas de los proveedores no son prosa: son títulos de 200 caracteres
 * llenos de palabras clave, descripciones con tablas de medidas y bloques
 * enteros en mayúsculas. Mandarlas tal cual sale caro —se paga por carácter— y
 * vuelve peor de lo que fue.
 *
 * Aquí se decide qué se manda, en qué trozos y qué se deja como está.
 */

/**
 * Tamaño máximo de cada envío.
 *
 * DeepL admite peticiones bastante mayores, pero con trozos grandes un fallo
 * obliga a repetir todo el bloque y se paga dos veces. 2.000 caracteres es un
 * equilibrio razonable: la mayoría de descripciones caben en uno o dos.
 */
export const MAXIMO_POR_ENVIO = 2000;

/**
 * Parte un texto en trozos que quepan en una petición.
 *
 * Se corta por párrafos y, si un párrafo no cabe, por frases. Nunca por la
 * mitad de una palabra: un traductor que recibe "…la cremall" y "era es de
 * metal" devuelve dos frases sin sentido, y al unirlas queda una descripción
 * que no dice nada.
 */
export function trocear(texto: string, maximo = MAXIMO_POR_ENVIO): string[] {
  const limpio = texto.trim();
  if (limpio.length === 0) return [];
  if (limpio.length <= maximo) return [limpio];

  const trozos: string[] = [];
  let actual = '';

  const empujar = () => {
    if (actual.trim().length > 0) trozos.push(actual.trim());
    actual = '';
  };

  for (const parrafo of limpio.split(/\n{2,}/)) {
    if (parrafo.length > maximo) {
      empujar();

      // Párrafo enorme: se parte por frases, conservando el punto.
      for (const frase of parrafo.split(/(?<=[.!?])\s+/)) {
        if (actual.length + frase.length + 1 > maximo) empujar();

        // Una sola frase más larga que el límite (listas separadas por comas,
        // típicas de las fichas): se parte por palabras como último recurso.
        if (frase.length > maximo) {
          empujar();
          let linea = '';
          for (const palabra of frase.split(' ')) {
            if (linea.length + palabra.length + 1 > maximo) {
              trozos.push(linea.trim());
              linea = '';
            }
            linea += `${palabra} `;
          }
          actual = linea;
          continue;
        }

        actual += `${frase} `;
      }

      empujar();
      continue;
    }

    if (actual.length + parrafo.length + 2 > maximo) empujar();
    actual += `${parrafo}\n\n`;
  }

  empujar();
  return trozos;
}

/**
 * Proporción mínima de letras para considerar que un texto es lenguaje.
 *
 * "SKU-99201-B" tiene un 36 % de letras; "Boots", el 100 %. El corte en 40 %
 * separa las referencias y las medidas de los títulos cortos de verdad, que
 * sí hay que traducir.
 */
const PROPORCION_MINIMA_DE_LETRAS = 0.4;

/**
 * ¿Merece la pena traducir este texto?
 *
 * Se paga por carácter, así que no se manda lo que no va a mejorar:
 *
 * - Vacío o casi: un título de dos letras no es una frase.
 * - Con más código que palabras: referencias, medidas y tallas ("XL-42 /
 *   3.5mm", "SKU-99201-B"). Traducidos quedan igual, o peor.
 *
 * Pedir solo "tres letras seguidas" no basta: "SKU-99201-B" las tiene y no es
 * lenguaje. Hace falta además que las letras sean la mayor parte del texto.
 *
 * No se intenta adivinar el idioma. Los títulos de proveedor mezclan inglés y
 * chino en la misma línea, y cualquier detector se equivoca lo bastante como
 * para dejar sin traducir justo lo que hacía falta.
 */
export function mereceTraducirse(texto: string | null | undefined): boolean {
  if (!texto) return false;

  const limpio = texto.trim();
  if (limpio.length < 3) return false;
  if (!/\p{L}{3,}/u.test(limpio)) return false;

  const sinEspacios = limpio.replace(/\s/g, '');
  const letras = [...sinEspacios].filter((c) => /\p{L}/u.test(c)).length;

  return letras / sinEspacios.length >= PROPORCION_MINIMA_DE_LETRAS;
}

/**
 * Cuántos caracteres costaría traducir esto.
 *
 * Sirve para avisar antes de lanzar una importación masiva: mil fichas a 1.500
 * caracteres son 1,5 millones, tres veces el plan gratuito de DeepL.
 */
export function costeEnCaracteres(textos: (string | null | undefined)[]): number {
  return textos
    .filter((t) => mereceTraducirse(t))
    .reduce((suma, t) => suma + (t ?? '').trim().length, 0);
}

/**
 * Slug a partir del título traducido.
 *
 * Cada idioma tiene el suyo —/es/botas-de-cuero y /en/leather-boots— porque es
 * lo que busca la gente en cada mercado. Se le añade el sufijo del original
 * para no chocar con el de otro producto: el slug es único por idioma en la
 * base de datos, y dos fichas de proveedor con el mismo título son lo normal.
 */
export function slugTraducido(titulo: string, sufijo: string): string {
  const base = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return base ? `${base}-${sufijo}` : sufijo;
}
