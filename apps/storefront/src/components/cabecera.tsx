import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { SelectorTema } from './selector-tema';
import { idiomasActivos } from '@/lib/idiomas';
import { SelectorIdioma } from './selector-idioma';
import { SelectorDivisa } from './selector-divisa';
import { BotonCarrito } from './boton-carrito';
import { BuscadorRapido } from './buscador-rapido';
import { BuscadorMovil } from './buscador-movil';
import { arbolCategorias, categoriasDestacadas } from '@/lib/categorias';
import { Icono } from './ui/icono';
import { CARRIL } from './ui/pagina';

export async function Cabecera({
  locale,
  marca,
}: {
  locale: string;
  marca: Record<string, unknown>;
}) {
  // Los idiomas activos los decide el panel; se leen aquí porque este es un
  // componente de servidor y el selector no lo es.
  const [t, arbol, idiomas] = await Promise.all([
    getTranslations('nav'),
    arbolCategorias(locale),
    idiomasActivos(),
  ]);
  const nombre = (marca['brand.name'] as string) ?? 'Tienda';
  const logo = marca['brand.logoLight'] as string | null;

  /*
   * Los atajos del buscador del móvil se resuelven aquí, en el servidor.
   *
   * Van dentro de un panel que solo se abre al tocar la lupa, así que la
   * tentación es pedirlos al abrirlo. Sería medio segundo de panel vacío en
   * cada apertura para una lista que cambia una vez al mes y que la API ya
   * sirve cacheada: se manda hecha con el HTML y el panel abre lleno.
   */
  const atajos = categoriasDestacadas(arbol, 6).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    imagen: c.imagen,
  }));

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--borde)] bg-[color-mix(in_srgb,var(--fondo)_88%,transparent)] backdrop-blur-lg">
      {/*
        Por debajo de `md` el buscador baja a su propia fila.

        El corte está en 768 px y no en 640 por una medida concreta: en una
        sola fila, con el logo, el idioma, el tema y tres iconos, al buscador
        le quedaban 166 px a 640 px de ancho. Un campo donde no cabe ni la
        palabra que se está escribiendo, y buscar es lo primero que hace quien
        entra a una tienda. A 768 ya le quedan 294, que sí dan.

        Se reordena con `flex-wrap` y `order` en lugar de pintar dos buscadores
        y esconder uno: dos instancias significan dos elementos con el mismo
        `id`, y el `aria-controls` del segundo apuntaría a la lista del
        primero. Un lector de pantalla anunciaría sugerencias que no existen.

        Los rellenos de la fila doble son más justos que los de la simple para
        que el salto de altura al cruzar el corte sea el menor posible: la
        cabecera es pegajosa y cada píxel suyo es un píxel menos de tienda.

        Ojo con `px`: cambia en `sm` como en el resto de la tienda, no en `md`
        junto con el resto de la cabecera. Cuando iban juntos, entre 640 y 767
        el logo se quedaba 8 px a la izquierda del título de la página.
      */}
      <div
        className={`mx-auto flex ${CARRIL} flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6 md:h-16 md:flex-nowrap md:gap-4 md:py-0`}
      >
        <Link href="/" className="order-1 flex items-center gap-2 font-semibold tracking-tight">
          {logo ? (
            // Con `<img>` a secas, el logo que suba la tienda se sirve tal cual
            // —puede ser un PNG de dos megas— y sin dimensiones reserva cero
            // espacio: la cabecera da un salto al cargar, en TODAS las páginas.
            // Las medidas son las máximas; el alto real lo fija el CSS.
            <Image
              src={logo}
              alt={nombre}
              width={200}
              height={32}
              priority
              className="h-8 w-auto object-contain"
            />
          ) : (
            <span
              className="grid h-8 w-8 place-items-center rounded-lg text-sm font-bold text-white"
              style={{
                background: 'linear-gradient(135deg,var(--marca-primario),var(--marca-acento))',
              }}
              aria-hidden="true"
            >
              {nombre.charAt(0)}
            </span>
          )}
          {/*
            El nombre solo cuando NO hay logotipo.

            Con los dos, la cabecera repetía la marca dos veces seguidas —el
            logotipo ya la lleva escrita dentro— y se comía ancho que en el
            escritorio le hace falta al buscador. Sin logotipo sí hace falta:
            ahí lo único que queda es la inicial en un cuadrado, que no es el
            nombre de nadie. Quien use lector de pantalla lo oye igual en los
            dos casos, porque el logotipo lleva la marca en su `alt`.
          */}
          {!logo && <span className="hidden md:inline">{nombre}</span>}
        </Link>

        {/*
          Dos buscadores distintos, no uno adaptable.

          Por debajo de `md` el campo abre un panel a pantalla completa; a
          partir de ahí es un campo con su desplegable. Se intentó con uno
          solo y no sale: el del móvil tiene que ser un botón —un `<input>`
          que al tocarlo abre otra cosa deja el teclado a medias— y el del
          escritorio tiene que ser un `<input>` de verdad. Cada uno se pinta
          en su tamaño y el otro no existe, así que tampoco hay dos campos
          enfocables ni dos listas de sugerencias a la vez.

          Los `id` son distintos (`buscador` y `buscador-movil`) por si algún
          día conviven: dos elementos con el mismo `id` harían que el
          `aria-controls` de uno apuntara a la lista del otro y un lector de
          pantalla anunciaría sugerencias que no están donde dice.
        */}
        <div className="order-3 w-full md:order-2 md:w-auto md:flex-1">
          <div className="md:hidden">
            <BuscadorMovil locale={locale} categorias={atajos} />
          </div>
          <div className="hidden md:block">
            <BuscadorRapido locale={locale} />
          </div>
        </div>

        <nav
          className="order-2 ml-auto flex items-center gap-1 md:order-3 md:ml-0"
          aria-label={t('inicio')}
        >
          <SelectorIdioma actual={locale} idiomas={idiomas} />
          <SelectorDivisa />
          <SelectorTema />
          <Link href="/deseos" className="btn btn-fantasma btn-icono" aria-label={t('deseos')}>
            <Icono nombre="corazon" />
          </Link>
          <Link href="/cuenta" className="btn btn-fantasma btn-icono" aria-label={t('cuenta')}>
            <Icono nombre="usuario" />
          </Link>
          <BotonCarrito />
        </nav>
      </div>
    </header>
  );
}
