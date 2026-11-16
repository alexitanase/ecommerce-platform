/**
 * Declaración trimestral de la ventanilla única (modelo 369).
 *
 * Es el modelo con el que se ingresa de una vez el IVA de otros países de la UE
 * sin darse de alta en cada uno. Se presenta **por trimestre natural** y hasta
 * el último día del mes siguiente, y lleva dos apartados que no se mezclan:
 *
 * - **Régimen de la Unión**: ventas a consumidores de otros estados miembros
 *   con mercancía que ya estaba en la UE (nuestro régimen OSS).
 * - **Régimen de importación**: envíos de hasta 150 € que entran de fuera de la
 *   UE con el IVA cobrado en el checkout (IOSS).
 *
 * Dentro de cada apartado va **una línea por país y tipo**: base imponible y
 * cuota. Presentarlo con los importes agregados sin separar por país no es un
 * detalle de formato —el modelo es literalmente el reparto de lo recaudado
 * entre las haciendas de cada estado— y una línea de menos significa que a un
 * país no le llega lo suyo.
 *
 * Aquí solo se agrupa lo ya facturado. Los importes salen de lo que se congeló
 * en cada pedido: recalcularlos ahora daría otro número, porque el umbral y los
 * tipos habrán cambiado desde entonces.
 */

/** Tramo tal y como se guardó en el pedido. */
export interface TramoGuardado {
  tipo: number;
  baseCents: number;
  cuotaCents: number;
}

export interface VentaDeclarable {
  numero: string;
  regimen: string;
  /** País que recauda. Vacío en un pedido con varios regímenes a la vez. */
  paisRecaudador: string;
  tramos: TramoGuardado[];
  /** El tipo aplicado quedó pendiente de confirmar. */
  necesitaRevision: boolean;
}

export interface LineaDeclaracion {
  pais: string;
  tipo: number;
  baseCents: number;
  cuotaCents: number;
  pedidos: number;
}

export interface DeclaracionOss {
  anio: number;
  trimestre: number;
  desde: Date;
  hasta: Date;
  /** Fecha límite de presentación: fin del mes siguiente al trimestre. */
  presentarAntesDe: Date;
  /** Ventas intracomunitarias con IVA de destino. */
  regimenUnion: LineaDeclaracion[];
  /** Importaciones de hasta 150 € con IVA cobrado en el checkout. */
  regimenImportacion: LineaDeclaracion[];
  baseTotalCents: number;
  cuotaTotalCents: number;
  /**
   * Pedidos que no se han podido clasificar solos y hay que mirar a mano.
   *
   * Son los de régimen mixto —parte de la mercancía sale de la UE y parte de
   * fuera— y aquellos cuyo tipo quedó pendiente de confirmar. Se listan en vez
   * de repartirlos a ojo: un importe colocado en el país equivocado es peor que
   * un importe que alguien tiene que revisar, porque nadie se entera.
   */
  aRevisar: { numero: string; motivo: string }[];
}

/** Trimestre natural, en UTC para que no lo mueva el horario de verano. */
export function rangoTrimestre(anio: number, trimestre: number): { desde: Date; hasta: Date } {
  const primerMes = (trimestre - 1) * 3;
  return {
    desde: new Date(Date.UTC(anio, primerMes, 1)),
    // Último instante del trimestre: el día 1 del siguiente menos un
    // milisegundo. Usar "día 30 a las 00:00" dejaría fuera las ventas del
    // último día, que es cuando más se vende en campaña.
    hasta: new Date(Date.UTC(anio, primerMes + 3, 1) - 1),
  };
}

/** Trimestre al que pertenece una fecha. */
export function trimestreDe(fecha: Date): { anio: number; trimestre: number } {
  return { anio: fecha.getUTCFullYear(), trimestre: Math.floor(fecha.getUTCMonth() / 3) + 1 };
}

export function agruparDeclaracion(
  ventas: VentaDeclarable[],
  anio: number,
  trimestre: number,
): DeclaracionOss {
  const { desde, hasta } = rangoTrimestre(anio, trimestre);
  const primerMes = (trimestre - 1) * 3;

  const union = new Map<string, LineaDeclaracion>();
  const importacion = new Map<string, LineaDeclaracion>();
  const aRevisar: { numero: string; motivo: string }[] = [];

  for (const venta of ventas) {
    if (venta.regimen === 'MIXTO' || !venta.paisRecaudador) {
      aRevisar.push({
        numero: venta.numero,
        motivo:
          'Régimen mixto: parte de la mercancía sale de la UE y parte de fuera. Hay que repartir ' +
          'su cuota entre los apartados a mano.',
      });
      continue;
    }

    if (venta.regimen !== 'OSS' && venta.regimen !== 'IOSS') continue;

    if (venta.necesitaRevision) {
      aRevisar.push({
        numero: venta.numero,
        motivo:
          'Lleva productos con tipo reducido en España a los que se ha aplicado el tipo general ' +
          'del país de destino. Confirma el tipo que les corresponde allí.',
      });
    }

    const destino = venta.regimen === 'OSS' ? union : importacion;

    for (const tramo of venta.tramos) {
      // Los tramos al 0 % no van al 369: no hay cuota que repartir y meterlos
      // añadiría líneas de países a los que no se les debe nada.
      if (tramo.tipo <= 0) continue;

      const clave = `${venta.paisRecaudador}·${String(tramo.tipo)}`;
      const linea = destino.get(clave) ?? {
        pais: venta.paisRecaudador,
        tipo: tramo.tipo,
        baseCents: 0,
        cuotaCents: 0,
        pedidos: 0,
      };

      linea.baseCents += tramo.baseCents;
      linea.cuotaCents += tramo.cuotaCents;
      linea.pedidos += 1;
      destino.set(clave, linea);
    }
  }

  const ordenar = (m: Map<string, LineaDeclaracion>): LineaDeclaracion[] =>
    [...m.values()].sort((a, b) => a.pais.localeCompare(b.pais) || b.tipo - a.tipo);

  const lineas = [...union.values(), ...importacion.values()];

  return {
    anio,
    trimestre,
    desde,
    hasta,
    presentarAntesDe: new Date(Date.UTC(anio, primerMes + 4, 1) - 1),
    regimenUnion: ordenar(union),
    regimenImportacion: ordenar(importacion),
    baseTotalCents: lineas.reduce((a, l) => a + l.baseCents, 0),
    cuotaTotalCents: lineas.reduce((a, l) => a + l.cuotaCents, 0),
    aRevisar,
  };
}
