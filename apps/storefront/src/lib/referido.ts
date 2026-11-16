/**
 * Código de invitación de quien recomendó la tienda.
 *
 * Llega en la URL (`?ref=ABCD1234`) y hay que conservarlo hasta el checkout,
 * que casi nunca pasa en la misma visita: se entra desde el enlace, se mira el
 * catálogo, se cierra y se vuelve dos días después. Sin guardarlo, el programa
 * solo premiaría a quien compra en la misma sesión en que llega, que es casi
 * nadie.
 *
 * Va en `localStorage` y no en una cookie a propósito: no se manda al servidor
 * en cada petición, no hace falta consentimiento de cookies para algo que el
 * propio usuario pide al pulsar un enlace de invitación, y caduca solo.
 */

const CLAVE = 'ref';

/** Cuánto se conserva. Un mes es tiempo de sobra para decidir una compra. */
const DIAS = 30;

interface Guardado {
  codigo: string;
  guardadoEl: number;
}

/**
 * Guarda el código si viene en la URL.
 *
 * No se sobrescribe uno que ya estuviera guardado: si alguien entra por el
 * enlace de una persona y luego navega con el de otra, el premio le
 * corresponde a quien lo trajo primero.
 */
export function capturarReferido(busqueda: string): void {
  const codigo = new URLSearchParams(busqueda).get(CLAVE)?.trim().toUpperCase();

  if (!codigo || codigo.length < 4 || codigo.length > 20) return;
  if (!/^[A-Z0-9]+$/.test(codigo)) return;
  if (leerReferido()) return;

  try {
    const dato: Guardado = { codigo, guardadoEl: Date.now() };
    window.localStorage.setItem(CLAVE, JSON.stringify(dato));
  } catch {
    // Navegación privada con almacenamiento bloqueado: se pierde el referido,
    // pero la compra tiene que seguir funcionando igual.
  }
}

/** Código vigente, o null si no hay o ya caducó. */
export function leerReferido(): string | null {
  try {
    const bruto = window.localStorage.getItem(CLAVE);
    if (!bruto) return null;

    const dato = JSON.parse(bruto) as Guardado;
    if (Date.now() - dato.guardadoEl > DIAS * 86_400_000) {
      window.localStorage.removeItem(CLAVE);
      return null;
    }

    return dato.codigo;
  } catch {
    return null;
  }
}

/** Se olvida en cuanto se ha usado en un pedido. */
export function olvidarReferido(): void {
  try {
    window.localStorage.removeItem(CLAVE);
  } catch {
    // Nada que hacer; el código caduca solo.
  }
}
