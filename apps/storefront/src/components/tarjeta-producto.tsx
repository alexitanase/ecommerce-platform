'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { BotonDeseo } from '@/components/boton-deseo';
import { descuento } from '@/lib/formato';
import { Icono } from './ui/icono';
import { usePrecio } from './proveedor-divisa';

export interface ProductoResumen {
  id: string;
  name: string;
  slug: string;
  imagen: string | null;
  priceCents: number;
  compareAtCents: number | null;
  disponible: boolean;
  valoracion: number;
  numeroResenas: number;
}

/**
 * Cómo se pinta un producto en un listado.
 *
 *  · `cuadricula` — la de siempre: foto grande y datos debajo. Es para mirar.
 *  · `lista` — una fila: foto pequeña a la izquierda y el nombre entero al
 *    lado. Es para comparar, que es lo que se hace cuando ya se sabe qué se
 *    busca. En el móvil la cuadrícula son dos columnas de 170 px con títulos
 *    de proveedor cortados a dos líneas, y dos productos de la misma familia
 *    se ven exactamente iguales: la fila es la que deja leerlos.
 */
export type VistaListado = 'cuadricula' | 'lista';

/**
 * Es un componente de cliente, y no por capricho.
 *
 * Los listados cargan las páginas siguientes desde el navegador conforme se
 * baja, así que las tarjetas nuevas se pintan ahí. Con un componente de
 * servidor haría falta una segunda tarjeta escrita para el cliente, y dos
 * tarjetas que enseñan lo mismo se separan al primer cambio: una con el
 * descuento y la otra sin él. Lo que cuesta es el peso del componente en el
 * navegador, que son unas líneas de JSX; el precio, el nombre y las fotos
 * siguen llegando renderizados desde el servidor en la primera página.
 */
export function TarjetaProducto({
  producto,
  locale,
  prioridad = false,
  vista = 'cuadricula',
}: {
  producto: ProductoResumen;
  locale: string;
  /** true para las primeras del listado: mejora el LCP al no diferir su carga. */
  prioridad?: boolean;
  vista?: VistaListado;
}) {
  // Los precios se enseñan en la divisa que haya elegido el visitante. El
  // importe sigue siendo el mismo en euros: esto solo convierte para mostrar.
  const fmtPrecio = usePrecio(locale);

  const t = useTranslations('producto');
  const rebaja = descuento(producto.priceCents, producto.compareAtCents);

  /*
   * La valoración y el precio se escriben una vez y se colocan en las dos
   * vistas. Son `<span>` con display de bloque y no `<p>`: en la fila van
   * dentro de contenido en línea, y un párrafo ahí es HTML inválido —el
   * navegador lo cierra por su cuenta y parte la tarjeta en dos.
   */
  const valoracion = producto.numeroResenas > 0 && (
    <span className="flex items-center gap-1 text-xs text-[var(--texto-tenue)]">
      <span aria-hidden="true">★</span>
      <span>{producto.valoracion.toFixed(1)}</span>
      <span>({producto.numeroResenas})</span>
    </span>
  );

  const precios = (
    <span className="flex items-baseline gap-2">
      <span className="font-semibold">{fmtPrecio(producto.priceCents)}</span>
      {producto.compareAtCents && (
        <span className="text-xs text-[var(--texto-tenue)] line-through">
          {fmtPrecio(producto.compareAtCents)}
        </span>
      )}
    </span>
  );

  if (vista === 'lista') {
    return (
      <article className="card relative flex gap-3 overflow-hidden p-3 transition-shadow hover:shadow-[var(--sombra-elevada)]">
        <BotonDeseo productId={producto.id} className="absolute right-2 top-2 z-10" />

        <Link
          href={`/producto/${producto.slug}` as never}
          className="flex min-w-0 flex-1 items-start gap-3"
        >
          <span className="relative aspect-square w-24 shrink-0 overflow-hidden rounded-lg bg-[var(--fondo-sutil)] sm:w-28">
            {producto.imagen ? (
              <Image
                src={producto.imagen}
                alt={producto.name}
                fill
                // Fija y pequeña: en la fila la foto mide lo mismo en el móvil
                // que en el escritorio, así que no hay nada que negociar con
                // el navegador y pedir un 50vw sería traerse ocho veces más.
                sizes="112px"
                priority={prioridad}
                className="object-cover"
              />
            ) : (
              <span className="grid h-full place-items-center text-[var(--texto-tenue)]">
                <Icono nombre="imagen" tamano={24} />
              </span>
            )}

            {!producto.disponible && (
              <span className="absolute inset-0 bg-[color-mix(in_srgb,var(--fondo)_70%,transparent)]" />
            )}
          </span>

          {/* `pr-8` deja sitio al corazón, que va absoluto sobre la esquina: sin
              él, un nombre largo pasa por debajo del botón. */}
          <div className="min-w-0 flex-1 pr-8">
            {/* Sigue siendo un h3, como en la cuadrícula: quien navega por
                titulares recorre el listado igual en las dos vistas. Tres
                líneas y no dos porque en la fila hay ancho de sobra y los
                títulos del proveedor solo se distinguen por el final. */}
            <h3 className="lineas-3 text-sm font-medium leading-snug">{producto.name}</h3>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              {valoracion}
              {rebaja !== null && (
                <span
                  className="etiqueta text-white"
                  style={{ background: 'var(--error-relleno)' }}
                >
                  {t('descuento', { porcentaje: rebaja })}
                </span>
              )}
              {!producto.disponible && (
                <span className="etiqueta bg-[var(--fondo-sutil)] text-[var(--texto-suave)]">
                  {t('sin_stock')}
                </span>
              )}
            </div>

            <div className="mt-2">{precios}</div>
          </div>
        </Link>
      </article>
    );
  }

  return (
    <article className="card group relative overflow-hidden transition-shadow hover:shadow-[var(--sombra-elevada)]">
      {/* Fuera del enlace: dentro, pulsar el corazón navegaría a la ficha. */}
      <BotonDeseo productId={producto.id} className="absolute right-2 top-2 z-10" />

      <Link href={`/producto/${producto.slug}` as never} className="block">
        <div className="relative aspect-square overflow-hidden bg-[var(--fondo-sutil)]">
          {producto.imagen ? (
            <Image
              src={producto.imagen}
              alt={producto.name}
              fill
              // Le dice al navegador qué ancho servirá en cada pantalla para
              // que no descargue una imagen de 1920px en un móvil.
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              priority={prioridad}
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="grid h-full place-items-center text-[var(--texto-tenue)]">
              <Icono nombre="imagen" tamano={32} />
            </div>
          )}

          {rebaja !== null && (
            <span
              className="etiqueta absolute left-2 top-2 text-white"
              style={{ background: 'var(--error-relleno)' }}
            >
              {t('descuento', { porcentaje: rebaja })}
            </span>
          )}

          {!producto.disponible && (
            <div className="absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--fondo)_75%,transparent)]">
              <span className="etiqueta bg-[var(--fondo-elevado)] text-[var(--texto-suave)]">
                {t('sin_stock')}
              </span>
            </div>
          )}
        </div>

        <div className="p-3">
          <h3 className="lineas-2 text-sm font-medium leading-snug">{producto.name}</h3>

          {valoracion && <div className="mt-1">{valoracion}</div>}

          <div className="mt-2">{precios}</div>
        </div>
      </Link>
    </article>
  );
}
