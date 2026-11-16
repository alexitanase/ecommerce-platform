import sanitizeHtml from 'sanitize-html';

/**
 * Limpieza del HTML de las descripciones.
 *
 * El HTML de una ficha llega de dos sitios y **ninguno es de fiar**: del
 * proveedor —cualquier vendedor de AliExpress escribe lo que quiere en la
 * descripción de su producto— y del editor del panel. Como la tienda lo pinta
 * tal cual, un `<script>` en una descripción importada sería código de un
 * tercero ejecutándose en nuestro dominio, con la sesión del cliente delante.
 *
 * Por eso se sanea al ENTRAR, no al salir: se guarda ya limpio. Sanear solo al
 * pintar deja la puerta abierta al siguiente sitio que lea el mismo campo —una
 * app, un canal de venta, un correo— y se olvide de hacerlo.
 *
 * Se usa `sanitize-html` y no una expresión regular propia a propósito: separar
 * HTML seguro de HTML peligroso tiene demasiadas esquinas —atributos con
 * `javascript:`, entidades codificadas, etiquetas sin cerrar, `<svg>` con
 * `onload`— para resolverlo a mano.
 */

/**
 * Lo que se permite en una descripción de producto.
 *
 * Deliberadamente corto. Una ficha necesita párrafos, listas, negrita, tablas de
 * medidas e imágenes; no necesita formularios, iframes, estilos propios ni
 * scripts. Todo lo que no esté aquí se cae, y con `nonTextTags` el CONTENIDO de
 * un `<script>` se cae también: sin eso, el código quedaría como texto visible
 * en medio de la descripción.
 */
const PERMITIDO: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'hr',
    'h2',
    'h3',
    'h4',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'small',
    'sup',
    'sub',
    'ul',
    'ol',
    'li',
    'blockquote',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'a',
    'img',
    'span',
    'div',
  ],
  allowedAttributes: {
    // `rel` está aquí porque lo añade `transformTags`: sin permitirlo, el
    // filtro de atributos borraba justo lo que acababa de poner y los enlaces
    // externos salían sin `noopener`.
    a: ['href', 'title', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  // Solo esquemas que no ejecutan nada. `data:` queda fuera aunque se use para
  // imágenes en línea: es la vía habitual para colar SVG con scripts dentro.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  // Un enlace a otro dominio sin esto deja que la página destino manipule la
  // nuestra a través de `window.opener`.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener noreferrer' }),
  },
};

/** HTML de descripción listo para guardar y pintar. */
export function sanearHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const limpio = sanitizeHtml(html, PERMITIDO).trim();
  return limpio === '' ? null : limpio;
}

/**
 * Convierte HTML en texto corrido.
 *
 * Para la descripción corta, que se usa en el listado, en las metaetiquetas y en
 * lo que se comparte en redes. Ahí el HTML no se pinta: se escapa y el cliente
 * ve `<p>Auriculares...` literalmente. Es lo que pasaba con lo importado, porque
 * la descripción corta se sacaba recortando la larga a 500 caracteres —con sus
 * etiquetas y cortada a mitad de una.
 *
 * Los bloques se separan con un espacio en vez de pegarse: sin eso,
 * `<li>Rojo</li><li>Azul</li>` acaba en «RojoAzul».
 */
export function aTextoPlano(html: string | null | undefined): string | null {
  if (!html) return null;

  /*
   * El espacio se mete ANTES de aplanar.
   *
   * Quitar etiquetas sin más pega los textos de bloques contiguos:
   * `<li>Rojo</li><li>Azul</li>` se convertía en «RojoAzul». Se marca el cierre
   * de cada bloque con un espacio y luego se colapsa el espacio de sobra.
   */
  const separado = html.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|td|th)\s*>|<br\s*\/?>/gi, ' ');

  const texto = sanitizeHtml(separado, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  })
    // `sanitize-html` deja las entidades decodificadas, así que aquí ya es texto.
    .replace(/\s+/g, ' ')
    .trim();

  return texto === '' ? null : texto;
}

/**
 * Descripción corta a partir de lo que haya.
 *
 * Corta por la última frase o palabra completa que quepa, no por el carácter
 * `limite`: «Auriculares con cancelación de ruido y 40 h de bat» no es un
 * resumen, es un texto roto.
 */
export function resumen(html: string | null | undefined, limite = 300): string | null {
  const texto = aTextoPlano(html);
  if (!texto) return null;
  if (texto.length <= limite) return texto;

  const recortado = texto.slice(0, limite);

  // Se prefiere cerrar en un punto si hay uno razonablemente cerca del final;
  // si no, en el último espacio.
  const punto = recortado.lastIndexOf('. ');
  if (punto > limite * 0.5) return recortado.slice(0, punto + 1);

  const espacio = recortado.lastIndexOf(' ');
  return `${espacio > 0 ? recortado.slice(0, espacio) : recortado}…`;
}
