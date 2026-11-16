import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { BloquePortada, type Bloque } from '@/components/bloques-portada';
import { Pagina } from '@/components/ui/pagina';
import { alternativas } from '@/lib/sitio';

/**
 * Portada.
 *
 * No está escrita aquí: es la lista de bloques que se configura en el panel
 * (Contenido → Portada). Esta página solo los pide y los pinta en orden, así
 * que cambiar el hero de campaña o el orden de las secciones no necesita
 * despliegue.
 *
 * Se regenera cada 5 minutos (ISR): el catálogo cambia con la sincronización
 * del proveedor, pero no tanto como para renderizarla en cada visita. Así la
 * página se sirve desde caché y carga al instante.
 *
 * Salvo para quien trae cookie de verificación de edad: ahí la portada depende
 * de quién pregunta —el catálogo +18 solo se le enseña a quien ha declarado su
 * edad— y una copia compartida se le serviría a la visita siguiente. Es el
 * mismo criterio que ya sigue la ficha de producto.
 */
export const revalidate = 300;

/**
 * La portada declara su canonical y sus tres idiomas.
 *
 * El título y la descripción los pone el layout con la marca de la tienda, así
 * que aquí solo hace falta decir cuál es su dirección buena y dónde están sus
 * traducciones. Es la página con más enlaces entrantes: si el hreflang falla en
 * alguna, que no sea en esta.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: await alternativas('/', locale) };
}

export default async function Portada({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('inicio');

  // Si la API no responde, la portada sale con lo mínimo en vez de con un
  // error: quien llega a la tienda tiene que poder entrar al catálogo aunque
  // el backend esté teniendo un mal momento.
  const galletas = (await cookies()).toString();

  const portada = await api<{ bloques: Bloque[] }>(`/content/home/${locale}`, {
    ...(galletas ? { cache: 'no-store' as const, cookies: galletas } : { revalidar: 300 }),
    etiquetas: ['catalogo', 'portada'],
  }).catch(() => ({ bloques: [] as Bloque[] }));

  return (
    <Pagina>
      {portada.bloques.length === 0 ? (
        <section className="card p-8 sm:p-12">
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            {t('titulo')}
          </h1>
          <Link href="/buscar" className="btn btn-primario mt-6">
            {t('ver_catalogo')}
          </Link>
        </section>
      ) : (
        portada.bloques.map((bloque, i) => (
          <BloquePortada key={bloque.id} bloque={bloque} locale={locale} primero={i === 0} />
        ))
      )}
    </Pagina>
  );
}
