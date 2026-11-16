import { urlAbsoluta } from './url-sitio';

/**
 * La tarjeta que sale al pegar un enlace de la tienda en un chat.
 *
 * WhatsApp, Telegram, X y los demás leen Open Graph, pero cada uno es tiquismiquis
 * con cosas distintas, y las que fallan en silencio son siempre las mismas:
 *
 *  · **La imagen tiene que ser absoluta.** Con una ruta relativa no se enseña
 *    nada. Next la resuelve contra `metadataBase`, pero solo si está declarada;
 *    aquí se resuelve a mano para no depender de eso.
 *  · **Con sus medidas.** Sin `og:image:width` y `og:image:height`, WhatsApp
 *    suele descartar la foto y X la enseña como miniatura cuadrada. Son dos
 *    etiquetas y son la diferencia entre una tarjeta con foto grande y una línea
 *    de texto.
 *  · **`og:url` es obligatoria de facto.** Es lo que la aplicación guarda como
 *    destino de la tarjeta y lo que usa para deduplicar cuando el mismo enlace
 *    se comparte con parámetros de campaña distintos.
 *  · **`twitter:card` decide el tamaño.** Sin ella se enseña la miniatura
 *    pequeña aunque haya una foto de 2000 px.
 *
 * El texto se recorta a 200 caracteres: WhatsApp corta por su cuenta sobre los
 * 160 y prefiero decidir yo dónde, antes de que parta una palabra por la mitad.
 */

/** Lo que hace falta saber de la foto para que se enseñe grande y sin recortes. */
export interface ImagenCompartir {
  url: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
}

/** La foto tal y como la declaran Open Graph y X. */
interface FotoTarjeta {
  url: string;
  width?: number;
  height?: number;
  alt: string;
}

/**
 * Lo que devuelve `tarjetaDeEnlace`, con el tipo concreto y no el de Next.
 *
 * El de Next para `twitter` es una unión de varias formas de tarjeta, así que
 * ni quien la usa ni las pruebas pueden leer `card` sin estrecharla antes. Aquí
 * solo se generan dos formas y las dos la tienen.
 */
export interface TarjetaEnlace {
  openGraph: {
    title: string;
    description?: string;
    url: string;
    type: 'website' | 'article';
    images?: FotoTarjeta[];
  };
  twitter: {
    card: 'summary' | 'summary_large_image';
    title: string;
    description?: string;
    images?: FotoTarjeta[];
  };
}

const LARGO_DESCRIPCION = 200;

/** Recorta sin partir palabras y sin dejar el puntito colgando de un espacio. */
export function recortar(texto: string, largo = LARGO_DESCRIPCION): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (limpio.length <= largo) return limpio;

  const corte = limpio.slice(0, largo);
  const ultimoEspacio = corte.lastIndexOf(' ');

  return `${(ultimoEspacio > largo * 0.6 ? corte.slice(0, ultimoEspacio) : corte).trimEnd()}…`;
}

/**
 * Los metadatos de Open Graph y de X para una página compartible.
 *
 * @param ruta ruta interna con el idioma delante (`/es/producto/botas`)
 */
export function tarjetaDeEnlace({
  titulo,
  descripcion,
  ruta,
  imagen,
  tipo = 'website',
}: {
  titulo: string;
  descripcion?: string | null;
  ruta: string;
  imagen?: ImagenCompartir | null;
  tipo?: 'website' | 'article';
}): TarjetaEnlace {
  const url = urlAbsoluta(ruta);
  const texto = descripcion ? recortar(descripcion) : undefined;

  if (!imagen?.url) {
    return {
      openGraph: { title: titulo, description: texto, url, type: tipo },
      // Sin foto, la tarjeta pequeña es la correcta: pedir la grande deja un
      // rectángulo vacío del ancho del chat.
      twitter: { card: 'summary', title: titulo, description: texto },
    };
  }

  const foto = {
    url: imagen.url.startsWith('http') ? imagen.url : urlAbsoluta(imagen.url),
    ...(imagen.width ? { width: imagen.width } : {}),
    ...(imagen.height ? { height: imagen.height } : {}),
    alt: imagen.alt ?? titulo,
  };

  return {
    openGraph: { title: titulo, description: texto, url, type: tipo, images: [foto] },
    twitter: { card: 'summary_large_image', title: titulo, description: texto, images: [foto] },
  };
}
