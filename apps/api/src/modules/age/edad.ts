/**
 * Cálculo de la mayoría de edad.
 *
 * Separado del servicio porque es la regla que decide si alguien accede o no a
 * un catálogo restringido, y equivocarse por un año es dejar entrar a un menor.
 */

/** Edad mínima para el catálogo +18 en España. */
export const EDAD_MINIMA = 18;

/**
 * Cuánto vale una verificación antes de volver a preguntar.
 *
 * No es para siempre: un ordenador compartido, un móvil prestado o un
 * ordenador familiar quedarían verificados indefinidamente. Treinta días es el
 * equilibrio entre no molestar en cada visita y no dejar la puerta abierta.
 */
export const DIAS_VALIDEZ = 30;

/**
 * ¿El año de nacimiento declarado da la mayoría de edad?
 *
 * Se compara solo por año a propósito. Guardar la fecha completa sería recoger
 * un dato personal más preciso del necesario, y el margen que se pierde —quien
 * cumple 18 este año pero aún no los ha cumplido— juega a favor del menor: se
 * le deja pasar solo si el año garantiza que ya los tiene cumplidos o los
 * cumple durante el año en curso.
 *
 * Es deliberadamente el criterio más restrictivo posible con solo el año.
 */
export function esMayorDeEdad(anioNacimiento: number, ahora = new Date()): boolean {
  if (!Number.isInteger(anioNacimiento)) return false;

  const anioActual = ahora.getFullYear();

  // Un año imposible es un intento de saltarse la comprobación, no un error.
  if (anioNacimiento > anioActual || anioNacimiento < anioActual - 120) return false;

  return anioActual - anioNacimiento >= EDAD_MINIMA;
}

/** Años cumplidos como mínimo, según el año declarado. */
export function edadMinimaSegunAnio(anioNacimiento: number, ahora = new Date()): number {
  return Math.max(0, ahora.getFullYear() - anioNacimiento - 1);
}

export function caducidadVerificacion(desde = new Date()): Date {
  const limite = new Date(desde);
  limite.setDate(limite.getDate() + DIAS_VALIDEZ);
  return limite;
}

/** ¿Sigue vigente una verificación? */
export function verificacionVigente(expiraEn: Date | null, ahora = new Date()): boolean {
  if (!expiraEn) return false;
  return expiraEn.getTime() > ahora.getTime();
}

/**
 * Año mínimo y máximo que tiene sentido aceptar en el formulario.
 *
 * El máximo evita que alguien escriba un año futuro; el mínimo, que se
 * declaren 130 años para probar si la validación existe.
 */
export function rangoAniosValido(ahora = new Date()): { min: number; max: number } {
  const anio = ahora.getFullYear();
  return { min: anio - 120, max: anio };
}
