import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { arbolCategorias } from '@/lib/categorias';
import { IndiceCategorias } from '@/components/indice-categorias';
import { Pagina, TituloPagina } from '@/components/ui/pagina';
import { alternativas } from '@/lib/sitio';

/**
 * El índice del catálogo.
 *
 * Se regenera cada diez minutos, como el propio árbol. Es de las páginas más
 * estables de la tienda —cambia cuando alguien toca el catálogo, no cuando
 * alguien compra— y no depende de quién la mire: aquí solo hay nombres de
 * categoría y sus fotos de portada, ningún producto. Por eso, a diferencia de
 * la portada, no hace falta partir el caché entre verificados y no verificados.
 *
 * Quien no ha declarado la edad no llega igualmente: la puerta general de la
 * tienda cubre todas las rutas menos las legales y las de pedidos.
 */
export const revalidate = 600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'categorias' });

  return {
    title: t('titulo'),
    description: t('descripcion'),
    alternates: await alternativas('/categorias', locale),
  };
}

export default async function PaginaCategorias({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, arbol] = await Promise.all([getTranslations('categorias'), arbolCategorias(locale)]);

  return (
    <Pagina>
      <TituloPagina titulo={t('titulo')} descripcion={t('descripcion')} />
      <IndiceCategorias arbol={arbol} />
    </Pagina>
  );
}
