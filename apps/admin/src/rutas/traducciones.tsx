import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, post } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Revisión de las traducciones automáticas.
 *
 * Nada de lo que hay aquí está publicado: son propuestas del traductor
 * esperando a que alguien las mire. Es la pantalla que separa "tienda en tres
 * idiomas" de "tienda con fichas que parecen escritas por una máquina", que es
 * justo la impresión que hace que alguien no compre.
 *
 * El original va al lado de la propuesta a propósito: revisar una traducción
 * sin ver de qué viene es adivinar, y así se detecta lo que el traductor se ha
 * inventado —que en fichas de proveedor pasa más de lo que parece.
 */

interface Pendiente {
  id: string;
  productId: string;
  locale: string;
  motor: string;
  creadaEn: string;
  imagen: string | null;
  estadoProducto: string;
  propuesta: {
    name: string;
    slug: string;
    shortDescription: string | null;
    description: string | null;
  };
  original: {
    locale: string;
    name: string;
    shortDescription: string | null;
    description: string | null;
  } | null;
}

export function Traducciones() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editando, setEditando] = useState<Record<string, { name: string; description: string }>>(
    {},
  );

  const consulta = useQuery({
    queryKey: ['traducciones'],
    queryFn: () =>
      get<{ motorActivo: boolean; total: number; items: Pendiente[] }>('/translations/pending'),
  });

  const refrescar = () => void qc.invalidateQueries({ queryKey: ['traducciones'] });

  const aprobar = useMutation({
    mutationFn: ({ id, cambios }: { id: string; cambios: Record<string, string> }) =>
      post(`/translations/${id}/approve`, cambios),
    onSuccess: refrescar,
  });

  const descartar = useMutation({
    mutationFn: (id: string) => del(`/translations/${id}`),
    onSuccess: refrescar,
  });

  if (consulta.isLoading) return <Cargando />;
  if (consulta.error)
    return <ErrorPanel error={consulta.error} reintentar={() => void consulta.refetch()} />;

  const datos = consulta.data;

  return (
    <div>
      <Encabezado titulo={t('traducciones.titulo')} descripcion={t('traducciones.descripcion')} />

      {/* Sin motor configurado esta pantalla estaría siempre vacía y nadie
          sabría por qué: se dice, con lo que hay que hacer para activarlo. */}
      {datos && !datos.motorActivo && (
        <p
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--aviso) 12%, transparent)',
            color: 'var(--aviso)',
          }}
        >
          {t('traducciones.sin_motor')}
        </p>
      )}

      {!datos || datos.items.length === 0 ? (
        <Vacio titulo={t('traducciones.vacio')} descripcion={t('traducciones.vacio_ayuda')} />
      ) : (
        <div className="fichas fichas-anchas">
          {datos.items.map((p) => {
            const edicion = editando[p.id] ?? {
              name: p.propuesta.name,
              description: p.propuesta.description ?? '',
            };

            const cambiar = (campo: 'name' | 'description', valor: string) => {
              setEditando((e) => ({ ...e, [p.id]: { ...edicion, [campo]: valor } }));
            };

            return (
              <article key={p.id} className="panel p-4">
                <header className="mb-3 flex flex-wrap items-center gap-2">
                  <Etiqueta texto={p.locale.toUpperCase()} />
                  <Etiqueta texto={p.motor} tono="neutro" />
                  {p.estadoProducto === 'DRAFT' && (
                    <Etiqueta texto={t('traducciones.en_borrador')} tono="neutro" />
                  )}
                  <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {new Date(p.creadaEn).toLocaleDateString('es-ES')}
                  </span>
                </header>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-medium" style={{ color: 'var(--texto-tenue)' }}>
                      {t('traducciones.original')} · {p.original?.locale.toUpperCase() ?? '—'}
                    </p>
                    <p className="text-sm font-medium">{p.original?.name}</p>
                    <p
                      className="mt-2 max-h-40 overflow-auto whitespace-pre-line text-xs"
                      style={{ color: 'var(--texto-suave)' }}
                    >
                      {p.original?.description ?? p.original?.shortDescription ?? '—'}
                    </p>
                  </div>

                  <div>
                    <label className="block">
                      <span
                        className="mb-1 block text-xs font-medium"
                        style={{ color: 'var(--texto-tenue)' }}
                      >
                        {t('traducciones.propuesta')}
                      </span>
                      <input
                        type="text"
                        value={edicion.name}
                        onChange={(e) => cambiar('name', e.target.value)}
                        className="campo text-base sm:text-sm"
                      />
                    </label>

                    <textarea
                      value={edicion.description}
                      onChange={(e) => cambiar('description', e.target.value)}
                      rows={6}
                      className="campo mt-2 resize-y text-base sm:text-xs"
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-primario text-sm"
                    disabled={aprobar.isPending}
                    onClick={() =>
                      aprobar.mutate({
                        id: p.id,
                        cambios: { name: edicion.name, description: edicion.description },
                      })
                    }
                  >
                    {t('traducciones.aprobar')}
                  </button>

                  <button
                    type="button"
                    className="btn btn-fantasma text-sm"
                    style={{ color: 'var(--error)' }}
                    disabled={descartar.isPending}
                    onClick={() => descartar.mutate(p.id)}
                  >
                    {t('traducciones.descartar')}
                  </button>

                  <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    /{p.locale}/{p.propuesta.slug}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
