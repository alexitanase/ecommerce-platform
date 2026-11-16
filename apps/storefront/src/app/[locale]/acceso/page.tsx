import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PuertaEdad } from '@/components/puerta-edad';

/**
 * La puerta de la tienda.
 *
 * No se llega aquí navegando: el middleware reescribe cualquier ruta a esta
 * página mientras no haya verificación, conservando la URL original. Por eso
 * al verificar basta con recargar —lo que hace `PuertaEdad`—: la recarga la
 * atiende ya la página que se pidió de verdad.
 */
export const metadata: Metadata = {
  // Lo que se pinta aquí es un formulario de edad, no contenido: indexarlo
  // duplicaría la misma página bajo todas las URL de la tienda.
  robots: { index: false, follow: false },
};

export default async function PaginaAcceso({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <PuertaEdad />;
}
