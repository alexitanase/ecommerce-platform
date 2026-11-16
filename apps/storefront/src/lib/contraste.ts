/**
 * Contraste de color según WCAG 2.1.
 *
 * Existe porque "se ve bien" no es un criterio: el gris #94a3b8 sobre blanco
 * parece elegante y tiene 2,5:1, la mitad de lo que exige el nivel AA. La
 * diferencia entre cumplir y no cumplir es un número, y este módulo lo calcula.
 *
 * Se usa en dos sitios:
 *
 *  - En las pruebas, para que nadie vuelva a bajar un tono de la paleta sin
 *    enterarse de que deja de ser legible.
 *  - En el editor de marca, para avisar cuando el color elegido por la tienda
 *    no contrasta con el fondo. Cada tienda pone el suyo, así que la paleta
 *    base puede estar impecable y el resultado final no.
 */

/** Umbral AA para texto normal. */
export const AA_TEXTO_NORMAL = 4.5;

/**
 * Umbral AA para texto grande (≥ 24 px, o ≥ 19 px en negrita) y para
 * componentes de interfaz: bordes de campos, iconos, indicadores de foco.
 */
export const AA_TEXTO_GRANDE = 3;

/** Luminancia relativa de un color `#rrggbb`. */
export function luminancia(hex: string): number {
  const limpio = hex.trim().replace('#', '');

  if (!/^[0-9a-f]{6}$/i.test(limpio)) {
    throw new Error(`Color no válido: "${hex}". Se espera #rrggbb.`);
  }

  const canales = [0, 2, 4].map((i) => parseInt(limpio.slice(i, i + 2), 16) / 255);

  // Se linealiza cada canal antes de ponderarlo: el ojo no percibe el brillo
  // de forma lineal, y sin este paso los grises salen mucho mejor de lo que
  // realmente se leen.
  const lineal = canales.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));

  return 0.2126 * (lineal[0] ?? 0) + 0.7152 * (lineal[1] ?? 0) + 0.0722 * (lineal[2] ?? 0);
}

/** Relación de contraste entre dos colores, de 1 (idénticos) a 21 (negro/blanco). */
export function contraste(colorA: string, colorB: string): number {
  const a = luminancia(colorA);
  const b = luminancia(colorB);
  const claro = Math.max(a, b);
  const oscuro = Math.min(a, b);

  return Math.round(((claro + 0.05) / (oscuro + 0.05)) * 100) / 100;
}

/** ¿Pasa el nivel AA para texto normal? */
export function cumpleAA(texto: string, fondo: string): boolean {
  return contraste(texto, fondo) >= AA_TEXTO_NORMAL;
}

/**
 * Elige entre negro y blanco el que mejor se lea sobre un fondo.
 *
 * Hace falta porque el color de marca lo pone cada tienda: con un amarillo, el
 * texto blanco del botón principal desaparece.
 *
 * Con un color que no se puede interpretar devuelve blanco en lugar de fallar:
 * esto se llama al pintar el layout de TODAS las páginas, y un ajuste mal
 * escrito en el panel no puede tumbar la tienda entera.
 */
export function textoSobre(fondo: string): '#ffffff' | '#0f172a' {
  try {
    return contraste('#ffffff', fondo) >= contraste('#0f172a', fondo) ? '#ffffff' : '#0f172a';
  } catch {
    return '#ffffff';
  }
}

/**
 * Color listo para meter dentro de un `<style>`.
 *
 * Los colores de marca se inyectan como variables CSS en el layout, y vienen
 * de un campo de texto del panel. Sin filtrar, quien pueda editar la marca
 * podría escribir `red}</style><script>…` y ejecutar JavaScript en la tienda de
 * todos los visitantes: no es un error de formato, es una inyección.
 *
 * Solo se admite `#rgb` o `#rrggbb`. Cualquier otra cosa —incluidos nombres
 * CSS válidos como "red" o funciones como `rgb()`— se cambia por el valor por
 * defecto: prefiero un color equivocado a un `<style>` abierto.
 */
export function colorSeguro(valor: unknown, porDefecto: string): string {
  return typeof valor === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(valor.trim())
    ? valor.trim()
    : porDefecto;
}
