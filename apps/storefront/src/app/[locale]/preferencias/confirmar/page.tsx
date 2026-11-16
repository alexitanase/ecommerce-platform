import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { ConfirmarToken } from '@/components/confirmar-token';

/** Sin indexar: son pantallas de un solo uso que llegan desde un correo. */
export const metadata = { robots: { index: false, follow: false } };

export default async function Pagina({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Lee el token de la query, así que necesita Suspense.
  return (
    <Suspense fallback={null}>
      <ConfirmarToken tipo="newsletter" />
    </Suspense>
  );
}
