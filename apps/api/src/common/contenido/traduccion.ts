import type { Locale } from '@ecom/shared';

/**
 * La traducción que hay que enseñar, con respaldo.
 *
 * Un catálogo importado no viene traducido: el proveedor manda sus fichas en un
 * idioma y las otras dos se rellenan después —o no se rellenan nunca—. Hasta
 * ahora, cada listado pedía a la base solo la traducción del idioma que se
 * estaba viendo y, si no había, caía al `handle`. El resultado en la tienda en
 * inglés era una tarjeta titulada
 * «auriculares-inalambricos-con-cancelacion-de-ruido-sim1001» que además
 * enlazaba a esa cadena como si fuera un slug: al pulsarla, 404.
 *
 * El orden del respaldo no es arbitrario. Primero el idioma pedido, que es lo
 * correcto. Después el español, que es el idioma de la tienda y del proveedor,
 * así que es el que más veces existe y el que más gente entiende de los que
 * pasan por aquí. Y al final el que haya: un nombre en otro idioma es
 * infinitamente mejor que un identificador interno.
 *
 * Devuelve `null` cuando no hay ninguna. Ese producto no tiene nombre ni
 * dirección, así que no se puede enseñar: quien lo llame debe descartarlo, no
 * inventarle un texto.
 */
export function traduccionPreferida<T extends { locale: string }>(
  traducciones: T[],
  locale: Locale,
): T | null {
  return (
    traducciones.find((t) => t.locale === locale) ??
    traducciones.find((t) => t.locale === 'es') ??
    traducciones[0] ??
    null
  );
}
