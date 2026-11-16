/**
 * Ciclo de vida de una creatividad.
 *
 * Se declara aquí, en una tabla pura, y no repartido en condicionales dentro
 * del servicio: un estado al que se puede llegar por un camino no previsto es
 * el tipo de error que no da excepción, solo deja una pieza publicada que nadie
 * aprobó.
 *
 * La regla que sostiene todo lo demás: **nada se publica sin pasar por
 * aprobada**. Con creatividades generadas por un modelo esto no es burocracia
 * —un generativo produce de vez en cuando algo impublicable— y el sitio de
 * descubrirlo no es la cola de revisión de la red de anuncios.
 */

export const ESTADOS_CREATIVIDAD = [
  'BORRADOR',
  'EN_REVISION',
  'APROBADA',
  'PUBLICADA',
  'ARCHIVADA',
] as const;

export type EstadoCreatividad = (typeof ESTADOS_CREATIVIDAD)[number];

export const TRANSICIONES: Record<EstadoCreatividad, EstadoCreatividad[]> = {
  BORRADOR: ['EN_REVISION', 'ARCHIVADA'],
  // Volver a borrador es rechazar: se devuelve para retocar, no se tira.
  EN_REVISION: ['APROBADA', 'BORRADOR', 'ARCHIVADA'],
  APROBADA: ['PUBLICADA', 'BORRADOR', 'ARCHIVADA'],
  // Editar algo publicado lo devuelve a borrador: lo que está corriendo en la
  // red es el archivo exportado, y el documento ya no coincide con él.
  PUBLICADA: ['BORRADOR', 'ARCHIVADA'],
  ARCHIVADA: ['BORRADOR'],
};

export const puedeTransitar = (desde: EstadoCreatividad, hasta: EstadoCreatividad): boolean =>
  TRANSICIONES[desde].includes(hasta);

/** Mensaje para cuando la transición no está permitida. */
export function motivoRechazo(desde: EstadoCreatividad, hasta: EstadoCreatividad): string {
  if (desde === hasta) return `La creatividad ya está en «${etiqueta(hasta)}».`;
  if (hasta === 'PUBLICADA' && desde !== 'APROBADA') {
    return 'Una creatividad solo se publica desde «Aprobada»: primero tiene que revisarla alguien.';
  }
  return `No se puede pasar de «${etiqueta(desde)}» a «${etiqueta(hasta)}».`;
}

const ETIQUETAS: Record<EstadoCreatividad, string> = {
  BORRADOR: 'Borrador',
  EN_REVISION: 'En revisión',
  APROBADA: 'Aprobada',
  PUBLICADA: 'Publicada',
  ARCHIVADA: 'Archivada',
};

export const etiqueta = (estado: EstadoCreatividad): string => ETIQUETAS[estado];
