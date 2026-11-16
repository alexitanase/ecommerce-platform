import type { Capa, CapaTexto, Documento, Recuadro, Relleno } from '@ecom/shared';
import { resolverColor } from '@ecom/shared';

/**
 * Lo que el motor de dibujo necesita saber y no es un componente.
 *
 * Vive aparte de `capas.tsx` por un motivo muy concreto: React Fast Refresh
 * solo sabe recargar en caliente un módulo que exporte **únicamente**
 * componentes. Teniendo aquí dentro constantes y funciones, cada retoque del
 * renderizador invalidaba el módulo entero y, si la pestaña llevaba abierta
 * desde antes, el editor se caía con un «does not provide an export named…»
 * que no tiene nada que ver con el cambio que se acababa de hacer.
 */

/** Familias tipográficas disponibles mientras no exista el kit de marca. */
export const FUENTES: Record<string, string> = {
  marca: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, Roboto, sans-serif',
  sistema: 'system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

export const familiaDe = (fuente: string): string => FUENTES[fuente] ?? FUENTES['marca']!;

// ── Medida de texto ───────────────────────────────────────

let contexto: CanvasRenderingContext2D | null = null;

/**
 * Ancho de un texto, en píxeles del documento.
 *
 * Se mide con un canvas y no consultando el DOM porque hay que medir cientos de
 * veces por segundo mientras se arrastra: cada lectura de geometría del DOM
 * fuerza un reflow, y eso convierte un arrastre suave en un arrastre a saltos.
 */
export function medirTexto(texto: string, tamano: number, peso: number, fuente: string): number {
  if (typeof document === 'undefined') return texto.length * tamano * 0.5;
  contexto ??= document.createElement('canvas').getContext('2d');
  if (!contexto) return texto.length * tamano * 0.5;

  contexto.font = `${peso} ${tamano}px ${familiaDe(fuente)}`;
  return contexto.measureText(texto).width;
}

/** Cuántas líneas ocuparía el texto a ese cuerpo, con el ancho dado. */
function contarLineas(texto: string, ancho: number, tamano: number, capa: CapaTexto): number {
  let lineas = 0;

  for (const parrafo of texto.split('\n')) {
    let actual = '';
    lineas++;
    for (const palabra of parrafo.split(/\s+/)) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (actual && medirTexto(prueba, tamano, capa.peso, capa.fuente) > ancho) {
        lineas++;
        actual = palabra;
      } else {
        actual = prueba;
      }
    }
  }

  return lineas;
}

/**
 * El cuerpo con el que el texto cabe en su caja.
 *
 * El corte de línea lo hace CSS, que sabe hacerlo mejor que nosotros. Lo que sí
 * se calcula aquí es **el tamaño**, porque hay que decidirlo antes de pintar y
 * el resultado tiene que ser idéntico en el editor y en la exportación: midiendo
 * del DOM ya pintado, cada uno elegiría el suyo y el archivo saldría distinto de
 * lo que se vio.
 *
 * El modo `encoger` es el que evita el problema de verdad: el mismo titular en
 * catalán o en inglés es más largo, y en un lote de treinta banners nadie los
 * revisa uno a uno. Un titular tres puntos más pequeño se vende igual; uno
 * cortado, no.
 */
export function cuerpoQueCabe(capa: CapaTexto, contenido: string): number {
  if (capa.ajuste !== 'encoger' || !contenido) return capa.tamano;

  const { ancho, alto } = capa.recuadro;
  let tamano = capa.tamano;

  // Cuatro píxeles es el suelo: por debajo no se lee, y encoger más solo
  // disimula que ahí no cabía ese texto.
  while (
    tamano > 4 &&
    contarLineas(contenido, ancho, tamano, capa) * tamano * capa.interlineado > alto
  ) {
    tamano -= 1;
  }

  return tamano;
}

// ── Piezas comunes ────────────────────────────────────────

export const ALINEACION: Record<string, string> = {
  izquierda: 'flex-start',
  centro: 'center',
  derecha: 'flex-end',
  arriba: 'flex-start',
  abajo: 'flex-end',
};

/** Estilos que comparten todas las capas: posición, giro, opacidad y sombra. */
export function estiloBase(capa: Capa, doc: Documento): React.CSSProperties {
  const r: Recuadro = capa.recuadro;

  return {
    position: 'absolute',
    left: r.x,
    top: r.y,
    width: r.ancho,
    height: r.alto,
    ...(r.rotacion ? { transform: `rotate(${r.rotacion}deg)` } : {}),
    ...(capa.opacidad !== 1 ? { opacity: capa.opacidad } : {}),
    ...(capa.fusion !== 'normal'
      ? { mixBlendMode: capa.fusion as React.CSSProperties['mixBlendMode'] }
      : {}),
    ...(capa.sombra
      ? {
          boxShadow: `${capa.sombra.interior ? 'inset ' : ''}${capa.sombra.x}px ${capa.sombra.y}px ${capa.sombra.desenfoque}px ${capa.sombra.extension}px ${resolverColor(doc, capa.sombra.color)}`,
        }
      : {}),
  };
}

/** Un relleno del documento, como valor de `background`. */
export function fondoCss(relleno: Relleno, doc: Documento, urls: Record<string, string>): string {
  if (relleno.tipo === 'ninguno') return 'transparent';
  if (relleno.tipo === 'solido') return resolverColor(doc, relleno.color);

  if (relleno.tipo === 'degradado') {
    const paradas = relleno.paradas
      .map((p) => `${resolverColor(doc, p.color)} ${Math.round(p.posicion * 100)}%`)
      .join(', ');

    return relleno.forma === 'radial'
      ? `radial-gradient(circle, ${paradas})`
      : `linear-gradient(${relleno.angulo}deg, ${paradas})`;
  }

  const url = relleno.activoId ? urls[relleno.activoId] : undefined;
  return url ? `center / cover no-repeat url("${url}")` : 'rgba(148,163,184,.35)';
}

export const trazoCss = (
  trazo: { color: string; grosor: number; discontinuo: boolean } | undefined,
  doc: Documento,
): React.CSSProperties =>
  trazo
    ? {
        border: `${trazo.grosor}px ${trazo.discontinuo ? 'dashed' : 'solid'} ${resolverColor(doc, trazo.color)}`,
        boxSizing: 'border-box',
      }
    : {};

/** `clip-path` de las formas que no son un rectángulo ni una elipse. */
export function recorteDeForma(forma: string, puntas: number): string | undefined {
  if (forma === 'triangulo') return 'polygon(50% 0%, 100% 100%, 0% 100%)';
  if (forma !== 'estrella') return undefined;

  const puntos: string[] = [];
  for (let i = 0; i < puntas * 2; i++) {
    const radio = i % 2 === 0 ? 50 : 22.5;
    const angulo = (Math.PI / puntas) * i - Math.PI / 2;
    puntos.push(
      `${(50 + Math.cos(angulo) * radio).toFixed(2)}% ${(50 + Math.sin(angulo) * radio).toFixed(2)}%`,
    );
  }
  return `polygon(${puntos.join(', ')})`;
}

/**
 * Acota el CSS de un bloque importado a su propia capa.
 *
 * Sin esto, un `p { color: red }` de una plantilla que alguien pegue repintaría
 * medio panel de administración. No es un saneador —eso se hace en el
 * servidor—: es evitar que el estilo se escape de su caja.
 */
export function acotarCss(css: string, capaId: string): string {
  return css.replace(
    /(^|\})\s*([^@{}]+)\{/g,
    (_, cierre: string, selector: string) =>
      `${cierre} [data-capa="${capaId}"] ${selector.trim()}{`,
  );
}

/**
 * El espacio de nombres de XHTML, que React no tipa en un `<div>`.
 *
 * Lo emite igual, y hace falta: sin él, el marcado dentro de un
 * `<foreignObject>` no lo rasteriza el navegador y la exportación sale en
 * blanco sin un solo error. Va en una constante convertida a mano para no
 * repartir conversiones por el componente.
 */
export const XMLNS_XHTML = {
  xmlns: 'http://www.w3.org/1999/xhtml',
} as unknown as React.HTMLAttributes<HTMLDivElement>;

export interface ContextoRender {
  documento: Documento;
  /** URL de cada activo por id. El editor la trae de la biblioteca. */
  activos: Record<string, string>;
}
