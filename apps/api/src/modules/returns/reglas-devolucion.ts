/**
 * Reglas de devolución.
 *
 * La distinción que más se confunde y más cara sale:
 *
 * | | Desistimiento | Falta de conformidad |
 * |---|---|---|
 * | Plazo | 14 días desde la entrega | **3 años** |
 * | Motivo | ninguno | producto defectuoso o no conforme |
 * | Portes de vuelta | los paga el cliente | los paga **el vendedor** |
 * | Remedio | reembolso | reparar, sustituir, rebajar o resolver |
 *
 * Tratar un producto defectuoso como un desistimiento recorta de tres años a
 * catorce días un derecho que no se puede recortar, y le carga al cliente unos
 * portes que no le corresponden. Por eso el motivo no es una etiqueta: decide
 * todo lo demás.
 *
 * Base legal: Real Decreto Legislativo 1/2007, arts. 114-127 ter, tras la
 * reforma de la Ley 7/2021 que subió la garantía de dos a tres años para lo
 * comprado desde el 1 de enero de 2022.
 */

export type MotivoDevolucion =
  | 'DEFECTIVE'
  | 'NOT_AS_DESCRIBED'
  | 'DAMAGED_IN_TRANSIT'
  | 'WRONG_ITEM'
  | 'MISSING_ITEM'
  | 'WITHDRAWAL';

export type Resolucion = 'REPAIR' | 'REPLACE' | 'REFUND' | 'PRICE_REDUCTION' | 'REJECTED';

/** Garantía legal de conformidad: 3 años desde la entrega. */
export const ANIOS_GARANTIA = 3;

/**
 * Durante los dos primeros años se presume que el defecto ya venía de origen.
 *
 * Art. 121: la carga de la prueba es del vendedor. Después, del consumidor.
 * Importa porque decide quién tiene que demostrar qué cuando hay discusión.
 */
export const ANIOS_PRESUNCION = 2;

/** Días para desistir sin motivo. */
export const DIAS_DESISTIMIENTO = 14;

/**
 * Un defecto de transporte hay que comunicarlo pronto: pasado un tiempo no hay
 * forma de distinguir un golpe del transportista de uno del uso. No es un plazo
 * legal cerrado, es lo razonable para poder reclamar al transportista, que a su
 * vez tiene sus propios plazos.
 */
export const DIAS_DANIO_TRANSPORTE = 14;

interface ReglasMotivo {
  /** Días naturales desde la entrega para poder solicitarlo. */
  diasPlazo: number;
  /** Quién paga el envío de vuelta. */
  portesVuelta: 'cliente' | 'vendedor';
  /** El cliente puede exigir estas resoluciones. */
  remedios: Resolucion[];
  /** ¿Vuelve a stock si llega en buen estado? */
  puedeVolverAStock: boolean;
}

const REGLAS: Record<MotivoDevolucion, ReglasMotivo> = {
  // ── Garantía legal ──
  DEFECTIVE: {
    diasPlazo: ANIOS_GARANTIA * 365,
    // Art. 118: la puesta en conformidad es gratuita para el consumidor, y eso
    // incluye los gastos de envío. Cobrárselos es cobrarle por un fallo nuestro.
    portesVuelta: 'vendedor',
    remedios: ['REPAIR', 'REPLACE', 'REFUND', 'PRICE_REDUCTION'],
    // Un producto defectuoso no vuelve al catálogo: revenderlo sabiendo que
    // falla es entregar a sabiendas un producto no conforme.
    puedeVolverAStock: false,
  },
  NOT_AS_DESCRIBED: {
    diasPlazo: ANIOS_GARANTIA * 365,
    portesVuelta: 'vendedor',
    remedios: ['REPLACE', 'REFUND', 'PRICE_REDUCTION'],
    // Sí vuelve: el producto está bien, lo que estaba mal era la ficha.
    puedeVolverAStock: true,
  },
  WRONG_ITEM: {
    diasPlazo: ANIOS_GARANTIA * 365,
    portesVuelta: 'vendedor',
    remedios: ['REPLACE', 'REFUND'],
    puedeVolverAStock: true,
  },
  MISSING_ITEM: {
    diasPlazo: ANIOS_GARANTIA * 365,
    portesVuelta: 'vendedor',
    // No hay nada que devolver: o se manda lo que falta o se reembolsa.
    remedios: ['REPLACE', 'REFUND'],
    puedeVolverAStock: false,
  },
  DAMAGED_IN_TRANSIT: {
    diasPlazo: DIAS_DANIO_TRANSPORTE,
    portesVuelta: 'vendedor',
    remedios: ['REPLACE', 'REFUND'],
    puedeVolverAStock: false,
  },

  // ── Desistimiento ──
  WITHDRAWAL: {
    diasPlazo: DIAS_DESISTIMIENTO,
    // Art. 108.1: los portes de devolución son del consumidor, siempre que se
    // le haya informado antes de comprar. Si no se le informó, los pagamos.
    portesVuelta: 'cliente',
    remedios: ['REFUND'],
    puedeVolverAStock: true,
  },
};

export function reglasDe(motivo: MotivoDevolucion): ReglasMotivo {
  return REGLAS[motivo];
}

/** Fecha límite para solicitar la devolución por este motivo. */
export function fechaLimite(motivo: MotivoDevolucion, entregadoEn: Date | null): Date | null {
  if (!entregadoEn) return null;

  const limite = new Date(entregadoEn);
  limite.setDate(limite.getDate() + reglasDe(motivo).diasPlazo);
  limite.setHours(23, 59, 59, 999);

  return limite;
}

export function enPlazo(
  motivo: MotivoDevolucion,
  entregadoEn: Date | null,
  ahora = new Date(),
): boolean {
  const limite = fechaLimite(motivo, entregadoEn);
  // Sin entrega registrada el plazo no ha empezado: si el paquete no ha
  // llegado, mal puede haber vencido el plazo para devolverlo.
  if (!limite) return true;
  return ahora.getTime() <= limite.getTime();
}

/**
 * ¿Tiene el vendedor la carga de la prueba?
 *
 * Los dos primeros años se presume que el defecto ya existía en la entrega, así
 * que somos nosotros quienes tenemos que demostrar lo contrario. Pasados esos
 * dos años, le toca al cliente demostrar que venía de fábrica.
 */
export function cargaDeLaPruebaDelVendedor(entregadoEn: Date | null, ahora = new Date()): boolean {
  if (!entregadoEn) return true;

  const limite = new Date(entregadoEn);
  limite.setFullYear(limite.getFullYear() + ANIOS_PRESUNCION);

  return ahora.getTime() <= limite.getTime();
}

/**
 * ¿Se puede aplicar esta resolución a este motivo?
 *
 * Evita, por ejemplo, ofrecer "reparación" en un desistimiento —donde el
 * cliente tiene derecho a su dinero y punto— o una rebaja de precio en un
 * artículo equivocado.
 */
export function resolucionValida(motivo: MotivoDevolucion, resolucion: Resolucion): boolean {
  if (resolucion === 'REJECTED') return true;
  return reglasDe(motivo).remedios.includes(resolucion);
}

/**
 * Quién paga el envío de vuelta.
 *
 * @param seInformoDePortes si se avisó antes de comprar de que en un
 *   desistimiento los portes son del cliente. Si no se le informó, los asume
 *   el vendedor (art. 108.1).
 */
export function quienPagaPortes(
  motivo: MotivoDevolucion,
  seInformoDePortes = true,
): 'cliente' | 'vendedor' {
  const reglas = reglasDe(motivo);

  if (motivo === 'WITHDRAWAL' && !seInformoDePortes) return 'vendedor';

  return reglas.portesVuelta;
}

/**
 * ¿Vuelve la unidad al stock?
 *
 * Depende del motivo y del estado en que llegue. Devolver al catálogo algo que
 * el cliente devolvió por defectuoso solo traslada el problema al siguiente.
 */
export function vuelveAStock(motivo: MotivoDevolucion, estadoRecibido: string | null): boolean {
  if (!reglasDe(motivo).puedeVolverAStock) return false;

  // Solo si llegó como salió. Cualquier otra cosa exige decisión humana.
  return estadoRecibido === 'nuevo' || estadoRecibido === 'perfecto';
}
