'use client';

import { useTranslations } from 'next-intl';
import { descuento } from '@/lib/formato';
import { usePrecio } from './proveedor-divisa';
import { useVarianteActiva } from './variante-activa';

/**
 * El precio grande de la ficha.
 *
 * Antes era el «desde» del producto, calculado en el servidor y fijo: en un
 * producto con once colores de 18,99 € a 54,99 €, elegir el verde militar
 * cambiaba el importe del botón a 54,99 € y dejaba el 18,99 € en grande justo
 * encima. Eso no es un detalle de maquetación: es enseñar un precio que no se va
 * a cobrar, y con el precio a la vista del botón contradiciéndolo.
 *
 * Ahora sigue a la variante elegida. El valor inicial lo pone el servidor a
 * través del contexto —la misma variante que preselecciona el selector—, así que
 * el primer pintado ya es el correcto y no hay parpadeo al hidratarse.
 *
 * `desde`/`hasta` solo se usan si no hay variante que valga: pasa cuando el
 * cliente ha elegido una combinación que no existe. Enseñar el rango es más
 * honesto que dejar el precio de la última variante válida.
 */
export function PrecioProducto({
  desdeCents,
  hastaCents,
  locale,
}: {
  desdeCents: number;
  hastaCents: number;
  locale: string;
}) {
  const t = useTranslations('producto');
  const { variante } = useVarianteActiva();
  // El precio más grande de la tienda: si este no sigue a la divisa elegida, no
  // la sigue nada.
  const formatear = usePrecio(locale);

  const rebaja = variante ? descuento(variante.precioCents, variante.compareAtCents) : null;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-3xl font-bold" data-prueba="precio-ficha">
          {variante
            ? formatear(variante.precioCents)
            : desdeCents === hastaCents
              ? formatear(desdeCents)
              : `${formatear(desdeCents)} – ${formatear(hastaCents)}`}
        </p>

        {/*
         * El precio tachado lo decide el histórico de los últimos 30 días, no
         * quien edita el producto: la API solo rellena `compareAtCents` cuando
         * el descuento es anunciable según la directiva Ómnibus. Aquí solo se
         * pinta lo que ya viene validado.
         */}
        {variante?.compareAtCents && rebaja !== null && (
          <>
            <p className="text-base text-[var(--texto-tenue)] line-through">
              {formatear(variante.compareAtCents)}
            </p>
            <span className="etiqueta text-white" style={{ background: 'var(--error-relleno)' }}>
              {t('descuento', { porcentaje: rebaja })}
            </span>
          </>
        )}
      </div>

      <p className="mt-1 text-xs text-[var(--texto-tenue)]">{t('iva_incluido')}</p>
    </div>
  );
}
