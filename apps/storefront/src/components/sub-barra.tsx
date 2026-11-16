import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { menuNavegacion } from '@/lib/api';
import { CARRIL } from './ui/pagina';

/**
 * La sub-barra de navegación.
 *
 * Va debajo de la cabecera y la escribe quien lleva la tienda desde el panel.
 * Existe porque la cabecera no tenía **ningún** enlace de navegación: logo,
 * buscador, deseos, cuenta y carrito. Para llegar al catálogo había que escribir
 * en el buscador, y quien entra a mirar sin saber qué quiere no tenía por dónde.
 *
 * Si no hay enlaces no se pinta nada: ni una franja vacía ni un borde suelto.
 * Con el menú de fábrica siempre hay al menos el catálogo, así que solo ocurre
 * si alguien los borra todos a propósito.
 *
 * En el móvil es una sola fila que se arrastra en horizontal. Se descartó
 * envolver en varias líneas: con el buscador, la cabecera ya ocupa dos filas en
 * el teléfono, y una tercera de altura variable descuadraba la pantalla entera.
 *
 * **Va fuera de la cabecera pegajosa, no dentro.** Metida dentro quedaba fija al
 * desplazar, que suena mejor y mide peor: la cabecera pasaba de 66 a 104 px, y en
 * un teléfono de 667 px de alto eso son 136 px de cromo permanente —un quinto de
 * la pantalla— justo cuando lo que hace falta en pantalla es el producto y su
 * botón de comprar. Lo dijo una prueba que ya existía: «es pegajosa, cada píxel
 * suyo es un píxel menos de tienda». Así, en reposo se ve igual y al desplazar
 * deja sitio.
 */
export async function SubBarra({ locale }: { locale: string }) {
  const [t, enlaces] = await Promise.all([getTranslations('nav'), menuNavegacion(locale)]);

  if (enlaces.length === 0) return null;

  return (
    <div className="border-b border-[var(--borde)]">
      <nav aria-label={t('menu_tienda')} className={`mx-auto ${CARRIL} px-4 sm:px-6`}>
        <ul className="barra-menu">
          {enlaces.map((enlace) => (
            <li key={enlace.id}>
              {enlace.externo ? (
                /*
                 * Fuera de la tienda: se abre en otra pestaña —quien está
                 * comprando no debe perder el carrito de vista— y con
                 * `noopener`, sin el cual la página de destino puede manipular
                 * la nuestra a través de `window.opener`.
                 */
                <a
                  href={enlace.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={enlace.destacado ? 'enlace-menu destacado' : 'enlace-menu'}
                >
                  {enlace.etiqueta}
                </a>
              ) : (
                /*
                 * `as never` porque el enrutador de next-intl tipa las rutas
                 * conocidas y estas las decide el panel: el slug de una página
                 * o de una categoría no existe en el tipo. Es la misma
                 * conversión que usan los bloques de la portada.
                 */
                <Link
                  href={enlace.href as never}
                  className={enlace.destacado ? 'enlace-menu destacado' : 'enlace-menu'}
                >
                  {enlace.etiqueta}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
