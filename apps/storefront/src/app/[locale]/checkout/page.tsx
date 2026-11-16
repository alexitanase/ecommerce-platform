import { setRequestLocale } from 'next-intl/server';
import { FormularioCheckout } from '@/components/formulario-checkout';

export default async function PaginaCheckout({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FormularioCheckout locale={locale} />;
}
