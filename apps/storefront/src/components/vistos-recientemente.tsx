'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useDeseos } from '@/lib/deseos';
import { useEsCliente } from '@/lib/use-es-cliente';
import { usePrecio } from './proveedor-divisa';

/**
 * Lo último que ha mirado este visitante.
 *
 * Sale del navegador, no del servidor: es historial de navegación, y guardarlo
 * en la base de datos sería recoger un dato de comportamiento que no hace falta
 * para vender —y que habría que declarar, conservar y borrar a petición.
 *
 * Ayuda de verdad en una tienda de catálogo largo: quien compara cuatro
 * productos parecidos vuelve al que vio hace tres clics, y sin esto tiene que
 * buscarlo otra vez.
 */
export function VistosRecientemente({ locale, excluir }: { locale: string; excluir?: string }) {
  // Los precios se enseñan en la divisa que haya elegido el visitante. El
  // importe sigue siendo el mismo en euros: esto solo convierte para mostrar.
  const fmtPrecio = usePrecio(locale);

  const t = useTranslations('producto');
  const montado = useEsCliente();
  const vistos = useDeseos((e) => e.vistos);

  // Hasta montar no hay localStorage: pintarlo antes daría un salto de página.
  if (!montado) return null;

  const lista = vistos.filter((v) => v.id !== excluir);
  // Con uno solo no es un carrusel, es la ficha que ya está mirando.
  if (lista.length < 2) return null;

  return (
    <section className="mt-12">
      <h2 className="mb-4 text-lg font-semibold tracking-tight">{t('vistos_recientemente')}</h2>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {lista.slice(0, 6).map((v) => (
          <li key={v.id} className="card overflow-hidden">
            <Link href={`/producto/${v.slug}` as never} className="block">
              <div className="relative aspect-square bg-[var(--fondo-sutil)]">
                {v.imagen && (
                  <Image
                    src={v.imagen}
                    alt={v.nombre}
                    fill
                    sizes="(max-width: 640px) 50vw, 16vw"
                    className="object-cover"
                  />
                )}
              </div>
              <div className="p-2">
                <p className="lineas-2 text-xs leading-snug">{v.nombre}</p>
                <p className="mt-1 text-sm font-semibold">{fmtPrecio(v.precioCents)}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
