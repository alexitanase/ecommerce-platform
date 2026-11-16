/**
 * Retención de datos personales y derecho de supresión.
 *
 * El derecho de supresión del RGPD (art. 17) **no es absoluto**: el apartado 3
 * exceptúa lo que hay que conservar para cumplir una obligación legal. En una
 * tienda española eso son, sobre todo, las facturas.
 *
 * De ahí el error que este módulo existe para evitar, y que se comete en las
 * dos direcciones:
 *
 *  · **Borrarlo todo** cuando alguien lo pide. Deja a la tienda sin las
 *    facturas que la Agencia Tributaria puede reclamar durante años, y eso es
 *    una infracción tributaria propia.
 *  · **No borrar nada**, escudándose en lo anterior. Conservar la dirección de
 *    envío de un pedido de hace ocho años no lo ampara ninguna obligación, y es
 *    exactamente lo que la AEPD sanciona.
 *
 * La respuesta correcta es por categorías: cada dato tiene su plazo y su base
 * legal, y al cliente hay que **decirle** qué se conserva y por qué (art. 17.3
 * y art. 13). Este módulo calcula eso; ejecutar el plan es cosa del servicio.
 */

export type CategoriaDato =
  | 'CUENTA'
  | 'DIRECCIONES'
  | 'PEDIDOS'
  | 'FACTURAS'
  | 'CONSENTIMIENTOS'
  | 'RESENAS'
  | 'VERIFICACION_EDAD'
  | 'AUDITORIA'
  | 'CARRITOS';

export interface ReglaRetencion {
  categoria: CategoriaDato;
  /** Años que hay que conservarlo. `0` significa que puede borrarse ya. */
  anios: number;
  /** Norma que obliga a conservarlo, o por qué se puede borrar. */
  base: string;
  /**
   * Si el plazo lo fija una obligación legal.
   *
   * Distingue "no puedo borrarlo" de "no me hace falta borrarlo ya": lo primero
   * hay que explicárselo al cliente, lo segundo no debería frenar una supresión
   * si la pide.
   */
  obligatorio: boolean;
}

/**
 * Plazos aplicables en España.
 *
 * Los seis años de la facturación salen del Código de Comercio (art. 30), que
 * es más largo que los cuatro de prescripción tributaria (Ley General
 * Tributaria, art. 66). Se aplica el mayor: cumplir el corto no libra del otro.
 */
export const RETENCIONES: Record<CategoriaDato, ReglaRetencion> = {
  FACTURAS: {
    categoria: 'FACTURAS',
    anios: 6,
    base: 'Código de Comercio art. 30 y Ley General Tributaria art. 66: la documentación contable se conserva seis años.',
    obligatorio: true,
  },
  PEDIDOS: {
    categoria: 'PEDIDOS',
    anios: 6,
    base: 'Respaldan la factura ante una comprobación o una reclamación; se conservan mientras la factura.',
    obligatorio: true,
  },
  VERIFICACION_EDAD: {
    categoria: 'VERIFICACION_EDAD',
    anios: 5,
    base: 'Prueba de haber comprobado la edad en una venta restringida; sin ella no se puede acreditar la diligencia.',
    obligatorio: true,
  },
  CONSENTIMIENTOS: {
    categoria: 'CONSENTIMIENTOS',
    anios: 4,
    base: 'RGPD art. 7.1: hay que poder demostrar que el consentimiento se dio, también después de retirarlo.',
    obligatorio: true,
  },
  AUDITORIA: {
    categoria: 'AUDITORIA',
    anios: 3,
    base: 'Registro de quién hizo qué en la plataforma; es la prueba de la propia diligencia en seguridad.',
    obligatorio: true,
  },
  CUENTA: {
    categoria: 'CUENTA',
    anios: 0,
    base: 'Los datos de la cuenta no tienen plazo propio: se anonimizan en cuanto se pide.',
    obligatorio: false,
  },
  DIRECCIONES: {
    categoria: 'DIRECCIONES',
    anios: 0,
    base: 'La libreta de direcciones es una comodidad, no una obligación: se borra al pedirlo.',
    obligatorio: false,
  },
  RESENAS: {
    categoria: 'RESENAS',
    anios: 0,
    base: 'La reseña puede quedarse publicada, pero disociada de la persona que la escribió.',
    obligatorio: false,
  },
  CARRITOS: {
    categoria: 'CARRITOS',
    anios: 0,
    base: 'Un carrito sin comprar no respalda nada: se borra.',
    obligatorio: false,
  },
};

/** Momento a partir del cual un dato de esta categoría deja de estar retenido. */
export function liberadoEl(categoria: CategoriaDato, creadoEl: Date): Date {
  const regla = RETENCIONES[categoria];
  const fecha = new Date(creadoEl);
  fecha.setFullYear(fecha.getFullYear() + regla.anios);
  return fecha;
}

/** ¿Se puede borrar ya este dato? */
export function puedeBorrarse(
  categoria: CategoriaDato,
  creadoEl: Date,
  ahora = new Date(),
): boolean {
  if (RETENCIONES[categoria].anios === 0) return true;
  return liberadoEl(categoria, creadoEl) <= ahora;
}

export interface ElementoConFecha {
  id: string;
  creadoEl: Date;
}

export interface PlanSupresion {
  /** Se borra o anonimiza ahora. */
  borrarAhora: { categoria: CategoriaDato; ids: string[] }[];
  /** Se conserva; con hasta cuándo y por qué. */
  conservar: {
    categoria: CategoriaDato;
    ids: string[];
    hasta: Date;
    base: string;
  }[];
}

/**
 * Decide qué se borra y qué se conserva ante una solicitud de supresión.
 *
 * Se calcula por elemento y no por categoría: de dos pedidos, el de hace siete
 * años se borra y el del mes pasado no. Tratar la categoría entera como un
 * bloque lleva a conservar de más —lo habitual— o a borrar una factura que aún
 * se debía guardar.
 */
export function planDeSupresion(
  datos: Partial<Record<CategoriaDato, ElementoConFecha[]>>,
  ahora = new Date(),
): PlanSupresion {
  const borrarAhora: PlanSupresion['borrarAhora'] = [];
  const conservar: PlanSupresion['conservar'] = [];

  for (const [clave, elementos] of Object.entries(datos)) {
    const categoria = clave as CategoriaDato;
    if (!elementos || elementos.length === 0) continue;

    const borrables = elementos.filter((e) => puedeBorrarse(categoria, e.creadoEl, ahora));
    const retenidos = elementos.filter((e) => !puedeBorrarse(categoria, e.creadoEl, ahora));

    if (borrables.length > 0) {
      borrarAhora.push({ categoria, ids: borrables.map((e) => e.id) });
    }

    if (retenidos.length > 0) {
      // La fecha que se comunica es la del último en liberarse: es cuando la
      // persona quedará realmente fuera de nuestros sistemas.
      const hasta = retenidos
        .map((e) => liberadoEl(categoria, e.creadoEl))
        .reduce((mayor, f) => (f > mayor ? f : mayor));

      conservar.push({
        categoria,
        ids: retenidos.map((e) => e.id),
        hasta,
        base: RETENCIONES[categoria].base,
      });
    }
  }

  return { borrarAhora, conservar };
}

const NOMBRES: Record<CategoriaDato, string> = {
  CUENTA: 'los datos de tu cuenta',
  DIRECCIONES: 'tus direcciones guardadas',
  PEDIDOS: 'tus pedidos',
  FACTURAS: 'tus facturas',
  CONSENTIMIENTOS: 'el registro de tus consentimientos',
  RESENAS: 'tus reseñas',
  VERIFICACION_EDAD: 'la comprobación de tu edad',
  AUDITORIA: 'el registro de actividad',
  CARRITOS: 'tus carritos sin finalizar',
};

/**
 * Explicación para el cliente.
 *
 * El art. 17.3 obliga a decirle qué se conserva y por qué cuando la supresión
 * no puede ser total. Responder "hecho" a secas y guardar seis años de facturas
 * es una respuesta incompleta, y la incompletitud es lo que se reclama.
 */
export function explicarPlan(plan: PlanSupresion): string {
  const partes: string[] = [];

  if (plan.borrarAhora.length > 0) {
    const lista = plan.borrarAhora.map((b) => NOMBRES[b.categoria]).join(', ');
    partes.push(`Hemos eliminado ${lista}.`);
  }

  for (const c of plan.conservar) {
    const fecha = c.hasta.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    partes.push(
      `Conservamos ${NOMBRES[c.categoria]} hasta el ${fecha} porque la ley nos obliga: ${c.base}`,
    );
  }

  if (partes.length === 0) {
    return 'No conservábamos ningún dato personal tuyo.';
  }

  // Solo si de verdad queda algo. Añadirlo siempre afirmaría que seguimos
  // guardando datos de alguien de quien ya no guardamos ninguno, en el mismo
  // texto con el que se le responde a una solicitud de supresión.
  if (plan.conservar.length > 0) {
    partes.push(
      'Lo que conservamos queda bloqueado: solo se usará para atender un requerimiento legal, ' +
        'nunca para contactarte ni con fines comerciales.',
    );
  }

  return partes.join(' ');
}

/**
 * Fecha límite para responder a una solicitud de derechos.
 *
 * Un mes desde que se recibe (RGPD art. 12.3). Se calcula para poder avisar
 * antes de que venza: pasarse del plazo es en sí mismo la infracción, aunque
 * después se responda bien.
 */
export function plazoDeRespuesta(solicitadoEl: Date): Date {
  const limite = new Date(solicitadoEl);
  limite.setMonth(limite.getMonth() + 1);
  return limite;
}
