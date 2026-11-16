import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { fechaHora } from '@/lib/formato';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

interface Resena {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  isVerifiedPurchase: boolean;
  locale: string;
  createdAt: string;
  product: { id: string; handle: string; translations: { name: string }[] };
}

/**
 * Moderación de reseñas.
 *
 * Las reseñas llegan sin publicar y esperan aquí. Publicarlas automáticamente
 * llena la ficha de spam en días, y una reseña falsa que ensalce el producto
 * es publicidad engañosa sancionable: la revisión humana no es opcional.
 */
export function Resenas() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const pendientes = useQuery({
    queryKey: ['resenas-pendientes'],
    queryFn: () => get<Resena[]>('/reviews/pending'),
  });

  const moderar = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVED' | 'REJECTED' }) =>
      post(`/reviews/${id}/moderate`, { decision }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['resenas-pendientes'] }),
  });

  const responder = useMutation({
    mutationFn: ({ id, reply }: { id: string; reply: string }) =>
      post(`/reviews/${id}/reply`, { reply }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['resenas-pendientes'] }),
  });

  if (pendientes.isLoading) return <Cargando />;
  if (pendientes.error)
    return <ErrorPanel error={pendientes.error} reintentar={() => void pendientes.refetch()} />;

  const items = pendientes.data ?? [];

  return (
    <div>
      <Encabezado titulo={t('nav.resenas')} cargados={items.length} />

      {items.length === 0 ? (
        <Vacio titulo={t('panel.resenas_pendientes')} descripcion={t('app.sin_datos')} />
      ) : (
        <ul className="fichas">
          {items.map((r) => (
            <li key={r.id} className="panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span aria-label={`${String(r.rating)} de 5`}>
                  {'★'.repeat(r.rating)}
                  <span style={{ color: 'var(--texto-tenue)' }}>{'★'.repeat(5 - r.rating)}</span>
                </span>
                {r.isVerifiedPurchase && <Etiqueta texto={t('nav.pedidos')} tono="exito" />}
                <Etiqueta texto={r.locale} />
                <span className="ml-auto text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {fechaHora(r.createdAt)}
                </span>
              </div>

              <p className="mt-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                {r.product.translations[0]?.name ?? r.product.handle}
              </p>

              {r.title && <p className="mt-2 font-medium">{r.title}</p>}
              {r.body && (
                <p className="mt-1 text-sm" style={{ color: 'var(--texto-suave)' }}>
                  {r.body}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => moderar.mutate({ id: r.id, decision: 'APPROVED' })}
                  disabled={moderar.isPending}
                  className="btn btn-primario text-xs"
                >
                  {t('app.confirmar')}
                </button>
                <button
                  type="button"
                  onClick={() => moderar.mutate({ id: r.id, decision: 'REJECTED' })}
                  disabled={moderar.isPending}
                  className="btn btn-secundario text-xs"
                >
                  {t('app.eliminar')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const reply = prompt(t('app.editar'));
                    if (reply) responder.mutate({ id: r.id, reply });
                  }}
                  className="btn btn-fantasma text-xs"
                >
                  {t('app.editar')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
