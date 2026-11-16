import type { Metadata } from 'next';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { alternativas } from '@/lib/sitio';
import { Pagina, TituloPagina } from '@/components/ui/pagina';
import { Vacio } from '@/components/ui/estados';

interface Marca {
  handle: string;
  name: string;
  logoUrl: string | null;
  productos: number;
}

/**
 * Las marcas del catálogo.
 *
 * Mucha gente no busca «vibrador»: busca «Satisfyer». Con el catálogo de un
 * proveedor son cientos de fabricantes, y hasta ahora la única forma de ver los
 * productos de uno era escribir su nombre en el buscador y confiar en que
 * coincidiera —y filtrarlo después desde la barra lateral—.
 *
 * Se regenera cada hora: el listado de marcas cambia cuando se importa
 * catálogo, no cuando alguien compra.
 */
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'marcas' });

  return {
    title: t('titulo'),
    description: t('descripcion'),
    alternates: await alternativas('/marcas', locale),
  };
}

export default async function PaginaMarcas({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, marcas] = await Promise.all([
    getTranslations('marcas'),
    api<Marca[]>('/brands/public', {
      revalidar: 3600,
      etiquetas: ['catalogo', 'marcas'],
      // Sin marcas la página sale vacía en vez de con un error: es un índice
      // de apoyo, no una pantalla por la que se cobre.
    }).catch(() => [] as Marca[]),
  ]);

  return (
    <Pagina>
      <TituloPagina titulo={t('titulo')} descripcion={t('descripcion')} />

      {marcas.length === 0 ? (
        <Vacio icono="imagen" titulo={t('vacia')} />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {marcas.map((m) => (
            <li key={m.handle}>
              {/*
               * Se filtra por NOMBRE y no por identificador.
               *
               * Es lo que el buscador tiene indexado de cada producto: el
               * índice guarda `brand: "Satisfyer"`, no su handle. Enlazando por
               * handle el filtro no encontraría nada y la marca llevaría a un
               * listado vacío.
               */}
              <Link
                href={`/buscar?marca=${encodeURIComponent(m.name)}` as never}
                className="card group flex h-full flex-col items-center gap-3 p-4 text-center transition-colors hover:border-[var(--marca-primario)]"
              >
                <span className="grid h-14 w-full place-items-center">
                  {m.logoUrl ? (
                    <Image
                      src={m.logoUrl}
                      alt={m.name}
                      width={140}
                      height={56}
                      // `contain`: los logotipos vienen con proporciones muy
                      // distintas y recortarlos los deja irreconocibles.
                      className="h-12 w-auto max-w-full object-contain"
                    />
                  ) : (
                    // Sin logotipo, el nombre en grande hace de logotipo. Un
                    // hueco vacío se lee como una imagen que no ha cargado.
                    <span className="text-base font-semibold tracking-tight">{m.name}</span>
                  )}
                </span>

                <span className="min-w-0">
                  {m.logoUrl && (
                    <span className="lineas-2 block text-sm font-medium">{m.name}</span>
                  )}
                  <span className="mt-0.5 block text-xs text-[var(--texto-tenue)]">
                    {t('productos', { total: m.productos })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Pagina>
  );
}
