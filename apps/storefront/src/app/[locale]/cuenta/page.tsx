import { setRequestLocale } from 'next-intl/server';
import { AreaCliente } from '@/components/area-cliente';

export default async function PaginaCuenta({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AreaCliente locale={locale} />;
}
