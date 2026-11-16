/**
 * Limita cuánto puede tardar una promesa.
 *
 * Necesario en las sondas de salud: el cliente de Redis se configura con
 * `maxRetriesPerRequest: null` porque BullMQ lo exige, y eso hace que un
 * comando espere indefinidamente si Redis no responde. Sin este límite, la
 * sonda de disponibilidad se queda colgada en lugar de contestar "down", que
 * es justo lo contrario de lo que necesita un balanceador para reaccionar.
 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`La operación ha superado el límite de ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;

  const limite = new Promise<never>((_, reject) => {
    temporizador = setTimeout(() => reject(new TimeoutError(ms)), ms);
    // No impide que el proceso termine si es lo único pendiente.
    temporizador.unref?.();
  });

  try {
    return await Promise.race([promise, limite]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}
