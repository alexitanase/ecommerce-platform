/**
 * Fusión de carritos al iniciar sesión.
 *
 * El caso: alguien navega como invitado, añade tres cosas, y luego entra en su
 * cuenta — donde ya tenía un carrito de la semana pasada. Las dos maneras
 * fáciles de resolverlo son malas:
 *
 *  · Quedarse con el del invitado borra lo que había guardado, que es
 *    exactamente lo que el cliente esperaba encontrar al identificarse.
 *  · Quedarse con el de la cuenta tira lo que acaba de añadir, que es todavía
 *    peor porque lo estaba mirando hace un segundo.
 *
 * Así que se suman. Y sumar cantidades tiene su propio riesgo: si en ambos
 * carritos hay 3 unidades de algo con 4 en stock, sumar da 6 y el pedido
 * fallaría al pagar. Se recorta al stock disponible y se avisa.
 */

export interface LineaFusion {
  variantId: string;
  quantity: number;
  priceWhenAddedCents: number;
}

export interface ResultadoFusion {
  lineas: LineaFusion[];
  /** Variantes cuya cantidad se recortó por falta de stock. */
  recortadas: { variantId: string; pedida: number; disponible: number }[];
}

/**
 * @param stockPorVariante stock real disponible; si falta una variante se
 *   asume que no hay ninguna y se descarta la línea
 * @param maxPorLinea tope por línea, el mismo que aplica el carrito normal
 */
export function fusionarCarritos(
  destino: LineaFusion[],
  origen: LineaFusion[],
  stockPorVariante: Map<string, number>,
  maxPorLinea = 99,
): ResultadoFusion {
  const combinado = new Map<string, LineaFusion>();

  for (const linea of destino) {
    combinado.set(linea.variantId, { ...linea });
  }

  for (const linea of origen) {
    const existente = combinado.get(linea.variantId);

    if (!existente) {
      combinado.set(linea.variantId, { ...linea });
      continue;
    }

    existente.quantity += linea.quantity;
    // Se conserva el precio más antiguo de los dos: es el que el cliente vio
    // primero y sobre el que se le avisará si ha subido.
    existente.priceWhenAddedCents = Math.min(
      existente.priceWhenAddedCents,
      linea.priceWhenAddedCents,
    );
  }

  const lineas: LineaFusion[] = [];
  const recortadas: ResultadoFusion['recortadas'] = [];

  for (const linea of combinado.values()) {
    const disponible = stockPorVariante.get(linea.variantId) ?? 0;

    if (disponible <= 0) {
      // Se quedó sin stock mientras el carrito dormía. Se descarta en lugar de
      // dejarla: una línea que va a fallar al pagar solo sirve para que el
      // cliente descubra el problema en la pantalla de pago.
      recortadas.push({ variantId: linea.variantId, pedida: linea.quantity, disponible: 0 });
      continue;
    }

    const permitida = Math.min(linea.quantity, disponible, maxPorLinea);

    if (permitida < linea.quantity) {
      recortadas.push({
        variantId: linea.variantId,
        pedida: linea.quantity,
        disponible: permitida,
      });
    }

    lineas.push({ ...linea, quantity: permitida });
  }

  return { lineas, recortadas };
}

/** Aviso de que un precio cambió mientras el producto estaba en el carrito. */
export interface CambioPrecio {
  variantId: string;
  anteriorCents: number;
  actualCents: number;
}

/**
 * Compara el precio guardado al añadir con el actual del catálogo.
 *
 * Se avisa tanto si sube como si baja. Que baje también importa: el cliente
 * que ve un precio menor al que recordaba se lo toma bien, y el que descubre
 * la subida en la pantalla de pago abandona el carrito.
 */
export function cambiosDePrecio(
  lineas: { variantId: string; priceWhenAddedCents: number }[],
  precioActual: Map<string, number>,
): CambioPrecio[] {
  const cambios: CambioPrecio[] = [];

  for (const linea of lineas) {
    const actual = precioActual.get(linea.variantId);
    if (actual === undefined || actual === linea.priceWhenAddedCents) continue;

    cambios.push({
      variantId: linea.variantId,
      anteriorCents: linea.priceWhenAddedCents,
      actualCents: actual,
    });
  }

  return cambios;
}
