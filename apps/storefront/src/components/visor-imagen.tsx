'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icono } from './ui/icono';

interface Imagen {
  id: string;
  url: string;
  alt: Record<string, string> | null;
}

/**
 * Visor de la foto a pantalla completa.
 *
 * Se abre al pulsar la galería. En una tienda de este catálogo la foto es
 * prácticamente toda la información: el cliente quiere ver el material, la
 * textura y el tamaño real, y la ficha enseña la imagen a 358 px en un móvil.
 *
 * El zoom es doble: **pellizcar** funciona solo —el contenedor lo permite y lo
 * gestiona el navegador, que lo hace mejor y más fluido que cualquier
 * implementación a mano— y **pulsar** hace un 2× centrado en el punto tocado,
 * que es lo que espera quien viene de una galería de móvil y no quiere hacer la
 * pinza con una sola mano.
 *
 * Sin biblioteca de carrusel: son cuarenta líneas de CSS de desplazamiento con
 * anclaje. Traer una dependencia para esto añade 30 kB al paquete de la página
 * más visitada de la tienda.
 */
export function VisorImagen({
  imagenes,
  indice,
  nombre,
  locale,
  alCerrar,
  alCambiar,
}: {
  imagenes: Imagen[];
  indice: number;
  nombre: string;
  locale: string;
  alCerrar: () => void;
  alCambiar: (indice: number) => void;
}) {
  const [ampliada, setAmpliada] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  /** Quién tenía el foco antes de abrir, para devolvérselo al salir. */
  const focoPrevio = useRef<HTMLElement | null>(null);

  const imagen = imagenes[indice];

  const mover = useCallback(
    (paso: number) => {
      // Da la vuelta por los dos lados: llegar al final y quedarse bloqueado es
      // lo que hace que la gente cierre el visor para volver a la primera foto.
      const siguiente = (indice + paso + imagenes.length) % imagenes.length;
      alCambiar(siguiente);
      setAmpliada(false);
    },
    [indice, imagenes.length, alCambiar],
  );

  useEffect(() => {
    focoPrevio.current = document.activeElement as HTMLElement | null;
    cerrarRef.current?.focus();

    // El fondo no se desplaza mientras el visor está abierto: en el móvil, sin
    // esto, el gesto de arrastrar la foto movía la página de debajo.
    const desbordeAntes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const alPulsarTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') alCerrar();
      if (e.key === 'ArrowRight') mover(1);
      if (e.key === 'ArrowLeft') mover(-1);
    };

    document.addEventListener('keydown', alPulsarTecla);

    return () => {
      document.removeEventListener('keydown', alPulsarTecla);
      document.body.style.overflow = desbordeAntes;
      focoPrevio.current?.focus();
    };
  }, [alCerrar, mover]);

  /**
   * Amplía centrando en el punto que se ha tocado.
   *
   * Un zoom que amplía siempre por el centro obliga a arrastrar hasta lo que se
   * quería mirar. Tomando el punto del clic, lo que interesaba queda debajo del
   * dedo.
   */
  const alternarZoom = (e: React.MouseEvent<HTMLDivElement>) => {
    const caja = contenedor.current;
    if (!caja) return;

    if (ampliada) {
      setAmpliada(false);
      caja.scrollTo({ left: 0, top: 0 });
      return;
    }

    const rect = caja.getBoundingClientRect();
    const relX = (e.clientX - rect.left + caja.scrollLeft) / caja.scrollWidth;
    const relY = (e.clientY - rect.top + caja.scrollTop) / caja.scrollHeight;

    setAmpliada(true);

    // Después de pintar el tamaño nuevo: antes, `scrollWidth` es todavía el
    // pequeño y el desplazamiento se queda corto.
    requestAnimationFrame(() => {
      caja.scrollTo({
        left: relX * caja.scrollWidth - rect.width / 2,
        top: relY * caja.scrollHeight - rect.height / 2,
      });
    });
  };

  if (!imagen) return null;

  return (
    <div
      className="visor"
      role="dialog"
      aria-modal="true"
      aria-label={`${nombre} · ${String(indice + 1)}/${String(imagenes.length)}`}
    >
      <div className="visor-barra">
        <span className="visor-contador" aria-hidden="true">
          {indice + 1} / {imagenes.length}
        </span>
        <button ref={cerrarRef} type="button" className="visor-boton" onClick={alCerrar}>
          <Icono nombre="cerrar" tamano={22} />
          <span className="sr-only">Cerrar</span>
        </button>
      </div>

      <div
        ref={contenedor}
        className={`visor-lienzo ${ampliada ? 'visor-lienzo-ampliada' : ''}`}
        onClick={alternarZoom}
      >
        {/*
         * `img` a secas y no el componente de Next.
         *
         * Aquí hace falta la imagen al tamaño máximo, sin recortar y sin las
         * variantes por ancho: es justo lo contrario de lo que optimiza la
         * ficha. Y no mide el LCP —solo existe después de pulsar—, que es lo
         * que justifica `next/image` en la galería.
         */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imagen.url}
          alt={imagen.alt?.[locale] ?? nombre}
          className={ampliada ? 'visor-imagen visor-imagen-ampliada' : 'visor-imagen'}
          draggable={false}
        />
      </div>

      {imagenes.length > 1 && (
        <>
          <button
            type="button"
            className="visor-flecha visor-flecha-izq"
            onClick={() => mover(-1)}
            aria-label="Imagen anterior"
          >
            <Icono nombre="flecha-derecha" tamano={22} />
          </button>
          <button
            type="button"
            className="visor-flecha visor-flecha-der"
            onClick={() => mover(1)}
            aria-label="Imagen siguiente"
          >
            <Icono nombre="flecha-derecha" tamano={22} />
          </button>
        </>
      )}

      <p className="visor-pie">{ampliada ? 'Pulsa para reducir' : 'Pulsa para ampliar'}</p>
    </div>
  );
}
