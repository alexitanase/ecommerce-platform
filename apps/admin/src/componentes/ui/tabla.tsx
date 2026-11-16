import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Boton } from './boton';
import { Menu, type OpcionMenu } from './menu';
import { Desplegable } from './overlays';
import { Cargando, ErrorPanel, SinPermiso, SinResultados, Vacio } from '@/componentes/estados';
import { exportarCsv } from '@/lib/exportar';

/**
 * Tabla de datos del panel.
 *
 * Una sola, para todas las pantallas. Antes cada listado traía su propia
 * versión y ninguna estaba completa: la de pedidos ordenaba pero no
 * seleccionaba, la de productos seleccionaba pero perdía la selección al
 * filtrar, y ninguna decía el total de la columna de importes. Quien pasa el
 * día aquí tiene que poder hacer lo mismo en todas.
 *
 * Lo que trae, y por qué:
 *
 *  · **Semántica de verdad**: `thead`/`tbody`/`tfoot`, `caption` que describe la
 *    tabla, `scope` en las cabeceras y `aria-sort` en la columna ordenada. Es lo
 *    que permite a un lector de pantalla decir «columna Importe, ordenada
 *    descendente» en vez de leer una cuadrícula de celdas sin relación.
 *  · **Cabecera pegajosa**: a la fila 40 ya nadie recuerda qué columna era la
 *    tercera.
 *  · **Selección múltiple con casilla indeterminada**, acciones en bloque en una
 *    barra que aparece con la selección, y la selección se limpia al cambiar los
 *    filtros: mantenerla sobre filas que ya no se ven es el camino corto a
 *    aplicar una acción masiva a lo que no era.
 *  · **Totales en `tfoot`**, calculados sobre lo que se está viendo, y dicho:
 *    un total que suma la página pero parece sumarlo todo miente.
 *  · **Fila expandible** para el detalle que no cabe en columnas, con
 *    `aria-expanded` y un `tr` propio, no un `div` flotando.
 *  · **Los cinco estados** del bloque de datos, sin que la pantalla tenga que
 *    acordarse de ninguno.
 */

export interface ColumnaTabla<T> {
  clave: string;
  titulo: string;
  valor: (fila: T) => ReactNode;
  /** Comparador para ordenar en cliente. Sin él, la columna no se ordena. */
  ordenar?: (a: T, b: T) => number;
  /** Alinea a la derecha y usa cifras tabulares. */
  numerica?: boolean;
  /** Contenido de la celda de totales. */
  total?: (filas: T[]) => ReactNode;
  /** Valor plano para el CSV; por defecto se intenta con `valor`. */
  csv?: (fila: T) => unknown;
  ancho?: string;
  /** Oculta por defecto; se enseña desde el selector de columnas. */
  ocultaPorDefecto?: boolean;
}

export interface PropsTabla<T> {
  /** Descripción de la tabla; sale como `<caption>`. */
  descripcion: string;
  columnas: ColumnaTabla<T>[];
  filas: T[];
  idFila: (fila: T) => string;

  cargando?: boolean;
  error?: unknown;
  reintentar?: () => void;
  permiso?: boolean;
  vacio: { titulo: string; descripcion?: string; accion?: ReactNode };

  /** Búsqueda en cliente sobre el texto que devuelva esta función. */
  buscarEn?: (fila: T) => string;
  /** Controles de filtro propios de la pantalla, en la barra de herramientas. */
  filtros?: ReactNode;
  /** Hay filtros activos: cambia «no hay nada» por «nada coincide». */
  hayFiltros?: boolean;
  alLimpiarFiltros?: () => void;

  seleccion?: {
    acciones: (ids: string[]) => ReactNode;
    /** Filas que no se pueden seleccionar (por estado o por permiso). */
    bloqueada?: (fila: T) => boolean;
  };
  accionesFila?: (fila: T) => OpcionMenu[];
  expandible?: (fila: T) => ReactNode;
  /** Pinta la fila de totales. */
  totales?: boolean;
  /** Nombre base del CSV; sin él no se ofrece exportar. */
  nombreExport?: string;
  /** Acciones extra a la derecha de la barra de herramientas. */
  acciones?: ReactNode;
  /** Debajo de la tabla: paginación, «ver más»… */
  pie?: ReactNode;
}

export function Tabla<T>({
  descripcion,
  columnas,
  filas,
  idFila,
  cargando = false,
  error,
  reintentar,
  permiso = true,
  vacio,
  buscarEn,
  filtros,
  hayFiltros = false,
  alLimpiarFiltros,
  seleccion,
  accionesFila,
  expandible,
  totales = false,
  nombreExport,
  acciones,
  pie,
}: PropsTabla<T>) {
  const { t } = useTranslation();

  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState<{ clave: string; asc: boolean } | null>(null);
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const [ocultas, setOcultas] = useState<Set<string>>(
    () => new Set(columnas.filter((c) => c.ocultaPorDefecto).map((c) => c.clave)),
  );
  const [densidad, setDensidad] = useState<'comoda' | 'compacta'>('comoda');
  const casillaTodas = useRef<HTMLInputElement>(null);

  const visibles = columnas.filter((c) => !ocultas.has(c.clave));

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q || !buscarEn) return filas;
    return filas.filter((f) => buscarEn(f).toLowerCase().includes(q));
  }, [filas, busqueda, buscarEn]);

  const ordenadas = useMemo(() => {
    if (!orden) return filtradas;
    const columna = columnas.find((c) => c.clave === orden.clave);
    if (!columna?.ordenar) return filtradas;
    const copia = [...filtradas];
    copia.sort((a, b) => (orden.asc ? columna.ordenar!(a, b) : columna.ordenar!(b, a)));
    return copia;
  }, [filtradas, orden, columnas]);

  const seleccionables = ordenadas.filter((f) => !seleccion?.bloqueada?.(f));
  const idsSeleccionables = seleccionables.map(idFila);
  const todasSeleccionadas =
    idsSeleccionables.length > 0 && idsSeleccionables.every((id) => seleccionadas.has(id));
  const algunaSeleccionada = idsSeleccionables.some((id) => seleccionadas.has(id));

  /*
   * Casilla de cabecera en estado intermedio.
   *
   * «Algunas seleccionadas» no se puede expresar con un atributo: solo existe
   * como propiedad del elemento, así que hay que tocarlo. Se hace en un efecto
   * y no durante el render porque escribir en el DOM mientras React está
   * pintando es exactamente lo que React no garantiza que sobreviva.
   */
  useEffect(() => {
    if (casillaTodas.current) {
      casillaTodas.current.indeterminate = algunaSeleccionada && !todasSeleccionadas;
    }
  }, [algunaSeleccionada, todasSeleccionadas]);

  const alternarTodas = () => {
    setSeleccionadas(todasSeleccionadas ? new Set() : new Set(idsSeleccionables));
  };

  const alternarFila = (id: string) => {
    setSeleccionadas((s) => {
      const copia = new Set(s);
      if (copia.has(id)) copia.delete(id);
      else copia.add(id);
      return copia;
    });
  };

  const alternarExpandida = (id: string) => {
    setExpandidas((s) => {
      const copia = new Set(s);
      if (copia.has(id)) copia.delete(id);
      else copia.add(id);
      return copia;
    });
  };

  const ordenarPor = (columna: ColumnaTabla<T>) => {
    if (!columna.ordenar) return;
    setOrden((o) =>
      o?.clave === columna.clave
        ? { clave: columna.clave, asc: !o.asc }
        : { clave: columna.clave, asc: true },
    );
  };

  const columnasExtra = (seleccion ? 1 : 0) + (expandible ? 1 : 0) + (accionesFila ? 1 : 0);

  /* ── Estados que sustituyen a la tabla entera ── */
  const contenido = () => {
    if (!permiso) return <SinPermiso />;
    if (error) return <ErrorPanel error={error} reintentar={reintentar} />;
    if (cargando) return <Cargando filas={6} />;
    // Vacío de verdad solo si no hay filtros puestos. Con un filtro activo,
    // «Aún no hay pedidos» es falso y desmoraliza sin motivo: lo que pasa es
    // que ninguno coincide.
    if (filas.length === 0 && !hayFiltros && !busqueda) return <Vacio {...vacio} />;
    if (ordenadas.length === 0) {
      return (
        <SinResultados
          {...(alLimpiarFiltros || busqueda
            ? {
                alLimpiar: () => {
                  setBusqueda('');
                  alLimpiarFiltros?.();
                },
              }
            : {})}
        />
      );
    }

    return (
      <>
        <div className="tabla-caja">
          <table
            className={`tabla tabla-pegajosa ${densidad === 'compacta' ? 'tabla-compacta' : ''}`}
          >
            {/* La descripción de la tabla, no un título decorativo: dice qué
                hay dentro y en qué unidades, que es lo que hace falta si no se
                ve la pantalla. */}
            <caption className="solo-lectores">{descripcion}</caption>

            <thead>
              <tr>
                {seleccion && (
                  <th scope="col" className="tabla-estrecha">
                    <input
                      ref={casillaTodas}
                      type="checkbox"
                      checked={todasSeleccionadas}
                      onChange={alternarTodas}
                      aria-label={t('tabla.seleccionar_todas')}
                    />
                  </th>
                )}
                {expandible && <th scope="col" className="tabla-estrecha" />}

                {visibles.map((c) => {
                  const ordenada = orden?.clave === c.clave;
                  return (
                    <th
                      key={c.clave}
                      scope="col"
                      style={c.ancho ? { width: c.ancho } : undefined}
                      className={c.numerica ? 'text-right' : undefined}
                      aria-sort={ordenada ? (orden.asc ? 'ascending' : 'descending') : undefined}
                    >
                      {c.ordenar ? (
                        <button
                          type="button"
                          className="tabla-orden"
                          onClick={() => ordenarPor(c)}
                          // El nombre dice también qué va a pasar al pulsar: sin
                          // esto se anuncia «Importe, botón» y no se sabe si
                          // ordena, filtra o abre algo.
                          aria-label={t('tabla.ordenar_por', { columna: c.titulo })}
                        >
                          {c.titulo}
                          <span aria-hidden="true" className="tabla-flecha">
                            {ordenada ? (orden.asc ? '▲' : '▼') : '↕'}
                          </span>
                        </button>
                      ) : (
                        c.titulo
                      )}
                    </th>
                  );
                })}

                {accionesFila && (
                  <th scope="col" className="tabla-estrecha">
                    <span className="solo-lectores">{t('app.acciones')}</span>
                  </th>
                )}
              </tr>
            </thead>

            <tbody>
              {ordenadas.map((fila) => {
                const id = idFila(fila);
                const abierta = expandidas.has(id);
                const marcada = seleccionadas.has(id);

                return (
                  <Fragment key={id}>
                    <tr className={marcada ? 'fila-marcada' : undefined}>
                      {seleccion && (
                        <td>
                          <input
                            type="checkbox"
                            checked={marcada}
                            disabled={seleccion.bloqueada?.(fila) ?? false}
                            onChange={() => alternarFila(id)}
                            aria-label={t('tabla.seleccionar_fila')}
                          />
                        </td>
                      )}

                      {expandible && (
                        <td>
                          <button
                            type="button"
                            className="tabla-expandir objetivo"
                            aria-expanded={abierta}
                            aria-label={
                              abierta ? t('tabla.contraer_fila') : t('tabla.expandir_fila')
                            }
                            onClick={() => alternarExpandida(id)}
                          >
                            <span aria-hidden="true">{abierta ? '▾' : '▸'}</span>
                          </button>
                        </td>
                      )}

                      {visibles.map((c) => (
                        <td key={c.clave} className={c.numerica ? 'text-right cifra' : undefined}>
                          {c.valor(fila)}
                        </td>
                      ))}

                      {accionesFila && (
                        <td>
                          <AccionesDeFila opciones={accionesFila(fila)} />
                        </td>
                      )}
                    </tr>

                    {expandible && abierta && (
                      <tr className="fila-detalle">
                        <td colSpan={visibles.length + columnasExtra}>{expandible(fila)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>

            {totales && (
              <tfoot>
                <tr>
                  {seleccion && <td />}
                  {expandible && <td />}
                  {visibles.map((c, i) => (
                    <td key={c.clave} className={c.numerica ? 'text-right cifra' : undefined}>
                      {c.total ? c.total(ordenadas) : i === 0 ? t('tabla.total_visible') : null}
                    </td>
                  ))}
                  {accionesFila && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {pie}
      </>
    );
  };

  return (
    <div className="panel tabla-panel" data-imprimir="true">
      {/* ── Barra de herramientas ── */}
      <div className="tabla-barra">
        {buscarEn && (
          <div className="tabla-buscar">
            <label htmlFor="tabla-busqueda" className="solo-lectores">
              {t('app.buscar')}
            </label>
            <input
              id="tabla-busqueda"
              type="search"
              className="campo"
              placeholder={t('app.buscar')}
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                // Al cambiar lo que se ve, la selección deja de tener sentido:
                // mantenerla es cómo se acaba aplicando una acción en bloque a
                // filas que ya no están en pantalla.
                setSeleccionadas(new Set());
              }}
            />
          </div>
        )}

        {filtros}

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {acciones}

          <Desplegable etiqueta={t('tabla.columnas')} tamano="sm" ancho={240}>
            <fieldset>
              <legend className="etiqueta-campo">{t('tabla.columnas_visibles')}</legend>
              {columnas.map((c) => (
                <label key={c.clave} className="opcion-linea">
                  <input
                    type="checkbox"
                    checked={!ocultas.has(c.clave)}
                    onChange={() =>
                      setOcultas((s) => {
                        const copia = new Set(s);
                        if (copia.has(c.clave)) copia.delete(c.clave);
                        else copia.add(c.clave);
                        return copia;
                      })
                    }
                  />
                  {c.titulo}
                </label>
              ))}
            </fieldset>
          </Desplegable>

          <Boton
            tamano="sm"
            variante="secundario"
            aria-pressed={densidad === 'compacta'}
            onClick={() => setDensidad((d) => (d === 'comoda' ? 'compacta' : 'comoda'))}
          >
            {densidad === 'comoda' ? t('tabla.compacta') : t('tabla.comoda')}
          </Boton>

          {nombreExport && (
            <Boton
              tamano="sm"
              variante="secundario"
              disabled={ordenadas.length === 0}
              onClick={() =>
                exportarCsv(
                  nombreExport,
                  ordenadas,
                  visibles.map((c) => ({
                    clave: c.clave,
                    titulo: c.titulo,
                    valor: (fila: T) => (c.csv ? c.csv(fila) : textoPlano(c.valor(fila))),
                  })),
                )
              }
            >
              {t('tabla.exportar')}
            </Boton>
          )}
        </div>
      </div>

      {/* ── Acciones en bloque ── */}
      {seleccion && seleccionadas.size > 0 && (
        <div className="tabla-seleccion" role="region" aria-label={t('tabla.acciones_bloque')}>
          <p className="text-sm">
            <span className="cifra font-medium">{seleccionadas.size}</span>{' '}
            {t('tabla.seleccionadas')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {seleccion.acciones([...seleccionadas])}
            <Boton variante="fantasma" tamano="sm" onClick={() => setSeleccionadas(new Set())}>
              {t('tabla.quitar_seleccion')}
            </Boton>
          </div>
        </div>
      )}

      {contenido()}
    </div>
  );
}

/** Menú de acciones de una fila; el mismo en todas las tablas. */
function AccionesDeFila({ opciones }: { opciones: OpcionMenu[] }) {
  const { t } = useTranslation();
  const [abierto, setAbierto] = useState(false);
  const ancla = useRef<HTMLDivElement>(null);

  if (opciones.length === 0) return null;

  return (
    <div ref={ancla} className="relative flex justify-end">
      <Boton
        variante="fantasma"
        tamano="sm"
        soloIcono
        etiqueta={t('app.acciones')}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        icono={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </svg>
        }
      />
      <Menu
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        ancla={ancla}
        opciones={opciones}
      />
    </div>
  );
}

/**
 * Texto plano de una celda para el CSV.
 *
 * Una celda puede ser una etiqueta de estado o un enlace; lo que va al fichero
 * es su texto. Si no se puede sacar, la columna declara su propio `csv`: es
 * mejor obligar a declararlo que exportar «[object Object]».
 */
function textoPlano(nodo: ReactNode): string {
  if (nodo === null || nodo === undefined || typeof nodo === 'boolean') return '';
  if (typeof nodo === 'string' || typeof nodo === 'number') return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoPlano).join(' ');
  const props = (nodo as { props?: { children?: ReactNode; texto?: string } }).props;
  if (props?.texto) return props.texto;
  if (props?.children !== undefined) return textoPlano(props.children);
  return '';
}
