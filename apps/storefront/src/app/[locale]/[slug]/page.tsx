import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { api, ErrorApi } from '@/lib/api';
import { urlAbsoluta } from '@/lib/sitio';
import { Pagina, TituloPagina } from '@/components/ui/pagina';

interface Pagina {
  slug: string;
  title: string;
  content: string;
  metaTitle: string | null;
  metaDescription: string | null;
  updatedAt: string;
}

/**
 * Páginas de contenido y legales.
 *
 * El contenido lo edita el admin y se sirve con ISR: cambiar la política de
 * privacidad no debe requerir un despliegue, pero tampoco tiene sentido
 * consultar la base de datos en cada visita para un texto que cambia dos veces
 * al año.
 */
export const revalidate = 3600;

/**
 * Páginas legales mínimas que la tienda debe tener en España.
 * Si el admin todavía no las ha creado, se sirve un texto provisional en lugar
 * de un 404: una tienda sin aviso legal accesible incumple la LSSI.
 */
const LEGALES: Record<string, Record<string, string>> = {
  'aviso-legal': { es: 'Aviso legal', ca: 'Avís legal', en: 'Legal notice' },
  privacidad: { es: 'Política de privacidad', ca: 'Política de privacitat', en: 'Privacy policy' },
  cookies: { es: 'Política de cookies', ca: 'Política de galetes', en: 'Cookie policy' },
  condiciones: { es: 'Condiciones de venta', ca: 'Condicions de venda', en: 'Terms of sale' },
  envios: { es: 'Envíos y entregas', ca: 'Enviaments i lliuraments', en: 'Shipping and delivery' },
  devoluciones: { es: 'Devoluciones', ca: 'Devolucions', en: 'Returns' },
};

async function cargar(slug: string, locale: string): Promise<Pagina | null> {
  try {
    return await api<Pagina>(`/content/pages/${locale}/${slug}`, {
      revalidar: 3600,
      etiquetas: ['contenido', `pagina-${slug}`],
    });
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 404) return null;
    // Si la API falla, las páginas legales deben seguir siendo accesibles.
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const pagina = await cargar(slug, locale);
  const titulo = pagina?.title ?? LEGALES[slug]?.[locale];

  /*
   * Solo las legales se esconden del buscador, no todas.
   *
   * Antes iban TODAS con `noindex`, y esta ruta no sirve solo el aviso legal:
   * sirve cualquier página que se cree desde el panel. Es decir, montar una
   * landing de campaña —lo que se hace cuando el catálogo es +18 y Google Ads y
   * Meta Ads están cerrados, o sea el único camino que queda— la creaba
   * invisible para Google, y nada en el panel lo advertía.
   *
   * El motivo original sigue valiendo para las legales: no aportan a la
   * búsqueda y consumen presupuesto de rastreo. Lo que no valía era aplicarlo a
   * lo demás.
   */
  const esLegal = slug in LEGALES;

  return {
    title: pagina?.metaTitle ?? titulo,
    description: pagina?.metaDescription ?? undefined,
    ...(esLegal
      ? { robots: { index: false, follow: true } }
      : { alternates: { canonical: urlAbsoluta(`/${locale}/${slug}`) } }),
  };
}

export default async function PaginaContenido({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const pagina = await cargar(slug, locale);
  const esLegal = slug in LEGALES;

  if (!pagina && !esLegal) notFound();

  const titulo = pagina?.title ?? LEGALES[slug]?.[locale] ?? slug;

  return (
    <Pagina ancho="lectura">
      <TituloPagina titulo={titulo} />

      {pagina ? (
        <div
          className="prose-sm mt-6 max-w-none whitespace-pre-line"
          style={{ color: 'var(--texto-suave)' }}
        >
          {pagina.content}
        </div>
      ) : (
        <div
          className="mt-6 rounded-[--radius-card] p-4 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--aviso) 10%, transparent)',
            color: 'var(--aviso)',
          }}
        >
          Esta página todavía no tiene contenido. Redáctala desde el panel de administración, en
          Contenido → Páginas.
        </div>
      )}
    </Pagina>
  );
}
