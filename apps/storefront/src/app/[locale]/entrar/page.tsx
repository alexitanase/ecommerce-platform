import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FormularioAcceso } from '@/components/formulario-acceso';
import { accesosSociales, motivoOauth } from '@/lib/accesos';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });

  // Sin indexar: no aporta nada en un buscador y solo compite con las páginas
  // que sí venden.
  return { title: t('entrar'), robots: { index: false, follow: true } };
}

export default async function PaginaEntrar({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // El motivo del fallo se valida aquí, en el servidor, contra una lista cerrada:
  // llega en la URL y de ahí no se puede fiar nada.
  const [proveedores, parametros] = await Promise.all([accesosSociales(), searchParams]);

  return (
    <FormularioAcceso
      modo="entrar"
      proveedores={proveedores}
      fallo={motivoOauth(parametros['error'])}
    />
  );
}
