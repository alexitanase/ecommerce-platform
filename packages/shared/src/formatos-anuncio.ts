/**
 * Catálogo de formatos de anuncio.
 *
 * Cada red de publicidad tiene sus tamaños, sus pesos máximos y sus límites de
 * caracteres, y no se parecen entre sí. Esa letra pequeña vive aquí, en el
 * código, por el mismo motivo que la de los canales de captación: si no está
 * escrita acaba en la cabeza de quien la averiguó, y dentro de seis meses hay
 * que volver a buscarla.
 *
 * Lo que de verdad paga esta lista es el validador: una creatividad que pesa
 * 160 KB no da ningún error al exportarla, la rechaza la red **días después**,
 * en su cola de revisión, cuando la campaña ya tenía que estar corriendo.
 *
 * Dos avisos que conviene no perder de vista:
 *
 *  · **Estas cifras caducan.** Cada formato lleva la fecha en que se comprobó y
 *    de dónde salió el dato. `revisionCaducada` avisa a partir de los seis
 *    meses; antes de una campaña grande se vuelve a mirar la documentación de
 *    la red.
 *  · **No todo está publicado.** Donde la red no publica un límite —duración de
 *    un GIF, número de bucles— se adopta la convención del IAB (15 segundos y
 *    3 bucles) y se dice en las notas. Es una convención nuestra, no su norma.
 */

/** De quién es el formato. */
export type RedAnuncio =
  'exoclick' | 'trafficstars' | 'trafficjunky' | 'juicyads' | 'social' | 'tienda' | 'correo';

/** Qué clase de hueco ocupa. Agrupa la lista en la interfaz. */
export type FamiliaFormato =
  'display' | 'nativo' | 'push' | 'intersticial' | 'video' | 'social' | 'tienda' | 'correo';

export type TipoArchivo = 'jpg' | 'png' | 'webp' | 'gif' | 'mp4' | 'webm' | 'html5';

/**
 * De dónde sale el dato, que es tan importante como el dato.
 *
 * `terceros` significa que lo hemos leído en una guía y no en el panel de la
 * red. Sirve para diseñar, no para dar por buena una entrega: la interfaz lo
 * marca y el validador avisa en vez de bloquear.
 */
export type FuenteFormato = 'oficial' | 'terceros' | 'convencion' | 'propio';

/** Márgenes que la interfaz de la app tapa, en píxeles del tamaño nominal. */
export interface ZonaSegura {
  arriba?: number;
  abajo?: number;
  izquierda?: number;
  derecha?: number;
}

/** Máximo de caracteres de los textos que acompañan a la imagen. */
export interface LimitesTexto {
  titulo?: number;
  descripcion?: number;
  marca?: number;
}

export interface FormatoAnuncio {
  /** `red.familia.tamaño`, estable: viaja en la base de datos. */
  clave: string;
  red: RedAnuncio;
  familia: FamiliaFormato;
  nombre: string;
  ancho: number;
  alto: number;
  /** Tipos de archivo que acepta la red para este hueco. */
  tipos: TipoArchivo[];
  /** Peso máximo de la entrega estática, en kilobytes. */
  pesoMaxKb: number;
  /** Peso máximo cuando la entrega es vídeo, si difiere del estático. */
  pesoMaxVideoKb?: number;
  duracionMaxS?: number;
  buclesMax?: number;
  textos?: LimitesTexto;
  zonaSegura?: ZonaSegura;
  fuente: FuenteFormato;
  /** Cuándo se comprobó, en AAAA-MM-DD. */
  revisado: string;
  notas?: string;
}

/** Convención del IAB para banners animados, que ninguna red nuestra publica. */
export const ANIMACION_POR_CONVENCION = { duracionMaxS: 15, buclesMax: 3 } as const;

const IAB = ANIMACION_POR_CONVENCION;

/** Fecha de la última revisión de las fichas oficiales. */
const REV_EXOCLICK = '2026-08-09';
const REV_TERCEROS = '2026-08-09';
const REV_PROPIO = '2026-08-09';

// ═════════════════════════════════════════════════════════════
//  ExoClick · https://www.exoclick.com/advertisers/ad-formats/
// ═════════════════════════════════════════════════════════════
//
// Su documentación publica 150 KB como norma general desde 2020 y menciona
// 300 KB en una nota sobre los tamaños IAB clásicos. El catálogo se queda con
// el valor conservador: que te acepten un archivo de menos no cuesta nada, que
// te lo rechacen sí.
//
// Los banners adhesivos (sticky) y el pie grande usan estos mismos tamaños con
// otra colocación, así que no se duplican: se anota en las notas.

const EXOCLICK: FormatoAnuncio[] = [
  {
    clave: 'exoclick.display.300x250',
    red: 'exoclick',
    familia: 'display',
    nombre: 'Rectángulo medio 300×250',
    ancho: 300,
    alto: 250,
    tipos: ['jpg', 'png', 'gif', 'mp4'],
    pesoMaxKb: 150,
    pesoMaxVideoKb: 1500,
    ...IAB,
    fuente: 'oficial',
    revisado: REV_EXOCLICK,
    notas:
      'El tamaño más vendido de la red y el que más inventario tiene. Sirve también como banner adhesivo y como banner dentro de vídeo.',
  },
  {
    clave: 'exoclick.display.300x100',
    red: 'exoclick',
    familia: 'display',
    nombre: 'Banner móvil 300×100',
    ancho: 300,
    alto: 100,
    tipos: ['jpg', 'png', 'gif', 'mp4'],
    pesoMaxKb: 150,
    pesoMaxVideoKb: 1500,
    ...IAB,
    fuente: 'oficial',
    revisado: REV_EXOCLICK,
    notas: 'Apaisado extremo: cabe un titular corto y poco más. El logo suele estorbar.',
  },
  {
    clave: 'exoclick.display.300x500',
    red: 'exoclick',
    familia: 'display',
    nombre: 'Vertical 300×500',
    ancho: 300,
    alto: 500,
    tipos: ['jpg', 'png', 'gif'],
    pesoMaxKb: 150,
    ...IAB,
    fuente: 'oficial',
    revisado: REV_EXOCLICK,
  },
  {
    clave: 'exoclick.display.728x90',
    red: 'exoclick',
    familia: 'display',
    nombre: 'Cabecera 728×90',
    ancho: 728,
    alto: 90,
    tipos: ['jpg', 'png', 'gif', 'mp4'],
    pesoMaxKb: 150,
    pesoMaxVideoKb: 1500,
    ...IAB,
    fuente: 'oficial',
    revisado: REV_EXOCLICK,
    notas: 'Solo escritorio. Sirve también como banner dentro de vídeo.',
  },
  {
    clave: 'exoclick.display.160x600',
    red: 'exoclick',
    familia: 'display',
    nombre: 'Rascacielos 160×600',
    ancho: 160,
    alto: 600,
    tipos: ['jpg', 'png', 'gif', 'mp4'],
    pesoMaxKb: 150,
    pesoMaxVideoKb: 1500,
    ...IAB,
    fuente: 'oficial',
    revisado: REV_EXOCLICK,
    notas: 'Vertical y estrechísimo: el texto va apilado o no se lee.',
  },
  {
    clave: 'exoclick.display.900x250',
    red: 'exoclick',
    familia: 'display',
    nombre: 'Pie grande 900×250',
    ancho: 900,
    alto: 250,
    tipos: ['jpg', 'png', 'gif'],
    pesoMaxKb: 150,
    ...IAB,
    fuente: 'oficial',
    revisado: REV_EXOCLICK,
    notas: 'Es el formato «large footer» de su catálogo.',
  },
  {
    clave: 'exoclick.intersticial.1600x900',
    red: 'exoclick',
    familia: 'intersticial',
    nombre: 'Intersticial escritorio 1600×900',
    ancho: 1600,
    alto: 900,
    tipos: ['jpg', 'png', 'gif', 'mp4', 'html5'],
    pesoMaxKb: 300,
    pesoMaxVideoKb: 1500,
    ...IAB,
    fuente: 'oficial',
    revisado: REV_EXOCLICK,
    notas: 'Ocupa la pantalla entera: es el que más molesta y el que más se cierra sin mirar.',
  },
  {
    clave: 'exoclick.intersticial.900x1600',
    red: 'exoclick',
    familia: 'intersticial',
    nombre: 'Intersticial móvil 900×1600',
    ancho: 900,
    alto: 1600,
    tipos: ['jpg', 'png', 'gif', 'mp4', 'html5'],
    pesoMaxKb: 300,
    pesoMaxVideoKb: 1500,
    ...IAB,
    fuente: 'oficial',
    revisado: REV_EXOCLICK,
  },
  {
    clave: 'exoclick.push.720x480',
    red: 'exoclick',
    familia: 'push',
    nombre: 'Push · imagen 720×480',
    ancho: 720,
    alto: 480,
    tipos: ['jpg', 'png', 'gif'],
    pesoMaxKb: 150,
    textos: { titulo: 50, descripcion: 90, marca: 30 },
    fuente: 'oficial',
    revisado: REV_EXOCLICK,
    notas:
      'Va acompañada del icono de 192×192. En el móvil el sistema recorta la imagen: lo importante, al centro.',
  },
  {
    clave: 'exoclick.push.192x192',
    red: 'exoclick',
    familia: 'push',
    nombre: 'Push · icono 192×192',
    ancho: 192,
    alto: 192,
    tipos: ['jpg', 'png'],
    pesoMaxKb: 150,
    fuente: 'oficial',
    revisado: REV_EXOCLICK,
    notas: 'Se ve a 48 px reales. Un logo con texto pequeño aquí no se lee.',
  },
  {
    clave: 'exoclick.nativo.600x600',
    red: 'exoclick',
    familia: 'nativo',
    nombre: 'Nativo 600×600',
    ancho: 600,
    alto: 600,
    tipos: ['jpg', 'png'],
    pesoMaxKb: 150,
    textos: { titulo: 50, descripcion: 90, marca: 30 },
    fuente: 'oficial',
    revisado: REV_EXOCLICK,
    notas:
      'Admite de 300×300 a 900×900; 600×600 es el punto medio. Sin GIF: el nativo se entrega estático.',
  },
  {
    clave: 'exoclick.video.vertical',
    red: 'exoclick',
    familia: 'video',
    nombre: 'Vídeo vertical 1080×1920',
    ancho: 1080,
    alto: 1920,
    tipos: ['mp4'],
    pesoMaxKb: 51200,
    pesoMaxVideoKb: 51200,
    fuente: 'oficial',
    revisado: REV_EXOCLICK,
    notas: 'Formato VAST 9:16. Hasta 50 MB, así que aquí el peso no es la restricción.',
  },
  {
    clave: 'exoclick.video.horizontal',
    red: 'exoclick',
    familia: 'video',
    nombre: 'Vídeo horizontal 1920×1080',
    ancho: 1920,
    alto: 1080,
    tipos: ['mp4'],
    pesoMaxKb: 51200,
    pesoMaxVideoKb: 51200,
    fuente: 'oficial',
    revisado: REV_EXOCLICK,
    notas: 'Para outstream, in-stream y slider.',
  },
];

// ═════════════════════════════════════════════════════════════
//  Otras redes adultas
// ═════════════════════════════════════════════════════════════
//
// Los tamaños se repiten mucho entre redes; los pesos NO están confirmados en
// sus paneles y las guías de terceros se contradicen entre sí. Están aquí para
// poder diseñar antes de tener cuenta, marcados como no oficiales.

const OTRAS_REDES: FormatoAnuncio[] = [
  ...(
    [
      ['300x250', 300, 250, 'Rectángulo medio 300×250'],
      ['300x300', 300, 300, 'Cuadrado 300×300'],
      ['900x250', 900, 250, 'Pie grande 900×250'],
      ['300x100', 300, 100, 'Banner móvil 300×100'],
    ] as const
  ).map(([tam, ancho, alto, nombre]) => ({
    clave: `trafficstars.display.${tam}`,
    red: 'trafficstars' as const,
    familia: 'display' as const,
    nombre,
    ancho,
    alto,
    tipos: ['jpg', 'png', 'gif'] as TipoArchivo[],
    pesoMaxKb: 150,
    ...IAB,
    fuente: 'terceros' as const,
    revisado: REV_TERCEROS,
    notas: 'Peso sin confirmar en su panel. Se ha adoptado el más restrictivo que circula.',
  })),
  ...(
    [
      ['300x250', 300, 250, 'Rectángulo medio 300×250'],
      ['728x90', 728, 90, 'Cabecera 728×90'],
      ['300x600', 300, 600, 'Media página 300×600'],
      ['970x250', 970, 250, 'Cartel 970×250'],
      ['300x100', 300, 100, 'Banner móvil 300×100'],
    ] as const
  ).map(([tam, ancho, alto, nombre]) => ({
    clave: `trafficjunky.display.${tam}`,
    red: 'trafficjunky' as const,
    familia: 'display' as const,
    nombre,
    ancho,
    alto,
    tipos: ['jpg', 'png', 'gif'] as TipoArchivo[],
    pesoMaxKb: 150,
    ...IAB,
    fuente: 'terceros' as const,
    revisado: REV_TERCEROS,
    notas:
      'Peso sin confirmar. Su revisión rechaza imágenes deformadas: nada de estirar una foto para que quepa.',
  })),
  ...(
    [
      ['300x250', 300, 250, 'Rectángulo medio 300×250'],
      ['728x90', 728, 90, 'Cabecera 728×90'],
      ['468x60', 468, 60, 'Banner clásico 468×60'],
    ] as const
  ).map(([tam, ancho, alto, nombre]) => ({
    clave: `juicyads.display.${tam}`,
    red: 'juicyads' as const,
    familia: 'display' as const,
    nombre,
    ancho,
    alto,
    tipos: ['jpg', 'png', 'gif'] as TipoArchivo[],
    pesoMaxKb: 150,
    ...IAB,
    fuente: 'terceros' as const,
    revisado: REV_TERCEROS,
    notas: 'Peso sin confirmar en su panel.',
  })),
];

// ═════════════════════════════════════════════════════════════
//  Redes sociales
// ═════════════════════════════════════════════════════════════
//
// Aquí no hay «peso máximo» que rechace nada: las plataformas recomprimen todo
// lo que se sube. El límite real es otro y es el que se vigila — la zona segura,
// porque en un vertical la interfaz de la app tapa arriba y abajo, y es
// exactamente donde acaba el precio si nadie lo pinta en el lienzo.

const SOCIAL: FormatoAnuncio[] = [
  {
    clave: 'social.feed.1080x1080',
    red: 'social',
    familia: 'social',
    nombre: 'Feed cuadrado 1080×1080',
    ancho: 1080,
    alto: 1080,
    tipos: ['jpg', 'png', 'webp', 'mp4'],
    pesoMaxKb: 8192,
    fuente: 'convencion',
    revisado: REV_PROPIO,
  },
  {
    clave: 'social.feed.1080x1350',
    red: 'social',
    familia: 'social',
    nombre: 'Feed vertical 1080×1350',
    ancho: 1080,
    alto: 1350,
    tipos: ['jpg', 'png', 'webp', 'mp4'],
    pesoMaxKb: 8192,
    fuente: 'convencion',
    revisado: REV_PROPIO,
    notas: 'El que más superficie de pantalla ocupa en el desplazamiento.',
  },
  {
    clave: 'social.vertical.1080x1920',
    red: 'social',
    familia: 'social',
    nombre: 'Vertical 1080×1920 (historias, reels, shorts)',
    ancho: 1080,
    alto: 1920,
    tipos: ['jpg', 'png', 'webp', 'mp4', 'webm'],
    pesoMaxKb: 16384,
    duracionMaxS: 60,
    zonaSegura: { arriba: 250, abajo: 350 },
    fuente: 'convencion',
    revisado: REV_PROPIO,
    notas:
      'Zona segura aproximada y común a Instagram, TikTok y Shorts. Fuera de ella el texto queda debajo de los botones de la app.',
  },
  {
    clave: 'social.miniatura.1280x720',
    red: 'social',
    familia: 'social',
    nombre: 'Miniatura de vídeo 1280×720',
    ancho: 1280,
    alto: 720,
    tipos: ['jpg', 'png', 'webp'],
    pesoMaxKb: 2048,
    fuente: 'convencion',
    revisado: REV_PROPIO,
  },
  {
    clave: 'social.ancho.1600x900',
    red: 'social',
    familia: 'social',
    nombre: 'Enlace compartido 1600×900',
    ancho: 1600,
    alto: 900,
    tipos: ['jpg', 'png', 'webp'],
    pesoMaxKb: 2048,
    fuente: 'convencion',
    revisado: REV_PROPIO,
    notas: 'X, Telegram y la imagen de Open Graph de cualquier enlace.',
  },
  {
    clave: 'social.pinterest.1000x1500',
    red: 'social',
    familia: 'social',
    nombre: 'Pin 1000×1500',
    ancho: 1000,
    alto: 1500,
    tipos: ['jpg', 'png', 'webp'],
    pesoMaxKb: 8192,
    fuente: 'convencion',
    revisado: REV_PROPIO,
  },
];

// ═════════════════════════════════════════════════════════════
//  Huecos propios: la tienda y el correo
// ═════════════════════════════════════════════════════════════
//
// Estos no los rechaza nadie, pero tienen el límite más real de todos: los paga
// quien navega, en tiempo de carga. La portada es la página más visitada.

const PROPIOS: FormatoAnuncio[] = [
  {
    clave: 'tienda.hero.1920x720',
    red: 'tienda',
    familia: 'tienda',
    nombre: 'Portada · hero escritorio',
    ancho: 1920,
    alto: 720,
    tipos: ['jpg', 'png', 'webp'],
    pesoMaxKb: 400,
    fuente: 'propio',
    revisado: REV_PROPIO,
    notas: 'Se sirve en AVIF y WebP en cinco anchos; el peso de aquí es el del original.',
  },
  {
    clave: 'tienda.hero.960x1200',
    red: 'tienda',
    familia: 'tienda',
    nombre: 'Portada · hero móvil',
    ancho: 960,
    alto: 1200,
    tipos: ['jpg', 'png', 'webp'],
    pesoMaxKb: 300,
    fuente: 'propio',
    revisado: REV_PROPIO,
  },
  {
    clave: 'tienda.banner.1600x500',
    red: 'tienda',
    familia: 'tienda',
    nombre: 'Portada · bloque banner',
    ancho: 1600,
    alto: 500,
    tipos: ['jpg', 'png', 'webp'],
    pesoMaxKb: 300,
    fuente: 'propio',
    revisado: REV_PROPIO,
  },
  {
    clave: 'tienda.categoria.1200x400',
    red: 'tienda',
    familia: 'tienda',
    nombre: 'Cabecera de categoría',
    ancho: 1200,
    alto: 400,
    tipos: ['jpg', 'png', 'webp'],
    pesoMaxKb: 250,
    fuente: 'propio',
    revisado: REV_PROPIO,
  },
  {
    clave: 'tienda.captacion.720x480',
    red: 'tienda',
    familia: 'tienda',
    nombre: 'Ventana de captación',
    ancho: 720,
    alto: 480,
    tipos: ['jpg', 'png', 'webp'],
    pesoMaxKb: 200,
    fuente: 'propio',
    revisado: REV_PROPIO,
    notas:
      'La imagen de la ventana que pide el correo. Aparece encima de todo: cuanto menos pese, mejor.',
  },
  {
    clave: 'correo.cabecera.600x300',
    red: 'correo',
    familia: 'correo',
    nombre: 'Correo · cabecera',
    ancho: 600,
    alto: 300,
    tipos: ['jpg', 'png'],
    pesoMaxKb: 200,
    fuente: 'propio',
    revisado: REV_PROPIO,
    notas:
      '600 px es el ancho que respetan todos los clientes de correo. Nada de WebP: Outlook no lo pinta.',
  },
  {
    clave: 'correo.bloque.600x600',
    red: 'correo',
    familia: 'correo',
    nombre: 'Correo · bloque cuadrado',
    ancho: 600,
    alto: 600,
    tipos: ['jpg', 'png'],
    pesoMaxKb: 200,
    fuente: 'propio',
    revisado: REV_PROPIO,
  },
];

/**
 * Prefijo de los tamaños a medida.
 *
 * Una creatividad puede no ser de ningún formato del catálogo —una cabecera
 * para un sitio concreto, una prueba— y entonces su clave es
 * `personalizado.300x600`. Se guarda así, como cadena, y no en columnas nuevas,
 * porque el tamaño real ya vive en la mesa del documento: esto solo tiene que
 * decir «esta pieza no tiene ficha de red», que es lo que consulta el validador
 * para saber que no hay peso máximo que comprobar.
 */
export const CLAVE_PERSONALIZADO = 'personalizado';

/** `personalizado.300x600` a partir de sus medidas. */
export const clavePersonalizada = (ancho: number, alto: number): string =>
  `${CLAVE_PERSONALIZADO}.${Math.round(ancho)}x${Math.round(alto)}`;

/** Las medidas de una clave a medida, o `null` si no lo es. */
export function medidaPersonalizada(clave: string): { ancho: number; alto: number } | null {
  const m = new RegExp(`^${CLAVE_PERSONALIZADO}\\.(\\d+)x(\\d+)$`).exec(clave);
  if (!m) return null;
  return { ancho: Number(m[1]), alto: Number(m[2]) };
}

/** Todos los formatos conocidos. */
export const FORMATOS: FormatoAnuncio[] = [...EXOCLICK, ...OTRAS_REDES, ...SOCIAL, ...PROPIOS];

const POR_CLAVE = new Map(FORMATOS.map((f) => [f.clave, f]));

/** Nombre legible de cada red, para agrupar la lista en la interfaz. */
export const NOMBRE_RED: Record<RedAnuncio, string> = {
  exoclick: 'ExoClick',
  trafficstars: 'TrafficStars',
  trafficjunky: 'TrafficJunky',
  juicyads: 'JuicyAds',
  social: 'Redes sociales',
  tienda: 'Nuestra tienda',
  correo: 'Correo',
};

export const formatoPorClave = (clave: string): FormatoAnuncio | undefined => POR_CLAVE.get(clave);

export const formatosDeRed = (red: RedAnuncio): FormatoAnuncio[] =>
  FORMATOS.filter((f) => f.red === red);

export const formatosDeFamilia = (familia: FamiliaFormato): FormatoAnuncio[] =>
  FORMATOS.filter((f) => f.familia === familia);

/** Si el formato admite una entrega animada. */
export const admiteAnimacion = (f: FormatoAnuncio): boolean =>
  f.tipos.some((t) => t === 'gif' || t === 'mp4' || t === 'webm');

/**
 * Peso máximo según lo que se vaya a entregar.
 *
 * Existe porque el mismo hueco admite 150 KB en imagen y 1,5 MB en vídeo, y
 * comparar contra el número equivocado rechaza entregas válidas.
 */
export function pesoMaximoKb(f: FormatoAnuncio, tipo: TipoArchivo): number {
  const esVideo = tipo === 'mp4' || tipo === 'webm';
  return esVideo ? (f.pesoMaxVideoKb ?? f.pesoMaxKb) : f.pesoMaxKb;
}

/** Meses tras los que una ficha deja de ser de fiar. */
export const MESES_VIGENCIA = 6;

/**
 * Si toca volver a comprobar la ficha contra la documentación de la red.
 *
 * Las redes cambian pesos y tamaños sin avisar —ExoClick bajó todos los banners
 * a 150 KB de un día para otro— y el síntoma es una tanda entera rechazada.
 */
export function revisionCaducada(f: FormatoAnuncio, hoy = new Date()): boolean {
  const revisado = new Date(`${f.revisado}T00:00:00Z`);
  if (Number.isNaN(revisado.getTime())) return true;
  const limite = new Date(revisado);
  limite.setUTCMonth(limite.getUTCMonth() + MESES_VIGENCIA);
  return hoy > limite;
}

/** Relación de aspecto simplificada, para ordenar y agrupar mesas. */
export function relacionAspecto(f: FormatoAnuncio): number {
  return f.ancho / f.alto;
}

/**
 * Orientación, que es lo que decide si una composición se puede reaprovechar.
 *
 * Pasar de un apaisado a otro apaisado suele salir solo; de apaisado a vertical
 * nunca, y por eso el editor propone recomponer en vez de escalar.
 */
export function orientacion(f: FormatoAnuncio): 'apaisado' | 'vertical' | 'cuadrado' {
  const r = relacionAspecto(f);
  if (r > 1.15) return 'apaisado';
  if (r < 0.87) return 'vertical';
  return 'cuadrado';
}

/**
 * Formatos que se parecen al dado, para el botón «añadir formatos».
 *
 * Ordenados por cercanía de proporción: lo que primero se ofrece es lo que
 * menos trabajo va a costar recomponer.
 */
export function formatosParecidos(f: FormatoAnuncio, limite = 6): FormatoAnuncio[] {
  const base = relacionAspecto(f);
  return FORMATOS.filter((o) => o.clave !== f.clave)
    .map((o) => ({ o, d: Math.abs(Math.log(relacionAspecto(o) / base)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limite)
    .map((x) => x.o);
}
