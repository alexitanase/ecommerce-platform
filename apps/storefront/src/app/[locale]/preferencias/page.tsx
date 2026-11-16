import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { PreferenciasCorreo } from '@/components/preferencias-correo';
import { Pagina } from '@/components/ui/pagina';
import { Esqueleto } from '@/components/ui/estados';

/**
 * Centro de preferencias de correo.
 *
 * No se indexa: es una página personal a la que se llega con un token desde el
 * pie de un correo, y en el buscador solo sería ruido.
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function PaginaPreferencias({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Pagina ancho="formulario">
      {/* Lee el token de la query, así que va dentro de Suspense. */}
      <Suspense fallback={<Esqueleto className="h-40" />}>
        <PreferenciasCorreo />
      </Suspense>
    </Pagina>
  );
}
