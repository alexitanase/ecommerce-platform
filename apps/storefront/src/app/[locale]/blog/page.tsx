import type { Metadata } from 'next';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { alternativas } from '@/lib/sitio';
import { Pagina, TituloPagina } from '@/components/ui/pagina';

interface ArticuloListado {
  handle: string;
  slug: string;
  titulo: string;
  resumen: string;
  portada: string | null;
  publicadoEl: string | null;
  minutosDeLectura: number;
  categoria: { slug: string; nombre: string } | null;
}

interface CategoriaBlog {
  slug: string;
  nombre: string;
  articulos: number;
}

/**
 * Índice del blog.
 *
 * Con catálogo +18, Google Ads y Meta Ads están cerrados: el tráfico orgánico
 * no es un complemento, es el canal principal. Por eso esta página se sirve
 * con ISR —rápida y cacheada— y cada tarjeta lleva su fecha y su tiempo de
 * lectura, que es lo que decide si alguien entra desde un resultado de
 * búsqueda.
 */
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'blog' });

  return {
    title: t('titulo'),
    description: t('descripcion'),
    alternates: await alternativas('/blog', locale),
  };
}

export default async function Blog({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ categoria?: string }>;
}) {
  const { locale } = await params;
  const { categoria } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations('blog');

  const [articulos, categorias] = await Promise.all([
    api<ArticuloListado[]>(
      `/content/blog/${locale}${categoria ? `?categoria=${encodeURIComponent(categoria)}` : ''}`,
    ).catch(() => []),
    api<CategoriaBlog[]>(`/content/blog/${locale}/categorias`).catch(() => []),
  ]);

  return (
    <Pagina>
      <TituloPagina titulo={t('titulo')} descripcion={t('descripcion')} />

      {categorias.length > 0 && (
        <nav className="mb-8 flex flex-wrap gap-2" aria-label={t('categorias')}>
          <Link
            href="/blog"
            className={`etiqueta ${categoria ? 'bg-[var(--fondo-sutil)]' : 'bg-[var(--marca-primario)] text-white'}`}
          >
            {t('todas')}
          </Link>
          {categorias.map((c) => (
            <Link
              key={c.slug}
              href={{ pathname: '/blog', query: { categoria: c.slug } }}
              className={`etiqueta ${
                categoria === c.slug
                  ? 'bg-[var(--marca-primario)] text-white'
                  : 'bg-[var(--fondo-sutil)]'
              }`}
            >
              {c.nombre} ({c.articulos})
            </Link>
          ))}
        </nav>
      )}

      {articulos.length === 0 ? (
        <p className="text-[var(--texto-tenue)]">{t('sin_articulos')}</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {articulos.map((a) => (
            <article key={a.handle} className="card overflow-hidden">
              <Link href={{ pathname: '/blog/[slug]', params: { slug: a.slug } }} className="block">
                {a.portada && (
                  <div className="relative aspect-[16/9] overflow-hidden">
                    <Image
                      src={a.portada}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 100vw, 50vw"
                      className="object-cover"
                    />
                  </div>
                )}

                <div className="p-4">
                  {a.categoria && (
                    <span className="text-xs font-medium text-[var(--marca-primario)]">
                      {a.categoria.nombre}
                    </span>
                  )}

                  <h2 className="lineas-2 mt-1 font-semibold">{a.titulo}</h2>
                  <p className="lineas-3 mt-2 text-sm text-[var(--texto-suave)]">{a.resumen}</p>

                  <p className="mt-3 text-xs text-[var(--texto-tenue)]">
                    {a.publicadoEl && (
                      <time dateTime={a.publicadoEl}>
                        {new Date(a.publicadoEl).toLocaleDateString(locale)}
                      </time>
                    )}
                    {' · '}
                    {t('minutos', { minutos: a.minutosDeLectura })}
                  </p>
                </div>
              </Link>
            </article>
          ))}
        </div>
      )}
    </Pagina>
  );
}
