import { construirEnlace, limpiarClave, type Marcaje } from '../channels/canales.js';

/**
 * El marcaje de una creatividad.
 *
 * Cada pieza que sale del Studio lleva su propio `utm_content`, y eso es lo que
 * convierte el informe de canales en algo accionable: sin él se sabe que
 * ExoClick trajo doce ventas, y con él se sabe cuál de los nueve banners las
 * trajo. Lo primero no permite decidir nada; lo segundo dice qué duplicar y qué
 * apagar.
 *
 * El valor tiene que sobrevivir al viaje entero —se pinta en una URL, la copia
 * quien monta la campaña en el panel de la red, vuelve en la query de la visita
 * y lo normaliza el navegador antes de guardarlo—. Por eso se genera ya en su
 * forma canónica: si al normalizarlo cambiara, el informe buscaría un valor que
 * nunca llega y esa creatividad aparecería siempre con cero ventas.
 */

/** Longitud máxima del `utm_content`, la misma a la que recorta `limpiarClave`. */
export const MAX_CONTENIDO = 60;

/** Caracteres del identificador que se añaden como sufijo. */
const SUFIJO = 6;

/**
 * Marcaje de una creatividad: nombre legible más un sufijo del identificador.
 *
 * El sufijo no es decoración. Dos creatividades pueden llamarse igual —«banner
 * principal» en dos campañas es lo normal— y sin él compartirían `utm_content`,
 * que es peor que no medir: mezcla las ventas de las dos y da una lectura falsa
 * con aspecto de buena.
 */
export function contenidoDeCreatividad(nombre: string, id: string): string {
  const cola = id
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(-SUFIJO)
    .padStart(SUFIJO, '0');

  // Los separadores repetidos se colapsan aquí y no en `limpiarClave`: un
  // nombre como «Banner · variante» pierde el punto medio y deja dos guiones
  // seguidos. Es válido, pero se lee mal en un informe y hay que mirarlo dos
  // veces para ver si son dos creatividades distintas.
  const base =
    limpiarClave(nombre)
      ?.replace(/[-._]{2,}/g, '-')
      .replace(/^[-._]+|[-._]+$/g, '')
      .slice(0, MAX_CONTENIDO - SUFIJO - 1)
      .replace(/[-._]+$/g, '') ?? '';
  const candidato = base ? `${base}-${cola}` : `creatividad-${cola}`;

  // Se normaliza el resultado, no solo las partes: recortar puede dejar un
  // guion suelto al final, y ese guion sí lo quitaría el navegador después.
  return limpiarClave(candidato) ?? `creatividad-${cola}`;
}

/** Los UTM de una campaña, con el hueco de la creatividad ya puesto. */
export function marcajeDeCampana(campana: {
  channel: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  slug?: string | null;
}): Marcaje {
  const fuente = limpiarClave(campana.utmSource) ?? limpiarClave(campana.channel) ?? 'directo';
  const medio = limpiarClave(campana.utmMedium);
  const campanaUtm = limpiarClave(campana.utmCampaign) ?? limpiarClave(campana.slug);

  return {
    fuente,
    ...(medio ? { medio } : {}),
    ...(campanaUtm ? { campana: campanaUtm } : {}),
  };
}

/**
 * Enlace listo para pegar en el panel de la red.
 *
 * Falla claro si la dirección no es válida: un enlace roto en una campaña
 * pagada no da ningún error nuestro, simplemente quema el presupuesto llevando
 * gente a una página que no existe.
 */
export function enlaceDeCreatividad(
  base: string,
  campana: Parameters<typeof marcajeDeCampana>[0],
  utmContent: string,
): string {
  const marcaje = marcajeDeCampana(campana);
  const contenido = limpiarClave(utmContent);

  return construirEnlace(base, { ...marcaje, ...(contenido ? { contenido } : {}) });
}
