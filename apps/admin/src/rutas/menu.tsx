import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LOCALES,
  MAXIMO_ENLACES,
  TIPOS_ENLACE,
  type EnlaceMenu,
  type Locale,
  type TipoEnlace,
} from '@ecom/shared';
import { get, post } from '@/lib/api';
import { Cargando, ErrorPanel } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Editor del menú de la tienda.
 *
 * La franja de enlaces que va bajo la cabecera. Antes no existía: la cabecera de
 * la tienda no tenía ni un enlace de navegación, así que al catálogo solo se
 * llegaba escribiendo en el buscador.
 *
 * Tres decisiones de la pantalla:
 *
 *  · **Las páginas y las categorías se eligen de una lista, no se escriben.**
 *    Lo que se guarda es su identificador, y así el enlace sigue funcionando al
 *    cambiar un título —y lleva a la dirección del idioma de cada visitante—.
 *    Escribiendo la dirección a mano, editar una página rompe el menú en
 *    silencio.
 *
 *  · **La etiqueta puede quedarse vacía** en páginas y categorías: entonces se
 *    usa su nombre real. Es lo que se quiere casi siempre y evita tener que
 *    traducir tres veces algo que ya está traducido.
 *
 *  · **Lo que se oculta no se borra.** Una campaña que vuelve se apaga y se
 *    enciende.
 */

interface Pagina {
  id: string;
  handle: string;
  status: string;
  titulos: Record<string, string>;
}

interface Categoria {
  id: string;
  name: string;
  /** Productos a la venta en toda su rama. Cero significa que no se enseñará. */
  productosRama: number;
  children?: Categoria[];
}

/** Una categoría lista para el desplegable. */
interface Opcion {
  id: string;
  name: string;
  productos: number;
}

/**
 * Categorías del árbol en una sola lista, con sangría y con lo que tienen dentro.
 *
 * El número no es decoración: la tienda **no enseña** una categoría sin
 * productos publicados en su rama, porque un enlace del menú que lleva a un
 * listado vacío se pulsa una vez y ya no se vuelve a pulsar. Pero eso ocurría
 * en silencio: aquí se elegía «Vibradores» —una de las categorías del catálogo
 * inicial, que se quedaron sin nada al importar el del proveedor bajo otras
 * ramas—, se guardaba, y el enlace no aparecía nunca sin que nada lo dijera.
 */
function aplanar(arbol: Categoria[], nivel = 0): Opcion[] {
  return arbol.flatMap((c) => [
    { id: c.id, name: `${'— '.repeat(nivel)}${c.name}`, productos: c.productosRama },
    ...aplanar(c.children ?? [], nivel + 1),
  ]);
}

/**
 * Identificador libre para un enlace nuevo.
 *
 * Numerado por tipo: el id acaba en el JSON guardado y «categoria-2» se entiende
 * al leerlo, mientras que un aleatorio no dice nada.
 */
function idLibre(tipo: TipoEnlace, usados: string[]): string {
  for (let n = 1; ; n++) {
    const id = `${tipo}-${String(n)}`;
    if (!usados.includes(id)) return id;
  }
}

function enlaceNuevo(tipo: TipoEnlace, id: string): EnlaceMenu {
  return {
    id,
    visible: true,
    tipo,
    // Vacío a propósito: obliga a elegir a qué apunta antes de poder guardar, en
    // lugar de crear un enlace que va al primer sitio de la lista por accidente.
    destino: tipo === 'url' ? '/' : '',
    etiqueta: {},
    destacado: false,
  };
}

export function MenuTienda() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();

  /** Cambios sin guardar. `null` mientras no se ha tocado nada. */
  const [enlaces, setEnlaces] = useState<EnlaceMenu[] | null>(null);
  const [idioma, setIdioma] = useState<Locale>('es');
  const [guardado, setGuardado] = useState(false);

  const consulta = useQuery({
    queryKey: ['menu'],
    queryFn: () => get<EnlaceMenu[]>('/content/admin/menu'),
  });

  const paginas = useQuery({
    queryKey: ['paginas', 'menu'],
    queryFn: () => get<Pagina[]>('/content/admin/pages'),
  });

  const categorias = useQuery({
    queryKey: ['categorias', 'plano', i18n.language],
    queryFn: () => get<Categoria[]>(`/catalog/categories/tree?locale=${i18n.language}`),
  });

  const guardar = useMutation({
    mutationFn: (lista: EnlaceMenu[]) => post('/content/admin/menu', { enlaces: lista }),
    onSuccess: () => {
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
      void qc.invalidateQueries({ queryKey: ['menu'] });
    },
  });

  if (consulta.isLoading) return <Cargando />;
  if (consulta.error)
    return <ErrorPanel error={consulta.error} reintentar={() => void consulta.refetch()} />;

  // Lo que respondió el servidor hasta que se toca algo; a partir de ahí, lo
  // editado. Sin copiarlo a estado en un efecto: eso pisa los cambios a medio
  // hacer cada vez que la consulta se refresca sola.
  const lista = enlaces ?? consulta.data ?? [];

  const actualizar = (indice: number, cambios: Partial<EnlaceMenu>) => {
    setEnlaces(lista.map((e, i) => (i === indice ? { ...e, ...cambios } : e)));
  };

  const mover = (indice: number, salto: number) => {
    const destino = indice + salto;
    if (destino < 0 || destino >= lista.length) return;

    const copia = [...lista];
    const [enlace] = copia.splice(indice, 1);
    if (enlace) copia.splice(destino, 0, enlace);
    setEnlaces(copia);
  };

  const anadir = (tipo: TipoEnlace) => {
    setEnlaces([
      ...lista,
      enlaceNuevo(
        tipo,
        idLibre(
          tipo,
          lista.map((e) => e.id),
        ),
      ),
    ]);
  };

  const planas = aplanar(categorias.data ?? []);
  /* Solo las publicadas: enlazar una página en borrador da un enlace que no
     lleva a ninguna parte, y la API lo descartaría al servir el menú. */
  const publicadas = (paginas.data ?? []).filter((p) => p.status === 'PUBLISHED');

  /** Enlaces a los que les falta el destino: la API los rechazaría. */
  const sinDestino = lista.filter((e) => e.destino.trim() === '').length;

  /**
   * ¿La categoría elegida se quedará fuera del menú de la tienda?
   *
   * Se decide con el mismo criterio que aplica la tienda —la rama entera, no
   * los productos propios— porque los productos cuelgan de la hoja más
   * concreta: una sección con miles por debajo tiene cero suyos.
   */
  const vacia = (categoryId: string): boolean => {
    if (!categoryId.trim() || planas.length === 0) return false;
    const elegida = planas.find((c) => c.id === categoryId);
    return elegida !== undefined && elegida.productos === 0;
  };

  return (
    <div>
      <Encabezado
        titulo={t('menu.titulo')}
        descripcion={t('menu.descripcion')}
        acciones={
          /* Un solo selector de idioma para toda la pantalla: con uno por campo,
             traducir cinco enlaces son quince clics. */
          <div className="flex gap-1" role="group" aria-label={t('nav.idioma')}>
            {LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                className={`btn text-sm ${idioma === l ? 'btn-primario' : 'btn-fantasma'}`}
                onClick={() => setIdioma(l)}
                aria-pressed={idioma === l}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        }
      />

      {lista.length === 0 && (
        <p className="panel p-4 text-sm" style={{ color: 'var(--texto-suave)' }}>
          {t('menu.vacio')}
        </p>
      )}

      <div className="space-y-3">
        {lista.map((enlace, i) => (
          <section
            key={enlace.id}
            className="panel p-4"
            style={{ opacity: enlace.visible ? 1 : 0.6 }}
          >
            <header className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="font-medium">{t(`menu.tipo_${enlace.tipo}`)}</h2>
              <code className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                {enlace.id}
              </code>

              <div className="ml-auto flex items-center gap-1">
                <label className="mr-2 flex cursor-pointer items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={enlace.visible}
                    onChange={(e) => actualizar(i, { visible: e.target.checked })}
                  />
                  {t('menu.visible')}
                </label>
                <label className="mr-2 flex cursor-pointer items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={enlace.destacado}
                    onChange={(e) => actualizar(i, { destacado: e.target.checked })}
                  />
                  {t('menu.destacado')}
                </label>
                <button
                  type="button"
                  className="btn btn-fantasma px-2 py-1 text-xs"
                  disabled={i === 0}
                  aria-label={t('menu.subir')}
                  onClick={() => mover(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-fantasma px-2 py-1 text-xs"
                  disabled={i === lista.length - 1}
                  aria-label={t('menu.bajar')}
                  onClick={() => mover(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-fantasma px-2 py-1 text-xs"
                  style={{ color: 'var(--error)' }}
                  onClick={() => setEnlaces(lista.filter((_, j) => j !== i))}
                >
                  {t('app.eliminar')}
                </button>
              </div>
            </header>

            <div className="campos-formulario">
              {enlace.tipo === 'pagina' && (
                <Campo
                  id={`${enlace.id}-destino`}
                  etiqueta={t('menu.campo_pagina')}
                  ayuda={t('menu.campo_pagina_ayuda')}
                >
                  {(props) => (
                    <select
                      {...props}
                      className="campo"
                      value={enlace.destino}
                      onChange={(e) => actualizar(i, { destino: e.target.value })}
                    >
                      <option value="">{t('menu.elige')}</option>
                      {publicadas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.titulos[idioma] ?? p.titulos['es'] ?? p.handle}
                        </option>
                      ))}
                    </select>
                  )}
                </Campo>
              )}

              {enlace.tipo === 'categoria' && (
                <Campo
                  id={`${enlace.id}-destino`}
                  etiqueta={t('menu.campo_categoria')}
                  ayuda={t('menu.campo_categoria_ayuda')}
                  /*
                   * El aviso va donde se elige, no en un resumen al guardar.
                   *
                   * La tienda descarta las categorías sin producto publicado en
                   * su rama —un enlace a un listado vacío se pulsa una vez— y lo
                   * hacía sin decirlo: se elegía una de las categorías del
                   * catálogo inicial, que se quedaron vacías al importar el del
                   * proveedor bajo otras ramas, y el enlace no salía nunca.
                   */
                  {...(vacia(enlace.destino) ? { error: t('menu.categoria_vacia') } : {})}
                >
                  {(props) => (
                    <select
                      {...props}
                      className="campo"
                      value={enlace.destino}
                      onChange={(e) => actualizar(i, { destino: e.target.value })}
                    >
                      <option value="">{t('menu.elige')}</option>
                      {planas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.productos > 0
                            ? `${c.name} (${String(c.productos)})`
                            : `${c.name} — ${t('menu.sin_productos')}`}
                        </option>
                      ))}
                    </select>
                  )}
                </Campo>
              )}

              {enlace.tipo === 'url' && (
                <Campo
                  id={`${enlace.id}-destino`}
                  etiqueta={t('menu.campo_url')}
                  ayuda={t('menu.campo_url_ayuda')}
                >
                  {(props) => (
                    <input
                      {...props}
                      type="text"
                      className="campo"
                      value={enlace.destino}
                      onChange={(e) => actualizar(i, { destino: e.target.value })}
                      placeholder="/buscar?categoria=juguetes"
                    />
                  )}
                </Campo>
              )}

              <Campo
                id={`${enlace.id}-etiqueta`}
                etiqueta={`${t('menu.campo_etiqueta')} · ${idioma.toUpperCase()}`}
                ayuda={
                  enlace.tipo === 'url'
                    ? t('menu.campo_etiqueta_obligatoria')
                    : t('menu.campo_etiqueta_ayuda')
                }
              >
                {(props) => (
                  <input
                    {...props}
                    type="text"
                    className="campo"
                    value={enlace.etiqueta?.[idioma] ?? ''}
                    onChange={(e) =>
                      actualizar(i, { etiqueta: { ...enlace.etiqueta, [idioma]: e.target.value } })
                    }
                  />
                )}
              </Campo>
            </div>
          </section>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {TIPOS_ENLACE.map((tipo) => (
          <button
            key={tipo}
            type="button"
            className="btn btn-secundario text-sm"
            disabled={lista.length >= MAXIMO_ENLACES}
            onClick={() => anadir(tipo)}
          >
            + {t(`menu.tipo_${tipo}`)}
          </button>
        ))}
        {lista.length >= MAXIMO_ENLACES && (
          <span className="self-center text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('menu.maximo', { n: MAXIMO_ENLACES })}
          </span>
        )}
      </div>

      <div
        className="sticky bottom-4 mt-5 flex flex-wrap items-center gap-3 rounded-xl p-3"
        style={{
          background: 'var(--fondo-panel)',
          border: '1px solid var(--borde-fuerte)',
          boxShadow: 'var(--sombra)',
        }}
      >
        <span
          className="text-sm"
          style={{ color: guardado ? 'var(--exito)' : 'var(--texto-suave)' }}
        >
          {guardado ? t('app.guardado') : t('menu.enlaces', { n: lista.length })}
        </span>

        {/* Se avisa antes de intentar guardar: la API lo rechazaría con un
            mensaje de validación, y es mejor decirlo aquí que hacer el viaje. */}
        {sinDestino > 0 && (
          <span className="text-sm" style={{ color: 'var(--aviso)' }}>
            {t('menu.sin_destino', { n: sinDestino })}
          </span>
        )}

        {guardar.error && (
          <span className="text-sm" style={{ color: 'var(--error)' }}>
            {guardar.error.message}
          </span>
        )}

        <button
          type="button"
          onClick={() => guardar.mutate(lista)}
          disabled={guardar.isPending || sinDestino > 0}
          className="btn btn-primario ml-auto"
        >
          {t('app.guardar')}
        </button>
      </div>
    </div>
  );
}

/**
 * Un campo con su etiqueta y su ayuda.
 *
 * La ayuda va FUERA de la etiqueta y enlazada con `aria-describedby`. Metiéndola
 * dentro —que es lo cómodo— pasa a formar parte del nombre accesible del campo:
 * un lector de pantalla anunciaría «Dirección Una ruta de la tienda («/buscar») o
 * una dirección completa» cada vez que el foco entrara ahí. Además incumple el
 * criterio 2.5.3 de WCAG, que exige que el nombre empiece por lo que se ve
 * escrito, y rompe el control por voz: «pulsa Dirección» deja de encontrarlo.
 *
 * Lo destapó una prueba de extremo a extremo que no conseguía escribir en el
 * campo buscándolo por su etiqueta.
 */
function Campo({
  id,
  etiqueta,
  ayuda,
  children,
}: {
  id: string;
  etiqueta: string;
  ayuda?: string;
  children: (props: { id: string; 'aria-describedby'?: string }) => React.ReactNode;
}) {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {etiqueta}
      </label>
      {children({ id, ...(idAyuda ? { 'aria-describedby': idAyuda } : {}) })}
      {ayuda && (
        <span id={idAyuda} className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {ayuda}
        </span>
      )}
    </div>
  );
}
