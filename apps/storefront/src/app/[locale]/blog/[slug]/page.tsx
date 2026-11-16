import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { api, ErrorApi } from '@/lib/api';
import { urlAbsoluta } from '@/lib/sitio';
import { formateadorPrecio } from '@/lib/divisas';
import { Pagina } from '@/components/ui/pagina';

interface ProductoEnlazado {
  id: string;
  slug: string;
  nombre: string;
  imagen: string | null;
  desdeCents: number | null;
  disponible: boolean;
}

interface Articulo {
  handle: string;
  slug: string;
  titulo: string;
  contenido: string;
  resumen: string;
  portada: string | null;
  publicadoEl: string | null;
  actualizadoEl: string | null;
  minutosDeLectura: number;
  autor: string | null;
  seo: { titulo: string; descripcion: string };
  categoria: { slug: string; nombre: string } | null;
  productos: ProductoEnlazado[];
}

/**
 * Un artículo del blog.
 *
 * Lo que hace que esto venda y no solo informe son los **productos
 * enlazados** del final: una guía que no lleva a ninguna ficha atrae visitas y
 * no convierte nada, que es el error clásico al montar un blog de tienda.
 *
 * Lleva datos estructurados de tipo `Article` porque es lo que hace que Google
 * muestre la fecha y el autor en el resultado, y eso sube el porcentaje de
 * clics bastante más que cualquier ajuste de palabras clave.
 */
export const revalidate = 300;

async function obtener(locale: string, slug: string): Promise<Articulo | null> {
  try {
    return await api<Articulo>(`/content/blog/${locale}/${slug}`);
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const articulo = await obtener(locale, slug);

  if (!articulo) return {};

  return {
    title: articulo.seo.titulo,
    description: articulo.seo.descripcion,
    /*
     * Solo el canonical: los hreflang de los artículos van en el sitemap.
     *
     * El slug cambia con el idioma y la API sirve el artículo de UNO, así que
     * declararlos aquí costaría pedir el mismo artículo tres veces en cada
     * visita. En el sitemap se resuelven una vez por hora y Google los admite
     * igual de bien.
     */
    alternates: { canonical: urlAbsoluta(`/${locale}/blog/${slug}`) },
    openGraph: {
      type: 'article',
      title: articulo.seo.titulo,
      description: articulo.seo.descripcion,
      ...(articulo.portada ? { images: [articulo.portada] } : {}),
      ...(articulo.publicadoEl ? { publishedTime: articulo.publicadoEl } : {}),
    },
  };
}

export default async function ArticuloBlog({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const articulo = await obtener(locale, slug);
  if (!articulo) notFound();

  const t = await getTranslations('blog');
  // El «agotado» de las tarjetas: el mismo texto que en el resto de la tienda,
  // que para eso vive en el espacio del producto.
  const tProducto = await getTranslations('producto');
  const fmtPrecio = await formateadorPrecio(locale);

  /**
   * Datos estructurados del artículo.
   *
   * Es lo que hace que en el resultado de búsqueda salgan la fecha y el autor.
   * Va en un `<script>` con el JSON serializado: los datos vienen del admin, y
   * `JSON.stringify` escapa lo necesario para que un título con comillas no
   * rompa el bloque.
   */
  const datosEstructurados = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: articulo.titulo,
    description: articulo.resumen,
    ...(articulo.portada ? { image: articulo.portada } : {}),
    ...(articulo.publicadoEl ? { datePublished: articulo.publicadoEl } : {}),
    ...(articulo.actualizadoEl ? { dateModified: articulo.actualizadoEl } : {}),
    ...(articulo.autor ? { author: { '@type': 'Person', name: articulo.autor } } : {}),
  };

  return (
    <Pagina ancho="lectura">
      <script
        type="application/ld+json"
        // El contenido lo genera el servidor a partir de datos propios, no de
        // nada que envíe quien visita.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datosEstructurados) }}
      />

      <nav className="mb-6 text-sm">
        <Link href="/blog" className="text-[var(--texto-tenue)] hover:underline">
          ← {t('titulo')}
        </Link>
      </nav>

      <header>
        {articulo.categoria && (
          <Link
            href={{ pathname: '/blog', query: { categoria: articulo.categoria.slug } }}
            className="text-sm font-medium text-[var(--marca-primario)] hover:underline"
          >
            {articulo.categoria.nombre}
          </Link>
        )}

        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {articulo.titulo}
        </h1>

        <p className="mt-3 text-sm text-[var(--texto-tenue)]">
          {articulo.autor && <>{articulo.autor} · </>}
          {articulo.publicadoEl && (
            <time dateTime={articulo.publicadoEl}>
              {new Date(articulo.publicadoEl).toLocaleDateString(locale)}
            </time>
          )}
          {' · '}
          {t('minutos', { minutos: articulo.minutosDeLectura })}
        </p>
      </header>

      {articulo.portada && (
        <div className="relative mt-6 aspect-[16/9] overflow-hidden rounded-[var(--radius-card)]">
          <Image
            src={articulo.portada}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            priority
            className="object-cover"
          />
        </div>
      )}

      {/* El cuerpo se escribe en el admin y se guarda en texto plano con saltos
          de línea. No se interpreta como HTML a propósito: aceptarlo abriría la
          puerta a inyectar scripts desde el editor. */}
      <div className="mt-8 space-y-4 leading-relaxed">
        {articulo.contenido
          .split(/\n{2,}/)
          .filter((p) => p.trim())
          .map((parrafo) => (
            <p key={parrafo.slice(0, 40)}>{parrafo}</p>
          ))}
      </div>

      {articulo.productos.length > 0 && (
        <section className="mt-12 border-t pt-8" style={{ borderColor: 'var(--borde)' }}>
          <h2 className="mb-4 text-lg font-semibold">{t('productos_mencionados')}</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            {articulo.productos.map((p) => (
              <Link
                key={p.id}
                // Igual que en el resto de la tienda: la ficha de producto no
                // está en `pathnames`, así que la ruta se construye a mano.
                href={`/producto/${p.slug}` as never}
                className="card flex items-center gap-3 p-3 transition-shadow hover:shadow-[var(--sombra-elevada)]"
              >
                {p.imagen ? (
                  <Image
                    src={p.imagen}
                    alt=""
                    width={64}
                    height={64}
                    className="h-16 w-16 rounded object-cover"
                  />
                ) : (
                  <span className="h-16 w-16 rounded bg-[var(--fondo-sutil)]" />
                )}

                <span className="min-w-0 flex-1">
                  <span className="lineas-2 block text-sm font-medium">{p.nombre}</span>
                  {p.desdeCents !== null && (
                    <span className="mt-1 block text-sm text-[var(--texto-suave)]">
                      {fmtPrecio(p.desdeCents)}
                    </span>
                  )}
                  {/* Los agotados ya salen los últimos, pero además se dicen:
                      quien llega desde una recomendación merece saber que ese
                      no se puede comprar antes de pulsar. */}
                  {!p.disponible && (
                    <span className="etiqueta mt-1 inline-block text-[var(--texto-suave)]">
                      {tProducto('sin_stock')}
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </Pagina>
  );
}
