/**
 * Si la conexión SMTP va cifrada desde el primer byte o empieza en claro.
 *
 * Son dos formas distintas de hacer lo mismo y no se pueden mezclar:
 *
 *  · **TLS implícito (puerto 465).** El servidor espera un saludo de TLS nada
 *    más aceptar la conexión. Es lo que usan casi todos los buzones de correo
 *    de toda la vida.
 *  · **STARTTLS (puertos 587 y 25).** La conversación empieza en claro y se
 *    cifra a mitad, con un `STARTTLS`. Es lo que usan casi todos los servicios
 *    de envío masivo.
 *
 * Equivocarse **no da un error**: da un plantón. Cada lado se queda esperando a
 * que hable el otro, y a los treinta segundos la librería corta con
 * «Greeting never received». Que el síntoma sea un tiempo de espera agotado es
 * justo lo que despista, porque parece un cortafuegos o un servidor caído, y se
 * pierde media tarde mirando la red mientras el mismo buzón funciona sin
 * problemas desde el móvil.
 *
 * Por eso el puerto manda sobre la casilla del panel en los dos puertos
 * estándar: no es una preferencia que se pueda elegir mal, es cómo funciona el
 * protocolo. En un puerto raro no hay forma de saberlo, así que ahí sí decide
 * quien configura.
 */

/** El puerto de TLS implícito. Ahí NUNCA vale empezar en claro. */
export const PUERTO_TLS_IMPLICITO = 465;

/** Los puertos de STARTTLS. Ahí NUNCA vale saludar con TLS. */
const PUERTOS_STARTTLS = [587, 25];

export function conexionCifrada(port: number, elegido: boolean): boolean {
  if (port === PUERTO_TLS_IMPLICITO) return true;
  if (PUERTOS_STARTTLS.includes(port)) return false;
  return elegido;
}

/**
 * Por qué ha fallado la conexión, dicho para quien tiene que arreglarlo.
 *
 * El mensaje de la librería es correcto y no ayuda: «Greeting never received»
 * no le dice a nadie qué casilla tocar. Aquí se traduce a las dos causas que lo
 * explican casi siempre, en orden de probabilidad.
 */
export function explicarFallo(error: unknown, host: string, port: number): string {
  const mensaje = error instanceof Error ? error.message : 'Sin conexión';
  const codigo = (error as { code?: string } | null)?.code ?? '';

  const esPlanton = codigo === 'ETIMEDOUT' || /greeting|timeout|timed out/i.test(mensaje);
  if (!esPlanton) return mensaje;

  return (
    `${mensaje}. El servidor ${host} no ha llegado a saludar en el puerto ${String(port)}: ` +
    'o el cortafuegos del servidor no deja salir por ese puerto, o el puerto y el cifrado no ' +
    'se corresponden (el 465 va con TLS y el 587 con STARTTLS). Comprueba lo primero desde ' +
    'la máquina donde corre la API.'
  );
}
