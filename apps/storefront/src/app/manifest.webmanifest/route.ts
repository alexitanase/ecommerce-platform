import { ajustesPublicos } from '@/lib/api';
import { colorSeguro } from '@/lib/contraste';
import { routing } from '@/i18n/routing';

/**
 * Manifiesto de la aplicación instalable.
 *
 * Se genera al vuelo en lugar de ser un fichero estático porque el nombre, los
 * colores y el icono los pone cada tienda desde el panel: con un JSON fijo
 * habría que reconstruir y desplegar para cambiar el nombre que aparece bajo el
 * icono en la pantalla de inicio del móvil.
 *
 * Se revalida cada hora. La marca se cambia una vez y luego no se toca, así que
 * generarlo en cada visita solo añadiría una consulta a la ruta que pide el
 * navegador antes de instalar nada.
 */
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const ajustes = await ajustesPublicos();

  const nombre = typeof ajustes['brand.name'] === 'string' ? ajustes['brand.name'] : 'Tienda';
  const primario = colorSeguro(ajustes['brand.primaryColor'], '#4f46e5');

  const iconoPropio =
    typeof ajustes['brand.favicon'] === 'string' && ajustes['brand.favicon']
      ? ajustes['brand.favicon']
      : null;

  const manifiesto = {
    name: nombre,
    // El corto es el que cabe debajo del icono: doce caracteres es lo que
    // muestra Android antes de cortar con puntos suspensivos.
    short_name: nombre.slice(0, 12),
    description:
      typeof ajustes['brand.tagline'] === 'object' && ajustes['brand.tagline'] !== null
        ? ((ajustes['brand.tagline'] as Record<string, string>)[routing.defaultLocale] ?? nombre)
        : nombre,
    // Con el idioma delante: si se abriera en "/", el navegador redirigiría en
    // cada arranque y la aplicación instalada tardaría más que la web.
    start_url: `/${routing.defaultLocale}?origen=pwa`,
    scope: '/',
    display: 'standalone',
    // El fondo se ve durante el arranque; el tema tiñe la barra del sistema.
    background_color: '#ffffff',
    theme_color: primario,
    lang: routing.defaultLocale,
    dir: 'ltr',
    categories: ['shopping'],
    icons: [
      {
        src: iconoPropio ?? '/icono?tamano=192',
        sizes: '192x192',
        type: iconoPropio ? 'image/png' : 'image/png',
        purpose: 'any',
      },
      {
        src: iconoPropio ?? '/icono?tamano=512',
        sizes: '512x512',
        type: 'image/png',
        // "maskable" deja que Android recorte el icono a la forma del sistema
        // sin comerse el dibujo. Sin uno maskable, el icono sale dentro de un
        // cuadrado blanco que desentona con el resto de la pantalla.
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      { name: 'Catálogo', url: `/${routing.defaultLocale}/buscar` },
      { name: 'Mi lista', url: `/${routing.defaultLocale}/deseos` },
      { name: 'Carrito', url: `/${routing.defaultLocale}/carrito` },
    ],
  };

  return Response.json(manifiesto, {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8' },
  });
}
