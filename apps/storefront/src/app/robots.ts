import type { MetadataRoute } from 'next';
import { urlAbsoluta } from '@/lib/sitio';

/**
 * Qué puede rastrear un robot y dónde está el mapa del sitio.
 *
 * No existía: `/robots.txt` devolvía 404. Eso no impide que Google entre —sin
 * fichero se rastrea todo— pero deja dos cosas sin decir, y las dos cuestan
 * dinero en una tienda con catálogo grande.
 *
 * **La primera es el sitemap.** Es la línea por la que Google descubre el
 * catálogo entero de una vez en lugar de ir tirando de enlaces.
 *
 * **La segunda es dónde NO entrar.** Un catálogo con filtros genera
 * combinaciones infinitas de la misma página (marca × precio × orden × página),
 * y el presupuesto de rastreo es finito: cada vez que un robot baja
 * `?orden=precio_desc&pagina=7`, es una ficha de producto que ese día no ha
 * mirado. Las categorías sí se dejan pasar —son las páginas que queremos
 * posicionar— y lo que se corta es la combinatoria que cuelga de ellas.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          /*
           * Lo privado. Ya lleva `noindex` en la propia página, pero eso solo
           * se sabe DESPUÉS de descargarla: aquí se ahorra el viaje.
           */
          '/*/carrito',
          '/*/checkout',
          '/*/cuenta',
          '/*/deseos',
          '/*/entrar',
          '/*/registro',
          '/*/acceso',
          '/*/recuperar',
          '/*/restablecer',
          '/*/verificar-email',
          '/*/preferencias',
          '/*/pedido/',
          // Rutas internas de la propia aplicación, nunca contenido.
          '/api/',

          /*
           * La combinatoria de filtros del catálogo.
           *
           * `?categoria=` se deja fuera de esta lista a propósito: es la única
           * combinación que SÍ queremos indexada, y es la que va en el sitemap.
           * El resto son cortes de la misma lista de productos.
           */
          '/*?*orden=',
          '/*?*marca=',
          '/*?*precioMin=',
          '/*?*precioMax=',
          '/*?*soloDisponibles=',
          '/*?*pagina=',
          // La búsqueda por texto: resultados internos, que Google pide
          // expresamente no indexar porque son páginas sin contenido propio.
          '/*?*q=',
        ],
      },
    ],
    sitemap: urlAbsoluta('/sitemap.xml'),
  };
}
