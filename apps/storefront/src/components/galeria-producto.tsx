'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Icono } from './ui/icono';
import { useVarianteActiva } from './variante-activa';
import { VisorImagen } from './visor-imagen';

interface Imagen {
  id: string;
  url: string;
  alt: Record<string, string> | null;
  blurhash: string | null;
}

/**
 * Galería de la ficha de producto.
 *
 * Es un carrusel con anclaje de desplazamiento: las fotos van una al lado de
 * otra en una tira que se arrastra con el dedo y se para en seco en cada una.
 * Lo hace el navegador con `scroll-snap`, sin biblioteca ni escuchas de
 * `touchmove`, así que el gesto va a 60 fps incluso en un teléfono viejo y
 * funciona igual con rueda, con teclado y con lector de pantalla.
 *
 * Al pulsar se abre a pantalla completa, donde se puede ampliar. En este
 * catálogo la foto ES el producto: el cliente compra por lo que ve, y en un
 * móvil la ficha la enseña a 358 px.
 *
 * La imagen visible lleva `priority`: es el elemento más grande de la página y
 * por tanto el que mide el LCP, la métrica que más pesa en el posicionamiento.
 */
export function GaleriaProducto({
  imagenes,
  nombre,
  locale,
}: {
  imagenes: Imagen[];
  nombre: string;
  locale: string;
}) {
  /*
   * Una sola fuente de verdad: la foto elegida, compartida con el selector.
   *
   * La galería no guarda su propio índice. Con dos estados —el suyo y el de la
   * variante— hay que decidir cuál gana, y cualquiera de las dos respuestas está
   * mal: si gana la variante, pulsar una miniatura no hace nada mientras haya
   * color elegido; si gana la galería, elegir un color no cambia la foto.
   *
   * Así, elegir variante y pulsar miniatura son la misma acción sobre el mismo
   * dato, y la última gana.
   */
  const { foto: elegida, verFoto, variante } = useVarianteActiva();

  const tira = useRef<HTMLDivElement>(null);
  const [visor, setVisor] = useState(false);
  /** Evita que el desplazamiento programado se lea como uno del usuario. */
  const moviendoSolo = useRef(false);

  // Si la foto no está en la lista se cae a la primera en vez de dejar el hueco
  // en blanco: pasa con las variantes que el proveedor no ilustra.
  const indice = elegida ? imagenes.findIndex((i) => i.url === elegida) : -1;
  const activa = indice >= 0 ? indice : 0;

  /**
   * Lleva la tira hasta la foto elegida cuando la elige otro (el selector).
   *
   * Sin esto, elegir «Azul» cambiaba el precio y el rótulo pero dejaba a la
   * vista la foto del color anterior, que es peor que no cambiar nada: el
   * cliente cree que ha elegido lo que está mirando.
   */
  useEffect(() => {
    const caja = tira.current;
    const destino = caja?.children[activa] as HTMLElement | undefined;
    if (!caja || !destino) return;

    if (Math.abs(caja.scrollLeft - destino.offsetLeft) < 4) return;

    moviendoSolo.current = true;
    caja.scrollTo({ left: destino.offsetLeft, behavior: 'smooth' });

    // El desplazamiento suave no avisa de cuándo termina; medio segundo cubre
    // de sobra el recorrido de una pantalla.
    const id = setTimeout(() => {
      moviendoSolo.current = false;
    }, 500);
    return () => clearTimeout(id);
  }, [activa]);

  /** Al arrastrar, la foto que queda en pantalla pasa a ser la elegida. */
  const alDesplazar = () => {
    const caja = tira.current;
    if (!caja || moviendoSolo.current) return;

    const visible = Math.round(caja.scrollLeft / caja.clientWidth);
    const imagen = imagenes[visible];
    if (imagen && imagen.url !== elegida) verFoto(imagen.url);
  };

  if (imagenes.length === 0) {
    return (
      <div className="galeria-caja card grid aspect-square place-items-center text-[var(--texto-tenue)]">
        <Icono nombre="imagen" tamano={48} />
      </div>
    );
  }

  return (
    <div className="galeria">
      <div className="galeria-caja">
        <div
          ref={tira}
          className="galeria-carril"
          onScroll={alDesplazar}
          // Es una lista de fotos que se recorre: para un lector de pantalla,
          // sin esto, son cinco imágenes sueltas sin relación entre ellas.
          role="group"
          aria-roledescription="carrusel"
          aria-label={`${nombre}: ${String(imagenes.length)} imágenes`}
        >
          {imagenes.map((img, i) => (
            <button
              key={img.id}
              type="button"
              className="galeria-diapositiva"
              onClick={() => setVisor(true)}
              aria-label={`Ampliar imagen ${String(i + 1)} de ${String(imagenes.length)}`}
              // Solo la visible entra en el recorrido del tabulador: si no,
              // tabular desde el nombre del producto obligaba a pasar por las
              // ocho fotos antes de llegar al botón de comprar.
              tabIndex={i === activa ? 0 : -1}
            >
              <Image
                src={img.url}
                // El alt viene traducido del admin; si falta, se usa el nombre
                // del producto en lugar de dejarlo vacío.
                alt={img.alt?.[locale] ?? nombre}
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                priority={i === 0}
                placeholder={img.blurhash ? 'blur' : 'empty'}
                {...(img.blurhash ? { blurDataURL: img.blurhash } : {})}
                className="object-cover"
              />
            </button>
          ))}
        </div>

        {/*
         * El nombre de lo que se está mirando, sobre la propia foto.
         *
         * En un producto de once colores las miniaturas se parecen entre sí y la
         * foto grande no dice cuál es: había que bajar hasta el selector para
         * saber si lo que se veía era «Gris oscuro» o «Caqui oscuro». Puesto
         * aquí, la foto y su nombre se leen juntos.
         */}
        {variante?.nombre && (
          <p className="galeria-rotulo" data-prueba="rotulo-variante">
            {variante.nombre}
          </p>
        )}

        {/* La lupa dice que la foto se puede ampliar. Sin ella, el visor es una
            función que solo descubre quien pulsa por casualidad. */}
        <span className="galeria-lupa" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="7" strokeWidth="2" />
            <path d="M21 21l-4.3-4.3M11 8v6M8 11h6" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
      </div>

      {imagenes.length > 1 && (
        <>
          {/* Puntos en el móvil: ocupan 16 px frente a los 50 de las miniaturas,
              y son esos 34 px los que dejan el precio dentro de la pantalla. */}
          <div className="galeria-puntos" aria-hidden="true">
            {imagenes.map((img, i) => (
              <span
                key={img.id}
                className={i === activa ? 'galeria-punto galeria-punto-activo' : 'galeria-punto'}
              />
            ))}
          </div>

          {/* Y miniaturas de verdad a partir de tableta, donde sí sobra sitio. */}
          <div className="galeria-tiras">
            {imagenes.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={() => verFoto(img.url)}
                aria-label={`Imagen ${String(i + 1)} de ${String(imagenes.length)}`}
                aria-current={i === activa}
                className={[
                  'galeria-tira relative overflow-hidden rounded-lg border-2 transition-colors',
                  i === activa ? 'border-[var(--marca-primario)]' : 'border-transparent',
                ].join(' ')}
              >
                <Image src={img.url} alt="" fill sizes="64px" className="object-cover" />
              </button>
            ))}
          </div>
        </>
      )}

      {visor && (
        <VisorImagen
          imagenes={imagenes}
          indice={activa}
          nombre={nombre}
          locale={locale}
          alCerrar={() => setVisor(false)}
          alCambiar={(i) => {
            const img = imagenes[i];
            if (img) verFoto(img.url);
          }}
        />
      )}
    </div>
  );
}
