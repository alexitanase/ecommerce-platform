'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { TarjetaProducto, type ProductoResumen } from './tarjeta-producto';
import { useVistaListado } from '@/lib/vista-listado';
import { useEsCliente } from '@/lib/use-es-cliente';
import { Icono } from './ui/icono';

/**
 * Cuántas páginas se traen solas antes de pasar a paginación normal.
 *
 * Tres, que con 24 por página son 96 productos en pantalla. El tope no es
 * prudencia de más: sin él, quien baja sin mirar acaba con mil tarjetas en el
 * documento —cada una con su foto— y el navegador del teléfono empieza a ir a
 * tirones justo cuando encuentra algo que le gusta. Y al pulsar en un producto
 * y volver atrás, el navegador tiene que reconstruir esas mil para devolverle a
 * su sitio, que es cuando se pierde la posición y la sesión se acaba.
 *
 * A partir del tope se pasa a «página siguiente», que es una dirección nueva:
 * el documento vuelve a tener 24 productos, el enlace se puede compartir y el
 * botón de atrás hace lo que dice.
 */
const MAXIMO_AUTOMATICAS = 3;

interface Respuesta {
  hits: ProductoResumen[];
  total: number;
}

/**
 * Los resultados del catálogo: cuadrícula o lista, con carga progresiva.
 *
 * La primera página llega renderizada desde el servidor —es la que ve Google y
 * la que decide el LCP— y este componente solo añade las siguientes. Por eso
 * recibe `inicial` en lugar de pedirla él: un listado que se pide desde el
 * navegador al montar enseña un hueco vacío durante medio segundo en la
 * pantalla más importante de la tienda.
 */
export function ResultadosListado({
  inicial,
  total,
  pagina,
  porPagina,
  locale,
  parametros,
}: {
  inicial: ProductoResumen[];
  total: number;
  /** La página que ha renderizado el servidor. La carga sigue a partir de ella. */
  pagina: number;
  porPagina: number;
  locale: string;
  /** Filtros y orden actuales, para pedir las páginas siguientes igual. */
  parametros: Record<string, string>;
}) {
  const t = useTranslations('listado');
  const params = useSearchParams();

  const [extra, setExtra] = useState<ProductoResumen[][]>([]);
  const [cargando, setCargando] = useState(false);
  /** Ha fallado la última carga: se deja de insistir y se ofrece reintentar. */
  const [fallo, setFallo] = useState(false);

  const { vista, fijar } = useVistaListado();
  const esCliente = useEsCliente();
  /*
   * Hasta que hidrata se pinta la cuadrícula.
   *
   * La preferencia vive en `localStorage`, que en el servidor no existe.
   * Pintando ya la vista guardada, el HTML del servidor y el primer render del
   * navegador no coincidirían y React descartaría el árbol entero: el listado
   * parpadearía en cada carga de página. Un fotograma de cuadrícula para quien
   * eligió lista es un precio mucho menor.
   */
  const vistaActual = esCliente ? vista : 'cuadricula';

  const productos = [...inicial, ...extra.flat()];
  const totalPaginas = Math.max(Math.ceil(total / porPagina), 1);
  const ultimaCargada = pagina + extra.length;
  const hayMas = ultimaCargada < totalPaginas;
  const quedanAutomaticas = hayMas && extra.length < MAXIMO_AUTOMATICAS;

  const cargarSiguiente = useCallback(() => {
    setCargando(true);
    setFallo(false);

    const base = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
    const consulta = new URLSearchParams({
      ...parametros,
      locale,
      pagina: String(pagina + extra.length + 1),
      porPagina: String(porPagina),
    });

    // `credentials: 'include'`: la API decide si enseña el catálogo +18 por la
    // cookie de verificación de edad, y tienda y API son orígenes distintos.
    // Sin esto, la primera página trae productos que las siguientes no.
    fetch(`${base}/api/v1/search?${consulta.toString()}`, { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<Respuesta>) : Promise.reject(new Error('search'))))
      .then((d) => {
        setExtra((paginas) => [...paginas, d.hits ?? []]);
        setCargando(false);
      })
      .catch(() => {
        // No se reintenta solo: si el buscador está caído, un observador de
        // desplazamiento reintentando en bucle son cien peticiones fallidas
        // por minuto. Se enseña el botón y decide quien está mirando.
        setCargando(false);
        setFallo(true);
      });
  }, [extra.length, locale, pagina, parametros, porPagina]);

  /*
   * El centinela del final de la lista.
   *
   * `rootMargin` de 600 px: la carga empieza antes de llegar al borde, así que
   * cuando el último producto entra en pantalla los siguientes ya están. Con 0
   * se ve el hueco y el salto en cada tramo.
   */
  const centinela = useRef<HTMLElement>(null);

  useEffect(() => {
    const nodo = centinela.current;
    if (!nodo || !quedanAutomaticas || cargando || fallo) return;

    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas[0]?.isIntersecting) cargarSiguiente();
      },
      { rootMargin: '600px' },
    );

    observador.observe(nodo);
    return () => observador.disconnect();
  }, [cargarSiguiente, cargando, fallo, quedanAutomaticas]);

  /** La dirección de otra página, conservando filtros y orden. */
  const enlacePagina = (n: number) => {
    const nuevos = new URLSearchParams(params.toString());
    nuevos.set('pagina', String(n));
    return `?${nuevos.toString()}`;
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        {/* El recuento de lo que se lleva visto. Es lo que responde a «¿me
            queda mucho?», que es la pregunta que hace abandonar un listado
            infinito sin final a la vista. */}
        <p className="text-sm text-[var(--texto-suave)]" aria-live="polite">
          {t('mostrando', { cargados: productos.length, total })}
        </p>

        <div
          className="flex items-center gap-1 rounded-[--radius-button] border border-[var(--borde)] p-0.5"
          role="group"
          aria-label={t('vista')}
        >
          {(['cuadricula', 'lista'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => fijar(v)}
              aria-pressed={vistaActual === v}
              className={[
                'btn btn-icono h-8 w-8',
                vistaActual === v ? 'btn-secundario' : 'btn-fantasma',
              ].join(' ')}
              aria-label={t(v === 'cuadricula' ? 'vista_cuadricula' : 'vista_lista')}
            >
              <Icono nombre={v === 'cuadricula' ? 'cuadricula' : 'lista'} tamano={16} />
            </button>
          ))}
        </div>
      </div>

      {/* Titular de la región de resultados. Va oculto porque el h1 ya dice lo
          mismo en pantalla, pero sin él se salta del h1 al h3 de las tarjetas:
          un lector de pantalla que navega por titulares se encuentra un hueco y
          da por hecho que falta algo. */}
      <h2 className="solo-lectores">{t('resultados_titulo')}</h2>

      <div
        className={
          vistaActual === 'lista'
            ? 'flex flex-col gap-3'
            : 'grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4'
        }
      >
        {productos.map((p, i) => (
          <TarjetaProducto
            key={p.id}
            producto={p}
            locale={locale}
            vista={vistaActual}
            prioridad={i < 4}
          />
        ))}
      </div>

      <nav
        ref={centinela}
        className="mt-8 flex flex-wrap items-center justify-center gap-2"
        aria-label={t('pagina_actual', { pagina: ultimaCargada, total: totalPaginas })}
      >
        {/* «Anterior» va aunque queden cargas automáticas: quien llega a la
            página 4 por un enlace tiene que poder retroceder desde el primer
            momento, y antes solo aparecía al agotar la carga progresiva. */}
        {pagina > 1 && (
          <a href={enlacePagina(pagina - 1)} className="btn btn-secundario">
            {t('pagina_anterior')}
          </a>
        )}

        {quedanAutomaticas || fallo ? (
          /*
           * El botón está siempre, no solo cuando falla algo.
           *
           * El centinela carga al desplazarse, que es un gesto que no existe
           * para quien navega con teclado o con lector de pantalla: sin un
           * control de verdad, para ellos el catálogo se acaba en el producto
           * 24. Cuando la carga automática funciona, el botón se limita a
           * adelantarla.
           */
          <button
            type="button"
            onClick={cargarSiguiente}
            disabled={cargando}
            className="btn btn-secundario"
          >
            {cargando ? t('cargando') : t('cargar_mas')}
          </button>
        ) : (
          hayMas && (
            <a href={enlacePagina(ultimaCargada + 1)} className="btn btn-primario">
              {t('pagina_siguiente')}
            </a>
          )
        )}
      </nav>

      {totalPaginas > 1 && (
        <p className="mt-3 text-center text-sm text-[var(--texto-tenue)]">
          {t('pagina_actual', { pagina: ultimaCargada, total: totalPaginas })}
        </p>
      )}
    </>
  );
}
