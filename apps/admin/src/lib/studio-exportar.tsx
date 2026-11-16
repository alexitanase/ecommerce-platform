import type { Documento, Mesa } from '@ecom/shared';
import { MesaHTML } from '@/componentes/studio/render/capas';

/**
 * Exportación estática desde el navegador.
 *
 * Se hace aquí y no en el servidor porque no necesita infraestructura ninguna:
 * el primer banner sale el día uno, sin contenedor de renderizado, sin cola y
 * sin GPU. Lo animado —GIF y MP4— sí exige servidor y llega en la fase B; esto
 * cubre PNG, JPG y WebP, que es el 80 % de lo que pide una red de anuncios.
 *
 * **Cómo se rasteriza HTML.** El navegador no sabe volcar un árbol de `<div>` a
 * un canvas: no existe esa API. Lo que sí sabe es rasterizar un SVG, y un SVG
 * puede llevar HTML dentro en un `<foreignObject>`. Así que se serializa el
 * MISMO componente que pinta el editor, se envuelve, se carga como imagen y se
 * vuelca. No hay un segundo motor de dibujo que pueda no coincidir con lo que
 * se ve en pantalla, que es el fallo clásico de las librerías que reimplementan
 * la maquetación por su cuenta.
 *
 * Tres detalles sin los cuales esto no funciona, y ninguno avisa al fallar:
 *
 *  · El `<div>` raíz necesita `xmlns` de XHTML. Sin él la imagen no carga.
 *  · Dentro tiene que ser XML válido. Un `<br>` suelto de un bloque importado
 *    rompe el documento entero, así que se normaliza antes de envolver.
 *  · Las imágenes tienen que ir en `data:`. Vienen de otro origen y, si no, el
 *    canvas queda contaminado y `toBlob` lanza una excepción de seguridad.
 */

export type TipoExportacion = 'png' | 'jpg' | 'webp';

const MIME: Record<TipoExportacion, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * Descarga las imágenes y las convierte en `data:`.
 *
 * Sin esto el canvas queda «contaminado» —las imágenes vienen de otro origen— y
 * `toBlob` lanza una excepción de seguridad. El error del navegador no dice
 * nada útil, así que conviene recordar por qué está este paso.
 */
async function incrustarActivos(urls: Record<string, string>): Promise<Record<string, string>> {
  const entradas = await Promise.all(
    Object.entries(urls).map(async ([id, url]) => {
      if (!url || url.startsWith('data:')) return [id, url] as const;
      try {
        const respuesta = await fetch(url, { mode: 'cors' });
        const blob = await respuesta.blob();
        const datos = await new Promise<string>((resolver, rechazar) => {
          const lector = new FileReader();
          lector.onload = () =>
            typeof lector.result === 'string'
              ? resolver(lector.result)
              : rechazar(new Error('La imagen no se ha leído como texto'));
          lector.onerror = () => rechazar(new Error('No se ha podido leer la imagen'));
          lector.readAsDataURL(blob);
        });
        return [id, datos] as const;
      } catch {
        // Una imagen que no se puede traer se deja fuera: el resto de la pieza
        // se exporta igual y el hueco se ve, que es más útil que fallar entera.
        return [id, ''] as const;
      }
    }),
  );

  return Object.fromEntries(entradas);
}

/**
 * Deja el marcado como XML válido.
 *
 * React ya cierra sus etiquetas, pero un bloque de HTML importado no tiene por
 * qué: basta un `<br>` o un `<img>` sin cerrar para que el `<foreignObject>`
 * deje de parsear y la exportación salga en blanco. Se pasa por el parser de
 * HTML del navegador —que perdona todo— y se vuelve a serializar como XML, que
 * no perdona nada.
 */
function comoXml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const raiz = doc.body.firstElementChild;
  if (!raiz) return html;
  return new XMLSerializer().serializeToString(raiz);
}

/**
 * El HTML de una mesa, como cadena XML.
 *
 * `incrustar` decide si las imágenes viajan dentro como `data:`. Para exportar
 * hace falta —si no, el canvas queda contaminado—; para enseñar el código no,
 * porque convierte una foto en cien mil caracteres de base64 y deja el panel
 * ilegible.
 */
export async function marcadoDeMesa(
  documento: Documento,
  mesa: Mesa,
  activos: Record<string, string>,
  opciones: { incrustar?: boolean } = {},
): Promise<string> {
  // `react-dom/server` se carga solo aquí. Son ~100 kB que no hacen ninguna
  // falta para editar, y el editor ya es la pantalla más pesada del panel.
  const [{ renderToStaticMarkup }, imagenes] = await Promise.all([
    import('react-dom/server'),
    opciones.incrustar === false ? Promise.resolve(activos) : incrustarActivos(activos),
  ]);

  return comoXml(
    renderToStaticMarkup(<MesaHTML mesa={mesa} documento={documento} activos={imagenes} />),
  );
}

/**
 * Sangra el marcado para poder leerlo.
 *
 * `renderToStaticMarkup` devuelve una sola línea de varios miles de caracteres:
 * técnicamente correcta e inservible para mirarla. Se recorre el árbol y se
 * escribe con saltos, en vez de meter saltos a base de expresiones regulares,
 * que es lo que rompe el contenido de los elementos con texto dentro.
 */
export function formatearHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const raiz = doc.body.firstElementChild;
  if (!raiz) return html;

  const escribir = (el: Element, nivel: number): string => {
    const sangria = '  '.repeat(nivel);
    const atributos = Array.from(el.attributes)
      .map((a) => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`)
      .join('');
    const etiqueta = el.tagName.toLowerCase();
    const hijos = Array.from(el.children);

    // Sin hijos: en una línea, con su texto si lo tiene.
    if (hijos.length === 0) {
      const texto = (el.textContent ?? '').trim();
      return texto
        ? `${sangria}<${etiqueta}${atributos}>${texto}</${etiqueta}>`
        : `${sangria}<${etiqueta}${atributos}></${etiqueta}>`;
    }

    const dentro = hijos.map((h) => escribir(h, nivel + 1)).join('\n');
    return `${sangria}<${etiqueta}${atributos}>\n${dentro}\n${sangria}</${etiqueta}>`;
  };

  return escribir(raiz, 0);
}

/** Rasteriza el marcado envolviéndolo en un SVG con `foreignObject`. */
async function aCanvas(marcado: string, ancho: number, alto: number): Promise<HTMLCanvasElement> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}"><foreignObject width="${ancho}" height="${alto}">${marcado}</foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const imagen = await new Promise<HTMLImageElement>((resolver, rechazar) => {
    const img = new Image();
    img.onload = () => resolver(img);
    img.onerror = () =>
      rechazar(
        new Error(
          'El dibujo no se ha podido rasterizar. Suele ser un bloque de HTML que no cierra alguna etiqueta.',
        ),
      );
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no ha dado un contexto 2D');

  // Fondo blanco para JPEG: sin él, lo transparente sale negro y el banner
  // aparece con un marco oscuro que nadie ha pedido.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(imagen, 0, 0, ancho, alto);

  return canvas;
}

const aBlob = (canvas: HTMLCanvasElement, mime: string, calidad?: number): Promise<Blob> =>
  new Promise((resolver, rechazar) => {
    canvas.toBlob(
      (blob) => (blob ? resolver(blob) : rechazar(new Error('La exportación ha salido vacía'))),
      mime,
      calidad,
    );
  });

export interface Exportacion {
  blob: Blob;
  bytes: number;
  /** Calidad con la que se consiguió entrar en el peso, si hubo que bajarla. */
  calidad?: number;
  /** Si no se ha conseguido bajar del máximo del formato. */
  excedeMaximo: boolean;
}

/**
 * Exporta una mesa, buscando entrar en el peso que admite el formato.
 *
 * 150 KB es poquísimo para un 728×90 con foto, así que la calidad se baja por
 * pasos hasta que entra. Se hace aquí y no se deja al ojo de quien exporta
 * porque el rechazo de la red llega días después, en su cola de revisión, con
 * la campaña ya parada.
 *
 * Con PNG no hay calidad que bajar: si no entra, se dice y se sugiere JPG.
 */
export async function exportarMesa(
  documento: Documento,
  mesa: Mesa,
  activos: Record<string, string>,
  tipo: TipoExportacion,
  pesoMaxKb?: number,
): Promise<Exportacion> {
  const marcado = await marcadoDeMesa(documento, mesa, activos);
  const canvas = await aCanvas(marcado, mesa.ancho, mesa.alto);
  const mime = MIME[tipo];
  const maximo = pesoMaxKb ? pesoMaxKb * 1024 : Infinity;

  if (tipo === 'png') {
    const blob = await aBlob(canvas, mime);
    return { blob, bytes: blob.size, excedeMaximo: blob.size > maximo };
  }

  for (const calidad of [0.92, 0.85, 0.78, 0.7, 0.6, 0.5, 0.4]) {
    const blob = await aBlob(canvas, mime, calidad);
    if (blob.size <= maximo) return { blob, bytes: blob.size, calidad, excedeMaximo: false };
  }

  const ultimo = await aBlob(canvas, mime, 0.35);
  return { blob: ultimo, bytes: ultimo.size, calidad: 0.35, excedeMaximo: ultimo.size > maximo };
}

/**
 * La pieza como fichero HTML suelto.
 *
 * Es la entrega que piden los formatos «en iframe» de las redes, y de paso la
 * forma de sacar el trabajo de aquí sin perderlo: un `.html` se abre en
 * cualquier sitio y se vuelve a importar al Studio.
 */
export async function exportarHtml(
  documento: Documento,
  mesa: Mesa,
  activos: Record<string, string>,
  titulo: string,
): Promise<Blob> {
  const marcado = await marcadoDeMesa(documento, mesa, activos);

  const pagina = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${titulo.replace(/[<>&]/g, '')}</title>
<style>html,body{margin:0;padding:0}body{width:${mesa.ancho}px;height:${mesa.alto}px;overflow:hidden}</style>
</head>
<body>
${marcado}
</body>
</html>`;

  return new Blob([pagina], { type: 'text/html;charset=utf-8' });
}

/** Guarda el archivo con un nombre que se entienda dentro de seis meses. */
export function descargar(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  // Sin revocar, cada exportación deja el archivo entero retenido en memoria.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `rebajas-verano_300x250_es.jpg` */
export const nombreDeArchivo = (
  creatividad: string,
  mesa: Mesa,
  locale: string,
  tipo: TipoExportacion | 'html',
): string => {
  const base = creatividad
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${base || 'creatividad'}_${mesa.ancho}x${mesa.alto}_${locale}.${tipo}`;
};
