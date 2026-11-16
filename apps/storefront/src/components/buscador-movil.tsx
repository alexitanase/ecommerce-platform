'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { useBusquedas } from '@/lib/busquedas';
import { useSugerencias } from '@/lib/use-sugerencias';
import { Icono } from './ui/icono';
import { usePrecio } from './proveedor-divisa';

/** Lo justo para pintar los atajos de categoría; el árbol entero no hace falta. */
export interface AtajoCategoria {
  id: string;
  name: string;
  slug: string;
  imagen: string | null;
}

/**
 * El buscador del móvil, a pantalla completa.
 *
 * Es el patrón de las tiendas grandes y no es un capricho de diseño: en un
 * teléfono, un desplegable de sugerencias colgando de la cabecera se abre
 * encima del catálogo, mide seis líneas, y el teclado del sistema tapa la
 * mitad. La pantalla completa es la única forma de que la lista de resultados
 * y el teclado quepan a la vez, y de que pulsar en un resultado no sea un
 * ejercicio de puntería sobre una fila de 32 px.
 *
 * Lo que se enseña con el campo vacío es lo que decide si esto sirve para algo:
 *
 *  · **Las últimas búsquedas.** Casi nadie encuentra lo que quiere a la
 *    primera; la segunda visita empieza repitiendo la búsqueda de la primera.
 *  · **Las categorías.** Quien entra a mirar sin saber qué quiere no tiene
 *    ninguna palabra que escribir, y un campo vacío no le lleva a ningún sitio.
 *
 * El campo de la cabecera que lo abre es un botón, no un `<input>` escondido:
 * un input que al tocarlo abre otra cosa deja el teclado a medio abrir en
 * Android y roba el foco al de dentro.
 */
export function BuscadorMovil({
  locale,
  categorias,
}: {
  locale: string;
  categorias: AtajoCategoria[];
}) {
  // Los precios se enseñan en la divisa que haya elegido el visitante. El
  // importe sigue siendo el mismo en euros: esto solo convierte para mostrar.
  const fmtPrecio = usePrecio(locale);

  const t = useTranslations('comun');
  const tb = useTranslations('buscador');
  const tl = useTranslations('listado');
  const router = useRouter();

  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState('');
  const campo = useRef<HTMLInputElement>(null);

  const { sugerencias } = useSugerencias(consulta, locale);
  const { recientes, recordar, olvidar, olvidarTodas } = useBusquedas();

  /*
   * El foco entra al abrir y vuelve al botón al cerrar.
   *
   * Sin lo primero hay que dar dos toques para escribir, que es justo el gesto
   * que este buscador existe para ahorrar. Sin lo segundo, quien navega con
   * teclado cierra el panel y el foco se va al principio del documento: hay
   * que recorrer la cabecera entera para volver a donde estaba.
   */
  const boton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (abierto) campo.current?.focus();
    else boton.current?.focus({ preventScroll: true });
  }, [abierto]);

  /*
   * Con el panel abierto, la página de detrás no se desplaza.
   *
   * En el móvil, sin esto, arrastrar sobre la lista de sugerencias mueve el
   * catálogo que hay debajo: al cerrar, la tienda ha viajado sola a mitad de
   * página. Se guarda el valor anterior en vez de escribir `auto` al salir,
   * porque puede haber otra capa —el visor de fotos— que lo tenga bloqueado.
   */
  useEffect(() => {
    if (!abierto) return;

    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [abierto]);

  const cerrar = () => {
    setAbierto(false);
    setConsulta('');
  };

  const buscar = (texto: string) => {
    const limpia = texto.trim();
    if (!limpia) return;

    recordar(limpia);
    router.push({ pathname: '/buscar', query: { q: limpia } } as never);
    cerrar();
  };

  const irAlProducto = (slug: string) => {
    router.push(`/producto/${slug}` as never);
    cerrar();
  };

  return (
    <>
      {/* Parece un campo porque es lo que se busca con la vista, pero es un
          botón: lo que hace es abrir el buscador de verdad. */}
      <button
        ref={boton}
        // Con `id`, y no solo por tenerlo: es lo que mide la prueba de maqueta
        // que vigila que el buscador no se quede sin sitio en ningún ancho.
        // Por debajo de `md` este botón ES el buscador, y sin un asidero
        // estable la prueba medía un campo que ahí ya no existe.
        id="buscador-movil-abrir"
        type="button"
        onClick={() => setAbierto(true)}
        /*
         * `h-9`, exactamente el alto que tenía el campo al que sustituye.
         *
         * Sin fijarlo, el relleno vertical de `.campo` más la letra de 16 px
         * que iOS obliga a usar lo dejaban en 46: diez píxeles más de cabecera
         * pegajosa en todas las páginas de la tienda, en la pantalla que menos
         * sitio tiene. Hay una prueba de maqueta que lo mide y que saltó por
         * dos píxeles. El ancho completo de la fila ya da área de sobra para
         * tocarlo sin fallar.
         */
        className="campo flex h-9 items-center gap-2 py-0 text-left text-[var(--texto-tenue)]"
      >
        <Icono nombre="busqueda" tamano={16} />
        {/* El mismo texto que el campo del escritorio y que el del panel: es
            el mismo control, y llamarlo «Buscar» aquí y «Buscar en la tienda»
            al abrirlo hace dudar de si se ha ido a otro sitio. */}
        <span>{tb('placeholder')}</span>
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('buscar')}
          className="buscador-panel"
          onKeyDown={(e) => {
            if (e.key === 'Escape') cerrar();
          }}
        >
          <form
            role="search"
            className="buscador-panel-barra"
            onSubmit={(e) => {
              e.preventDefault();
              buscar(consulta);
            }}
          >
            <button
              type="button"
              onClick={cerrar}
              className="btn btn-fantasma btn-icono"
              aria-label={t('volver')}
            >
              <Icono nombre="flecha-izquierda" />
            </button>

            <label className="solo-lectores" htmlFor="buscador-movil">
              {t('buscar')}
            </label>
            <input
              ref={campo}
              id="buscador-movil"
              type="search"
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
              placeholder={tb('placeholder')}
              className="campo"
              autoComplete="off"
              // El teclado del móvil trae la tecla «buscar» en vez del intro
              // genérico, que es la que la gente pulsa sin pensar.
              enterKeyHint="search"
            />

            {consulta && (
              <button
                type="button"
                onClick={() => {
                  setConsulta('');
                  campo.current?.focus();
                }}
                className="btn btn-fantasma btn-icono"
                aria-label={tb('limpiar')}
              >
                <Icono nombre="cerrar" />
              </button>
            )}
          </form>

          <div className="buscador-panel-cuerpo">
            {consulta.trim().length >= 2 ? (
              <>
                {sugerencias.length > 0 ? (
                  <ul>
                    {sugerencias.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => irAlProducto(s.slug)}
                          className="buscador-fila"
                        >
                          {s.imagen ? (
                            <Image
                              src={s.imagen}
                              alt=""
                              width={48}
                              height={48}
                              className="h-12 w-12 shrink-0 rounded-lg object-cover"
                            />
                          ) : (
                            <span className="h-12 w-12 shrink-0 rounded-lg bg-[var(--fondo-sutil)]" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="lineas-2 text-sm">{s.name}</span>
                            <span className="mt-0.5 block text-sm font-semibold">
                              {fmtPrecio(s.priceCents)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-6 text-sm text-[var(--texto-suave)]">
                    {tb('sin_sugerencias')}
                  </p>
                )}

                {/* Siempre disponible, haya sugerencias o no: las sugerencias
                    son seis y la búsqueda completa trae todo lo demás. */}
                <button
                  type="button"
                  onClick={() => buscar(consulta)}
                  className="buscador-fila font-medium text-[var(--marca-texto)]"
                >
                  <Icono nombre="busqueda" tamano={20} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {tb('ver_todo', { consulta: consulta.trim() })}
                  </span>
                </button>
              </>
            ) : (
              <>
                {recientes.length > 0 && (
                  <section className="buscador-seccion">
                    <div className="buscador-seccion-titulo">
                      <h2>{tb('recientes')}</h2>
                      <button
                        type="button"
                        onClick={olvidarTodas}
                        className="text-xs font-medium text-[var(--marca-texto)]"
                      >
                        {tb('borrar_historial')}
                      </button>
                    </div>
                    <ul>
                      {recientes.map((r) => (
                        <li key={r} className="flex items-center">
                          <button
                            type="button"
                            onClick={() => buscar(r)}
                            className="buscador-fila min-w-0 flex-1"
                          >
                            <Icono
                              nombre="reloj"
                              tamano={18}
                              className="shrink-0 text-[var(--texto-tenue)]"
                            />
                            <span className="min-w-0 flex-1 truncate text-sm">{r}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => olvidar(r)}
                            className="btn btn-fantasma btn-icono mr-2"
                            aria-label={tb('olvidar', { consulta: r })}
                          >
                            <Icono nombre="cerrar" tamano={16} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {categorias.length > 0 && (
                  <section className="buscador-seccion">
                    <div className="buscador-seccion-titulo">
                      <h2>{tb('explorar')}</h2>
                      {/* Aquí caben seis; el catálogo tiene cientos. Sin esta
                          salida, quien no ve la suya entre las seis se queda
                          sin saber que existen las demás. */}
                      <button
                        type="button"
                        onClick={() => {
                          router.push('/categorias');
                          cerrar();
                        }}
                        className="text-xs font-medium text-[var(--marca-texto)]"
                      >
                        {tl('todas_las_categorias')}
                      </button>
                    </div>
                    <ul className="grid grid-cols-2 gap-3 px-4 pb-4">
                      {categorias.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => {
                              router.push(`/buscar?categoria=${c.slug}` as never);
                              cerrar();
                            }}
                            className="buscador-categoria"
                          >
                            <span className="buscador-categoria-foto">
                              {c.imagen ? (
                                <Image
                                  src={c.imagen}
                                  alt=""
                                  fill
                                  sizes="20vw"
                                  className="object-cover"
                                />
                              ) : (
                                <Icono
                                  nombre="imagen"
                                  tamano={20}
                                  className="text-[var(--texto-tenue)]"
                                />
                              )}
                            </span>
                            <span className="lineas-2 min-w-0 flex-1 text-sm font-medium">
                              {c.name}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
