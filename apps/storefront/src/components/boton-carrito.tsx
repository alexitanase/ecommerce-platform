'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useCarrito } from '@/lib/carrito';
import { useEsCliente } from '@/lib/use-es-cliente';
import { Icono } from './ui/icono';

export function BotonCarrito() {
  const t = useTranslations('nav');
  const total = useCarrito((s) => s.totalArticulos());
  // El carrito vive en localStorage: en el servidor siempre está vacío, así
  // que pintar el contador antes de hidratar produciría una discrepancia.
  const montado = useEsCliente();

  return (
    <Link
      href="/carrito"
      className="btn btn-fantasma btn-icono relative"
      aria-label={montado && total > 0 ? `${t('carrito')} (${String(total)})` : t('carrito')}
    >
      <Icono nombre="carrito" />
      {montado && total > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white"
          style={{ background: 'var(--marca-primario)' }}
        >
          {total > 99 ? '99+' : total}
        </span>
      )}
    </Link>
  );
}
