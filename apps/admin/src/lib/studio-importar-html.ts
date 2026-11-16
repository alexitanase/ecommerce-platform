import { newId, type Capa, type Mesa, type Recuadro, type Relleno } from '@ecom/shared';

/**
 * Importar un fichero HTML y convertirlo en capas editables.
 *
 * La idea: en vez de adivinar cómo se maqueta un HTML leyendo su CSS —que es
 * reimplementar el navegador y salir perdiendo—, se le pide **al navegador**
 * que lo maquete y se le pregunta dónde ha puesto cada cosa. Se pinta en un
 * marco aislado del tamaño de la mesa, se recorre el árbol leyendo
 * `getBoundingClientRect` y `getComputedStyle`, y cada elemento con contenido
 * visible sale como una capa con su posición, su tipografía y sus colores ya
 * resueltos.
 *
 * Lo que se gana: capas de verdad, que se mueven, se reescriben y se adaptan a
 * otro formato como cualquier otra.
 *
 * Lo que se pierde, y conviene decirlo: **la maquetación fluida**. Lo que era
 * un `flex` que se recolocaba solo pasa a ser una posición absoluta. Para un
 * banner —lienzo de tamaño fijo— eso es exactamente lo que hace falta; para una
 * página, no. Quien quiera conservar el comportamiento original tiene la capa
 * `html`, que lo pinta tal cual sin descomponerlo.
 *
 * El marco va con `sandbox="allow-same-origin"` y **sin** `allow-scripts`: así
 * nada de lo que traiga el fichero se ejecuta, y aun así podemos leer su DOM
 * para medir. El saneado de verdad lo hace el servidor al guardar.
 */

/** Etiquetas que nunca aportan nada al recorrer: no se miran ni se entra en ellas. */
const IGNORADAS = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT']);

/** Por debajo de esto no es una capa, es un pelo suelto de la maquetación. */
const MINIMO_PX = 4;

export interface ResultadoImportacion {
  capas: Capa[];
  /** Imágenes referenciadas que habrá que subir a la biblioteca. */
  imagenesExternas: string[];
  avisos: string[];
}

/** Pinta el HTML en un marco aislado y devuelve su documento ya maquetado. */
async function maquetar(
  html: string,
  ancho: number,
  alto: number,
): Promise<{ doc: Document; limpiar: () => void }> {
  const marco = document.createElement('iframe');
  // Sin `allow-scripts`: el fichero puede traer cualquier cosa y aquí solo
  // queremos que el navegador lo MAQUETE, no que lo ejecute.
  marco.setAttribute('sandbox', 'allow-same-origin');
  marco.style.cssText = `position:fixed;left:-10000px;top:0;width:${ancho}px;height:${alto}px;border:0;visibility:hidden`;
  document.body.appendChild(marco);

  const doc = marco.contentDocument;
  if (!doc) {
    marco.remove();
    throw new Error('El navegador no ha dejado abrir el marco de importación');
  }

  doc.open();
  doc.write(html);
  doc.close();

  // Las imágenes tienen que haber cargado antes de medir: una `<img>` sin
  // cargar mide 0×0 y saldría como una capa diminuta en la esquina.
  await Promise.all(
    Array.from(doc.images).map(async (img) => {
      if (img.complete) return;
      await new Promise<void>((listo) => {
        img.addEventListener('load', () => listo(), { once: true });
        img.addEventListener('error', () => listo(), { once: true });
      });
    }),
  );

  return { doc, limpiar: () => marco.remove() };
}

const esVisible = (estilo: CSSStyleDeclaration): boolean =>
  estilo.display !== 'none' && estilo.visibility !== 'hidden' && Number(estilo.opacity) > 0.01;

/** Un color de CSS en hexadecimal; `undefined` si es transparente. */
function aHex(color: string): string | undefined {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+))?/i.exec(color);
  if (!m) return undefined;

  const alfa = m[4] === undefined ? 1 : Number(m[4]);
  if (alfa < 0.02) return undefined;

  const hex = [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');

  return `#${hex}${
    alfa < 1
      ? Math.round(alfa * 255)
          .toString(16)
          .padStart(2, '0')
      : ''
  }`;
}

/** Como `aHex`, pero conservando lo transparente: en un degradado es una parada. */
function aHexSiempre(color: string): string {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+))?/i.exec(color);
  if (!m) return '#000000';

  const alfa = m[4] === undefined ? 1 : Number(m[4]);
  const hex = [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
  const opacidad =
    alfa < 1
      ? Math.round(alfa * 255)
          .toString(16)
          .padStart(2, '0')
      : '';

  return `#${hex}${opacidad}`;
}

/**
 * Parte una lista de CSS por las comas de primer nivel.
 *
 * Con `split(',')` a secas se rompe cada `rgb(225, 29, 72)` en tres trozos, que
 * es exactamente lo que hace que un degradado importado salga en negro.
 */
function partirPorComas(texto: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let actual = '';

  for (const c of texto) {
    if (c === '(') nivel++;
    if (c === ')') nivel--;
    if (c === ',' && nivel === 0) {
      partes.push(actual.trim());
      actual = '';
    } else {
      actual += c;
    }
  }
  if (actual.trim()) partes.push(actual.trim());

  return partes;
}

/** `to right` y compañía, en grados. 0° es hacia arriba, como en CSS. */
const GRADOS_POR_PALABRA: Record<string, number> = {
  'to top': 0,
  'to top right': 45,
  'to right top': 45,
  'to right': 90,
  'to bottom right': 135,
  'to right bottom': 135,
  'to bottom': 180,
  'to bottom left': 225,
  'to left bottom': 225,
  'to left': 270,
  'to top left': 315,
  'to left top': 315,
};

/** Tope de paradas del esquema del documento. */
const MAX_PARADAS = 8;

/**
 * Convierte el `background-image` calculado en un relleno del documento.
 *
 * Devuelve `null` cuando no hay nada que traducir o cuando es un degradado que
 * el documento no sabe representar —cónico o repetido—, para que quien llama
 * pueda avisar en vez de dibujar algo que no es lo que había.
 *
 * Se lee del valor **calculado**, que el navegador ya ha normalizado: los
 * colores vienen siempre como `rgb()` o `rgba()`, y la dirección puede venir en
 * grados, en palabras (`to right`) o no venir —y entonces es hacia abajo, que
 * es el valor por defecto de CSS y el que más se olvida—.
 */
export function rellenoDeGradiente(backgroundImage: string): Relleno | null {
  if (!backgroundImage || backgroundImage === 'none') return null;

  // Puede haber varias capas de fondo superpuestas; nos quedamos con el primer
  // degradado que sepamos leer.
  for (const capa of partirPorComas(backgroundImage)) {
    const m = /^(linear|radial)-gradient\((.*)\)$/s.exec(capa.trim());
    if (!m) continue;

    const radial = m[1] === 'radial';
    const argumentos = partirPorComas(m[2] ?? '');
    if (argumentos.length < 2) continue;

    // El primer argumento es la dirección solo si no empieza por un color.
    const primero = argumentos[0] ?? '';
    const esDireccion =
      !/^(rgb|rgba|#|[a-z]+\s*$)/i.test(primero) || /^(to |at |circle|ellipse)/i.test(primero);

    let angulo = 180;
    if (esDireccion) {
      const grados = /(-?[\d.]+)deg/.exec(primero);
      if (grados) angulo = Number(grados[1]);
      else {
        const palabra = GRADOS_POR_PALABRA[primero.trim().toLowerCase()];
        if (palabra !== undefined) angulo = palabra;
      }
      argumentos.shift();
    }

    const crudas = argumentos.filter((a) => /rgba?\(/i.test(a));
    if (crudas.length < 2) continue;

    const usadas = crudas.slice(0, MAX_PARADAS);
    const paradas = usadas.map((parada, i) => {
      const posicion = /([\d.]+)%/.exec(parada.replace(/rgba?\([^)]*\)/gi, ''));
      return {
        posicion: posicion
          ? Math.min(1, Math.max(0, Number(posicion[1]) / 100))
          : i / Math.max(1, usadas.length - 1),
        color: aHexSiempre(parada),
      };
    });

    return {
      tipo: 'degradado',
      forma: radial ? 'radial' : 'lineal',
      // El esquema guarda el ángulo entre 0 y 360; CSS admite negativos.
      angulo: ((angulo % 360) + 360) % 360,
      paradas,
    };
  }

  return null;
}

/** El texto propio de un elemento, sin el de sus hijos con elementos dentro. */
function textoDirecto(el: Element): string {
  return Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

const alineacionDe = (valor: string): 'izquierda' | 'centro' | 'derecha' =>
  valor === 'center' ? 'centro' : valor === 'right' || valor === 'end' ? 'derecha' : 'izquierda';

/**
 * Convierte un HTML maquetado en capas.
 *
 * El recorrido emite, por cada elemento: una capa de imagen si es `<img>`, una
 * de forma si tiene fondo o borde propios, y una de texto si tiene texto suyo.
 * Un mismo `<div>` puede dar dos capas —el fondo y el titular— y así se pueden
 * mover por separado, que es justo lo que se quiere al retocar.
 */
export async function importarHtmlComoCapas(
  html: string,
  mesa: Mesa,
): Promise<ResultadoImportacion> {
  const { doc, limpiar } = await maquetar(html, mesa.ancho, mesa.alto);

  try {
    const capas: Capa[] = [];
    const imagenes = new Set<string>();
    const avisos: string[] = [];
    let orden = 0;

    const base = doc.body.getBoundingClientRect();

    const recuadroDe = (el: Element): Recuadro | null => {
      const r = el.getBoundingClientRect();
      if (r.width < MINIMO_PX || r.height < MINIMO_PX) return null;
      return {
        x: Math.round(r.left - base.left),
        y: Math.round(r.top - base.top),
        ancho: Math.round(r.width),
        alto: Math.round(r.height),
        rotacion: 0,
      };
    };

    const comun = (nombre: string, recuadro: Recuadro, estilo: CSSStyleDeclaration) => ({
      id: newId(),
      mesaId: mesa.id,
      orden: orden++,
      nombre,
      visible: true,
      bloqueada: false,
      opacidad: Math.min(1, Math.max(0, Number(estilo.opacity) || 1)),
      fusion: 'normal' as const,
      recuadro,
      anclaje: { x: 'izquierda' as const, y: 'arriba' as const },
    });

    const recorrer = (el: Element) => {
      if (IGNORADAS.has(el.tagName)) return;

      const estilo = doc.defaultView?.getComputedStyle(el);
      if (!estilo || !esVisible(estilo)) return;

      const recuadro = recuadroDe(el);

      if (recuadro) {
        if (el.tagName === 'IMG') {
          const src = (el as HTMLImageElement).getAttribute('src') ?? '';
          if (src) imagenes.add(src);
          capas.push({
            ...comun('Imagen', recuadro, estilo),
            tipo: 'imagen',
            // El activo se resuelve después: hay que subir la imagen a la
            // biblioteca para que exista dentro del Studio. Mientras tanto la
            // capa se ve como hueco, con su sitio ya reservado.
            activoId: '',
            ajuste:
              estilo.objectFit === 'contain'
                ? 'contener'
                : estilo.objectFit === 'fill'
                  ? 'estirar'
                  : 'cubrir',
            foco: { x: 0.5, y: 0.5 },
            radio: Math.round(parseFloat(estilo.borderTopLeftRadius) || 0),
          });
        } else {
          const fondo = aHex(estilo.backgroundColor);
          const borde = parseFloat(estilo.borderTopWidth) || 0;
          const imagenFondo = estilo.backgroundImage !== 'none' ? estilo.backgroundImage : '';
          const degradado = rellenoDeGradiente(imagenFondo);

          if (fondo || borde > 0 || imagenFondo) {
            // El degradado manda sobre el color de fondo porque en CSS se pinta
            // encima: un `background-color` debajo de un degradado opaco no se
            // ve, y traerlo en su lugar cambiaría la pieza.
            if (imagenFondo && !degradado) {
              const que = /url\(/i.test(imagenFondo)
                ? 'una imagen de fondo'
                : 'un degradado que el editor no sabe representar';
              avisos.push(`Se ha perdido ${que} de un <${el.tagName.toLowerCase()}>.`);
            }

            capas.push({
              ...comun('Fondo', recuadro, estilo),
              tipo: 'forma',
              forma: 'rectangulo',
              relleno:
                degradado ?? (fondo ? { tipo: 'solido', color: fondo } : { tipo: 'ninguno' }),
              radio: Math.round(parseFloat(estilo.borderTopLeftRadius) || 0),
              puntas: 5,
              ...(borde > 0 && aHex(estilo.borderTopColor)
                ? {
                    trazo: {
                      color: aHex(estilo.borderTopColor)!,
                      grosor: Math.round(borde),
                      alineacion: 'dentro' as const,
                      discontinuo: estilo.borderTopStyle === 'dashed',
                    },
                  }
                : {}),
            });
          }

          const texto = textoDirecto(el);
          if (texto) {
            const cuerpo = Math.round(parseFloat(estilo.fontSize) || 16);
            const interlineado = parseFloat(estilo.lineHeight);
            capas.push({
              ...comun(texto.slice(0, 40), recuadro, estilo),
              tipo: 'texto',
              contenido: { es: texto },
              fuente: 'marca',
              peso: Number(estilo.fontWeight) || 400,
              tamano: cuerpo,
              interlineado: Number.isFinite(interlineado) && cuerpo ? interlineado / cuerpo : 1.15,
              espaciado: parseFloat(estilo.letterSpacing) || 0,
              alineacion: alineacionDe(estilo.textAlign),
              alineacionVertical: 'arriba',
              transformar:
                estilo.textTransform === 'uppercase'
                  ? 'mayusculas'
                  : estilo.textTransform === 'lowercase'
                    ? 'minusculas'
                    : 'ninguna',
              color: aHex(estilo.color) ?? '#111111',
              // Lo importado se deja fijo: si se pusiera a encoger, un texto
              // que en el original cabía justo cambiaría de tamaño solo y
              // parecería que la importación lo ha estropeado.
              ajuste: 'fijo',
            });
          }
        }
      }

      for (const hijo of Array.from(el.children)) recorrer(hijo);
    };

    for (const hijo of Array.from(doc.body.children)) recorrer(hijo);

    if (capas.length === 0) {
      avisos.push('No se ha encontrado nada visible dentro del tamaño de la mesa.');
    }

    return { capas, imagenesExternas: [...imagenes], avisos };
  } finally {
    limpiar();
  }
}

/**
 * El HTML entero como una sola capa, sin descomponerlo.
 *
 * Es la otra mitad de la historia: hay piezas que no interesa despiezar —una
 * plantilla que ya funciona, un bloque con una animación CSS— y lo que se
 * quiere es meterla tal cual y tocar el código. Se separan las hojas de estilo
 * del cuerpo porque el bloque las aplica acotadas a su propia capa.
 */
export function importarHtmlComoBloque(html: string, mesa: Mesa, nombre = 'Bloque HTML'): Capa {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const css = Array.from(doc.querySelectorAll('style'))
    .map((e) => e.textContent ?? '')
    .join('\n');
  doc.querySelectorAll('style').forEach((e) => e.remove());

  return {
    id: newId(),
    mesaId: mesa.id,
    orden: 0,
    nombre,
    visible: true,
    bloqueada: false,
    opacidad: 1,
    fusion: 'normal',
    recuadro: { x: 0, y: 0, ancho: mesa.ancho, alto: mesa.alto, rotacion: 0 },
    anclaje: { x: 'estirar', y: 'estirar' },
    tipo: 'html',
    html: doc.body.innerHTML,
    css,
  };
}
