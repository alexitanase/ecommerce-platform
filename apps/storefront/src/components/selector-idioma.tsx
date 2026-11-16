'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { Icono } from './ui/icono';

const NOMBRES: Record<string, string> = { es: 'Español', ca: 'Català', en: 'English' };

/**
 * Los idiomas que se ofrecen los decide el panel, no este componente.
 *
 * Antes salían de `routing.locales`, o sea los compilados, así que desactivar un
 * idioma desde ajustes no lo quitaba del selector: seguía ofreciéndose y quien lo
 * elegía acababa en una versión que la tienda había decidido no servir. Ahora
 * llegan como propiedad desde la cabecera, que sí puede leer los ajustes por ser
 * un componente de servidor.
 *
 * Con un solo idioma activo no se pinta nada: un desplegable de una sola opción
 * es ruido, y en el móvil ocupa sitio en la fila más disputada de la tienda.
 */
export function SelectorIdioma({ actual, idiomas }: { actual: string; idiomas: string[] }) {
  const t = useTranslations('nav');
  const router = useRouter();
  const pathname = usePathname();
  const [pendiente, startTransition] = useTransition();

  // Después de los hooks, no antes: salir del componente antes de llamarlos
  // cambia el número de hooks entre renderizados y React pierde su estado.
  if (idiomas.length < 2) return null;

  return (
    /*
     * Va con la misma pinta que los demás botones de la cabecera.
     *
     * Con el aspecto nativo, este control era lo más llamativo de toda la
     * barra: borde marcado, fondo propio y la flecha que dibuja el sistema
     * operativo, al lado de cuatro iconos discretos. El resultado era que el
     * control menos importante —se toca una vez en la vida— se llevaba toda
     * la atención, y encima con un estilo que no era el de la tienda.
     *
     * Sigue siendo un `<select>` de verdad: la lista la despliega el
     * navegador, funciona con teclado y en móvil sale el selector nativo. Solo
     * se le quita el aspecto y se le pone un galón propio.
     */
    <label className="relative flex items-center">
      <span className="solo-lectores">{t('idioma')}</span>
      <select
        value={actual}
        disabled={pendiente}
        onChange={(e) => {
          // Se mantiene la ruta actual y solo cambia el idioma: si el usuario
          // está viendo un producto, no debe acabar en la portada.
          //
          // Excepción: las páginas de contenido (/[slug]) tienen un slug
          // distinto en cada idioma —"privacidad" y "privacy"— y aquí no se
          // conoce el del idioma de destino. `usePathname` devuelve la
          // plantilla con los corchetes, así que reutilizarla llevaría a una
          // URL literal "/en/[slug]" que no existe. En ese caso se va a la
          // portada del nuevo idioma, que es un destino válido.
          const destino = pathname.includes('[') ? '/' : pathname;

          startTransition(() => {
            router.replace(destino as '/', { locale: e.target.value });
          });
        }}
        // `text-base` en el móvil: por debajo de 16 px, Safari en iOS hace
        // zoom al desplegarlo y deja la página ampliada. Igual que `.campo`.
        className="btn btn-fantasma h-9 cursor-pointer appearance-none py-0 pr-7 pl-2.5 text-base sm:text-sm"
      >
        {idiomas.map((l) => (
          <option key={l} value={l}>
            {NOMBRES[l] ?? l}
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
