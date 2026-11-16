/**
 * Cuántos workers hacen falta, según lo que hay en las colas.
 *
 * La profundidad de cola es la señal que se adelanta a todas las demás: la cola
 * empieza a crecer minutos antes de que nadie note nada, mientras que la CPU
 * solo sube cuando el retraso ya es visible. Por eso se escala por aquí y no
 * por carga de máquina.
 *
 * Es lógica pura para poder probarla: una política de autoescalado mal ajustada
 * no da errores, da o bien pedidos que salen con horas de retraso o bien una
 * factura de servidores que nadie mira hasta fin de mes.
 */

export interface EstadoCola {
  cola: string;
  /** Trabajos esperando a que alguien los coja. */
  esperando: number;
  /** Trabajos que se están procesando ahora mismo. */
  activos: number;
}

export interface Recomendacion {
  replicas: number;
  motivo: string;
  /** Trabajos pendientes que han motivado la recomendación. */
  pendientes: number;
}

/**
 * Límites del escalado.
 *
 * `MINIMO` es 1 y no 0 a propósito: bajar a cero significa que el primer
 * pedido de la mañana espera a que arranque un contenedor, y arrancar cuesta
 * más que procesarlo.
 *
 * `MAXIMO` no está para ahorrar: cada réplica abre su propio pool de conexiones
 * a Postgres, así que un techo mal puesto agota `max_connections` y tira la
 * tienda entera intentando ir más rápido. Ver la cuenta en `infra/ESCALADO.md`.
 */
export const MINIMO_REPLICAS = 1;
export const MAXIMO_REPLICAS = 8;

/** Trabajos pendientes que se le supone a cada réplica. */
const TRABAJOS_POR_REPLICA = 50;

/**
 * Trabajos que una réplica puede tener en curso a la vez.
 *
 * Sirve para lo contrario que `TRABAJOS_POR_REPLICA`: no para decidir cuántas
 * levantar, sino cuántas **no** se pueden quitar. Un worker no se apaga a
 * mitad de un trabajo, así que reducir por debajo de lo que hay en curso solo
 * consigue que el orquestador espere a que terminen mientras la cola crece.
 */
const ACTIVOS_POR_REPLICA = 5;

/**
 * Margen para no oscilar.
 *
 * Sin él, una cola que baila alrededor del umbral haría subir y bajar réplicas
 * cada minuto —"flapping"—, y cada arranque tarda más que los trabajos que
 * habría procesado. Se sube deprisa y se baja despacio: quedarse corto retrasa
 * pedidos, quedarse largo cuesta unos céntimos.
 */
const UMBRAL_PARA_BAJAR = 10;

/**
 * Recomienda un número de réplicas de worker.
 *
 * `actuales` importa: la recomendación no es solo una función de la cola, sino
 * de si conviene moverse desde donde se está.
 */
export function replicasRecomendadas(colas: EstadoCola[], actuales: number): Recomendacion {
  const pendientes = colas.reduce((total, c) => total + c.esperando, 0);
  const enCurso = colas.reduce((total, c) => total + c.activos, 0);

  // Nada esperando y nada en curso: al mínimo, pero no a cero.
  if (pendientes === 0 && enCurso === 0) {
    return {
      replicas: MINIMO_REPLICAS,
      pendientes,
      motivo: 'Las colas están vacías',
    };
  }

  // Suelo por trabajo en curso: quitar una réplica que está enviando pedidos a
  // un proveedor no acelera nada, solo alarga el apagado mientras la cola sube.
  const suelo = Math.max(MINIMO_REPLICAS, Math.ceil(enCurso / ACTIVOS_POR_REPLICA));

  const ideal = Math.min(
    MAXIMO_REPLICAS,
    Math.max(suelo, Math.ceil(pendientes / TRABAJOS_POR_REPLICA)),
  );

  if (ideal > actuales) {
    return {
      replicas: ideal,
      pendientes,
      motivo: `${String(pendientes)} trabajos esperando: hacen falta ${String(ideal)} réplicas`,
    };
  }

  // Para bajar, la cola tiene que estar claramente tranquila. Bajar en cuanto
  // el número cuadra provoca subidas y bajadas continuas.
  if (ideal < actuales && pendientes < UMBRAL_PARA_BAJAR) {
    return {
      replicas: ideal,
      pendientes,
      motivo:
        enCurso > 0
          ? `Quedan ${String(pendientes)} en cola y ${String(enCurso)} en curso: se puede bajar a ${String(ideal)}`
          : `Solo quedan ${String(pendientes)} trabajos: se puede bajar a ${String(ideal)}`,
    };
  }

  return {
    replicas: actuales,
    pendientes,
    motivo: 'La capacidad actual es adecuada',
  };
}
