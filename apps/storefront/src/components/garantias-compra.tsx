import { getTranslations } from 'next-intl/server';
import { ajustesPublicos } from '@/lib/api';
import { formateadorPrecio } from '@/lib/divisas';
import { Icono, type NombreIcono } from './ui/icono';

/**
 * Envío, devoluciones y pago seguro, justo debajo del botón de comprar.
 *
 * Es el hueco donde nacen las dudas que frenan la compra —«¿cuánto me cobran
 * de envío?», «¿y si no me vale?»— y hasta ahora había que ir a buscarlas al
 * pie de página o a las condiciones de venta. Quien se va a comprobar el coste
 * del envío en otra pantalla, muchas veces no vuelve.
 *
 * Los tres datos salen de los ajustes de la tienda, no están escritos aquí: el
 * umbral de envío gratis y los días de devolución los pone el panel, y una
 * ficha que prometa «14 días» cuando en las condiciones ponen 30 es una
 * promesa que hay que cumplir por escrito.
 */
export async function GarantiasCompra({ locale }: { locale: string }) {
  const [t, ajustes, fmtPrecio] = await Promise.all([
    getTranslations('producto'),
    ajustesPublicos(),
    formateadorPrecio(locale),
  ]);

  const umbral = Number(ajustes['shop.freeShippingThreshold'] ?? 0);
  const dias = Number(ajustes['legal.withdrawalDays'] ?? 14);

  const garantias: { icono: NombreIcono; texto: string }[] = [
    // El envío gratis solo se anuncia si de verdad existe. Con el umbral a
    // cero, el mensaje sería «envío gratis desde 0 €», que es mentira o es
    // ruido según cómo lo lea cada uno.
    ...(umbral > 0
      ? [
          {
            icono: 'camion' as const,
            texto: t('envio_gratis_desde', { importe: fmtPrecio(umbral) }),
          },
        ]
      : [{ icono: 'camion' as const, texto: t('envio_a_espana') }]),
    { icono: 'flecha-izquierda', texto: t('devolucion_dias', { dias }) },
    { icono: 'candado', texto: t('pago_seguro') },
  ];

  return (
    <ul className="garantias" data-prueba="garantias-compra">
      {garantias.map((g) => (
        <li key={g.texto}>
          <Icono nombre={g.icono} tamano={18} className="shrink-0 text-[var(--texto-tenue)]" />
          <span>{g.texto}</span>
        </li>
      ))}
    </ul>
  );
}
