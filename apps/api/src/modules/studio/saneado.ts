import sanitizeHtml from 'sanitize-html';
import type { Capa, Documento } from '@ecom/shared';

/**
 * Saneado del marcado que entra en un documento.
 *
 * El Studio deja subir un fichero HTML, pegar un bloque e importar un SVG, y
 * todo eso acaba pintándose **dentro del panel de administración**, en el mismo
 * origen donde vive la sesión de quien tiene todos los permisos. Un `<script>`
 * en una plantilla que alguien se descargó de internet es un XSS almacenado con
 * acceso a los pedidos, a los clientes y a las claves de las pasarelas.
 *
 * Por eso se sanea **en el servidor al guardar** y no solo en el navegador al
 * importar: una limpieza que solo corre en el cliente no protege de nada —basta
 * llamar a la API directamente— y el documento guardado lo van a pintar después
 * el editor, el renderizador y el correo.
 *
 * Lo que se quita no se avisa: quien pega una plantilla con un contador de
 * visitas no quiere una negociación, quiere su banner.
 */

/**
 * Etiquetas que puede llevar una creatividad.
 *
 * Deliberadamente corta. No hay formularios, ni `<iframe>`, ni `<video>`: una
 * pieza que se va a rasterizar a PNG no los necesita, y cada etiqueta de más es
 * superficie de ataque a cambio de nada.
 */
const ETIQUETAS_HTML = [
  'div',
  'span',
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'small',
  'sub',
  'sup',
  'mark',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'figure',
  'figcaption',
  'blockquote',
  'a',
  'img',
  'picture',
  'source',
];

/*
 * `<style>` NO está en la lista, y la propia librería avisa de por qué: una
 * etiqueta de estilo dentro del marcado es un agujero por su cuenta —selectores
 * de atributo con `background: url(...)` sacan datos del panel a un servidor
 * ajeno sin ejecutar una línea de JavaScript—.
 *
 * No hace falta para nada: el CSS de un bloque vive en su propio campo, se
 * sanea aparte y se aplica acotado a la capa. El importador ya separa las hojas
 * del cuerpo al traer un fichero.
 */

/** Las de un SVG. `foreignObject` queda fuera: es la puerta de vuelta al HTML. */
const ETIQUETAS_SVG = [
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'pattern',
  'clipPath',
  'mask',
  'filter',
  'feGaussianBlur',
  'feOffset',
  'feBlend',
  'feColorMatrix',
  'feComposite',
  'feFlood',
  'feMerge',
  'feMergeNode',
];

/**
 * El parser no puede tocar las mayúsculas.
 *
 * En SVG la caja importa: `linearGradient`, `clipPath` y `viewBox` no existen
 * en minúsculas. Con la configuración por defecto, sanear un SVG lo deja
 * sintácticamente correcto y visualmente roto —degradados que no aplican,
 * recortes que no recortan— sin un solo error por ningún lado.
 */
const PARSER = { lowerCaseTags: false, lowerCaseAttributeNames: false };

/** Esquemas de URL admitidos. `javascript:` no está, que es el motivo de la lista. */
const ESQUEMAS = ['http', 'https', 'data', 'mailto', 'tel'];

const COMUNES = ['style', 'class', 'id', 'title', 'lang', 'dir'];

const OPCIONES_HTML: sanitizeHtml.IOptions = {
  allowedTags: [...ETIQUETAS_HTML, ...ETIQUETAS_SVG],
  allowedAttributes: {
    '*': [...COMUNES, 'width', 'height', 'align', 'valign', 'colspan', 'rowspan'],
    a: [...COMUNES, 'href', 'target', 'rel'],
    img: [...COMUNES, 'src', 'alt', 'srcset', 'sizes', 'loading', 'width', 'height'],
    source: ['src', 'srcset', 'type', 'media', 'sizes'],
    // En SVG los atributos SON el dibujo, así que la lista es larga a la
    // fuerza. Lo que no está aquí —`onload`, `href` externo en `use`— es
    // justamente lo que no queremos.
    svg: [
      ...COMUNES,
      'viewBox',
      'xmlns',
      'xmlns:xlink',
      'width',
      'height',
      'fill',
      'stroke',
      'preserveAspectRatio',
      'role',
      'aria-hidden',
      'focusable',
    ],
    '*svg*': [],
  },
  allowedSchemes: ESQUEMAS,
  allowedSchemesByTag: { img: ['http', 'https', 'data'], a: ['http', 'https', 'mailto', 'tel'] },
  // Lo que se descarta se descarta entero, contenido incluido: dejar el texto
  // de dentro de un `<script>` suelto en la pieza es peor que quitarlo.
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed'],
  parser: PARSER,
};

/**
 * Atributos de presentación del SVG.
 *
 * Van aparte porque son decenas y se aplican a casi cualquier elemento: sin
 * ellos, sanear un logotipo devuelve la silueta en negro.
 */
const ATRIBUTOS_SVG = [
  'd',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'transform',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'points',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'patternUnits',
  'viewBox',
  'preserveAspectRatio',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'stdDeviation',
  'in',
  'in2',
  'result',
  'values',
  'type',
  'mode',
  'flood-color',
  'flood-opacity',
];

const OPCIONES_SVG: sanitizeHtml.IOptions = {
  allowedTags: ETIQUETAS_SVG,
  allowedAttributes: {
    '*': [...COMUNES, ...ATRIBUTOS_SVG],
    svg: [...COMUNES, ...ATRIBUTOS_SVG, 'xmlns', 'xmlns:xlink', 'role', 'aria-hidden'],
  },
  allowedSchemes: ['data'],
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'foreignObject'],
  parser: PARSER,
};

/**
 * Quita de un valor de estilo lo que puede ejecutar algo.
 *
 * `style` se deja pasar entero porque es lo que da forma a la pieza, pero hay
 * dos formas históricas de meter código por ahí y no cuesta nada cerrarlas.
 */
const limpiarEstilos = (marcado: string): string =>
  marcado
    .replace(/expression\s*\(/gi, '(')
    .replace(/url\s*\(\s*['"]?\s*javascript:/gi, 'url(')
    .replace(/javascript\s*:/gi, '');

export const sanearHtml = (html: string): string =>
  limpiarEstilos(sanitizeHtml(html, OPCIONES_HTML));

export const sanearSvg = (svg: string): string => limpiarEstilos(sanitizeHtml(svg, OPCIONES_SVG));

/**
 * CSS de un bloque importado.
 *
 * Se corta lo que sale de la propia hoja: `@import` trae CSS de fuera —que
 * además delata al servidor de terceros la IP de quien edita— y un `</style>`
 * incrustado cierra la etiqueta antes de tiempo y deja escribir marcado libre
 * en la página.
 */
export const sanearCss = (css: string): string =>
  limpiarEstilos(css)
    .replace(/@import[^;]*;?/gi, '')
    .replace(/<\/?\s*style/gi, '')
    .replace(/<!--|-->/g, '');

/**
 * Devuelve el documento con todo su marcado saneado.
 *
 * Se recorre entero en cada guardado. Es barato —son cadenas— y es la única
 * forma de que no importe por dónde entró el contenido: importador, pegado a
 * mano, plantilla o una llamada directa a la API.
 */
export function sanearDocumento(documento: Documento): Documento {
  return {
    ...documento,
    capas: documento.capas.map((capa): Capa => {
      if (capa.tipo === 'html') {
        return { ...capa, html: sanearHtml(capa.html), css: sanearCss(capa.css) };
      }
      if (capa.tipo === 'vector') {
        return { ...capa, svg: sanearSvg(capa.svg) };
      }
      return capa;
    }),
  };
}
