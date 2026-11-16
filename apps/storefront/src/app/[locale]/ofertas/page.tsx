import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPathname } from '@/i18n/routing';
import { alternativas, urlAbsoluta } from '@/lib/sitio';
import { tarjetaDeEnlace } from '@/lib/tarjeta-enlace';
import { ListadoCatalogo, uno } from '@/components/listado-catalogo';

/**
 * Lo que está rebajado.
 *
 * Es el mismo listado del catálogo con `soloOfertas` puesto de antemano, y por
 * eso comparte componente: los filtros que valen ahí valen aquí —categoría,
 * marca, precio y el buscador de texto— y quien busca una oferta concreta no
 * tiene por qué aprender otra pantalla.
 *
 * **El filtro va fuera de la URL a propósito.** Si viajara como un parámetro
 * más, «limpiar filtros» lo borraría y la página de ofertas pasaría a enseñar
 * el catálogo entero sin que nada lo explicara.
 *
 * Ordena por descuento de mayor a menor, que es como se mira una página de
 * ofertas: nadie entra buscando el 5 %. El desplegable de orden sigue estando
 * por si se quiere otra cosa.
 */
export const dynamic = 'force-dynamic';

/** Los que convierten la página en «un corte de las ofertas». */
const CLAVES_QUE_FILTRAN = ['q', 'marca', 'precioMin', 'precioMax', 'soloDisponibles'] as const;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ locale }, sp, t] = await Promise.all([params, searchParams, getTranslations('ofertas')]);

  const pagina = Number(uno(sp['pagina']) ?? '1');
  // Un corte de la lista no se indexa: cinco filtros dan cientos de URLs con el
  // mismo contenido barajado, y Google reparte entre ellas la fuerza que
  // debería ir a una sola.
  const recortado =
    CLAVES_QUE_FILTRAN.some((k) => uno(sp[k])) ||
    Boolean(uno(sp['categoria'])) ||
    (Number.isFinite(pagina) && pagina > 1);

  const limpia = getPathname({ href: '/ofertas', locale });

  return {
    title: t('titulo'),
    description: t('descripcion'),
    ...(recortado
      ? { alternates: { canonical: urlAbsoluta(limpia) }, robots: { index: false, follow: true } }
      : {
          alternates: await alternativas('/ofertas', locale),
          robots: { index: true, follow: true },
        }),
    ...tarjetaDeEnlace({ titulo: t('titulo'), descripcion: t('descripcion'), ruta: limpia }),
  };
}

export default async function PaginaOfertas({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const [sp, t] = await Promise.all([searchParams, getTranslations('ofertas')]);
  setRequestLocale(locale);

  return (
    <ListadoCatalogo
      locale={locale}
      sp={sp}
      fijos={{ soloOfertas: 'true', orden: 'descuento' }}
      titulo={t('titulo')}
      descripcion={t('descripcion')}
    />
  );
}
