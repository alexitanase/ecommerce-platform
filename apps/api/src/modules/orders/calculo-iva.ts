/**
 * Cálculo del IVA de un pedido.
 *
 * En España los precios al consumidor se anuncian **con el IVA incluido**, así
 * que la cuota no se suma: se extrae. Y no hay un solo tipo: conviven el
 * general (21 %), el reducido (10 %) y el superreducido (4 %). Un carrito con
 * un libro y unas botas lleva dos tipos a la vez.
 *
 * Aplicar un único tipo a todo el pedido —el del primer producto, por ejemplo—
 * no da ningún error: da una cuota equivocada y una factura cuyo desglose no
 * cuadra con el modelo 303. El error se descubre en el trimestre, con las
 * facturas ya emitidas y entregadas al cliente.
 *
 * Todo el módulo trabaja en céntimos enteros. Con decimales, sumar líneas y
 * comparar con el total falla por céntimos que no se pueden justificar ante
 * Hacienda.
 */

export interface LineaImponible {
  /** Importe total de la línea, IVA incluido. */
  totalCents: number;
  /** Tipo aplicable: 21, 10, 4… */
  tipo: number;
}

export interface TramoIva {
  tipo: number;
  /** Importe sin IVA. */
  baseCents: number;
  /** IVA de ese tramo. */
  cuotaCents: number;
  /** Base + cuota. */
  totalCents: number;
}

export interface DesgloseIva {
  tramos: TramoIva[];
  baseCents: number;
  cuotaCents: number;
  totalCents: number;
}

/**
 * Extrae la cuota de un importe que ya lleva el IVA dentro.
 *
 * El redondeo es al céntimo más próximo y se hace una sola vez, sobre el
 * importe agregado del tramo: redondear línea a línea y luego sumar acumula
 * diferencias que dejan la factura descuadrada por céntimos.
 */
export function cuotaIncluida(totalConIvaCents: number, tipo: number): number {
  if (tipo <= 0) return 0;
  return totalConIvaCents - Math.round(totalConIvaCents / (1 + tipo / 100));
}

/** Importe sin IVA a partir del importe con IVA. */
export function baseImponible(totalConIvaCents: number, tipo: number): number {
  return totalConIvaCents - cuotaIncluida(totalConIvaCents, tipo);
}

/**
 * Reparte un importe entre varios tramos en proporción a su peso.
 *
 * Es lo que hace falta para el envío y el descuento: acompañan al pedido
 * entero, no a un tipo concreto, y en un carrito con tipos distintos hay que
 * decidir qué parte va a cada uno. Se reparte proporcionalmente al importe de
 * cada tramo, que es el criterio que sigue la Agencia Tributaria para las
 * prestaciones accesorias.
 *
 * El último céntimo importa: al repartir 10 entre tres partes iguales sobran
 * céntimos por el redondeo. Se asignan al tramo mayor, de modo que la suma de
 * las partes es **exactamente** el importe repartido y la factura cuadra.
 */
export function repartirProporcional(importeCents: number, pesos: number[]): number[] {
  const total = pesos.reduce((a, b) => a + b, 0);

  if (total === 0 || pesos.length === 0) {
    // Sin nada a lo que repartir: todo al primero, para no perder el importe.
    return pesos.map((_, i) => (i === 0 ? importeCents : 0));
  }

  const partes = pesos.map((p) => Math.round((importeCents * p) / total));
  const residuo = importeCents - partes.reduce((a, b) => a + b, 0);

  if (residuo !== 0) {
    // Al tramo de mayor peso: es donde un céntimo se nota menos y donde el
    // criterio es estable entre ejecuciones.
    let mayor = 0;
    for (let i = 1; i < pesos.length; i++) {
      if ((pesos[i] ?? 0) > (pesos[mayor] ?? 0)) mayor = i;
    }
    partes[mayor] = (partes[mayor] ?? 0) + residuo;
  }

  return partes;
}

/**
 * Quita el IVA a un importe accesorio —el porte o un descuento— en una entrega
 * exenta.
 *
 * El importe no tiene tipo propio: sigue al de la mercancía. Con un solo tipo
 * basta con dividir, pero con varios hay que repartirlo primero y netificar
 * cada parte con su tipo. Usar el tipo del primer producto sería cobrar de más
 * o de menos en un carrito mezclado, y en una entrega exenta cualquier resto de
 * IVA español es, además, un cobro indebido.
 */
export function netificarAccesorio(importeCents: number, lineas: LineaImponible[]): number {
  if (importeCents === 0 || lineas.length === 0) return importeCents;

  const porTipo = new Map<number, number>();
  for (const l of lineas) porTipo.set(l.tipo, (porTipo.get(l.tipo) ?? 0) + l.totalCents);

  const tipos = [...porTipo.keys()].sort((a, b) => b - a);
  const partes = repartirProporcional(
    importeCents,
    tipos.map((t) => porTipo.get(t) ?? 0),
  );

  return tipos.reduce((suma, tipo, i) => suma + baseImponible(partes[i] ?? 0, tipo), 0);
}

/**
 * Como `netificarAccesorio`, pero cuando solo **parte** del pedido va exenta.
 *
 * Pasa en cuanto entra el IVA transfronterizo: un pedido puede llevar una línea
 * que sale del almacén español con su 21 % y otra que viene de China y va sin
 * IVA porque el cliente lo pagará en la aduana. El porte acompaña a las dos.
 *
 * Se reparte el importe en proporción a la mercancía de cada bloque y solo se
 * netifica el que acompaña a lo exento. Netificarlo entero rebajaría la base de
 * lo que sí lleva IVA —cobrando de menos—, y no netificar nada dejaría IVA
 * español dentro de un porte que no debe llevarlo.
 *
 * `tipoCatalogo` es el tipo con el que se publicó el precio (el español), no el
 * que se acaba aplicando: es el que hay que quitar del importe.
 */
export function netificarAccesorioParcial(
  importeCents: number,
  lineas: { totalCents: number; tipoCatalogo: number; exenta: boolean }[],
): number {
  if (importeCents === 0 || lineas.length === 0) return importeCents;

  const exentas = lineas.filter((l) => l.exenta);
  if (exentas.length === 0) return importeCents;

  const gravadas = lineas.filter((l) => !l.exenta);
  if (gravadas.length === 0) {
    return netificarAccesorio(
      importeCents,
      exentas.map((l) => ({ totalCents: l.totalCents, tipo: l.tipoCatalogo })),
    );
  }

  const suma = (ls: typeof lineas) => ls.reduce((a, l) => a + l.totalCents, 0);
  const [parteExenta = 0, parteGravada = 0] = repartirProporcional(importeCents, [
    suma(exentas),
    suma(gravadas),
  ]);

  return (
    netificarAccesorio(
      parteExenta,
      exentas.map((l) => ({ totalCents: l.totalCents, tipo: l.tipoCatalogo })),
    ) + parteGravada
  );
}

/**
 * Desglosa el IVA de un pedido completo.
 *
 * @param lineas       líneas de producto, con IVA incluido
 * @param envioCents   porte cobrado, con IVA incluido
 * @param descuentoCents descuento aplicado, con IVA incluido
 * @param exento       entrega fuera del territorio IVA (Canarias, Ceuta, Melilla)
 *
 * El envío sigue el tipo de lo que transporta —es una prestación accesoria— y
 * el descuento minora la base del tramo al que corresponde. Ambos se reparten
 * en proporción al importe de cada tipo.
 */
export function desglosarIva(
  lineas: LineaImponible[],
  envioCents = 0,
  descuentoCents = 0,
  exento = false,
): DesgloseIva {
  // Una entrega exenta no tiene tramos por tipo: todo va al 0 %, y el importe
  // ya es la base porque el precio del catálogo se ha netificado antes.
  if (exento) {
    const total = lineas.reduce((a, l) => a + l.totalCents, 0) - descuentoCents + envioCents;
    return {
      tramos: total === 0 ? [] : [{ tipo: 0, baseCents: total, cuotaCents: 0, totalCents: total }],
      baseCents: total,
      cuotaCents: 0,
      totalCents: total,
    };
  }

  // Agrupar por tipo: dos líneas al 21 % son un solo tramo en la factura.
  const porTipo = new Map<number, number>();
  for (const linea of lineas) {
    porTipo.set(linea.tipo, (porTipo.get(linea.tipo) ?? 0) + linea.totalCents);
  }

  // Orden descendente: es como se presenta el desglose en una factura española
  // y hace que el reparto del residuo sea reproducible.
  const tipos = [...porTipo.keys()].sort((a, b) => b - a);
  const importes = tipos.map((t) => porTipo.get(t) ?? 0);

  if (tipos.length === 0) {
    return { tramos: [], baseCents: 0, cuotaCents: 0, totalCents: 0 };
  }

  const envios = repartirProporcional(envioCents, importes);
  const descuentos = repartirProporcional(descuentoCents, importes);

  const tramos: TramoIva[] = tipos.map((tipo, i) => {
    const total = (importes[i] ?? 0) + (envios[i] ?? 0) - (descuentos[i] ?? 0);
    const cuota = cuotaIncluida(total, tipo);
    return { tipo, baseCents: total - cuota, cuotaCents: cuota, totalCents: total };
  });

  return {
    tramos,
    baseCents: tramos.reduce((a, t) => a + t.baseCents, 0),
    cuotaCents: tramos.reduce((a, t) => a + t.cuotaCents, 0),
    totalCents: tramos.reduce((a, t) => a + t.totalCents, 0),
  };
}

/**
 * Tipo a mostrar cuando hay que resumir el pedido en un solo número.
 *
 * Con varios tipos no existe "el tipo del pedido": se devuelve el mayoritario
 * por importe, que es el que menos desconcierta en un listado. El desglose
 * completo es el que vale para la factura y para Hacienda.
 */
export function tipoPredominante(desglose: DesgloseIva): number {
  let mayor: TramoIva | null = null;
  for (const t of desglose.tramos) {
    if (!mayor || t.totalCents > mayor.totalCents) mayor = t;
  }
  return mayor?.tipo ?? 0;
}

/** Un pedido con más de un tipo necesita desglose obligatorio en la factura. */
export function tieneVariosTipos(desglose: DesgloseIva): boolean {
  return desglose.tramos.length > 1;
}
