import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SeguimientoPedido, type PedidoSeguimiento } from '@/components/seguimiento-pedido';
import { Pagina } from '@/components/ui/pagina';
import { ErrorCarga } from '@/components/ui/estados';

/**
 * Confirmación y seguimiento de un pedido.
 *
 * Dinámica y sin indexar a propósito: la URL lleva la clave del pedido dentro,
 * así que una copia cacheada o indexada expondría los datos de un cliente.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function PaginaSeguimiento({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const base = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

  const respuesta = await fetch(`${base}/api/v1/orders/track/${encodeURIComponent(token)}`, {
    // Nunca cacheado: el estado del pedido cambia mientras el cliente mira.
    cache: 'no-store',
  });

  if (respuesta.status === 404) notFound();

  if (!respuesta.ok) {
    const t = await getTranslations('pedido');
    return (
      <Pagina ancho="formulario">
        <ErrorCarga titulo={t('no_encontrado')} descripcion={t('no_encontrado_ayuda')} />
      </Pagina>
    );
  }

  const pedido = (await respuesta.json()) as PedidoSeguimiento;

  return <SeguimientoPedido pedido={pedido} locale={locale} />;
}
