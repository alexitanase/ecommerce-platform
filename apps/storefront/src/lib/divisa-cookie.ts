/**
 * El nombre de la cookie de divisa, y nada más.
 *
 * Vive en su propio fichero porque lo necesitan los dos lados: el servidor para
 * leerla y el selector —que es de cliente— para escribirla. Tenerlo en
 * `lib/divisas.ts` no funciona: ese módulo importa `next/headers`, que es solo de
 * servidor, así que al importarlo desde el selector el bundle de cliente se
 * envenena y el build falla con un error que apunta al fichero equivocado.
 *
 * Legible desde el navegador a propósito: no hay nada que proteger en «este
 * visitante mira los precios en libras», y el selector tiene que poder ponerla
 * sin dar un viaje al servidor.
 */
export const COOKIE_DIVISA = 'divisa';
