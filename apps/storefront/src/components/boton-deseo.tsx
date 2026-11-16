'use client';

import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useDeseos } from '@/lib/deseos';
import { useEsCliente } from '@/lib/use-es-cliente';
import { Icono } from './ui/icono';

/**
 * Corazón de "guardar para después".
 *
 * Funciona sin cuenta: se guarda en el navegador y punto. Si además hay
 * sesión, se manda al servidor sin esperar respuesta —el corazón se pinta al
 * instante— porque hacer esperar medio segundo a un gesto tan pequeño lo
 * convierte en algo que no apetece usar.
 *
 * Si la llamada falla, el deseo sigue guardado en el navegador y se sincroniza
 * en la próxima visita: perderlo por un error de red sería peor que tenerlo
 * solo en este dispositivo.
 */
export function BotonDeseo({
  productId,
  className = '',
}: {
  productId: string;
  className?: string;
}) {
  const t = useTranslations('producto');
  const montado = useEsCliente();
  const deseos = useDeseos((e) => e.deseos);
  const alternar = useDeseos((e) => e.alternar);

  // Hasta que monta, el navegador aún no ha leído localStorage: pintar el
  // corazón lleno y cambiarlo después daría un parpadeo en cada carga.
  const guardado = montado && deseos.includes(productId);

  const pulsar = () => {
    const ahoraGuardado = alternar(productId);

    void api(`/wishlist/${productId}`, { method: ahoraGuardado ? 'POST' : 'DELETE' }).catch(
      () => undefined,
    );
  };

  return (
    <button
      type="button"
      onClick={pulsar}
      aria-pressed={guardado}
      aria-label={guardado ? t('quitar_de_deseos') : t('guardar_en_deseos')}
      title={guardado ? t('quitar_de_deseos') : t('guardar_en_deseos')}
      className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${className}`}
      style={{
        background: 'color-mix(in srgb, var(--fondo-elevado) 85%, transparent)',
        color: guardado ? 'var(--error)' : 'var(--texto-suave)',
      }}
    >
      <Icono nombre="corazon" relleno={guardado} />
    </button>
  );
}
