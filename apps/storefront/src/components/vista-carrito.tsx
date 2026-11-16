'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useCarrito } from '@/lib/carrito';
import { useEsCliente } from '@/lib/use-es-cliente';
import { usePrecio } from '@/components/proveedor-divisa';
import { Pagina, TituloPagina } from '@/components/ui/pagina';
import { Cargando, Esqueleto, Vacio } from '@/components/ui/estados';

export function VistaCarrito({ locale }: { locale: string }) {
  const t = useTranslations('carrito');
  const tc = useTranslations('comun');
  const { lineas, cambiarCantidad, eliminar, subtotalCents } = useCarrito();
  const fmtPrecio = usePrecio(locale);
  const [umbralEnvioGratis, setUmbral] = useState<number | null>(null);

  // El carrito está en localStorage: en el servidor siempre saldría vacío.
  const montado = useEsCliente();

  useEffect(() => {
    const base = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
    fetch(`${base}/api/v1/settings/public`)
      .then((r) => r.json() as Promise<Record<string, unknown>>)
      .then((a) => {
        const u = a['shop.freeShippingThreshold'];
        if (typeof u === 'number') setUmbral(u);
      })
      .catch(() => {
        // Si falla, simplemente no se muestra el aviso de envío gratis.
      });
  }, []);

  if (!montado) {
    return (
      <Pagina>
        <Esqueleto className="mb-6 h-8 w-40" />
        <Cargando etiqueta={t('titulo')} />
      </Pagina>
    );
  }

  const subtotal = subtotalCents();
  const faltaParaGratis = umbralEnvioGratis !== null ? umbralEnvioGratis - subtotal : null;

  if (lineas.length === 0) {
    return (
      <Pagina>
        {/* El título se mantiene aunque no haya nada: sin él la página se
            queda sin `h1` y quien navega con lector de pantalla no sabe
            dónde ha llegado. */}
        <TituloPagina titulo={t('titulo')} />
        {/* El carrito vacío es de las pocas pantallas donde alguien decide si
            sigue en la tienda o se va: lleva salida, no solo el aviso. */}
        <Vacio icono="carrito" titulo={t('vacio')} descripcion={t('vacio_ayuda')}>
          <Link href="/buscar" className="btn btn-primario">
            {t('seguir_comprando')}
          </Link>
        </Vacio>
      </Pagina>
    );
  }

  return (
    <Pagina>
      <TituloPagina titulo={t('titulo')} />

      {faltaParaGratis !== null && (
        <div
          className="mt-4 rounded-[--radius-card] px-4 py-3 text-sm"
          style={{
            background:
              faltaParaGratis > 0
                ? 'color-mix(in srgb, var(--info) 10%, transparent)'
                : 'color-mix(in srgb, var(--exito) 12%, transparent)',
            color: faltaParaGratis > 0 ? 'var(--info)' : 'var(--exito)',
          }}
        >
          {faltaParaGratis > 0
            ? t('envio_gratis_desde', { importe: fmtPrecio(faltaParaGratis) })
            : t('envio_gratis_conseguido')}
        </div>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
        <ul className="space-y-3">
          {lineas.map((l) => (
            <li key={l.variantId} className="card flex gap-4 p-3">
              <Link
                href={`/producto/${l.slug}` as never}
                className="relative h-24 w-24 flex-none overflow-hidden rounded-lg bg-[var(--fondo-sutil)]"
              >
                {l.imagen && (
                  <Image src={l.imagen} alt={l.nombre} fill sizes="96px" className="object-cover" />
                )}
              </Link>

              <div className="min-w-0 flex-1">
                <Link href={`/producto/${l.slug}` as never} className="lineas-2 font-medium">
                  {l.nombre}
                </Link>
                {l.variante && (
                  <p className="mt-0.5 text-sm text-[var(--texto-tenue)]">{l.variante}</p>
                )}

                <div className="mt-3 flex items-center gap-3">
                  <label className="flex items-center gap-2">
                    <span className="solo-lectores">{t('actualizar')}</span>
                    <select
                      value={l.cantidad}
                      onChange={(e) => cambiarCantidad(l.variantId, Number(e.target.value))}
                      // Sin `text-sm`: ganaba a `.campo` y devolvía el campo a
                      // 14 px, que es justo el tamaño con el que iOS hace zoom.
                      className="campo h-8 w-16 py-0"
                    >
                      {Array.from(
                        { length: Math.max(Math.min(l.stockDisponible, 10), l.cantidad) },
                        (_, i) => i + 1,
                      ).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={() => eliminar(l.variantId)}
                    className="text-sm text-[var(--texto-tenue)] underline-offset-2 transition-colors hover:text-[var(--error)] hover:underline"
                  >
                    {t('eliminar')}
                  </button>
                </div>

                {l.cantidad >= l.stockDisponible && l.stockDisponible > 0 && (
                  <p className="mt-2 text-xs" style={{ color: 'var(--aviso)' }}>
                    {t('stock_insuficiente', {
                      cantidad: l.stockDisponible,
                      producto: l.nombre,
                    })}
                  </p>
                )}
              </div>

              <p className="flex-none font-semibold">
                {fmtPrecio(l.precioCents * l.cantidad)}
              </p>
            </li>
          ))}
        </ul>

        <aside className="card h-fit p-5 lg:sticky lg:top-24">
          <h2 className="font-semibold">{t('subtotal')}</h2>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--texto-suave)]">{t('subtotal')}</dt>
              <dd>{fmtPrecio(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--texto-suave)]">{t('envio')}</dt>
              <dd className="text-[var(--texto-tenue)]">{t('envio_calculado')}</dd>
            </div>
          </dl>

          <div className="mt-4 flex justify-between border-t border-[var(--borde)] pt-4 text-lg font-semibold">
            <span>{t('total')}</span>
            <span>{fmtPrecio(subtotal)}</span>
          </div>

          <Link href="/checkout" className="btn btn-primario mt-5 w-full">
            {t('finalizar')}
          </Link>

          <Link href="/buscar" className="btn btn-fantasma mt-2 w-full">
            {tc('volver')}
          </Link>
        </aside>
      </div>
    </Pagina>
  );
}
