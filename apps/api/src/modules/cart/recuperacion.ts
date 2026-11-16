/**
 * Recuperación de carritos abandonados.
 *
 * De cada diez carritos que se llenan, siete se quedan sin pagar. Escribir a
 * quien dejó el suyo a medias es la acción de marketing con mejor retorno de
 * una tienda: el cliente ya eligió, ya puso el email, y muchas veces solo se
 * distrajo.
 *
 * También es la más fácil de convertir en spam. Tres reglas que aquí no se
 * negocian:
 *
 *  1. **Solo con email dado voluntariamente.** El carrito guarda el correo
 *     cuando el cliente lo escribe en el checkout, no antes.
 *  2. **Como mucho tres avisos**, y con horas de por medio. Un cuarto correo
 *     no recupera nada: gana una baja y una marca de spam, que perjudica la
 *     entregabilidad de los correos de pedido, que sí importan.
 *  3. **Nunca después de comprar.** Un aviso de "te dejaste esto" a alguien
 *     que ya pagó parece que se le ha cobrado dos veces, y genera un ticket
 *     de soporte por cada envío.
 *
 * La ventana es corta a propósito: pasada una semana el carrito ya no es un
 * recordatorio útil, es publicidad no pedida (y sin consentimiento previo para
 * marketing, tampoco es legal enviarla).
 */

const HORA = 3600_000;

export interface EtapaRecuperacion {
  etapa: number;
  /** Tiempo desde la última actividad del carrito. */
  trasMs: number;
  /** Si en este aviso se ofrece el cupón configurado. */
  conCupon: boolean;
}

/**
 * Cuándo se escribe y qué se dice.
 *
 * El descuento no va en el primero: la mayoría de los carritos se recuperan
 * solo con el recordatorio, y regalar margen a quien iba a volver de todas
 * formas es tirar dinero. Y quien aprende que esperando llega un cupón, espera
 * siempre.
 */
export const SECUENCIA: EtapaRecuperacion[] = [
  { etapa: 1, trasMs: 1 * HORA, conCupon: false },
  { etapa: 2, trasMs: 24 * HORA, conCupon: true },
  { etapa: 3, trasMs: 72 * HORA, conCupon: true },
];

/** Pasada esta ventana el carrito ya no se toca. */
export const VENTANA_MAXIMA_MS = 7 * 24 * HORA;

/** Espera mínima entre dos avisos, aunque las etapas coincidan. */
export const ESPERA_ENTRE_AVISOS_MS = 12 * HORA;

export interface CarritoRecuperable {
  email: string | null;
  lineas: number;
  lastActivityAt: Date;
  convertedAt: Date | null;
  /** Cuántos avisos se han enviado ya. */
  recoveryStage: number;
  lastRecoveryAt: Date | null;
  /** El cliente pidió no recibir estos avisos. */
  optOut?: boolean;
}

/**
 * Qué aviso toca enviar a este carrito, si es que toca alguno.
 *
 * Devuelve `null` cuando no hay nada que enviar, que es el caso normal: la
 * tarea se ejecuta cada pocos minutos sobre todos los carritos vivos.
 */
export function avisoPendiente(
  carrito: CarritoRecuperable,
  ahora: Date = new Date(),
): EtapaRecuperacion | null {
  if (carrito.convertedAt) return null;
  if (carrito.optOut) return null;
  if (!carrito.email) return null;
  if (carrito.lineas === 0) return null;
  if (carrito.recoveryStage >= SECUENCIA.length) return null;

  const inactivo = ahora.getTime() - carrito.lastActivityAt.getTime();

  // Pasada la ventana no se escribe ni aunque queden etapas: a los diez días
  // el carrito ya no se recuerda y el correo se lee como publicidad.
  if (inactivo > VENTANA_MAXIMA_MS) return null;

  // Dos correos seguidos en la misma ejecución —porque el carrito lleva
  // parado más tiempo que dos etapas juntas— es la forma más rápida de
  // acabar en spam.
  if (carrito.lastRecoveryAt) {
    const desdeElUltimo = ahora.getTime() - carrito.lastRecoveryAt.getTime();
    if (desdeElUltimo < ESPERA_ENTRE_AVISOS_MS) return null;
  }

  const siguiente = SECUENCIA[carrito.recoveryStage];
  if (!siguiente) return null;

  return inactivo >= siguiente.trasMs ? siguiente : null;
}

export interface MetricasRecuperacion {
  /** Carritos a los que se ha escrito al menos una vez. */
  avisados: number;
  /** De ellos, los que acabaron en pedido. */
  recuperados: number;
  /** Porcentaje de recuperación, redondeado. */
  tasa: number;
  /** Facturación de los pedidos que salieron de un carrito avisado. */
  ingresosCents: number;
}

/**
 * Resultado de la campaña.
 *
 * Se mide contra los carritos **avisados**, no contra todos los abandonados:
 * la pregunta que responde es "de a quienes escribimos, ¿cuántos volvieron?",
 * que es lo que decide si la secuencia merece la pena o hay que cambiarla.
 */
export function medirRecuperacion(
  carritos: { recoveryStage: number; convertedAt: Date | null; totalCents: number }[],
): MetricasRecuperacion {
  const avisados = carritos.filter((c) => c.recoveryStage > 0);
  const recuperados = avisados.filter((c) => c.convertedAt !== null);

  return {
    avisados: avisados.length,
    recuperados: recuperados.length,
    tasa: avisados.length > 0 ? Math.round((recuperados.length / avisados.length) * 100) : 0,
    ingresosCents: recuperados.reduce((a, c) => a + c.totalCents, 0),
  };
}
