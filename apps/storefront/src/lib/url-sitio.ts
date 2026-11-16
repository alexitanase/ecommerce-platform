/**
 * La dirección pública de la tienda, y cómo componer una absoluta.
 *
 * Vive aparte de `sitio.ts` porque aquello importa el enrutador de next-intl
 * para resolver los slugs traducidos, y eso arrastra medio Next: cualquier
 * módulo que solo necesite componer una URL no puede probarse sin levantar el
 * entorno del navegador. Aquí no hay ninguna dependencia, así que sí se puede.
 *
 * Se lee del entorno del servidor y no de una `NEXT_PUBLIC_*` a propósito: las
 * públicas se incrustan al compilar, así que cambiar de dominio obligaría a
 * reconstruir la imagen. Esto solo se usa en el servidor —metadatos, sitemap y
 * robots— y ahí se lee en cada arranque.
 */
export const SITIO = (
  process.env['SITE_URL'] ??
  process.env['NEXT_PUBLIC_SITE_URL'] ??
  'http://localhost:3000'
).replace(/\/+$/, '');

/** Una ruta de la tienda como dirección absoluta. */
export function urlAbsoluta(ruta: string): string {
  return `${SITIO}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
}
