import { addTax, extractBase, psychologicalRound, type Cents } from '@ecom/shared';

/**
 * Margen y PVP, contados sobre lo que de verdad entra en caja.
 *
 * El fallo que hay detrás de este fichero costó dinero de verdad. En España el
 * precio que se enseña lleva el IVA incluido, así que `priceCents` es un precio
 * BRUTO; el coste del proveedor, en cambio, es lo que se paga y punto. Restar
 * uno del otro y dividir por el bruto no es un margen: es un margen más el IVA,
 * que no es nuestro sino de Hacienda.
 *
 * Con números reales del catálogo, un artículo que costaba 13,99 € se puso a
 * 18,99 € «con un 26 % de margen»:
 *
 *   · Lo que decía el panel:  (18,99 − 13,99) / 18,99 = 26 %
 *   · Lo que quedaba de verdad: 18,99 lleva 3,30 € de IVA. Ingreso 15,69 €,
 *     coste 13,99 € → 1,70 €, un **10,8 %**. Y con la comisión de la pasarela y
 *     el porte del proveedor, por debajo de cero.
 *
 * El engaño no depende del régimen del pedido. Si la venta lleva IVA español,
 * se cobran 18,99 y se devuelven 3,30. Si va exenta —una importación sin IOSS,
 * que es el caso normal aquí— el cliente paga los 15,69 directamente. En los
 * dos casos entran los mismos 15,69 €: la base imponible. Por eso es la base, y
 * no el precio de escaparate, lo que hay que comparar con el coste.
 *
 * Regla, entonces: **el margen se mide sobre la base y el PVP se calcula
 * añadiendo el IVA al final**, nunca al revés.
 */

/**
 * Lo que cuesta DE VERDAD poner un artículo en manos del cliente.
 *
 * Cuatro sumandos, y los cuatro se han olvidado alguna vez:
 *
 *  1. El precio del artículo, que es lo único que dice la API del proveedor.
 *  2. Su porte, si no se le cobra aparte al cliente.
 *  3. **Lo que el proveedor añade al pagar y no aparece en ninguna consulta**,
 *     en porcentaje: los cargos de importación que recauda él.
 *  4. **El cargo fijo por categoría** de las importaciones de bajo valor.
 *
 * El tercero es el que costó dinero. Un pedido real: la ficha de AliExpress
 * cotizaba 13,99 €, y al pagar el cargo fue de 16,89 € —15,37 $ de artículo más
 * 4,09 $ de «cargos de importación estimados», que es el IVA de entrada en la
 * UE que ellos recaudan—. Se vendió por 15,69 €. Pérdida de 1,20 € por unidad,
 * con el panel diciendo que había un 26 % de margen.
 *
 * El cuarto no escala con el precio y por eso va aparte y en euros: tres euros
 * son un 5 % sobre un artículo de 60 € y un 21 % sobre uno de 14 €. Modelarlo
 * como porcentaje daría bien la media y mal todos los casos.
 *
 * El porcentaje se aplica sobre artículo + porte —los cargos de importación se
 * calculan sobre el valor del envío completo— y el cargo fijo se suma después,
 * porque es una tasa de gestión y no parte del valor declarado.
 */
export interface PartesDelCoste {
  costCents: Cents;
  envioCents?: Cents;
  /**
   * El cargo fijo, ya decidido por quien llama.
   *
   * Se pasa resuelto y no como «el del proveedor» porque quién lo paga depende
   * del pedido: es por categoría, así que dos artículos de la misma categoría
   * en un mismo envío pagan uno solo. Al poner precio se cuenta entero en cada
   * artículo —el pedido típico lleva una unidad— y al cerrar un pedido real se
   * reparte de verdad.
   */
  cargoFijoCents?: Cents;
}

export function costeDeCompra(partes: PartesDelCoste, recargoPct = 0): Cents {
  const base = partes.costCents + (partes.envioCents ?? 0);
  return Math.round(base * (1 + recargoPct / 100)) + (partes.cargoFijoCents ?? 0);
}

/**
 * El cargo fijo que le toca a un artículo según lo que cuesta el envío.
 *
 * Por encima del umbral no se aplica: ese envío entra por el régimen general,
 * con aranceles y gastos de gestión del transportista, que son otra cosa y no
 * se calculan aquí.
 */
export function cargoFijoAplicable(
  valorDelEnvioCents: Cents,
  reglas: { importeCents: number; umbralCents: number },
): Cents {
  if (reglas.importeCents <= 0) return 0;
  return valorDelEnvioCents < reglas.umbralCents ? reglas.importeCents : 0;
}

export interface MargenReal {
  /** Lo que entra en caja: el PVP sin el IVA que hay que ingresar a Hacienda. */
  ingresoCents: Cents;
  /** Lo que cuesta traerlo: artículo más porte del proveedor. */
  costeCents: Cents;
  /** Ingreso menos coste. Antes de comisiones de pasarela. */
  margenCents: Cents;
  /** El de antes sobre el ingreso, en puntos porcentuales. */
  porcentaje: number;
  /** Multiplicador sobre el coste (markup). */
  multiplicador: number;
}

/**
 * El margen de vender algo a `pvpConIva` habiéndolo comprado por `costeCents`.
 *
 * `taxRate` es el tipo del producto, no el del pedido: un pedido exento paga la
 * base, que es justo lo que se está comparando.
 */
export function margenDeVenta(pvpConIva: Cents, costeCents: Cents, taxRate: number): MargenReal {
  const ingreso = extractBase(pvpConIva, taxRate);
  const margen = ingreso - costeCents;

  return {
    ingresoCents: ingreso,
    costeCents,
    margenCents: margen,
    porcentaje: ingreso > 0 ? Math.round((margen / ingreso) * 100) : 0,
    multiplicador: costeCents > 0 ? Math.round((ingreso / costeCents) * 100) / 100 : 0,
  };
}

export interface ParametrosPvp {
  costeCents: Cents;
  /** Lo que el proveedor cobra de porte, si no se repercute aparte. */
  envioCents?: Cents;
  /** Lo que el proveedor añade al pagar y su API no dice. Ver `costeDeCompra`. */
  recargoPct?: number;
  /** El cargo fijo por categoría de las importaciones de bajo valor. */
  cargoFijoCents?: Cents;
  /** Margen que se quiere sobre la base, en porcentaje. */
  margenObjetivo: number;
  /** Tipo de IVA del producto. */
  taxRate: number;
  redondear?: boolean;
  terminacion?: number;
  /** Nunca vender por debajo de este margen, aunque el redondeo lo baje. */
  margenMinimo?: number;
}

export interface ResultadoPvp {
  /** Precio de escaparate, con IVA incluido. */
  pvpCents: Cents;
  /** Base imponible de ese precio: lo que se ingresa. */
  baseCents: Cents;
  /** Lo que cuesta comprarlo: artículo, porte y recargo del proveedor. */
  costeCompraCents: Cents;
  /** Margen que queda de verdad tras redondear, sobre la base. */
  margenReal: number;
  aviso?: string;
}

/**
 * El PVP que hace falta para quedarse con `margenObjetivo` sobre la base.
 *
 * El orden importa: primero se calcula la base que deja el margen, luego se le
 * añade el IVA y solo entonces se redondea. Redondear la base y sumar el IVA
 * después da precios de escaparate como 22,87 €, que es justo lo que el
 * redondeo psicológico existe para evitar.
 */
export function pvpParaMargen(parametros: ParametrosPvp): ResultadoPvp {
  const {
    costeCents,
    envioCents = 0,
    recargoPct = 0,
    cargoFijoCents = 0,
    margenObjetivo,
    taxRate,
    redondear = true,
    terminacion = 99,
    margenMinimo,
  } = parametros;

  const costeTotal = costeDeCompra(
    { costCents: costeCents, envioCents, cargoFijoCents },
    recargoPct,
  );

  if (margenObjetivo >= 100) {
    return {
      pvpCents: addTax(costeTotal, taxRate),
      baseCents: costeTotal,
      costeCompraCents: costeTotal,
      margenReal: 0,
      aviso: 'El margen objetivo debe ser menor que 100%',
    };
  }

  // margen = (base − coste) / base  →  base = coste / (1 − margen)
  const base = Math.round(costeTotal / (1 - margenObjetivo / 100));
  const conIva = addTax(base, taxRate);
  const pvp = redondear ? psychologicalRound(conIva, terminacion) : conIva;

  // Sobre el precio REDONDEADO, que es el que se va a cobrar. El redondeo solo
  // sube, así que el margen real nunca queda por debajo del objetivo por su
  // culpa; y si lo enseñáramos sin recalcular estaríamos dando otra cifra que
  // no se corresponde con el precio de al lado.
  const real = margenDeVenta(pvp, costeTotal, taxRate);

  let aviso: string | undefined;
  if (margenMinimo !== undefined && real.porcentaje < margenMinimo) {
    aviso =
      `El margen resultante (${real.porcentaje}%) queda por debajo del mínimo fijado ` +
      `(${margenMinimo}%)`;
  }

  return {
    pvpCents: pvp,
    baseCents: real.ingresoCents,
    costeCompraCents: costeTotal,
    margenReal: real.porcentaje,
    ...(aviso ? { aviso } : {}),
  };
}
