/**
 * Pruebas A/B en la tienda.
 *
 * El reparto lo decide el servidor —es determinista y vive en la API— y aquí
 * solo se hacen dos cosas: mantener un identificador anónimo de navegador y
 * preguntar qué variante toca.
 *
 * El identificador **no es un dato personal ni una cookie de seguimiento**: se
 * genera en el propio navegador, no viaja a ningún tercero, no se cruza con la
 * cuenta y solo sirve para que la misma persona vea siempre la misma versión
 * de la tienda. Sin él, alguien vería el botón de una forma al entrar y de otra
 * al recargar, y lo que mediría el experimento sería el desconcierto.
 */

const CLAVE_VISITANTE = 'vid';

/** Identificador anónimo del navegador, creándolo la primera vez. */
export function visitante(): string | null {
  try {
    const guardado = window.localStorage.getItem(CLAVE_VISITANTE);
    if (guardado) return guardado;

    // 16 bytes en base64url: suficiente para no colisionar y sin nada dentro
    // que diga quién es.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const nuevo = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    window.localStorage.setItem(CLAVE_VISITANTE, nuevo);
    return nuevo;
  } catch {
    // Navegación privada con almacenamiento bloqueado. Sin identificador no
    // hay experimento —se ve la versión por defecto— y la tienda funciona
    // igual, que es lo que importa.
    return null;
  }
}

export interface Asignacion {
  clave: string;
  variante: string;
  valor: unknown;
}

/**
 * Valor de un experimento, o el de por defecto.
 *
 * Se pasa siempre un valor por defecto y se usa cuando el experimento no
 * existe, está parado o la petición falló. Una tienda que se queda sin botón
 * porque no respondió la API de experimentos es mucho peor que una que nunca
 * llegó a probar el texto nuevo.
 */
export function valorDe<T>(asignaciones: Asignacion[], clave: string, porDefecto: T): T {
  const encontrada = asignaciones.find((a) => a.clave === clave);
  return encontrada && encontrada.valor !== undefined && encontrada.valor !== null
    ? (encontrada.valor as T)
    : porDefecto;
}
