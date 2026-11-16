import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Árbol de categorías.
 *
 * Es la estructura por la que el cliente navega la tienda, y la que define qué
 * secciones son +18. Dos cosas que la pantalla tiene que dejar claras porque
 * no se pueden deshacer fácil:
 *
 *  · **Marcar una categoría como +18 la hereda toda su rama.** No es un
 *    atributo suelto: cuelga hijas nuevas de ahí y también quedan restringidas.
 *  · **Cuántos productos cuelga cada una.** Desactivar una categoría con
 *    productos los saca de la navegación sin que nada más avise.
 */

interface Categoria {
  id: string;
  handle: string;
  name: string;
  slug: string;
  depth: number;
  position: number;
  isActive: boolean;
  isAdult: boolean;
  productos: number;
  children: Categoria[];
}

const LOCALES = ['es', 'ca', 'en'] as const;

export function Categorias() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [creandoEn, setCreandoEn] = useState<string | null | undefined>(undefined);

  const arbol = useQuery({
    queryKey: ['categorias', i18n.language],
    // incluirInactivas: en el admin hay que ver también las apagadas, o no
    // habría forma de volver a encenderlas.
    queryFn: () =>
      get<Categoria[]>(`/catalog/categories/tree?locale=${i18n.language}&incluirInactivas=true`),
  });

  const refrescar = () => void qc.invalidateQueries({ queryKey: ['categorias'] });

  if (arbol.isLoading) return <Cargando />;
  if (arbol.error)
    return <ErrorPanel error={arbol.error} reintentar={() => void arbol.refetch()} />;

  const raices = arbol.data ?? [];

  return (
    <div>
      <Encabezado
        titulo={t('categorias.titulo')}
        descripcion={t('categorias.descripcion')}
        acciones={
          <button
            type="button"
            className="btn btn-primario text-sm"
            onClick={() => setCreandoEn(creandoEn === null ? undefined : null)}
          >
            + {t('categorias.nueva_raiz')}
          </button>
        }
      />

      {creandoEn === null && (
        <FormularioCategoria
          padreId={null}
          onHecho={() => {
            setCreandoEn(undefined);
            refrescar();
          }}
          onCancelar={() => setCreandoEn(undefined)}
        />
      )}

      <SeccionAtributos />

      <h2 className="mb-2 mt-8 text-sm font-semibold">{t('categorias.arbol')}</h2>
      {raices.length === 0 ? (
        <Vacio
          titulo={t('categorias.sin_categorias')}
          descripcion={t('categorias.sin_categorias_ayuda')}
        />
      ) : (
        <ul className="space-y-1">
          {raices.map((c) => (
            <Rama
              key={c.id}
              categoria={c}
              creandoEn={creandoEn}
              setCreandoEn={setCreandoEn}
              onCambio={refrescar}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Rama({
  categoria,
  creandoEn,
  setCreandoEn,
  onCambio,
}: {
  categoria: Categoria;
  creandoEn: string | null | undefined;
  setCreandoEn: (v: string | null | undefined) => void;
  onCambio: () => void;
}) {
  const { t } = useTranslation();
  const [confirmando, setConfirmando] = useState(false);

  const actualizar = useMutation({
    mutationFn: (datos: { isActive?: boolean; isAdult?: boolean }) =>
      patch(`/catalog/categories/${categoria.id}`, datos),
    onSuccess: onCambio,
  });

  const eliminar = useMutation({
    mutationFn: () => del(`/catalog/categories/${categoria.id}`),
    onSuccess: onCambio,
  });

  return (
    <li>
      <div
        className="panel flex flex-wrap items-center gap-3 p-3"
        style={{ marginLeft: `${categoria.depth * 20}px` }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{categoria.name}</span>
            {!categoria.isActive && <Etiqueta tono="neutro" texto={t('categorias.oculta')} />}
            {/* Se hereda a toda la rama: verlo aquí evita marcar una raíz sin
                darse cuenta de que restringe todo lo que cuelga. */}
            {categoria.isAdult && <Etiqueta tono="aviso" texto="+18" />}
          </div>
          <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
            /{categoria.slug} · {t('categorias.n_productos', { n: categoria.productos })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-fantasma text-sm"
            onClick={() => setCreandoEn(creandoEn === categoria.id ? undefined : categoria.id)}
          >
            + {t('categorias.subcategoria')}
          </button>

          <button
            type="button"
            className="btn btn-fantasma text-sm"
            onClick={() => actualizar.mutate({ isActive: !categoria.isActive })}
          >
            {categoria.isActive ? t('categorias.ocultar') : t('categorias.mostrar')}
          </button>

          <button
            type="button"
            className="btn btn-fantasma text-sm"
            onClick={() => actualizar.mutate({ isAdult: !categoria.isAdult })}
          >
            {categoria.isAdult ? t('categorias.quitar_18') : t('categorias.marcar_18')}
          </button>

          <button
            type="button"
            className="btn btn-fantasma text-sm"
            style={{ color: 'var(--error)' }}
            onClick={() => setConfirmando(true)}
          >
            {t('app.eliminar')}
          </button>
        </div>
      </div>

      {confirmando && (
        <div
          className="panel mt-1 flex flex-wrap items-center justify-between gap-3 p-3"
          style={{ marginLeft: `${categoria.depth * 20}px`, borderColor: 'var(--error)' }}
        >
          <span className="text-sm">
            {categoria.productos > 0
              ? t('categorias.confirmar_con_productos', {
                  nombre: categoria.name,
                  n: categoria.productos,
                })
              : t('categorias.confirmar', { nombre: categoria.name })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-peligro text-sm"
              disabled={eliminar.isPending}
              onClick={() => eliminar.mutate()}
            >
              {t('app.eliminar')}
            </button>
            <button
              type="button"
              className="btn btn-fantasma text-sm"
              onClick={() => setConfirmando(false)}
            >
              {t('app.cancelar')}
            </button>
          </div>
        </div>
      )}

      {creandoEn === categoria.id && (
        <div style={{ marginLeft: `${(categoria.depth + 1) * 20}px` }}>
          <FormularioCategoria
            padreId={categoria.id}
            onHecho={() => {
              setCreandoEn(undefined);
              onCambio();
            }}
            onCancelar={() => setCreandoEn(undefined)}
          />
        </div>
      )}

      {categoria.children.length > 0 && (
        <ul className="mt-1 space-y-1">
          {categoria.children.map((h) => (
            <Rama
              key={h.id}
              categoria={h}
              creandoEn={creandoEn}
              setCreandoEn={setCreandoEn}
              onCambio={onCambio}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Genera un identificador de URL a partir del nombre. */
function aHandle(texto: string): string {
  return (
    texto
      .toLowerCase()
      .normalize('NFD')
      // Se quitan los acentos: una URL con "camisón" funciona pero se comparte
      // como %C3%B3 y queda ilegible en cualquier sitio donde se pegue.
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
  );
}

function FormularioCategoria({
  padreId,
  onHecho,
  onCancelar,
}: {
  padreId: string | null;
  onHecho: () => void;
  onCancelar: () => void;
}) {
  const { t } = useTranslation();
  const [nombres, setNombres] = useState<Record<string, string>>({ es: '', ca: '', en: '' });
  const [esAdulto, setEsAdulto] = useState(false);

  const crear = useMutation({
    mutationFn: () => {
      const base = nombres['es'] || nombres['en'] || nombres['ca'] || '';
      return post('/catalog/categories', {
        handle: aHandle(base),
        ...(padreId ? { parentId: padreId } : {}),
        isAdult: esAdulto,
        // Solo los idiomas rellenados: crear traducciones vacías dejaría la
        // tienda enseñando categorías sin nombre en ese idioma.
        translations: LOCALES.filter((l) => nombres[l]?.trim()).map((l) => ({
          locale: l,
          name: nombres[l]!.trim(),
          slug: aHandle(nombres[l]!),
        })),
      });
    },
    onSuccess: onHecho,
  });

  const sinNombre = !LOCALES.some((l) => nombres[l]?.trim());

  return (
    <div className="panel my-2 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {LOCALES.map((l) => (
          <label key={l} className="text-sm">
            <span className="etiqueta">{t(`categorias.nombre_${l}`)}</span>
            <input
              className="campo mt-1 w-full"
              value={nombres[l] ?? ''}
              onChange={(e) => setNombres({ ...nombres, [l]: e.target.value })}
            />
          </label>
        ))}
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={esAdulto} onChange={(e) => setEsAdulto(e.target.checked)} />
        {t('categorias.es_adulto')}
      </label>

      {esAdulto && (
        <p className="mt-1 text-xs" style={{ color: 'var(--aviso)' }}>
          {t('categorias.es_adulto_aviso')}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="btn btn-primario text-sm"
          disabled={sinNombre || crear.isPending}
          onClick={() => crear.mutate()}
        >
          {t('app.crear')}
        </button>
        <button type="button" className="btn btn-fantasma text-sm" onClick={onCancelar}>
          {t('app.cancelar')}
        </button>
      </div>

      {crear.error != null && (
        <p className="mt-2 text-sm" style={{ color: 'var(--error)' }}>
          {crear.error instanceof Error ? crear.error.message : t('app.error')}
        </p>
      )}
    </div>
  );
}

// ── Atributos ───────────────────────────────────────────────

interface Atributo {
  id: string;
  key: string;
  type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SELECT' | 'MULTISELECT';
  unit: string | null;
  isFilterable: boolean;
  isVisible: boolean;
  options: string[] | null;
  productos: number;
  categorias: number;
}

/**
 * Atributos del catálogo.
 *
 * Son las facetas por las que el cliente filtra. Un catálogo grande sin ellas
 * obliga a recorrer páginas hasta dar con algo, que es la forma más rápida de
 * perder una venta que ya estaba decidida.
 */
function SeccionAtributos() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [creando, setCreando] = useState(false);

  const atributos = useQuery({
    queryKey: ['atributos'],
    queryFn: () => get<Atributo[]>('/catalog/attributes'),
  });

  const cambiar = useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: Partial<Atributo> }) =>
      patch(`/catalog/attributes/${id}`, datos),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['atributos'] }),
  });

  const items = atributos.data ?? [];

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('categorias.atributos')}</h2>
        <button
          type="button"
          className="btn btn-fantasma text-sm"
          onClick={() => setCreando(!creando)}
        >
          + {t('categorias.nuevo_atributo')}
        </button>
      </div>

      <p className="mb-3 text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {t('categorias.atributos_ayuda')}
      </p>

      {creando && (
        <FormularioAtributo
          onHecho={() => {
            setCreando(false);
            void qc.invalidateQueries({ queryKey: ['atributos'] });
          }}
          onCancelar={() => setCreando(false)}
        />
      )}

      {items.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
          {t('categorias.sin_atributos')}
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((a) => (
            <li key={a.id} className="panel flex flex-wrap items-center gap-3 p-3 text-sm">
              <span className="font-medium">{a.key}</span>
              <Etiqueta tono="neutro" texto={a.type} />
              {a.unit && <span style={{ color: 'var(--texto-tenue)' }}>({a.unit})</span>}
              {a.options && a.options.length > 0 && (
                <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {a.options.slice(0, 4).join(' · ')}
                  {a.options.length > 4 ? '…' : ''}
                </span>
              )}

              <span className="ml-auto text-xs" style={{ color: 'var(--texto-tenue)' }}>
                {t('categorias.en_productos', { n: a.productos })}
              </span>

              <button
                type="button"
                className="btn btn-fantasma text-sm"
                onClick={() =>
                  cambiar.mutate({ id: a.id, datos: { isFilterable: !a.isFilterable } })
                }
              >
                {a.isFilterable ? t('categorias.filtra') : t('categorias.no_filtra')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const TIPOS = ['TEXT', 'NUMBER', 'BOOLEAN', 'SELECT', 'MULTISELECT'] as const;

function FormularioAtributo({
  onHecho,
  onCancelar,
}: {
  onHecho: () => void;
  onCancelar: () => void;
}) {
  const { t } = useTranslation();
  const [clave, setClave] = useState('');
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>('TEXT');
  const [unidad, setUnidad] = useState('');
  const [opciones, setOpciones] = useState('');

  const necesitaOpciones = tipo === 'SELECT' || tipo === 'MULTISELECT';

  const crear = useMutation({
    mutationFn: () =>
      post('/catalog/attributes', {
        key: clave.trim(),
        type: tipo,
        ...(unidad.trim() ? { unit: unidad.trim() } : {}),
        ...(necesitaOpciones
          ? {
              options: opciones
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean),
            }
          : {}),
      }),
    onSuccess: onHecho,
  });

  return (
    <div className="panel mb-3 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="etiqueta">{t('categorias.clave')}</span>
          <input
            className="campo mt-1 w-full"
            placeholder="material"
            value={clave}
            // Se normaliza al escribir: la clave viaja al índice de búsqueda y
            // un espacio ahí rompe la faceta sin dar error visible.
            onChange={(e) => setClave(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
          />
        </label>

        <label className="text-sm">
          <span className="etiqueta">{t('categorias.tipo')}</span>
          <select
            className="campo mt-1 w-full"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as (typeof TIPOS)[number])}
          >
            {TIPOS.map((x) => (
              <option key={x} value={x}>
                {t(`categorias.tipo_${x}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="etiqueta">{t('categorias.unidad')}</span>
          <input
            className="campo mt-1 w-full"
            placeholder="cm"
            value={unidad}
            onChange={(e) => setUnidad(e.target.value)}
          />
        </label>
      </div>

      {necesitaOpciones && (
        <label className="mt-3 block text-sm">
          <span className="etiqueta">{t('categorias.opciones')}</span>
          <input
            className="campo mt-1 w-full"
            placeholder="Algodón, Cuero, Sintético"
            value={opciones}
            onChange={(e) => setOpciones(e.target.value)}
          />
          <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('categorias.opciones_ayuda')}
          </span>
        </label>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="btn btn-primario text-sm"
          disabled={!clave.trim() || crear.isPending}
          onClick={() => crear.mutate()}
        >
          {t('app.crear')}
        </button>
        <button type="button" className="btn btn-fantasma text-sm" onClick={onCancelar}>
          {t('app.cancelar')}
        </button>
      </div>

      {crear.error != null && (
        <p className="mt-2 text-sm" style={{ color: 'var(--error)' }}>
          {crear.error instanceof Error ? crear.error.message : t('app.error')}
        </p>
      )}
    </div>
  );
}
