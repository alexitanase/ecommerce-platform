import Image from 'next/image';
import { Link } from '@/i18n/routing';
import { TarjetaProducto, type ProductoResumen } from '@/components/tarjeta-producto';
import { Icono } from '@/components/ui/icono';

/**
 * Los bloques de la portada, ya resueltos por la API.
 *
 * Aquí no se decide qué se enseña —eso viene del panel— solo cómo se pinta.
 * Cada bloque se dibuja con lo que trae y calla lo que le falta: un hero sin
 * botón sale sin botón, y un bloque de destacados que se ha quedado sin
 * productos no se pinta, en lugar de dejar un título con un hueco debajo.
 */

interface BloqueBase {
  id: string;
  tipo: string;
}

interface Hero extends BloqueBase {
  tipo: 'hero';
  titulo: string;
  subtitulo: string;
  textoBoton: string;
  enlaceBoton: string | null;
  imagen: string | null;
  oscurecer: boolean;
}

interface Banner extends BloqueBase {
  tipo: 'banner';
  titulo: string;
  texto: string;
  textoBoton: string;
  enlaceBoton: string | null;
  imagen: string | null;
}

interface Destacados extends BloqueBase {
  tipo: 'destacados';
  titulo: string;
  productos: ProductoResumen[];
}

interface Colecciones extends BloqueBase {
  tipo: 'colecciones';
  titulo: string;
  categorias: { id: string; name: string; slug: string; imagen: string | null }[];
}

interface Ventajas extends BloqueBase {
  tipo: 'ventajas';
  ventajas: { titulo: string; texto: string }[];
}

interface Testimonios extends BloqueBase {
  tipo: 'testimonios';
  titulo: string;
  testimonios: { texto: string; autor: string }[];
}

export type Bloque = Hero | Banner | Destacados | Colecciones | Ventajas | Testimonios;

export function BloquePortada({
  bloque,
  locale,
  primero,
}: {
  bloque: Bloque;
  locale: string;
  /** El primero de la página: sus imágenes se cargan sin diferir (LCP). */
  primero: boolean;
}) {
  switch (bloque.tipo) {
    case 'hero':
      return <SeccionHero bloque={bloque} primero={primero} />;
    case 'banner':
      return <SeccionBanner bloque={bloque} />;
    case 'destacados':
      return <SeccionDestacados bloque={bloque} locale={locale} primero={primero} />;
    case 'colecciones':
      return <SeccionColecciones bloque={bloque} />;
    case 'ventajas':
      return <SeccionVentajas bloque={bloque} />;
    case 'testimonios':
      return <SeccionTestimonios bloque={bloque} />;
  }
}

function SeccionHero({ bloque, primero }: { bloque: Hero; primero: boolean }) {
  const conImagen = Boolean(bloque.imagen);

  return (
    <section className="card relative mb-12 overflow-hidden p-8 sm:p-12">
      {bloque.imagen && (
        <>
          <Image
            src={bloque.imagen}
            alt=""
            fill
            // Decorativa: el texto va aparte y encima, así que no describe nada
            // que un lector de pantalla necesite. Anunciarla sería ruido.
            aria-hidden="true"
            priority={primero}
            sizes="100vw"
            className="object-cover"
          />
          {/* Sin la capa oscura, un texto claro sobre una foto clara deja de
              leerse: el contraste depende de la foto que suba cada uno. */}
          {bloque.oscurecer && <div className="absolute inset-0 bg-black/45" />}
        </>
      )}

      {!conImagen && (
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--marca-primario) 12%, var(--fondo-elevado)), var(--fondo-elevado))',
          }}
        />
      )}

      <div className={`relative max-w-2xl ${conImagen ? 'text-white' : ''}`}>
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          {bloque.titulo}
        </h1>

        {bloque.subtitulo && (
          <p
            className={`mt-3 text-lg ${conImagen ? 'text-white/90' : 'text-[var(--texto-suave)]'}`}
          >
            {bloque.subtitulo}
          </p>
        )}

        {bloque.enlaceBoton && bloque.textoBoton && (
          <Link href={bloque.enlaceBoton as never} className="btn btn-primario mt-6">
            {bloque.textoBoton}
          </Link>
        )}
      </div>
    </section>
  );
}

function SeccionBanner({ bloque }: { bloque: Banner }) {
  return (
    <section className="card relative mb-12 overflow-hidden p-6 sm:p-8">
      {bloque.imagen && (
        <>
          <Image
            src={bloque.imagen}
            alt=""
            fill
            aria-hidden="true"
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-black/45" />
        </>
      )}

      <div
        className={`relative flex flex-wrap items-center gap-4 ${bloque.imagen ? 'text-white' : ''}`}
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight">{bloque.titulo}</h2>
          {bloque.texto && (
            <p className={`mt-1 ${bloque.imagen ? 'text-white/90' : 'text-[var(--texto-suave)]'}`}>
              {bloque.texto}
            </p>
          )}
        </div>

        {bloque.enlaceBoton && bloque.textoBoton && (
          <Link href={bloque.enlaceBoton as never} className="btn btn-secundario">
            {bloque.textoBoton}
          </Link>
        )}
      </div>
    </section>
  );
}

function SeccionDestacados({
  bloque,
  locale,
  primero,
}: {
  bloque: Destacados;
  locale: string;
  primero: boolean;
}) {
  // Un bloque sin productos no se pinta: el título solo, con un hueco debajo,
  // parece que la página ha fallado al cargar.
  if (bloque.productos.length === 0) return null;

  return (
    <section className="mb-12">
      <h2 className="mb-5 text-xl font-semibold tracking-tight">{bloque.titulo}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {bloque.productos.map((p, i) => (
          <TarjetaProducto key={p.id} producto={p} locale={locale} prioridad={primero && i < 4} />
        ))}
      </div>
    </section>
  );
}

/**
 * Las categorías destacadas de la portada.
 *
 * Foto cuadrada y nombre debajo, en una rejilla de tres columnas ya en el
 * móvil. Antes eran tarjetas de 4:3 a dos columnas con el nombre dentro de un
 * recuadro, y ocupaban tanto que cuatro categorías se comían la primera
 * pantalla entera: la portada dejaba de ser un escaparate para ser un menú de
 * cuatro entradas.
 *
 * La foto sale de la portada en caché de cada categoría, así que hay imagen
 * desde el primer día sin que nadie suba una a mano. Y cuando no la hay se
 * pinta el icono en el hueco en vez de dejar un rectángulo gris: un cuadro
 * vacío se lee como una foto que no ha cargado, y quien lo ve espera a que
 * cargue en lugar de pulsar.
 */
function SeccionColecciones({ bloque }: { bloque: Colecciones }) {
  if (bloque.categorias.length === 0) return null;

  return (
    <section className="mb-12">
      <h2 className="mb-5 text-xl font-semibold tracking-tight">{bloque.titulo}</h2>
      <ul className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
        {bloque.categorias.map((c) => (
          <li key={c.id}>
            <Link href={`/buscar?categoria=${c.slug}` as never} className="group block text-center">
              <span className="relative block aspect-square overflow-hidden rounded-[--radius-card] border border-[var(--borde)] bg-[var(--fondo-sutil)]">
                {c.imagen ? (
                  <Image
                    src={c.imagen}
                    alt=""
                    fill
                    aria-hidden="true"
                    // Tres columnas en el móvil y seis en el escritorio: el
                    // ancho real nunca pasa de un tercio de pantalla, y pedir
                    // media como antes era traerse el doble de foto.
                    sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 16vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <span className="grid h-full place-items-center text-[var(--texto-tenue)]">
                    <Icono nombre="imagen" tamano={24} />
                  </span>
                )}
              </span>

              {/* Dos líneas como mucho: los nombres del proveedor llegan a
                  «Succionadores de clítoris» y sin el recorte una categoría de
                  nombre largo desalinea toda la fila. */}
              <span className="lineas-2 mt-2 block text-sm font-medium leading-snug transition-colors group-hover:text-[var(--marca-texto)]">
                {c.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SeccionVentajas({ bloque }: { bloque: Ventajas }) {
  if (bloque.ventajas.length === 0) return null;

  return (
    <section className="mb-12">
      <ul className="grid gap-4 sm:grid-cols-3">
        {bloque.ventajas.map((v) => (
          <li key={v.titulo} className="card p-5">
            <h3 className="font-semibold">{v.titulo}</h3>
            {v.texto && <p className="mt-1 text-sm text-[var(--texto-suave)]">{v.texto}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SeccionTestimonios({ bloque }: { bloque: Testimonios }) {
  if (bloque.testimonios.length === 0) return null;

  return (
    <section className="mb-12">
      <h2 className="mb-5 text-xl font-semibold tracking-tight">{bloque.titulo}</h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {bloque.testimonios.map((x) => (
          <li key={`${x.autor}-${x.texto.slice(0, 16)}`} className="card p-5">
            <blockquote className="text-[var(--texto-suave)]">«{x.texto}»</blockquote>
            <p className="mt-3 text-sm font-medium">{x.autor}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
