import { setRequestLocale } from 'next-intl/server';
import { IniciarPago } from '@/components/iniciar-pago';

/**
 * Pantalla de pago del pedido.
 *
 * Dinámica: depende del estado de un cobro concreto, que cambia en segundos.
 * Cachearla mostraría al cliente un pago ya caducado como si estuviera vivo.
 */
export const dynamic = 'force-dynamic';

export default async function PaginaPago({
  params,
  searchParams,
}: {
  // El segmento se llama igual que en la página de seguimiento: Next exige el
  // mismo nombre para la misma posición de la ruta, y aquí es el número visible
  // del pedido, que el checkout ya conoce cuando redirige a pagar.
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const { locale, token: numero } = await params;
  const { id } = await searchParams;
  setRequestLocale(locale);

  return <IniciarPago orderId={id ?? ''} numero={numero} locale={locale} />;
}
