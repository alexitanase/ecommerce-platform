/**
 * De dónde vino quien está navegando.
 *
 * Google Ads y Meta Ads no admiten catálogo adulto, así que la captación se
 * reparte entre buscadores, correo propio, comunidades y afiliados. Saber cuál
 * de ellos trae las ventas es lo único que evita repartir el esfuerzo por
 * intuición, y para eso hay que conservar el marcaje desde que se hace clic
 * hasta que se compra — que casi nunca es la misma visita.
 *
 * Va en `localStorage`, no en una cookie: no viaja al servidor en cada
 * petición, no se comparte con nadie y no identifica a la persona. Solo dice
 * de qué enlace vino.
 */

const CLAVE = 'canal';

/**
 * Cuánto se conserva.
 *
 * Treinta días es la ventana habitual de atribución. Más allá, decir que una
 * venta viene de una campaña de hace dos meses es contarse un cuento.
 */
const DIAS = 30;

export interface Marcaje {
  fuente: string;
  medio?: string;
  campana?: string;
  /**
   * Qué pieza concreta trajo el clic.
   *
   * Lo pone el Studio en cada creatividad que exporta. Es lo que convierte el
   * informe de canales en algo accionable: sin él se sabe que la red trajo doce
   * ventas, con él se sabe cuál de los nueve banners las trajo, que es lo único
   * que dice qué repetir y qué apagar.
   */
  contenido?: string;
}

interface Guardado extends Marcaje {
  guardadoEl: number;
}

function limpiar(valor: string | null): string | undefined {
  if (!valor) return undefined;

  const v = valor
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 60);

  return v || undefined;
}

/**
 * Guarda el marcaje que venga en la URL.
 *
 * Último clic no directo: un marcaje nuevo **sí** pisa al anterior. Si alguien
 * llega por la newsletter, se va, y vuelve por Reddit, la venta es de Reddit,
 * que es lo último que lo trajo de vuelta. Volver tecleando la dirección no
 * borra nada, porque entonces casi todas las ventas acabarían siendo directas.
 */
export function capturarCanal(busqueda: string): void {
  const params = new URLSearchParams(busqueda);
  const fuente = limpiar(params.get('utm_source'));
  if (!fuente) return;

  const medio = limpiar(params.get('utm_medium'));
  const campana = limpiar(params.get('utm_campaign'));
  const contenido = limpiar(params.get('utm_content'));

  try {
    const dato: Guardado = {
      fuente,
      ...(medio ? { medio } : {}),
      ...(campana ? { campana } : {}),
      ...(contenido ? { contenido } : {}),
      guardadoEl: Date.now(),
    };
    window.localStorage.setItem(CLAVE, JSON.stringify(dato));
  } catch {
    // Navegación privada con almacenamiento bloqueado: la venta contará como
    // directa. Es un dato de menos, no una compra de menos.
  }
}

/** Marcaje vigente, o null si no hay o ya caducó. */
export function leerCanal(): Marcaje | null {
  try {
    const bruto = window.localStorage.getItem(CLAVE);
    if (!bruto) return null;

    const dato = JSON.parse(bruto) as Guardado;
    if (!dato.fuente) return null;

    if (Date.now() - dato.guardadoEl > DIAS * 86_400_000) {
      window.localStorage.removeItem(CLAVE);
      return null;
    }

    return {
      fuente: dato.fuente,
      ...(dato.medio ? { medio: dato.medio } : {}),
      ...(dato.campana ? { campana: dato.campana } : {}),
      ...(dato.contenido ? { contenido: dato.contenido } : {}),
    };
  } catch {
    return null;
  }
}
