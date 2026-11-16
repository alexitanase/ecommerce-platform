import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ListaDeseos } from '@/components/lista-deseos';
import { VistosRecientemente } from '@/components/vistos-recientemente';
import { Pagina, TituloPagina } from '@/components/ui/pagina';

/** La lista es de cada visitante, así que no tiene sentido indexarla. */
export const metadata = { robots: { index: false, follow: true } };

export default async function PaginaDeseos({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('deseos');

  return (
    <Pagina>
      <TituloPagina titulo={t('titulo')} />
      <ListaDeseos locale={locale} />
      <VistosRecientemente locale={locale} />
    </Pagina>
  );
}
