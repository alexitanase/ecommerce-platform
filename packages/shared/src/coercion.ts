/**
 * Conversores seguros para datos sin tipar.
 *
 * Se usan con todo lo que no controlamos: respuestas de proveedores, cuerpos de
 * webhooks, campos JSON de la base de datos y ajustes editables desde el admin.
 * En todos esos casos, un valor que hoy es una cadena mañana puede ser un
 * objeto, y `String()` guardaría literalmente "[object Object]" como título de
 * producto, número de seguimiento o —peor— nombre de cliente en una factura.
 *
 * Estas funciones convierten solo lo que es razonablemente convertible y
 * devuelven el valor por defecto en el resto de casos.
 */

/** Convierte a texto solo primitivos; cualquier otra cosa devuelve el defecto. */
export function texto(valor: unknown, porDefecto = ''): string {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  if (typeof valor === 'boolean') return String(valor);
  if (typeof valor === 'bigint') return valor.toString();
  return porDefecto;
}

/** Igual que `texto`, pero devuelve undefined si no hay valor utilizable. */
export function textoOpcional(valor: unknown): string | undefined {
  const t = texto(valor, '');
  return t === '' ? undefined : t;
}

/**
 * Convierte a número, aceptando cadenas numéricas.
 *
 * Una cadena vacía o en blanco NO es un cero: es un campo que nadie ha
 * rellenado, y se resuelve con el valor por defecto. `Number('')` da 0, así que
 * sin esta comprobación un ajuste vacío del panel machacaría el valor por
 * defecto con un cero —que en un tope de importe es la diferencia entre "sin
 * límite" y "límite de cero euros"—. `numeroOpcional` ya lo distinguía; esto
 * los deja de acuerdo.
 */
export function numero(valor: unknown, porDefecto = 0): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor.trim());
    if (Number.isFinite(n)) return n;
  }
  return porDefecto;
}

export function numeroOpcional(valor: unknown): number | undefined {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Fecha a partir de un valor desconocido; undefined si no es interpretable.
 *
 * Un número se trata como marca de tiempo Unix en milisegundos, que es como la
 * mandan varias APIs. Convertirlo antes a texto daría "Invalid Date", y quien
 * lo consume acaba poniendo la fecha de hoy: el cliente vería su envío fechado
 * en el momento en que alguien consultó el seguimiento.
 */
export function fecha(valor: unknown): Date | undefined {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? undefined : valor;

  if (typeof valor === 'number' && Number.isFinite(valor)) {
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  const t = texto(valor);
  if (!t) return undefined;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Lista de textos a partir de un valor que puede ser array o cadena separada. */
export function listaDeTextos(valor: unknown, separador = ','): string[] {
  if (Array.isArray(valor)) {
    return valor.map((v) => texto(v)).filter((v) => v !== '');
  }
  const t = texto(valor);
  return t
    ? t
        .split(separador)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/** Objeto plano; devuelve {} si el valor no lo es. */
export function objeto(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

/** Array de objetos; devuelve [] si el valor no lo es. */
export function listaDeObjetos(valor: unknown): Record<string, unknown>[] {
  return Array.isArray(valor) ? valor.map(objeto) : [];
}
