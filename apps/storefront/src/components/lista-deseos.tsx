'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { useDeseos } from '@/lib/deseos';
import { useEsCliente } from '@/lib/use-es-cliente';
import { Esqueleto, Vacio } from '@/components/ui/estados';
import { usePrecio } from './proveedor-divisa';

/**
 * La lista de deseos, con o sin cuenta.
 *
 * Sin sesión se pintan los productos guardados en este navegador; con sesión,
 * primero se funden ambas listas y luego manda el servidor. Ese orden importa:
 * al revés, quien guarda tres cosas sin cuenta y luego entra las perdería.
 */

interface ProductoGuardado {
  id: string;
  name: string;
  slug: string;
  imagen: string | null;
  priceCents: number;
  compareAtCents: number | null;
  disponible: boolean;
}

export function ListaDeseos({ locale }: { locale: string }) {
  // Los precios se enseñan en la divisa que haya elegido el visitante. El
  // importe sigue siendo el mismo en euros: esto solo convierte para mostrar.
  const fmtPrecio = usePrecio(locale);

  const t = useTranslations('deseos');
  const tp = useTranslations('producto');
  const montado = useEsCliente();

  const deseos = useDeseos((e) => e.deseos);
  const fijarDeseos = useDeseos((e) => e.fijarDeseos);
  const alternar = useDeseos((e) => e.alternar);

  const [productos, setProductos] = useState<ProductoGuardado[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const base = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
      const r = await fetch(`${base}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'include',
      });

      if (r.ok) {
        const { accessToken } = (await r.json()) as { accessToken: string };

        // Fundir primero, pintar después: si se pintara antes, lo guardado sin
        // cuenta aparecería y desaparecería al llegar la respuesta.
        const ids = await api<string[]>('/wishlist/merge', {
          method: 'POST',
          body: JSON.stringify({ productIds: useDeseos.getState().deseos }),
          token: accessToken,
        });

        fijarDeseos(ids);
        setProductos(
          await api<ProductoGuardado[]>(`/wishlist?locale=${locale}`, { token: accessToken }),
        );
        return;
      }
    } catch {
      // Sin sesión o con la API caída: se sigue con lo del navegador.
    }

    const guardados = useDeseos.getState().deseos;

    if (guardados.length === 0) {
      setProductos([]);
      return;
    }

    // Como invitado no hay lista en el servidor, pero sí hacen falta los datos
    // de cada producto: se piden al catálogo público por sus identificadores.
    const items = await api<ProductoGuardado[]>(
      `/wishlist/resolve?locale=${locale}&ids=${guardados.join(',')}`,
    ).catch(() => [] as ProductoGuardado[]);

    setProductos(items);
  }, [locale, fijarDeseos]);

  useEffect(() => {
    if (!montado) return;

    void (async () => {
      await cargar();
      setCargando(false);
    })();
  }, [montado, cargar]);

  const quitar = (productId: string) => {
    alternar(productId);
    setProductos((p) => p.filter((x) => x.id !== productId));
    void api(`/wishlist/${productId}`, { method: 'DELETE' }).catch(() => undefined);
  };

  if (!montado || cargando) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Esqueleto key={i} className="aspect-square rounded-[--radius-card]" />
        ))}
      </div>
    );
  }

  if (deseos.length === 0 || productos.length === 0) {
    return (
      <Vacio icono="corazon" titulo={t('vacio')} descripcion={t('vacio_ayuda')}>
        {/* La clave estaba en el espacio de nombres equivocado —`producto` no
            tiene `ver_mas`, lo tiene `comun`— así que el botón salía con el
            identificador en crudo: «producto.ver_mas». Se usa uno propio de
            esta pantalla, que además dice a dónde lleva. */}
        <Link href="/buscar" className="btn btn-primario">
          {t('explorar')}
        </Link>
      </Vacio>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {productos.map((p) => (
        <li key={p.id} className="card group relative overflow-hidden">
          <button
            type="button"
            onClick={() => {
              quitar(p.id);
            }}
            aria-label={tp('quitar_de_deseos')}
            className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full"
            style={{
              background: 'color-mix(in srgb, var(--fondo-elevado) 85%, transparent)',
              color: 'var(--error)',
            }}
          >
            ×
          </button>

          <Link href={`/producto/${p.slug}` as never} className="block">
            <div className="relative aspect-square bg-[var(--fondo-sutil)]">
              {p.imagen && (
                <Image
                  src={p.imagen}
                  alt={p.name}
                  fill
                  sizes="(max-width: 640px) 50vw, 25vw"
                  className="object-cover"
                />
              )}

              {!p.disponible && (
                <div className="absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--fondo)_75%,transparent)]">
                  <span className="etiqueta bg-[var(--fondo-elevado)] text-[var(--texto-suave)]">
                    {tp('sin_stock')}
                  </span>
                </div>
              )}
            </div>

            <div className="p-3">
              <h2 className="lineas-2 text-sm font-medium leading-snug">{p.name}</h2>
              <p className="mt-2 font-semibold">{fmtPrecio(p.priceCents)}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
