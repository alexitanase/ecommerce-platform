import { permitido } from '@/lib/consentimiento';

/**
 * Eventos del embudo de compra.
 *
 * Una tienda sin medición se dirige a ciegas: no se sabe si el problema es que
 * nadie entra, que nadie añade al carrito o que la gente abandona en el
 * checkout, y cada una de esas tres cosas se arregla de una manera distinta.
 *
 * **Nada se envía sin permiso.** Cada función comprueba el consentimiento en el
 * momento de disparar, no al cargar el módulo: alguien puede retirar el suyo a
 * mitad de sesión desde la página de preferencias, y a partir de ese momento no
 * puede salir un evento más. Comprobarlo una sola vez al arrancar es
 * exactamente el fallo que convierte un banner de cookies en decoración.
 *
 * Los importes viajan en euros con dos decimales porque es lo que esperan GA4 y
 * Meta. En el resto del proyecto el dinero son céntimos enteros; la conversión
 * se hace aquí, en la frontera, y en un solo sitio.
 */

/** Producto tal como lo esperan las plataformas de analítica. */
export interface ArticuloAnalitica {
  id: string;
  nombre: string;
  precioCents: number;
  cantidad?: number;
  categoria?: string;
  variante?: string;
}

interface VentanaConAnalitica extends Window {
  gtag?: (...args: unknown[]) => void;
  fbq?: (...args: unknown[]) => void;
  dataLayer?: unknown[];
}

const ventana = (): VentanaConAnalitica | null => (typeof window === 'undefined' ? null : window);

/** Céntimos a la cifra decimal que esperan GA4 y Meta. */
const aEuros = (cents: number): number => Math.round(cents) / 100;

const mapearGa4 = (a: ArticuloAnalitica) => ({
  item_id: a.id,
  item_name: a.nombre,
  price: aEuros(a.precioCents),
  quantity: a.cantidad ?? 1,
  ...(a.categoria ? { item_category: a.categoria } : {}),
  ...(a.variante ? { item_variant: a.variante } : {}),
});

/**
 * Envía a Google, si hay permiso analítico y GA4 está cargado.
 *
 * Nunca lanza. Un fallo de la analítica no puede romper el checkout: mide, no
 * vende.
 */
function aGoogle(evento: string, datos: Record<string, unknown>): void {
  if (!permitido('analiticas')) return;

  const w = ventana();
  if (!w?.gtag) return;

  try {
    w.gtag('event', evento, datos);
  } catch {
    // Silencio deliberado: si la analítica falla, la tienda sigue.
  }
}

/** Envía a Meta, si hay permiso de marketing y el píxel está cargado. */
function aMeta(evento: string, datos: Record<string, unknown>): void {
  // Permiso distinto al de Google a propósito: el píxel de Meta sirve para
  // construir audiencias publicitarias, que es una finalidad de marketing, no
  // de medición. Aceptar estadísticas no es aceptar publicidad.
  if (!permitido('marketing')) return;

  const w = ventana();
  if (!w?.fbq) return;

  try {
    w.fbq('track', evento, datos);
  } catch {
    // Igual que arriba.
  }
}

// ── Eventos del embudo ───────────────────────────────────────

/** Alguien ha visto una ficha de producto. */
export function verProducto(articulo: ArticuloAnalitica): void {
  aGoogle('view_item', {
    currency: 'EUR',
    value: aEuros(articulo.precioCents),
    items: [mapearGa4(articulo)],
  });

  aMeta('ViewContent', {
    content_ids: [articulo.id],
    content_name: articulo.nombre,
    content_type: 'product',
    value: aEuros(articulo.precioCents),
    currency: 'EUR',
  });
}

/** Añadido al carrito: el primer indicio real de intención de compra. */
export function anadirAlCarrito(articulo: ArticuloAnalitica): void {
  const cantidad = articulo.cantidad ?? 1;

  aGoogle('add_to_cart', {
    currency: 'EUR',
    value: aEuros(articulo.precioCents * cantidad),
    items: [mapearGa4(articulo)],
  });

  aMeta('AddToCart', {
    content_ids: [articulo.id],
    content_name: articulo.nombre,
    content_type: 'product',
    value: aEuros(articulo.precioCents * cantidad),
    currency: 'EUR',
  });
}

export function quitarDelCarrito(articulo: ArticuloAnalitica): void {
  aGoogle('remove_from_cart', {
    currency: 'EUR',
    value: aEuros(articulo.precioCents * (articulo.cantidad ?? 1)),
    items: [mapearGa4(articulo)],
  });
}

/**
 * Ha empezado el checkout.
 *
 * La diferencia entre este evento y `purchase` es el abandono de carrito, que
 * suele ser el mayor agujero del embudo de cualquier tienda.
 */
export function empezarCheckout(articulos: ArticuloAnalitica[], totalCents: number): void {
  aGoogle('begin_checkout', {
    currency: 'EUR',
    value: aEuros(totalCents),
    items: articulos.map(mapearGa4),
  });

  aMeta('InitiateCheckout', {
    content_ids: articulos.map((a) => a.id),
    content_type: 'product',
    num_items: articulos.reduce((n, a) => n + (a.cantidad ?? 1), 0),
    value: aEuros(totalCents),
    currency: 'EUR',
  });
}

/**
 * Compra completada.
 *
 * `numeroPedido` va como identificador de transacción para que las plataformas
 * puedan deduplicar: si alguien recarga la página de confirmación, el pedido no
 * se cuenta dos veces y los ingresos del panel no se inflan.
 */
export function comprar(
  numeroPedido: string,
  articulos: ArticuloAnalitica[],
  totales: { totalCents: number; envioCents?: number; ivaCents?: number },
): void {
  aGoogle('purchase', {
    transaction_id: numeroPedido,
    currency: 'EUR',
    value: aEuros(totales.totalCents),
    ...(totales.envioCents !== undefined ? { shipping: aEuros(totales.envioCents) } : {}),
    ...(totales.ivaCents !== undefined ? { tax: aEuros(totales.ivaCents) } : {}),
    items: articulos.map(mapearGa4),
  });

  aMeta('Purchase', {
    content_ids: articulos.map((a) => a.id),
    content_type: 'product',
    value: aEuros(totales.totalCents),
    currency: 'EUR',
    // Meta lo usa para deduplicar entre el píxel del navegador y la API de
    // conversiones del servidor, si algún día se activa.
    eventID: numeroPedido,
  });
}

/** Búsqueda en la tienda: dice qué busca la gente y no encuentra. */
export function buscar(consulta: string, resultados: number): void {
  aGoogle('search', { search_term: consulta, resultados });
}
