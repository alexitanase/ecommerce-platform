'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import type { NavegacionCategorias } from '@/lib/categorias';
import { Icono } from './ui/icono';

/** Cuántas categorías caben en la columna sin convertirla en una lista larga. */
const VISIBLES = 10;

/** Las claves que cuentan como «hay filtros puestos». */
const CLAVES_FILTRO = [
  'marca',
  'categoria',
  'categoryId',
  'precioMin',
  'precioMax',
  'soloDisponibles',
] as const;

/**
 * Filtros facetados.
 *
 * El estado vive en la URL, no en React: así el cliente puede compartir un
 * enlace con los filtros puestos, usar el botón atrás del navegador, y el
 * servidor renderiza directamente el resultado filtrado.
 *
 * En el escritorio son una columna al lado del listado. En el móvil se abren
 * en un panel a pantalla completa, y eso sí cambió: antes se desplegaban en
 * línea y empujaban el catálogo fuera de la pantalla, así que al aplicar un
 * filtro había que volver a subir para ver qué había pasado. El panel tapa,
 * hace lo suyo y se quita.
 *
 * Es el MISMO árbol en los dos casos, colocado por CSS. Pintar dos —uno para
 * el panel y otro para la columna— significa dos juegos de controles con los
 * mismos `id` y dos sitios donde arreglar cada cosa.
 */
export function FiltrosListado({
  facetas,
  navegacion,
  ordenPorDefecto = 'relevancia',
  conRecuento = true,
}: {
  facetas: Record<string, Record<string, number>>;
  /**
   * Dónde se está en el árbol de categorías y a dónde se puede ir.
   *
   * La calcula el servidor con el árbol, que ya viene cacheado para la
   * cabecera, y no con las facetas del buscador. El motivo está explicado en
   * `navegarCategorias`: con facetas, elegir una categoría dejaba la lista con
   * esa sola dentro y no había manera de bajar, saltar ni volver.
   */
  navegacion: NavegacionCategorias;
  /**
   * El orden cuando no se ha elegido ninguno.
   *
   * En ofertas es «mayor descuento», y sin esto el desplegable decía
   * «Relevancia» mientras la lista venía ordenada por descuento: la primera
   * señal de que un control miente es que enseñe algo distinto de lo que hace.
   */
  ordenPorDefecto?: string;
  /**
   * Enseñar cuántos productos tiene cada categoría.
   *
   * Se apaga en las páginas que ya llegan filtradas —ofertas— porque el número
   * es el del catálogo entero: diría «Moda 500» junto a una lista de tres
   * rebajas, y un número que no cuadra con lo que se ve en pantalla se lee como
   * un fallo, no como otra cosa.
   */
  conRecuento?: boolean;
}) {
  const t = useTranslations('listado');
  const tc = useTranslations('comun');
  const router = useRouter();
  const params = useSearchParams();
  const [abierto, setAbierto] = useState(false);

  /*
   * Con el panel abierto, el catálogo de detrás no se desplaza.
   *
   * Sin esto, arrastrar sobre la lista de marcas mueve los resultados que hay
   * debajo, y al cerrar el panel la página ha viajado sola.
   */
  useEffect(() => {
    if (!abierto) return;

    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [abierto]);

  const cambiar = (clave: string, valor: string | null) => {
    const nuevos = new URLSearchParams(params.toString());
    if (valor === null || valor === '') nuevos.delete(clave);
    else nuevos.set(clave, valor);
    // Al cambiar un filtro se vuelve a la primera página: mantener la 5 daría
    // "sin resultados" aunque el filtro tenga cientos.
    nuevos.delete('pagina');
    router.push(`?${nuevos.toString()}`);
  };

  const marcas = Object.entries(facetas['brand'] ?? {}).sort((a, b) => b[1] - a[1]);
  // `categoria` entra en la cuenta: sin ella, entrar por el menú a una
  // categoría no ofrecía el botón de quitar filtros y no había forma de volver
  // al catálogo completo sin editar la dirección a mano.
  const puestos = CLAVES_FILTRO.filter((k) => params.get(k)).length;

  return (
    <>
      {/* En el móvil, el botón que abre el panel. Lleva la cuenta de los
          filtros puestos porque, con el panel cerrado, es la única señal de
          que el listado está recortado: sin ella, «no hay casi nada» y «lo he
          filtrado yo» se ven exactamente igual. */}
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="btn btn-secundario lg:hidden"
        aria-expanded={abierto}
      >
        <Icono nombre="ajustes" tamano={16} />
        {t('filtros_activos', { total: puestos })}
      </button>

      <aside
        className="filtros-capa"
        data-abierto={abierto}
        aria-label={t('filtros')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setAbierto(false);
        }}
      >
        <div className="filtros-cabecera">
          <h2 className="text-base font-semibold">{t('filtros')}</h2>
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="btn btn-fantasma btn-icono"
            aria-label={t('cerrar_filtros')}
          >
            <Icono nombre="cerrar" />
          </button>
        </div>

        <div className="filtros-cuerpo">
          {/* `filtros-contenido` y no `lg:card`: `card` es una clase de
              componente escrita a mano, no una utilidad de Tailwind, así que
              no admite prefijo de tamaño. Ese `lg:` no daría error en ningún
              sitio; simplemente no pintaría nada. */}
          <div className="filtros-contenido space-y-6">
            <div>
              {/* `htmlFor` + `id`: sin ellos la etiqueta es texto decorativo y el
                  desplegable se anuncia como "combobox" sin decir de qué. */}
              <label htmlFor="orden-listado" className="mb-2 block text-sm font-medium">
                {t('ordenar')}
              </label>
              <select
                id="orden-listado"
                value={params.get('orden') ?? ordenPorDefecto}
                onChange={(e) => cambiar('orden', e.target.value)}
                className="campo"
              >
                <option value="relevancia">{t('orden_relevancia')}</option>
                <option value="precio_asc">{t('orden_precio_asc')}</option>
                <option value="precio_desc">{t('orden_precio_desc')}</option>
                <option value="novedad">{t('orden_novedad')}</option>
                <option value="valoracion">{t('orden_valoracion')}</option>
                <option value="descuento">{t('orden_descuento')}</option>
              </select>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">{t('precio')}</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  placeholder="0"
                  defaultValue={
                    params.get('precioMin') ? Number(params.get('precioMin')) / 100 : ''
                  }
                  onBlur={(e) =>
                    cambiar(
                      'precioMin',
                      e.target.value ? String(Number(e.target.value) * 100) : null,
                    )
                  }
                  className="campo"
                  aria-label={`${t('precio')} mínimo`}
                />
                <span className="text-[var(--texto-tenue)]">–</span>
                <input
                  type="number"
                  min={0}
                  placeholder="∞"
                  defaultValue={
                    params.get('precioMax') ? Number(params.get('precioMax')) / 100 : ''
                  }
                  onBlur={(e) =>
                    cambiar(
                      'precioMax',
                      e.target.value ? String(Number(e.target.value) * 100) : null,
                    )
                  }
                  className="campo"
                  aria-label={`${t('precio')} máximo`}
                />
              </div>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t('categorias')}</legend>

              {/*
                Migas: dónde se está y cómo subir.

                Es lo que faltaba. Al elegir una categoría, la lista se quedaba
                con esa sola dentro —eran las categorías de los RESULTADOS, y
                los resultados ya eran solo de ella— así que no había manera de
                bajar a una subcategoría, saltar a otra ni volver atrás salvo
                «Limpiar filtros», que además se llevaba el precio y la marca.
              */}
              {navegacion.actual && (
                <nav aria-label={t('categorias')} className="mb-2">
                  <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs">
                    <li>
                      <button
                        type="button"
                        onClick={() => cambiar('categoria', null)}
                        className="text-[var(--marca-texto)] hover:underline"
                      >
                        {t('todas')}
                      </button>
                    </li>
                    {navegacion.ruta.map((c, i) => {
                      const ultima = i === navegacion.ruta.length - 1;

                      return (
                        <li key={c.id} className="flex items-center gap-1">
                          <span aria-hidden="true" className="text-[var(--texto-tenue)]">
                            ›
                          </span>
                          {ultima ? (
                            <span aria-current="page" className="font-medium">
                              {c.name}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => cambiar('categoria', c.slug)}
                              className="text-[var(--marca-texto)] hover:underline"
                            >
                              {c.name}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </nav>
              )}

              {/* Al llegar a la última rama se ofrecen las hermanas: ahí lo
                  siguiente que se quiere mirar es la de al lado, y se dice, para
                  que la lista no parezca la de subcategorías de antes. */}
              {navegacion.sonHermanas && navegacion.opciones.length > 0 && (
                <p className="mb-1 text-xs text-[var(--texto-tenue)]">{t('tambien_en')}</p>
              )}

              {/*
                Con foto, no solo con nombre.

                Los nombres del proveedor no dicen gran cosa —«Parejas», «Para
                ellos»— y una lista de doce se lee como un formulario. La
                miniatura es un producto de verdad de esa rama: convierte la
                lista en algo que se mira, que es lo que hace que alguien entre
                en una categoría que no venía buscando.
              */}
              <ul className="space-y-1">
                {navegacion.opciones.slice(0, VISIBLES).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => cambiar('categoria', c.slug)}
                      className="filtro-categoria"
                    >
                      <span className="filtro-categoria-foto">
                        {c.imagen ? (
                          <Image src={c.imagen} alt="" fill sizes="32px" className="object-cover" />
                        ) : (
                          <Icono
                            nombre="imagen"
                            tamano={14}
                            className="text-[var(--texto-tenue)]"
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {conRecuento && (
                        <span className="shrink-0 text-xs text-[var(--texto-tenue)]">
                          {c.productosRama}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>

              {/* Aquí solo caben unas cuantas. Quien no encuentre la suya
                  necesita un sitio al que ir, y ese sitio es el árbol entero. */}
              <Link
                href="/categorias"
                className="mt-2 inline-block text-sm font-medium text-[var(--marca-texto)]"
              >
                {t('todas_las_categorias')}
              </Link>
            </fieldset>

            {marcas.length > 0 && (
              <fieldset>
                <legend className="mb-2 text-sm font-medium">{t('marca')}</legend>
                <ul className="space-y-1">
                  {marcas.slice(0, 10).map(([nombre, total]) => (
                    <li key={nombre}>
                      <label className="flex cursor-pointer items-center justify-between rounded px-1 py-1 text-sm hover:bg-[var(--fondo-sutil)]">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={params.get('marca') === nombre}
                            onChange={(e) => cambiar('marca', e.target.checked ? nombre : null)}
                          />
                          <span className="text-[var(--texto-suave)]">{nombre}</span>
                        </span>
                        <span className="text-xs text-[var(--texto-tenue)]">{total}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={params.get('soloDisponibles') === 'true'}
                onChange={(e) => cambiar('soloDisponibles', e.target.checked ? 'true' : null)}
              />
              <span className="text-[var(--texto-suave)]">{t('solo_disponibles')}</span>
            </label>

            {puestos > 0 && (
              <button
                type="button"
                onClick={() => {
                  const limpios = new URLSearchParams();
                  const q = params.get('q');
                  if (q) limpios.set('q', q);
                  router.push(`?${limpios.toString()}`);
                }}
                className="btn btn-secundario w-full"
              >
                {t('limpiar_filtros')}
              </button>
            )}
          </div>
        </div>

        {/*
         * El pie del panel, solo en el móvil.
         *
         * Los filtros se aplican al tocarlos —la URL cambia y el listado se
         * vuelve a pedir— así que este botón no «aplica» nada: cierra. Pero
         * tiene que estar, y con ese texto. Con el panel tapando la pantalla,
         * quien acaba de marcar tres filtros no ve ningún resultado y no sabe
         * que ya están puestos; sin un botón que diga «ver resultados», la
         * salida es la flecha de atrás del teléfono, que deshace la búsqueda.
         */}
        <div className="filtros-pie">
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="btn btn-primario btn-grande w-full"
          >
            {t('ver_resultados')}
          </button>
        </div>
      </aside>

      {/* El fondo oscuro. Cerrar tocando fuera es el gesto que todo el mundo
          prueba antes de buscar la equis. */}
      {abierto && (
        <button
          type="button"
          className="filtros-fondo lg:hidden"
          aria-label={tc('cerrar')}
          onClick={() => setAbierto(false)}
        />
      )}
    </>
  );
}
