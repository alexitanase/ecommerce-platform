/**
 * Reglas de las variantes que comparten el servidor y el navegador.
 *
 * Están aquí y no dentro de un componente porque la ficha se pinta en las dos
 * partes: el servidor tiene que preseleccionar la misma variante que elegirá el
 * selector en el cliente, o el precio de la primera pintada no coincidiría con
 * el del botón y la página parpadearía al hidratarse.
 */

export interface ValorOpcionLigero {
  id: string;
  value: string;
  labels: Record<string, string> | null;
}

export interface OpcionLigera {
  id: string;
  key: string;
  esEnvio?: boolean;
  values: ValorOpcionLigero[];
}

export interface VarianteLigera {
  id: string;
  priceCents: number;
  stock: number;
  optionValues: { optionValue: ValorOpcionLigero }[];
  media: { url: string }[];
}

/**
 * La variante que se enseña al abrir la ficha.
 *
 * La primera con stock, y solo si no hay ninguna, la primera de todas. Así el
 * botón de comprar está activo desde el primer momento en lugar de pedir dos
 * clics para descubrir que lo que venía marcado estaba agotado.
 */
export function variantePreseleccionada<T extends { stock: number }>(
  variantes: T[],
): T | undefined {
  return variantes.find((v) => v.stock > 0) ?? variantes[0];
}

/** El texto de un valor de opción en el idioma del visitante. */
export function etiquetaValor(valor: ValorOpcionLigero, locale: string): string {
  return valor.labels?.[locale] ?? valor.value;
}

/**
 * Precio más bajo al que se puede comprar cada valor de opción.
 *
 * Es el mínimo y no la media ni el de la primera variante: un color que existe en
 * dos tallas cuesta, para quien mira la ficha, lo que cuesta la más barata de las
 * dos. Es el mismo criterio que el «desde» del catálogo, y así el orden de la
 * ficha coincide con el precio que se anunció en la tarjeta.
 *
 * Cuenta el precio de todas las variantes, agotadas incluidas. Descontarlas
 * cambiaría el orden de la ficha cada vez que se acaba una talla, y el cliente
 * no entiende por qué se le han movido los botones entre dos visitas.
 */
export function precioPorValor(variantes: VarianteLigera[]): Map<string, number> {
  const minimos = new Map<string, number>();

  for (const variante of variantes) {
    for (const { optionValue } of variante.optionValues) {
      const actual = minimos.get(optionValue.id);
      if (actual === undefined || variante.priceCents < actual) {
        minimos.set(optionValue.id, variante.priceCents);
      }
    }
  }

  return minimos;
}

/**
 * Los valores de una opción, del más barato al más caro.
 *
 * Dos detalles que deciden si esto ayuda o estorba:
 *
 *  · **El orden es estable.** Cuando dos valores cuestan lo mismo se quedan como
 *    venían, que en una talla es lo único aceptable: si todas valen igual, se
 *    siguen leyendo 41, 42, 43 y no en un orden inventado.
 *
 *  · **Lo que no lleva a ninguna variante va al final.** Un valor huérfano no
 *    tiene precio, y colocarlo primero pondría delante justo lo que no se puede
 *    comprar.
 */
export function valoresPorPrecio<V extends ValorOpcionLigero>(
  valores: V[],
  precios: Map<string, number>,
): V[] {
  const precio = (v: V) => precios.get(v.id) ?? Number.POSITIVE_INFINITY;

  // Sobre una copia: `sort` ordena en el sitio y esta lista viene de las
  // propiedades del componente, que no se tocan.
  return [...valores].sort((a, b) => precio(a) - precio(b));
}

/**
 * Nombre de una variante, para enseñarlo sobre la foto.
 *
 * Se dejan fuera las opciones de envío: «Vino tinto» describe lo que se está
 * mirando, «Vino tinto · China Mainland» mezcla el artículo con la logística y
 * el país ya tiene su propio sitio en la ficha.
 */
export function nombreVariante(
  variante: VarianteLigera,
  opciones: OpcionLigera[],
  locale: string,
): string | null {
  const visibles = opciones.filter((o) => !o.esEnvio);
  if (visibles.length === 0) return null;

  const partes: string[] = [];
  for (const opcion of visibles) {
    const suyos = new Set(opcion.values.map((v) => v.id));
    const elegido = variante.optionValues.find((ov) => suyos.has(ov.optionValue.id));
    if (elegido) partes.push(etiquetaValor(elegido.optionValue, locale));
  }

  return partes.length > 0 ? partes.join(' · ') : null;
}

/**
 * Foto de cada valor de opción, cuando el proveedor le ha asignado una.
 *
 * En AliExpress cada color trae su propia foto, y sin esto el cliente elegía
 * entre once nombres de color mirando siempre la misma imagen. La dificultad
 * está en saber a QUÉ opción pertenece la foto: en un producto de color y talla
 * la foto es del color, y si se reparte a ciegas cada talla acabaría con la foto
 * del primer color que la lleve, que es una foto mentirosa.
 *
 * La regla: una opción tiene fotos propias si cada uno de sus valores apunta
 * siempre a la misma foto, y hay al menos dos fotos distintas entre sus valores.
 * La talla no lo cumple —la talla M existe en rojo y en azul, así que recoge dos
 * fotos— y el color sí. No hace falta saber cómo se llama la opción, lo que
 * evita depender del idioma en el que el proveedor la nombró.
 */
export function fotosPorValor(
  variantes: VarianteLigera[],
  opciones: OpcionLigera[],
): Map<string, string> {
  const fotos = new Map<string, string>();

  for (const opcion of opciones) {
    if (opcion.esEnvio) continue;

    const suyos = new Set(opcion.values.map((v) => v.id));
    /** Valor → todas las fotos que le han tocado. */
    const candidatas = new Map<string, Set<string>>();

    for (const variante of variantes) {
      const url = variante.media[0]?.url;
      if (!url) continue;

      for (const ov of variante.optionValues) {
        if (!suyos.has(ov.optionValue.id)) continue;
        const conjunto = candidatas.get(ov.optionValue.id) ?? new Set<string>();
        conjunto.add(url);
        candidatas.set(ov.optionValue.id, conjunto);
      }
    }

    const ambiguo = [...candidatas.values()].some((c) => c.size > 1);
    const distintas = new Set([...candidatas.values()].flatMap((c) => [...c]));
    if (ambiguo || distintas.size < 2) continue;

    for (const [valorId, conjunto] of candidatas) {
      const url = [...conjunto][0];
      if (url) fotos.set(valorId, url);
    }
  }

  return fotos;
}
