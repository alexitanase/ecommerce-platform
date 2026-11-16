import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Pagina } from '@/components/ui/pagina';
import { Vacio } from '@/components/ui/estados';

/**
 * La página que se ve cuando algo no existe.
 *
 * No la había. Los textos sí —`errores.404_titulo` y su descripción llevaban
 * traducidos a tres idiomas desde el principio— pero sin este fichero
 * `notFound()` caía en la pantalla de fábrica de Next: fondo blanco, «404: This
 * page could not be found» en inglés, sin cabecera, sin pie y sin un solo
 * enlace. Quien pulsaba un producto que ya no estaba se quedaba fuera de la
 * tienda, y desde ahí lo único que se puede hacer es cerrar la pestaña.
 *
 * Va dentro de `[locale]`, así que se pinta con la cabecera, el menú y el pie
 * de la tienda, y en el idioma que se estaba visitando.
 *
 * Es un componente síncrono a propósito: `notFound()` puede saltar desde
 * cualquier punto del renderizado y esto tiene que poder pintarse siempre, sin
 * depender de que la API responda.
 */
export default function NoEncontrado() {
  const t = useTranslations('errores');
  const ti = useTranslations('inicio');

  return (
    <Pagina>
      <Vacio icono="busqueda" titulo={t('404_titulo')} descripcion={t('404_descripcion')}>
        {/* Dos salidas, no una: al catálogo, que es donde quería ir quien ha
            llegado aquí desde un producto que ya no está, y a la portada. */}
        <Link href="/buscar" className="btn btn-primario">
          {ti('ver_catalogo')}
        </Link>
        <Link href="/" className="btn btn-secundario">
          {t('ir_inicio')}
        </Link>
      </Vacio>
    </Pagina>
  );
}
