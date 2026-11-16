/**
 * IVA en ventas a otros países de la UE (OSS) y en importaciones (IOSS).
 *
 * Dos regímenes distintos que se confunden constantemente:
 *
 * **OSS — Ventanilla Única.** Al vender a consumidores de otros países de la
 * UE se cobra el IVA español hasta que las ventas transfronterizas del año
 * superan los **10.000 € en conjunto** (no por país). A partir de la operación
 * que cruza el umbral se cobra el IVA **del país del cliente**, y se declara
 * todo en un único modelo, el 369, sin darse de alta en cada país. El umbral
 * obliga para ese año y el siguiente.
 *
 * **IOSS — Importaciones.** Cuando la mercancía sale de fuera de la UE y va
 * directa al cliente —el caso normal en dropshipping— la venta es una
 * importación. Si el envío no pasa de **150 €**, con IOSS se cobra el IVA del
 * país del cliente en el checkout y el paquete entra sin más trámite. Sin IOSS,
 * o por encima de 150 €, el cliente paga el IVA y los aranceles **al recibirlo**:
 * es legal, pero si no se le avisa antes de comprar es una omisión engañosa, y
 * es el motivo por el que muchos paquetes se rechazan en la entrega.
 *
 * El error caro no es equivocarse de tipo: es no darse cuenta de que se ha
 * cruzado el umbral. Se sigue cobrando el 21 % español cuando tocaba el 25 %
 * danés, y la diferencia sale del margen cuando Hacienda lo regulariza —con la
 * venta ya hecha y sin poder reclamársela al cliente.
 */

/** Estados miembros de la UE, con su tipo general de IVA. */
export const TIPOS_UE: Record<string, number> = {
  AT: 20,
  BE: 21,
  BG: 20,
  CY: 19,
  CZ: 21,
  DE: 19,
  DK: 25,
  EE: 22,
  ES: 21,
  FI: 25.5,
  FR: 20,
  GR: 24,
  HR: 25,
  HU: 27,
  IE: 23,
  IT: 22,
  LT: 21,
  LU: 17,
  LV: 21,
  MT: 18,
  NL: 21,
  PL: 23,
  PT: 23,
  RO: 21,
  SE: 25,
  SI: 22,
  SK: 23,
};

/** Umbral anual conjunto de ventas a distancia intracomunitarias. */
export const UMBRAL_OSS_CENTS = 1_000_000;

/** Valor máximo del envío para poder usar IOSS. */
export const LIMITE_IOSS_CENTS = 15_000;

export function esPaisUE(pais: string): boolean {
  return pais.toUpperCase() in TIPOS_UE;
}

/**
 * Territorios de un estado miembro que quedan **fuera** del IVA de la UE.
 *
 * Canarias, Ceuta y Melilla son España a todos los efectos salvo este: una
 * entrega allí va exenta y, a la vuelta, una compra desde allí es una
 * importación. Tratarlos como "ES" a secas es el error que factura IVA español
 * a quien no debe pagarlo.
 */
export const TERRITORIOS_EXCLUIDOS: Record<string, string[]> = {
  // Prefijos de código postal español fuera del territorio IVA.
  ES: ['35', '38', '51', '52'],
};

export function fueraDelTerritorioIva(pais: string, codigoPostal: string): boolean {
  const prefijos = TERRITORIOS_EXCLUIDOS[pais.toUpperCase()] ?? [];
  return prefijos.some((p) => codigoPostal.trim().startsWith(p));
}

export type RegimenIva =
  | 'INTERIOR' // venta nacional
  | 'OSS' // venta a otro país de la UE con IVA de destino
  | 'NACIONAL_POR_UMBRAL' // venta a la UE por debajo del umbral: IVA español
  | 'IOSS' // importación de hasta 150 € con IVA cobrado en el checkout
  | 'IMPORTACION_SIN_IOSS' // el cliente paga IVA y aranceles al recibirlo
  | 'EXENTA'; // fuera del territorio IVA (Canarias, Ceuta, Melilla)

export interface ContextoVenta {
  /** País de entrega. */
  paisDestino: string;
  codigoPostalDestino: string;
  /** Desde dónde sale la mercancía. */
  paisOrigen: string;
  /** Valor del envío, con IVA incluido. */
  valorEnvioCents: number;
  /** Ventas transfronterizas acumuladas este año, antes de esta. */
  acumuladoAnualCents: number;
  /** La tienda está dada de alta en IOSS. */
  tieneIoss: boolean;
  /** Tipo general del país de la tienda. */
  tipoNacional: number;
}

export interface DecisionIva {
  regimen: RegimenIva;
  /** Tipo a aplicar; 0 en exentas y en importaciones sin IOSS. */
  tipo: number;
  /** Qué país recauda: determina en qué declaración va. */
  paisRecaudador: string;
  /** Aviso obligatorio para el cliente, si lo hay. */
  avisoCliente?: string;
  /** Explicación para el registro contable. */
  motivo: string;
}

/**
 * Decide qué IVA se aplica a una venta.
 *
 * @param ctx todo lo que hace falta para decidir; nada se consulta fuera
 */
export function decidirIva(ctx: ContextoVenta): DecisionIva {
  const destino = ctx.paisDestino.toUpperCase();
  const origen = ctx.paisOrigen.toUpperCase();

  // 1. Territorios excluidos del IVA de la UE, antes que nada: Canarias es
  //    "ES" y aun así la entrega va exenta.
  if (fueraDelTerritorioIva(destino, ctx.codigoPostalDestino)) {
    return {
      regimen: 'EXENTA',
      tipo: 0,
      paisRecaudador: destino,
      avisoCliente:
        'Tu pedido va sin IVA español por enviarse fuera del territorio de aplicación del impuesto. ' +
        'Es posible que tengas que pagar el impuesto local y los trámites de aduana al recibirlo.',
      motivo: 'Entrega fuera del territorio IVA (Canarias, Ceuta o Melilla).',
    };
  }

  // 2. La mercancía viene de fuera de la UE: es una importación, mande donde
  //    mande el cliente. Este es el caso habitual en dropshipping y el que se
  //    trata mal con más frecuencia.
  if (!esPaisUE(origen)) {
    if (ctx.tieneIoss && ctx.valorEnvioCents <= LIMITE_IOSS_CENTS) {
      return {
        regimen: 'IOSS',
        tipo: TIPOS_UE[destino] ?? ctx.tipoNacional,
        paisRecaudador: destino,
        motivo: `Importación de hasta 150 € con IOSS: se repercute el IVA de ${destino} en el checkout.`,
      };
    }

    return {
      regimen: 'IMPORTACION_SIN_IOSS',
      tipo: 0,
      paisRecaudador: destino,
      // Callar esto es la omisión engañosa que hace que el cliente rechace el
      // paquete en la entrega y la venta se pierda entera.
      avisoCliente:
        'Este producto se envía desde fuera de la Unión Europea. Al recibirlo tendrás que pagar ' +
        'el IVA de importación y, si procede, los aranceles y los gastos de gestión del transportista.',
      motivo:
        ctx.valorEnvioCents > LIMITE_IOSS_CENTS
          ? 'Importación de más de 150 €: fuera del IOSS, el IVA se liquida en aduana.'
          : 'Importación sin alta en IOSS: el IVA se liquida en aduana.',
    };
  }

  // 3. Venta nacional.
  if (destino === origen) {
    return {
      regimen: 'INTERIOR',
      tipo: ctx.tipoNacional,
      paisRecaudador: origen,
      motivo: 'Venta interior.',
    };
  }

  // 4. Venta a otro país de la UE: decide el umbral de los 10.000 €.
  //    Se compara con el acumulado MÁS esta venta: la operación que cruza el
  //    umbral ya tributa en destino, no la siguiente.
  const acumuladoConEsta = ctx.acumuladoAnualCents + ctx.valorEnvioCents;

  if (acumuladoConEsta > UMBRAL_OSS_CENTS) {
    return {
      regimen: 'OSS',
      tipo: TIPOS_UE[destino] ?? ctx.tipoNacional,
      paisRecaudador: destino,
      motivo: `Superado el umbral de 10.000 €: se repercute el IVA de ${destino} y se declara por OSS (modelo 369).`,
    };
  }

  return {
    regimen: 'NACIONAL_POR_UMBRAL',
    tipo: ctx.tipoNacional,
    paisRecaudador: origen,
    motivo: 'Venta a la UE por debajo del umbral de 10.000 €: se repercute el IVA español.',
  };
}

export interface EstadoUmbral {
  acumuladoCents: number;
  umbralCents: number;
  restanteCents: number;
  superado: boolean;
  /** Porcentaje consumido, para poder avisar antes de llegar. */
  porcentaje: number;
  aviso?: string;
}

/**
 * Situación frente al umbral de los 10.000 €.
 *
 * Avisa **antes** de cruzarlo a propósito. Enterarse después obliga a
 * regularizar operaciones ya facturadas con un tipo que no era, y esa
 * diferencia sale del margen: al cliente ya no se le puede reclamar.
 */
export function estadoDelUmbral(acumuladoCents: number): EstadoUmbral {
  const restante = Math.max(0, UMBRAL_OSS_CENTS - acumuladoCents);
  const porcentaje = Math.round((acumuladoCents / UMBRAL_OSS_CENTS) * 100);
  const superado = acumuladoCents > UMBRAL_OSS_CENTS;

  const base: EstadoUmbral = {
    acumuladoCents,
    umbralCents: UMBRAL_OSS_CENTS,
    restanteCents: restante,
    superado,
    porcentaje,
  };

  if (superado) {
    return {
      ...base,
      aviso:
        'Umbral de 10.000 € superado: las ventas a otros países de la UE deben llevar el IVA del ' +
        'país del cliente y declararse por OSS (modelo 369). Hay que estar dado de alta en el régimen.',
    };
  }

  if (porcentaje >= 80) {
    return {
      ...base,
      aviso:
        `Vas por el ${String(porcentaje)} % del umbral de 10.000 €. Conviene darse de alta en OSS antes de ` +
        'cruzarlo: después habría que regularizar ventas ya facturadas con un tipo que no era.',
    };
  }

  return base;
}

/**
 * Tipos reducidos.
 *
 * Se aplica siempre el **tipo general** del país de destino. Los reducidos
 * existen en todos los estados miembros, pero cada uno decide qué productos los
 * llevan y no hay dos listas iguales: un libro es 4 % en España, 5,5 % en
 * Francia y 0 % en Irlanda. Resolverlo bien exige clasificar cada producto país
 * por país, y hacerlo a ojo daría un número equivocado con apariencia de
 * correcto.
 *
 * Por eso se marca para revisión en lugar de adivinar: si un producto no lleva
 * el tipo general español, su tipo en destino hay que confirmarlo.
 */
export function necesitaRevisionDeTipo(
  tipoNacionalProducto: number,
  tipoGeneralNacional: number,
): boolean {
  return tipoNacionalProducto !== tipoGeneralNacional;
}

/**
 * Tipo que se aplica de verdad a una línea, ya decidido el régimen.
 *
 * El catálogo publica precios **con el IVA español dentro**, así que el régimen
 * no cambia lo que paga el cliente: cambia cómo se reparte ese importe entre
 * base y cuota, y quién recauda.
 *
 * - Exenta o importación sin IOSS → 0: el importe hay que netificarlo, porque
 *   el IVA español que lleva el precio no se puede cobrar. En la importación,
 *   además, el cliente lo pagará en aduana; cobrárselo aquí también sería
 *   cobrarlo dos veces.
 * - OSS o IOSS → tipo general del país de destino, aunque el producto tenga un
 *   reducido en España (ver `necesitaRevisionDeTipo`).
 * - Interior o por debajo del umbral → el tipo del catálogo, con sus reducidos.
 */
export function tipoAplicable(decision: DecisionIva, tipoCatalogo: number): number {
  switch (decision.regimen) {
    case 'EXENTA':
    case 'IMPORTACION_SIN_IOSS':
      return 0;
    case 'OSS':
    case 'IOSS':
      return decision.tipo;
    default:
      return tipoCatalogo;
  }
}

/** Un régimen en el que el precio del catálogo lleva IVA que no se puede cobrar. */
export function exigeNetificar(regimen: RegimenIva): boolean {
  return regimen === 'EXENTA' || regimen === 'IMPORTACION_SIN_IOSS';
}

/** Regímenes cuya cuota se declara por la ventanilla única (modelo 369). */
export function declaraPorOss(regimen: RegimenIva | 'MIXTO'): boolean {
  return regimen === 'OSS' || regimen === 'IOSS';
}

/**
 * Un envío del pedido: la mercancía que sale de un mismo sitio.
 *
 * En dropshipping un pedido con tres productos puede ser tres paquetes de tres
 * proveedores distintos, y el régimen no es del pedido sino de cada envío: el
 * límite de 150 € del IOSS se mide **por envío**, no por pedido. Partir un
 * pedido de 200 € en dos paquetes de 100 € que llegan por separado es un caso
 * normal, y tratarlo como uno solo dejaría fuera del IOSS dos envíos que sí
 * cabían.
 */
export interface EnvioDelPedido {
  /** Quién lo manda; normalmente el id del proveedor. */
  id: string;
  paisOrigen: string;
  /** Valor de esa parte de la mercancía, con IVA incluido. */
  valorCents: number;
}

export interface DecisionPedido {
  /** La decisión de cada envío, en el orden en que se pasaron. */
  envios: { id: string; decision: DecisionIva }[];
  /** Régimen del pedido entero; `MIXTO` cuando sus envíos no coinciden. */
  regimen: RegimenIva | 'MIXTO';
  /** País que recauda; cadena vacía si hay más de uno. */
  paisRecaudador: string;
  /** Avisos que hay que enseñar antes de comprar, sin repetir. */
  avisos: string[];
  /** Parte del pedido que consume umbral de ventas a distancia. */
  consumeUmbralCents: number;
}

/**
 * Decide el IVA de un pedido que puede salir de varios sitios a la vez.
 *
 * El acumulado del umbral crece **dentro del propio pedido**: si la tienda
 * llega al pedido con 9.900 € y este vende 200 € a Francia en dos envíos, el
 * segundo ya está por encima de los 10.000 € aunque el primero no lo estuviera.
 * Evaluar los dos con el mismo acumulado inicial dejaría uno mal facturado.
 *
 * `envios` no puede venir vacío: un pedido sin mercancía no tiene régimen. Si
 * no se sabe de dónde sale, el que llama pone el país de la tienda.
 */
export function decidirIvaDelPedido(
  base: Omit<ContextoVenta, 'paisOrigen' | 'valorEnvioCents'>,
  envios: EnvioDelPedido[],
): DecisionPedido {
  let acumulado = base.acumuladoAnualCents;
  let consumeUmbral = 0;

  const decisiones = envios.map((envio) => {
    const decision = decidirIva({
      ...base,
      acumuladoAnualCents: acumulado,
      paisOrigen: envio.paisOrigen,
      valorEnvioCents: envio.valorCents,
    });

    // Solo las ventas a distancia intracomunitarias consumen umbral: una
    // importación o una entrega a Canarias no cuentan para los 10.000 €.
    if (decision.regimen === 'OSS' || decision.regimen === 'NACIONAL_POR_UMBRAL') {
      acumulado += envio.valorCents;
      consumeUmbral += envio.valorCents;
    }

    return { id: envio.id, decision };
  });

  const regimenes = new Set(decisiones.map((d) => d.decision.regimen));
  const paises = new Set(decisiones.map((d) => d.decision.paisRecaudador));

  const avisos = [
    ...new Set(
      decisiones.map((d) => d.decision.avisoCliente).filter((a): a is string => Boolean(a)),
    ),
  ];

  return {
    envios: decisiones,
    regimen: regimenes.size === 1 ? [...regimenes][0]! : 'MIXTO',
    paisRecaudador: paises.size === 1 ? [...paises][0]! : '',
    avisos,
    consumeUmbralCents: consumeUmbral,
  };
}
