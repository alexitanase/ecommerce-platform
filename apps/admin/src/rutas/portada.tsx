import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LOCALES,
  TIPOS_BLOQUE,
  type BloquePortada,
  type Locale,
  type TipoBloque,
  type Traducible,
} from '@ecom/shared';
import { get, post } from '@/lib/api';
import { Cargando, ErrorPanel } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Editor de la portada.
 *
 * La portada es la página que más se mira y la que más cambia: una campaña, un
 * banner de rebajas, cambiar el orden en temporada. Si cada cambio necesita un
 * despliegue, no se hace. Aquí se reordena, se activa y se desactiva sin tocar
 * código, y lo que se guarda es exactamente lo que valida la API.
 *
 * Los bloques ocultos no se borran: una campaña que vuelve el año que viene se
 * apaga y se enciende, no se reescribe.
 */

interface Categoria {
  id: string;
  name: string;
  children?: Categoria[];
}

interface ProductoBuscado {
  id: string;
  name: string;
  handle: string;
}

/**
 * Identificador libre para un bloque nuevo.
 *
 * Numerado por tipo y no con la hora ni un aleatorio: el id acaba en el JSON
 * guardado y en la URL de las anclas, y "hero-2" se entiende al leerlo mientras
 * que "hero-931204" no dice nada.
 */
function idLibre(tipo: TipoBloque, usados: string[]): string {
  for (let n = 1; ; n++) {
    const id = `${tipo}-${String(n)}`;
    if (!usados.includes(id)) return id;
  }
}

/** Bloque nuevo del tipo elegido, con lo mínimo para que se pueda guardar. */
function bloqueNuevo(tipo: TipoBloque, id: string): BloquePortada {
  const base = { id, visible: true };

  switch (tipo) {
    case 'hero':
      return { ...base, tipo, titulo: {}, oscurecer: true };
    case 'banner':
      return { ...base, tipo, titulo: {} };
    case 'destacados':
      return { ...base, tipo, titulo: {}, origen: 'novedad', productIds: [], limite: 8 };
    case 'colecciones':
      return { ...base, tipo, titulo: {}, categoryIds: [] };
    case 'ventajas':
      return { ...base, tipo, ventajas: [] };
    case 'testimonios':
      return { ...base, tipo, titulo: {}, testimonios: [] };
  }
}

export function Portada() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();

  /** Cambios sin guardar. `null` mientras no se ha tocado nada. */
  const [bloques, setBloques] = useState<BloquePortada[] | null>(null);
  const [idioma, setIdioma] = useState<Locale>('es');
  const [guardado, setGuardado] = useState(false);

  const consulta = useQuery({
    queryKey: ['portada'],
    queryFn: () => get<BloquePortada[]>('/content/admin/home'),
  });

  const categorias = useQuery({
    queryKey: ['categorias', 'plano', i18n.language],
    queryFn: () => get<Categoria[]>(`/catalog/categories/tree?locale=${i18n.language}`),
  });

  const guardar = useMutation({
    mutationFn: (lista: BloquePortada[]) => post('/content/admin/home', { bloques: lista }),
    onSuccess: () => {
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
      void qc.invalidateQueries({ queryKey: ['portada'] });
    },
  });

  if (consulta.isLoading) return <Cargando />;
  if (consulta.error)
    return <ErrorPanel error={consulta.error} reintentar={() => void consulta.refetch()} />;

  // Lo que respondió el servidor hasta que se toca algo; a partir de ahí, lo
  // editado. Sin copiarlo a estado en un efecto: eso pisa los cambios a medio
  // hacer cada vez que la consulta se refresca sola.
  const lista = bloques ?? consulta.data ?? [];

  const actualizar = (indice: number, cambios: Partial<BloquePortada>) => {
    setBloques(
      lista.map((bloque, i) =>
        i === indice ? ({ ...bloque, ...cambios } as BloquePortada) : bloque,
      ),
    );
  };

  const mover = (indice: number, salto: number) => {
    const destino = indice + salto;
    if (destino < 0 || destino >= lista.length) return;

    const copia = [...lista];
    const [bloque] = copia.splice(indice, 1);
    if (bloque) copia.splice(destino, 0, bloque);
    setBloques(copia);
  };

  const anadir = (tipo: TipoBloque) => {
    setBloques([
      ...lista,
      bloqueNuevo(
        tipo,
        idLibre(
          tipo,
          lista.map((b) => b.id),
        ),
      ),
    ]);
  };

  const planas = aplanar(categorias.data ?? []);

  return (
    <div>
      <Encabezado
        titulo={t('portada.titulo')}
        descripcion={t('portada.descripcion')}
        acciones={
          /* Un solo selector de idioma para toda la pantalla: con uno por
             campo, traducir la portada entera son treinta clics. */
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

      <div className="space-y-3">
        {lista.map((bloque, i) => (
          <section
            key={bloque.id}
            className="panel p-4"
            style={{ opacity: bloque.visible ? 1 : 0.6 }}
          >
            <header className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="font-medium">{t(`portada.tipo_${bloque.tipo}`)}</h2>
              <code className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                {bloque.id}
              </code>

              <div className="ml-auto flex items-center gap-1">
                <label className="mr-2 flex cursor-pointer items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={bloque.visible}
                    onChange={(e) => actualizar(i, { visible: e.target.checked })}
                  />
                  {t('portada.visible')}
                </label>
                <button
                  type="button"
                  className="btn btn-fantasma px-2 py-1 text-xs"
                  disabled={i === 0}
                  aria-label={t('portada.subir')}
                  onClick={() => mover(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-fantasma px-2 py-1 text-xs"
                  disabled={i === lista.length - 1}
                  aria-label={t('portada.bajar')}
                  onClick={() => mover(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-fantasma px-2 py-1 text-xs"
                  style={{ color: 'var(--error)' }}
                  onClick={() => setBloques(lista.filter((_, j) => j !== i))}
                >
                  {t('app.eliminar')}
                </button>
              </div>
            </header>

            <CamposBloque
              bloque={bloque}
              idioma={idioma}
              categorias={planas}
              alCambiar={(cambios) => actualizar(i, cambios)}
            />
          </section>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {TIPOS_BLOQUE.map((tipo) => (
          <button
            key={tipo}
            type="button"
            className="btn btn-secundario text-sm"
            onClick={() => anadir(tipo)}
          >
            + {t(`portada.tipo_${tipo}`)}
          </button>
        ))}
      </div>

      <div
        className="sticky bottom-4 mt-5 flex items-center gap-3 rounded-xl p-3"
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
          {guardado ? t('app.guardado') : t('portada.bloques', { n: lista.length })}
        </span>

        {guardar.error && (
          <span className="text-sm" style={{ color: 'var(--error)' }}>
            {guardar.error.message}
          </span>
        )}

        <button
          type="button"
          onClick={() => guardar.mutate(lista)}
          disabled={guardar.isPending}
          className="btn btn-primario ml-auto"
        >
          {t('app.guardar')}
        </button>
      </div>
    </div>
  );
}

/** Categorías del árbol en una sola lista, con sangría en el nombre. */
function aplanar(arbol: Categoria[], nivel = 0): { id: string; name: string }[] {
  return arbol.flatMap((c) => [
    { id: c.id, name: `${'— '.repeat(nivel)}${c.name}` },
    ...aplanar(c.children ?? [], nivel + 1),
  ]);
}

function CamposBloque({
  bloque,
  idioma,
  categorias,
  alCambiar,
}: {
  bloque: BloquePortada;
  idioma: Locale;
  categorias: { id: string; name: string }[];
  alCambiar: (cambios: Partial<BloquePortada>) => void;
}) {
  const { t } = useTranslation();

  /** Campo de texto traducible: solo toca el idioma que se está editando. */
  const campoTraducible = (
    etiqueta: string,
    valor: Traducible | undefined,
    aplicar: (v: Traducible) => Partial<BloquePortada>,
  ) => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{etiqueta}</span>
      <input
        type="text"
        value={valor?.[idioma] ?? ''}
        onChange={(e) => alCambiar(aplicar({ ...valor, [idioma]: e.target.value }))}
        className="campo"
      />
    </label>
  );

  const campoTexto = (
    etiqueta: string,
    valor: string,
    aplicar: (v: string) => Partial<BloquePortada>,
  ) => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{etiqueta}</span>
      <input
        type="text"
        value={valor}
        onChange={(e) => alCambiar(aplicar(e.target.value))}
        className="campo"
      />
    </label>
  );

  switch (bloque.tipo) {
    case 'hero':
      return (
        <div className="campos-formulario">
          {campoTraducible(t('portada.campo_titulo'), bloque.titulo, (titulo) => ({ titulo }))}
          {campoTraducible(t('portada.campo_subtitulo'), bloque.subtitulo, (subtitulo) => ({
            subtitulo,
          }))}
          {campoTraducible(t('portada.campo_boton'), bloque.textoBoton, (textoBoton) => ({
            textoBoton,
          }))}
          {campoTexto(t('portada.campo_enlace'), bloque.enlaceBoton ?? '', (enlaceBoton) => ({
            enlaceBoton,
          }))}
          {campoTexto(t('portada.campo_imagen'), bloque.imagen ?? '', (imagen) => ({ imagen }))}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={bloque.oscurecer}
              onChange={(e) => alCambiar({ oscurecer: e.target.checked })}
            />
            {t('portada.oscurecer')}
          </label>
        </div>
      );

    case 'banner':
      return (
        <div className="campos-formulario">
          {campoTraducible(t('portada.campo_titulo'), bloque.titulo, (titulo) => ({ titulo }))}
          {campoTraducible(t('portada.campo_texto'), bloque.texto, (texto) => ({ texto }))}
          {campoTraducible(t('portada.campo_boton'), bloque.textoBoton, (textoBoton) => ({
            textoBoton,
          }))}
          {campoTexto(t('portada.campo_enlace'), bloque.enlaceBoton ?? '', (enlaceBoton) => ({
            enlaceBoton,
          }))}
          {campoTexto(t('portada.campo_imagen'), bloque.imagen ?? '', (imagen) => ({ imagen }))}
        </div>
      );

    case 'destacados':
      return (
        <div className="campos-formulario">
          {campoTraducible(t('portada.campo_titulo'), bloque.titulo, (titulo) => ({ titulo }))}

          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t('portada.origen')}</span>
            <select
              value={bloque.origen}
              onChange={(e) => alCambiar({ origen: e.target.value as typeof bloque.origen })}
              className="campo"
            >
              {(['novedad', 'valoracion', 'categoria', 'manual'] as const).map((o) => (
                <option key={o} value={o}>
                  {t(`portada.origen_${o}`)}
                </option>
              ))}
            </select>
          </label>

          {bloque.origen === 'categoria' && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium">{t('portada.categoria')}</span>
              <select
                value={bloque.categoryId ?? ''}
                onChange={(e) => alCambiar({ categoryId: e.target.value })}
                className="campo"
              >
                <option value="">—</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t('portada.limite')}</span>
            <input
              type="number"
              min={2}
              max={24}
              value={bloque.limite}
              onChange={(e) => alCambiar({ limite: Number(e.target.value) })}
              className="campo"
            />
          </label>
          {/* El buscador de productos no es un campo más: lleva su propia lista
              de resultados y necesita la fila entera. */}
          {bloque.origen === 'manual' && (
            <div className="campos-fila">
              <SelectorProductos
                ids={bloque.productIds}
                alCambiar={(productIds) => alCambiar({ productIds })}
              />
            </div>
          )}
        </div>
      );

    case 'colecciones':
      return (
        <div className="space-y-3">
          {campoTraducible(t('portada.campo_titulo'), bloque.titulo, (titulo) => ({ titulo }))}
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t('portada.categorias')}</legend>
            <p className="mb-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
              {t('portada.categorias_ayuda')}
            </p>
            <div className="grid gap-1 sm:grid-cols-2">
              {categorias.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={bloque.categoryIds.includes(c.id)}
                    onChange={(e) =>
                      alCambiar({
                        categoryIds: e.target.checked
                          ? [...bloque.categoryIds, c.id]
                          : bloque.categoryIds.filter((id) => id !== c.id),
                      })
                    }
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      );

    case 'ventajas':
      return (
        <div className="space-y-3">
          {bloque.ventajas.map((v, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <input
                type="text"
                value={v.titulo[idioma] ?? ''}
                placeholder={t('portada.campo_titulo')}
                onChange={(e) =>
                  alCambiar({
                    ventajas: bloque.ventajas.map((x, j) =>
                      j === i ? { ...x, titulo: { ...x.titulo, [idioma]: e.target.value } } : x,
                    ),
                  })
                }
                className="campo"
              />
              <input
                type="text"
                value={v.texto?.[idioma] ?? ''}
                placeholder={t('portada.campo_texto')}
                onChange={(e) =>
                  alCambiar({
                    ventajas: bloque.ventajas.map((x, j) =>
                      j === i ? { ...x, texto: { ...x.texto, [idioma]: e.target.value } } : x,
                    ),
                  })
                }
                className="campo"
              />
              <button
                type="button"
                className="btn btn-fantasma text-xs"
                onClick={() => alCambiar({ ventajas: bloque.ventajas.filter((_, j) => j !== i) })}
              >
                {t('app.eliminar')}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-secundario text-sm"
            onClick={() => alCambiar({ ventajas: [...bloque.ventajas, { titulo: {} }] })}
          >
            + {t('portada.anadir_ventaja')}
          </button>
        </div>
      );

    case 'testimonios':
      return (
        <div className="space-y-3">
          {campoTraducible(t('portada.campo_titulo'), bloque.titulo, (titulo) => ({ titulo }))}
          {bloque.testimonios.map((x, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
              <input
                type="text"
                value={x.texto[idioma] ?? ''}
                placeholder={t('portada.campo_texto')}
                onChange={(e) =>
                  alCambiar({
                    testimonios: bloque.testimonios.map((y, j) =>
                      j === i ? { ...y, texto: { ...y.texto, [idioma]: e.target.value } } : y,
                    ),
                  })
                }
                className="campo"
              />
              <input
                type="text"
                value={x.autor}
                placeholder={t('portada.autor')}
                onChange={(e) =>
                  alCambiar({
                    testimonios: bloque.testimonios.map((y, j) =>
                      j === i ? { ...y, autor: e.target.value } : y,
                    ),
                  })
                }
                className="campo"
              />
              <button
                type="button"
                className="btn btn-fantasma text-xs"
                onClick={() =>
                  alCambiar({ testimonios: bloque.testimonios.filter((_, j) => j !== i) })
                }
              >
                {t('app.eliminar')}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-secundario text-sm"
            onClick={() =>
              alCambiar({ testimonios: [...bloque.testimonios, { texto: {}, autor: '' }] })
            }
          >
            + {t('portada.anadir_testimonio')}
          </button>
        </div>
      );
  }
}

/**
 * Productos elegidos a mano, buscándolos por nombre.
 *
 * Pedir los identificadores a mano sería copiar cuids de una pantalla a otra, y
 * un carácter mal copiado deja un hueco en la portada sin decir por qué.
 */
function SelectorProductos({
  ids,
  alCambiar,
}: {
  ids: string[];
  alCambiar: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [busqueda, setBusqueda] = useState('');

  const resultados = useQuery({
    queryKey: ['portada', 'productos', busqueda],
    queryFn: () =>
      get<{ items: ProductoBuscado[] }>(
        `/catalog/products?locale=es&limite=8&status=ACTIVE&busqueda=${encodeURIComponent(busqueda)}`,
      ),
    enabled: busqueda.trim().length >= 2,
  });

  // Los nombres de los ya elegidos: al reabrir la pantalla solo hay cuids
  // guardados, y una lista de códigos no dice qué productos son.
  const elegidos = useQuery({
    queryKey: ['portada', 'elegidos', ids.join(',')],
    queryFn: () =>
      get<{ items: ProductoBuscado[] }>(
        `/catalog/products?locale=es&limite=50&ids=${encodeURIComponent(ids.join(','))}`,
      ),
    enabled: ids.length > 0,
  });

  const nombreDe = (id: string) => elegidos.data?.items.find((p) => p.id === id)?.name ?? id;

  return (
    <div>
      <span className="mb-1 block text-sm font-medium">{t('portada.productos')}</span>

      <ol className="mb-2 space-y-1">
        {ids.map((id, i) => (
          <li key={id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{nombreDe(id)}</span>
            <button
              type="button"
              className="btn btn-fantasma px-2 py-0.5 text-xs"
              disabled={i === 0}
              aria-label={t('portada.subir')}
              onClick={() => {
                const copia = [...ids];
                const [x] = copia.splice(i, 1);
                if (x) copia.splice(i - 1, 0, x);
                alCambiar(copia);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn-fantasma px-2 py-0.5 text-xs"
              style={{ color: 'var(--error)' }}
              onClick={() => alCambiar(ids.filter((x) => x !== id))}
            >
              {t('app.eliminar')}
            </button>
          </li>
        ))}
      </ol>

      <input
        type="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder={t('portada.buscar_producto')}
        className="campo"
      />

      {busqueda.trim().length >= 2 && (
        <ul className="mt-1 space-y-1">
          {(resultados.data?.items ?? [])
            .filter((p) => !ids.includes(p.id))
            .map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="btn btn-fantasma w-full justify-start text-left text-sm"
                  onClick={() => {
                    alCambiar([...ids, p.id]);
                    setBusqueda('');
                  }}
                >
                  + {p.name}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
