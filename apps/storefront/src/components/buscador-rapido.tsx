'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { useBusquedas } from '@/lib/busquedas';
import { useSugerencias } from '@/lib/use-sugerencias';
import { Icono } from './ui/icono';
import { usePrecio } from './proveedor-divisa';

/**
 * Buscador con sugerencias en vivo.
 *
 * Este es el del escritorio, donde hay sitio para un campo en la barra y un
 * desplegable debajo. En el móvil se usa `BuscadorMovil`, que abre a pantalla
 * completa; los dos comparten la consulta de sugerencias (`useSugerencias`) y
 * el historial (`useBusquedas`) para que no puedan comportarse distinto.
 */
export function BuscadorRapido({ locale }: { locale: string }) {
  // Los precios se enseñan en la divisa que haya elegido el visitante. El
  // importe sigue siendo el mismo en euros: esto solo convierte para mostrar.
  const fmtPrecio = usePrecio(locale);

  const t = useTranslations('comun');
  const tb = useTranslations('buscador');
  const router = useRouter();
  const [consulta, setConsulta] = useState('');
  /**
   * Se ha cerrado el desplegable a propósito.
   *
   * Se guarda esto y no «está abierto». El desplegable está abierto siempre
   * que haya sugerencias que enseñar, que es lo normal; lo excepcional es
   * haberlo cerrado —con Escape, pulsando fuera o tras elegir algo— y eso es
   * lo único que hace falta recordar. Al revés obligaba a abrirlo desde un
   * efecto cada vez que llegaban sugerencias nuevas, que es un render de más
   * por pulsación y lo que React desaconseja.
   */
  const [cerrado, setCerrado] = useState(false);
  /**
   * Sugerencia resaltada con las flechas.
   *
   * −1 significa "ninguna": el foco no se mueve del campo de texto, que es
   * como funciona un combobox accesible. El elemento activo se comunica al
   * lector con `aria-activedescendant`, no moviendo el foco de sitio.
   */
  const [resaltada, setResaltada] = useState(-1);
  const contenedor = useRef<HTMLDivElement>(null);

  const { sugerencias: visibles } = useSugerencias(consulta, locale);
  const { recordar } = useBusquedas();

  const abierto = visibles.length > 0 && !cerrado;

  // Cerrar al pulsar fuera.
  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (contenedor.current && !contenedor.current.contains(e.target as Node)) {
        setCerrado(true);
      }
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  const irA = (slug: string) => {
    router.push(`/producto/${slug}` as never);
    setCerrado(true);
    setConsulta('');
    setResaltada(-1);
  };

  /**
   * Flechas, Enter y Escape sobre el campo de búsqueda.
   *
   * Sin esto, declarar `role="combobox"` sería mentir: el lector anunciaría
   * que hay una lista de sugerencias y no habría forma de recorrerla. Peor que
   * no anunciarla.
   */
  const teclas = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (visibles.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCerrado(false);
      setResaltada((i) => (i + 1) % visibles.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setResaltada((i) => (i <= 0 ? visibles.length - 1 : i - 1));
    } else if (e.key === 'Enter' && resaltada >= 0) {
      // Solo intercepta si hay una sugerencia elegida; si no, el formulario
      // hace lo suyo y lleva a la búsqueda completa.
      e.preventDefault();
      const elegida = visibles[resaltada];
      if (elegida) irA(elegida.slug);
    } else if (e.key === 'Escape') {
      setCerrado(true);
      setResaltada(-1);
    }
  };

  return (
    /*
     * Empieza donde acaba el logo y crece con la pantalla.
     *
     * Sin `mx-auto`: centrado dentro de su hueco flexible quedaba flotando sin
     * alinearse con nada. Y con el tope en `md` se quedaba en 448 px aunque
     * hubiera 800 libres, dejando un hueco muerto en mitad de la barra que se
     * notaba más que un campo grande.
     */
    <div ref={contenedor} className="relative w-full max-w-2xl">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const limpia = consulta.trim();
          if (limpia) {
            // El historial es el mismo que enseña el buscador del móvil: quien
            // busca en el portátil y sigue en el teléfono no lo comparte —vive
            // en cada navegador— pero dentro del mismo sí.
            recordar(limpia);
            router.push({ pathname: '/buscar', query: { q: limpia } } as never);
            setCerrado(true);
          }
        }}
      >
        <label className="solo-lectores" htmlFor="buscador">
          {t('buscar')}
        </label>
        <input
          id="buscador"
          type="search"
          value={consulta}
          onChange={(e) => {
            setConsulta(e.target.value);
            // Escribir vuelve a abrirlo: lo contrario deja el desplegable
            // cerrado para siempre en cuanto alguien pulsa Escape una vez.
            setCerrado(false);
            setResaltada(-1);
          }}
          onKeyDown={teclas}
          onFocus={() => setCerrado(false)}
          placeholder={tb('placeholder')}
          className="campo h-9 pl-9"
          autoComplete="off"
          /*
           * Patrón de combobox completo, no solo `aria-expanded`.
           *
           * `aria-expanded` y `aria-controls` no están permitidos en un input
           * de búsqueda a secas: sin `role="combobox"` un lector de pantalla
           * los ignora y axe lo marca como infracción crítica. Anunciar que
           * hay sugerencias y no decir de qué tipo es peor que no anunciarlas.
           */
          role="combobox"
          aria-expanded={abierto}
          aria-controls="sugerencias"
          aria-autocomplete="list"
          {...(abierto && resaltada >= 0 && visibles[resaltada]
            ? { 'aria-activedescendant': `sugerencia-${visibles[resaltada].id}` }
            : {})}
        />
        <Icono
          nombre="busqueda"
          tamano={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--texto-tenue)]"
        />
      </form>

      {abierto && visibles.length > 0 && (
        <ul
          id="sugerencias"
          // El combobox dice que controla una lista; tiene que serlo de verdad,
          // con sus opciones, o el lector anuncia una lista vacía.
          role="listbox"
          aria-label={t('buscar')}
          className="card absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden p-1"
        >
          {visibles.map((s, i) => (
            <li key={s.id} id={`sugerencia-${s.id}`} role="option" aria-selected={i === resaltada}>
              <button
                type="button"
                // El foco no sale del campo de texto: lo mueve el combobox con
                // las flechas. Dejar estos botones en el orden de tabulación
                // obligaría a atravesar diez sugerencias para llegar al menú.
                tabIndex={-1}
                onMouseEnter={() => setResaltada(i)}
                onClick={() => irA(s.slug)}
                className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
                  i === resaltada ? 'bg-[var(--fondo-sutil)]' : ''
                }`}
              >
                {s.imagen ? (
                  // 40 px en pantalla: sin pasar por el optimizador, cada
                  // sugerencia se traía la foto de producto entera para
                  // enseñarla del tamaño de una uña.
                  <Image
                    src={s.imagen}
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded object-cover"
                  />
                ) : (
                  <span className="h-10 w-10 rounded bg-[var(--fondo-sutil)]" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{s.name}</span>
                  <span className="block text-xs text-[var(--texto-tenue)]">
                    {fmtPrecio(s.priceCents)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
