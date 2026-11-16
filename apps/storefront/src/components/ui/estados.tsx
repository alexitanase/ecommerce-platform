import type { ReactNode } from 'react';
import { Icono, type NombreIcono } from './icono';

/**
 * Estados vacío, de carga y de error.
 *
 * Los tres estaban escritos a mano en diez sitios distintos, cada uno con su
 * relleno y su tono de gris. Además de lo evidente —que no se parecen entre
 * sí— tenían un problema de fondo: la mitad decían solo lo que NO hay ("no
 * tienes pedidos") sin decir qué hacer a continuación. Una pantalla vacía es
 * justo donde alguien decide si sigue en la tienda o se va, y dejarla en un
 * gris con una frase corta es desaprovechar el único momento en que está
 * mirando sin distracciones.
 *
 * Por eso `Vacio` pide una acción: no es opcional por casualidad, es que casi
 * siempre hay una y omitirla es un olvido, no una decisión.
 */
export function Vacio({
  icono = 'imagen',
  titulo,
  descripcion,
  children,
}: {
  icono?: NombreIcono;
  titulo: string;
  descripcion?: ReactNode;
  /** Qué puede hacer quien ha llegado aquí. Un enlace al catálogo, casi siempre. */
  children?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div
        className="mb-4 grid h-12 w-12 place-items-center rounded-full text-[var(--texto-tenue)]"
        style={{ background: 'var(--fondo-sutil)' }}
      >
        <Icono nombre={icono} tamano={24} />
      </div>

      <p className="font-medium">{titulo}</p>
      {descripcion && (
        <p className="mt-1 max-w-sm text-sm text-[var(--texto-suave)]">{descripcion}</p>
      )}
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * Bloque de esqueleto.
 *
 * Se usa con las medidas del contenido que va a sustituir, no con un tamaño
 * genérico: un esqueleto que ocupa otra cosa que lo que llega después hace que
 * la página salte al cargar, y eso se nota más que no poner nada.
 */
export function Esqueleto({ className = '' }: { className?: string }) {
  return <div className={`esqueleto rounded-[--radius-button] ${className}`} aria-hidden="true" />;
}

/**
 * Carga de una pantalla entera.
 *
 * Lleva `aria-busy` y un texto solo para lectores: sin él, quien navega con
 * lector de pantalla se encuentra una página que no anuncia nada y no sabe si
 * está cargando o si ha fallado.
 */
export function Cargando({ etiqueta, filas = 3 }: { etiqueta: string; filas?: number }) {
  return (
    <div aria-busy="true" className="space-y-3">
      <span className="solo-lectores">{etiqueta}</span>
      {Array.from({ length: filas }, (_, i) => (
        <Esqueleto key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

/**
 * Algo ha fallado.
 *
 * Siempre con reintento: un error sin salida obliga a recargar la página a
 * mano, y quien está comprando lo que hace es irse.
 */
export function ErrorCarga({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center" role="alert">
      <div
        className="mb-4 grid h-12 w-12 place-items-center rounded-full"
        style={{
          background: 'color-mix(in srgb, var(--error) 12%, transparent)',
          color: 'var(--error)',
        }}
      >
        <Icono nombre="alerta" tamano={24} />
      </div>

      <p className="font-medium">{titulo}</p>
      {descripcion && (
        <p className="mt-1 max-w-sm text-sm text-[var(--texto-suave)]">{descripcion}</p>
      )}
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}
