import { setRequestLocale } from 'next-intl/server';
import { RecuperarPassword } from '@/components/recuperar-password';

export const metadata = { robots: { index: false, follow: true } };

export default async function Pagina({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <RecuperarPassword />;
}
