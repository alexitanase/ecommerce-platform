import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { precio } from '@/lib/formato';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { Enlace } from '@/componentes/enlace';

interface Proveedor {
  id: string;
  name: string;
  credencialesConfiguradas: boolean;
  /** Si se le puede pedir algo ya; lo decide la API, no esta pantalla. */
  listo: boolean;
  motivoNoListo: string | null;
}

interface Candidato {
  externalId: string;
  titulo: string;
  costeCents: number;
  envioCents: number;
  pvpPropuestoCents: number;
  margenReal: number;
  aviso?: string;
  variantes: number;
  imagenes: number;
  yaImportado: boolean;
}

/**
 * Importador de productos del proveedor.
 *
 * Muestra el PVP calculado ANTES de importar, con el margen que resultaría.
 * Sin ese cálculo previo el operador importa a ciegas y descubre después que
 * la mitad del catálogo no llega al margen mínimo.
 */
/** Resultados por página del catálogo del proveedor. */
const POR_PAGINA = 20;

interface NodoCategoria {
  id: string;
  name: string;
  children: NodoCategoria[];
}

interface Marca {
  id: string;
  name: string;
}

/** El árbol de categorías aplanado: un `<select>` no anida. */
function aplanarCategorias(nodos: NodoCategoria[], depth = 0): { id: string; etiqueta: string }[] {
  return nodos.flatMap((n) => [
    { id: n.id, etiqueta: `${'\u00a0'.repeat(depth * 3)}${depth > 0 ? '└ ' : ''}${n.name}` },
    ...aplanarCategorias(n.children, depth + 1),
  ]);
}

export function Importar() {
  const { t } = useTranslation();
  const [proveedorId, setProveedorId] = useState('');
  const [consulta, setConsulta] = useState('');
  const [buscado, setBuscado] = useState('');
  const [pagina, setPagina] = useState(1);
  const [importados, setImportados] = useState<Set<string>>(new Set());
  const [referencia, setReferencia] = useState('');
  const [buscadoPorId, setBuscadoPorId] = useState('');
  /*
   * Dónde va a parar lo que se importe.
   *
   * Se elige ANTES de importar y vale para toda la sesión de importación: quien
   * está trayendo vibradores importa quince seguidos a la misma categoría, y
   * pedírsela producto a producto —o peor, dejar la ficha sin categoría y que
   * la asigne después— es el trabajo que nadie hace.
   */
  const [categoriaDestino, setCategoriaDestino] = useState('');
  const [marcaDestino, setMarcaDestino] = useState('');

  const proveedores = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => get<Proveedor[]>('/suppliers'),
  });

  const catalogo = useQuery({
    queryKey: ['catalogo-proveedor', proveedorId, buscado, pagina],
    queryFn: () =>
      get<{ items: Candidato[]; total: number; hayMas: boolean }>(
        `/suppliers/${proveedorId}/catalog?q=${encodeURIComponent(buscado)}&pagina=${String(pagina)}&porPagina=${String(POR_PAGINA)}`,
      ),
    enabled: proveedorId !== '',
    /*
     * Se conserva la página anterior mientras carga la siguiente.
     *
     * Sin esto, cada «Siguiente» vacía la tabla y la pantalla pega un salto
     * hasta arriba. Con catálogos de doce mil productos, pasar páginas es lo
     * que más se hace en esta pantalla.
     */
    placeholderData: (anterior) => anterior,
  });

  /**
   * Ficha suelta por identificador o URL.
   *
   * Es la vía principal con AliExpress: su búsqueda por texto exige que la
   * aplicación esté aprobada para producción, mientras que consultar una ficha
   * concreta funciona desde el primer día. Y es como se trabaja de verdad:
   * se encuentra el producto en su web y se copia el enlace.
   */
  const porIdentificador = useQuery({
    queryKey: ['catalogo-proveedor', proveedorId, 'ficha', buscadoPorId],
    queryFn: () =>
      get<Candidato>(`/suppliers/${proveedorId}/catalog/${encodeURIComponent(buscadoPorId)}`),
    enabled: proveedorId !== '' && buscadoPorId !== '',
    retry: false,
  });

  const categorias = useQuery({
    queryKey: ['categorias', 'arbol', 'todas'],
    queryFn: () => get<NodoCategoria[]>('/catalog/categories/tree?incluirInactivas=true'),
    staleTime: 5 * 60_000,
  });

  const marcas = useQuery({
    queryKey: ['marcas'],
    queryFn: () => get<Marca[]>('/brands'),
    staleTime: 5 * 60_000,
  });

  const importar = useMutation({
    mutationFn: (externalId: string) =>
      post(`/suppliers/${proveedorId}/import`, {
        externalId,
        descargarImagenes: true,
        // Solo si se ha elegido algo: sin categoría el producto entra sin
        // clasificar, y sin marca se usa la que declare el proveedor.
        ...(categoriaDestino ? { categoryId: categoriaDestino } : {}),
        ...(marcaDestino ? { brandId: marcaDestino } : {}),
      }),
    onSuccess: (_, externalId) => {
      setImportados((s) => new Set(s).add(externalId));
    },
  });

  const todos = proveedores.data ?? [];
  // Antes se filtraba por "tiene credenciales", y el proveedor simulado —que
  // no necesita ninguna— quedaba fuera del desplegable. Con AliExpress sin
  // autorizar, eso dejaba la pantalla sin ningún proveedor utilizable.
  const activos = todos.filter((p) => p.listo);
  const noListos = todos.filter((p) => !p.listo);

  return (
    <div>
      <Encabezado titulo={t('productos.importar')} />

      {proveedores.isLoading ? (
        <Cargando filas={2} />
      ) : activos.length === 0 ? (
        <div className="panel p-5">
          <p className="font-medium">{t('proveedores.ninguno_listo')}</p>
          {/* El motivo concreto de cada uno: "no hay proveedores disponibles"
              a secas no le dice a nadie qué tiene que arreglar. */}
          <ul className="mt-3 space-y-1 text-sm" style={{ color: 'var(--texto-tenue)' }}>
            {noListos.map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong>: {p.motivoNoListo}
              </li>
            ))}
          </ul>
          <Enlace a="/proveedores" className="btn btn-secundario mt-4 text-sm">
            {t('nav.proveedores')}
          </Enlace>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <select
              value={proveedorId}
              onChange={(e) => {
                setProveedorId(e.target.value);
                // Cambiar de proveedor con la página 7 puesta enseña una tabla
                // vacía y parece que ese proveedor no tiene catálogo.
                setPagina(1);
              }}
              className="campo w-auto"
              aria-label={t('proveedores.titulo')}
            >
              <option value="">{t('proveedores.titulo')}…</option>
              {activos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setBuscado(consulta);
                setPagina(1);
              }}
              className="flex flex-1 gap-2"
            >
              <input
                type="search"
                value={consulta}
                onChange={(e) => setConsulta(e.target.value)}
                placeholder={t('proveedores.buscar_catalogo')}
                className="campo max-w-sm"
                disabled={!proveedorId}
              />
              <button type="submit" className="btn btn-secundario" disabled={!proveedorId}>
                {t('app.buscar')}
              </button>
            </form>
          </div>

          {/*
            Dónde entra lo que se importe.
            Se elige una vez y vale para toda la tanda. Sin esto, los productos
            entraban sin categoría y no había forma de asignársela después.
          */}
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium">
                {t('proveedores.importar_a_categoria')}
              </span>
              <select
                value={categoriaDestino}
                onChange={(e) => setCategoriaDestino(e.target.value)}
                className="campo w-auto"
                data-prueba="categoria-destino"
              >
                <option value="">{t('productos.sin_categoria')}</option>
                {aplanarCategorias(categorias.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.etiqueta}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium">
                {t('proveedores.importar_con_marca')}
              </span>
              <select
                value={marcaDestino}
                onChange={(e) => setMarcaDestino(e.target.value)}
                className="campo w-auto"
                data-prueba="marca-destino"
              >
                {/* Por defecto la del proveedor, que es la que acierta casi
                    siempre: forzarla a mano es la excepción. */}
                <option value="">{t('proveedores.marca_del_proveedor')}</option>
                {(marcas.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Por identificador o URL: la única vía disponible mientras el
              proveedor no habilite la búsqueda por texto. */}
          <section className="panel mb-4 p-4">
            <h2 className="mb-1 text-sm font-semibold">{t('proveedores.por_identificador')}</h2>
            <p className="mb-3 text-xs" style={{ color: 'var(--texto-tenue)' }}>
              {t('proveedores.por_identificador_ayuda')}
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setBuscadoPorId(referencia.trim());
              }}
              className="flex flex-wrap gap-2"
            >
              <input
                type="text"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                // Los tres formatos que alguien tiene delante: el enlace que se
                // copia del navegador, el código que enseña la web del
                // proveedor y el EAN impreso en la caja del producto.
                placeholder="D-196690 · 5060140209928 · https://es.aliexpress.com/item/…"
                className="campo max-w-lg font-mono text-base sm:text-sm"
                disabled={!proveedorId}
                aria-label={t('proveedores.por_identificador')}
              />
              <button
                type="submit"
                className="btn btn-secundario"
                disabled={!proveedorId || !referencia.trim()}
              >
                {t('app.buscar')}
              </button>
            </form>

            {porIdentificador.isFetching && <Cargando filas={1} />}

            {porIdentificador.error && (
              <ErrorPanel
                error={porIdentificador.error}
                reintentar={() => void porIdentificador.refetch()}
              />
            )}

            {porIdentificador.data && (
              <div
                className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                style={{ borderColor: 'var(--borde)' }}
              >
                <div className="min-w-0">
                  <p className="font-medium">{porIdentificador.data.titulo}</p>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {t('productos.coste')} {precio(porIdentificador.data.costeCents)}
                    {porIdentificador.data.envioCents > 0 &&
                      ` + ${precio(porIdentificador.data.envioCents)}`}{' '}
                    · {t('proveedores.pvp_propuesto')}{' '}
                    <strong>{precio(porIdentificador.data.pvpPropuestoCents)}</strong> ·{' '}
                    {porIdentificador.data.margenReal}% · {porIdentificador.data.variantes}{' '}
                    {t('productos.variantes').toLowerCase()}
                  </p>
                  {porIdentificador.data.aviso && (
                    <p className="mt-1 text-xs" style={{ color: 'var(--aviso)' }}>
                      {porIdentificador.data.aviso}
                    </p>
                  )}
                </div>

                {porIdentificador.data.yaImportado ||
                importados.has(porIdentificador.data.externalId) ? (
                  <Etiqueta texto={t('proveedores.importado')} tono="neutro" />
                ) : (
                  <button
                    type="button"
                    className="btn btn-primario text-sm"
                    disabled={importar.isPending}
                    onClick={() => importar.mutate(porIdentificador.data.externalId)}
                  >
                    {t('proveedores.importar')}
                  </button>
                )}
              </div>
            )}
          </section>

          {!proveedorId ? (
            <Vacio titulo={t('proveedores.titulo')} />
          ) : catalogo.isLoading ? (
            <Cargando />
          ) : catalogo.error ? (
            <ErrorPanel error={catalogo.error} reintentar={() => void catalogo.refetch()} />
          ) : (catalogo.data?.items.length ?? 0) === 0 ? (
            <Vacio titulo={t('app.sin_datos')} />
          ) : (
            <div className="panel overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>{t('productos.nombre')}</th>
                    <th className="text-right">{t('productos.coste')}</th>
                    <th className="text-right">{t('proveedores.pvp_propuesto')}</th>
                    <th className="text-right">{t('pedidos.margen')}</th>
                    <th className="text-right">{t('productos.variantes')}</th>
                    <th className="text-right">{t('app.acciones')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(catalogo.data?.items ?? []).map((c) => {
                    const yaEsta = c.yaImportado || importados.has(c.externalId);
                    return (
                      <tr key={c.externalId}>
                        <td>
                          <p className="lineas-1 max-w-[320px] font-medium">{c.titulo}</p>
                          {c.aviso && (
                            <p className="mt-0.5 text-xs" style={{ color: 'var(--aviso)' }}>
                              {c.aviso}
                            </p>
                          )}
                        </td>
                        <td
                          className="text-right tabular-nums"
                          style={{ color: 'var(--texto-tenue)' }}
                        >
                          {precio(c.costeCents)}
                          {c.envioCents > 0 && (
                            <span className="block text-xs">+{precio(c.envioCents)}</span>
                          )}
                        </td>
                        <td className="text-right font-medium tabular-nums">
                          {precio(c.pvpPropuestoCents)}
                        </td>
                        <td
                          className="text-right tabular-nums"
                          style={{
                            color: c.margenReal < 25 ? 'var(--aviso)' : 'var(--exito)',
                          }}
                        >
                          {c.margenReal}%
                        </td>
                        <td className="text-right tabular-nums">{c.variantes}</td>
                        <td className="text-right">
                          {yaEsta ? (
                            <Etiqueta texto={t('proveedores.importado')} tono="neutro" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => importar.mutate(c.externalId)}
                              disabled={importar.isPending}
                              className="btn btn-primario text-xs"
                            >
                              {importar.isPending && importar.variables === c.externalId
                                ? '…'
                                : t('proveedores.importar')}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginación: con doce mil productos, las veinte primeras filas no
              son el catálogo, son la primera pantalla. */}
          {(catalogo.data?.total ?? 0) > POR_PAGINA && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
                {t('app.pagina')} {pagina} · {(catalogo.data?.total ?? 0).toLocaleString('es-ES')}{' '}
                {t('proveedores.resultados')}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-secundario text-sm"
                  disabled={pagina === 1 || catalogo.isFetching}
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                >
                  {t('app.anterior')}
                </button>
                <button
                  type="button"
                  className="btn btn-secundario text-sm"
                  disabled={!catalogo.data?.hayMas || catalogo.isFetching}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  {t('app.siguiente')}
                </button>
              </div>
            </div>
          )}

          {importados.size > 0 && (
            <p
              className="mt-4 rounded-lg px-4 py-2.5 text-sm"
              style={{
                background: 'color-mix(in srgb, var(--info) 10%, transparent)',
                color: 'var(--info)',
              }}
            >
              {importados.size} producto(s) importados como borrador. Revísalos en{' '}
              {t('nav.productos')} antes de publicarlos.
            </p>
          )}
        </>
      )}
    </div>
  );
}
