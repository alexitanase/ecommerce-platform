'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { DIVISA_BASE } from '@ecom/shared';
import { COOKIE_DIVISA } from '@/lib/divisa-cookie';
import { useDivisa } from './proveedor-divisa';
import { Icono } from './ui/icono';

/**
 * Elegir en qué divisa se ven los precios.
 *
 * Solo aparece si hay algo que elegir, o sea con la integración de tipo de cambio
 * configurada y más de una divisa activa. Con una sola —el estado de salida— no
 * se pinta nada: un desplegable de una opción es ruido, y va en la fila más
 * disputada de la tienda.
 *
 * **Dice que el cobro es en euros, y eso no es un detalle.** Enseñar 21,40 £ sin
 * advertirlo lleva a que el cargo de la tarjeta no cuadre con lo que el cliente
 * creía y a una reclamación evitable; además de que informar del precio final es
 * obligación, no cortesía. Va en el `title` y como texto accesible del control,
 * y el checkout lo repite donde se paga.
 *
 * La preferencia se guarda en cookie desde aquí y se recarga la ruta: los precios
 * los pinta el servidor, así que sin `refresh()` el selector cambiaría de valor y
 * los precios se quedarían como estaban.
 */
export function SelectorDivisa() {
  const t = useTranslations('nav');
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const { actual, disponibles } = useDivisa();

  if (disponibles.length < 2) return null;

  return (
    <label className="relative flex items-center" title={t('divisa_cobro_euros')}>
      <span className="sr-only">
        {t('divisa')} · {t('divisa_cobro_euros')}
      </span>

      <select
        value={actual}
        disabled={pendiente}
        onChange={(e) => {
          const elegida = e.target.value;

          /*
           * Un año, y `SameSite=Lax`.
           *
           * No es un dato sensible ni identifica a nadie, así que no necesita ser
           * `httpOnly`. `Lax` para que sobreviva a volver desde la pasarela de
           * pago: con `Strict` se perdería justo al regresar del cobro y el
           * resumen del pedido saldría en otra divisa que el resto de la visita.
           */
          document.cookie = `${COOKIE_DIVISA}=${elegida}; path=/; max-age=${String(60 * 60 * 24 * 365)}; SameSite=Lax`;

          startTransition(() => {
            router.refresh();
          });
        }}
        // `text-base` en el móvil: por debajo de 16 px, Safari en iOS hace zoom
        // al desplegarlo y deja la página ampliada. Igual que el de idioma.
        className="btn btn-fantasma h-9 cursor-pointer appearance-none py-0 pr-7 pl-2.5 text-base sm:text-sm"
      >
        {disponibles.map((d) => (
          <option key={d} value={d}>
            {d}
            {d === DIVISA_BASE ? '' : ' ≈'}
          </option>
        ))}
      </select>

      <Icono
        nombre="galon-abajo"
        tamano={14}
        className="pointer-events-none absolute right-2 text-[var(--texto-tenue)]"
      />
    </label>
  );
}
