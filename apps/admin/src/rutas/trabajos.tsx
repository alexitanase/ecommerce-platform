import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

interface Cola {
  nombre: string;
  esperando: number;
  activos: number;
  completados: number;
  fallidos: number;
  retrasados: number;
  pausada: boolean;
}

interface Metricas {
  colas: Cola[];
  outbox: { pendientes: number; procesando: number; publicados: number; fallidos: number };
}

/**
 * Centro de trabajos.
 *
 * Permite ver qué se ha atascado y relanzarlo sin entrar por SSH ni tocar
 * Redis a mano. En dropshipping, un trabajo de fulfillment fallido es un
 * pedido que el cliente pagó y no va a recibir: cuanto antes se vea, mejor.
 */
export function Trabajos() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const metricas = useQuery({
    queryKey: ['metricas-colas'],
    queryFn: () => get<Metricas>('/jobs'),
    refetchInterval: 10_000,
  });

  const accion = useMutation({
    mutationFn: ({ ruta }: { ruta: string }) => post(ruta),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['metricas-colas'] }),
  });

  if (metricas.isLoading) return <Cargando />;
  if (metricas.error)
    return <ErrorPanel error={metricas.error} reintentar={() => void metricas.refetch()} />;

  return (
    <div>
      <Encabezado titulo={t('trabajos.titulo')} />

      <div className="panel overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>{t('trabajos.cola')}</th>
              <th className="text-right">{t('trabajos.esperando')}</th>
              <th className="text-right">{t('trabajos.activos')}</th>
              <th className="text-right">{t('trabajos.completados')}</th>
              <th className="text-right">{t('trabajos.fallidos')}</th>
              <th className="text-right">{t('app.acciones')}</th>
            </tr>
          </thead>
          <tbody>
            {metricas.data?.colas.map((c) => (
              <tr key={c.nombre}>
                <td className="font-medium">
                  {c.nombre}
                  {c.pausada && (
                    <span className="ml-2">
                      <Etiqueta texto={t('trabajos.pausada')} tono="aviso" />
                    </span>
                  )}
                </td>
                <td className="text-right tabular-nums">{c.esperando}</td>
                <td className="text-right tabular-nums">{c.activos}</td>
                <td className="text-right tabular-nums" style={{ color: 'var(--texto-tenue)' }}>
                  {c.completados}
                </td>
                <td
                  className="text-right font-medium tabular-nums"
                  style={c.fallidos > 0 ? { color: 'var(--error)' } : undefined}
                >
                  {c.fallidos}
                </td>
                <td className="text-right">
                  <div className="flex justify-end gap-1">
                    {c.fallidos > 0 && (
                      <button
                        type="button"
                        onClick={() => accion.mutate({ ruta: `/jobs/${c.nombre}/retry-all` })}
                        className="btn btn-secundario text-xs"
                      >
                        {t('trabajos.reintentar_todos')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        accion.mutate({
                          ruta: `/jobs/${c.nombre}/${c.pausada ? 'resume' : 'pause'}`,
                        })
                      }
                      className="btn btn-fantasma text-xs"
                    >
                      {c.pausada ? t('trabajos.reanudar') : t('trabajos.pausar')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">Outbox</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { k: 'pendientes', v: metricas.data?.outbox.pendientes ?? 0 },
            { k: 'procesando', v: metricas.data?.outbox.procesando ?? 0 },
            { k: 'publicados', v: metricas.data?.outbox.publicados ?? 0 },
            { k: 'fallidos', v: metricas.data?.outbox.fallidos ?? 0, alerta: true },
          ].map((x) => (
            <div key={x.k} className="panel p-4">
              <p
                className="text-xs uppercase tracking-wide"
                style={{ color: 'var(--texto-tenue)' }}
              >
                {x.k}
              </p>
              <p
                className="mt-1 text-2xl font-semibold tabular-nums"
                style={x.alerta && x.v > 0 ? { color: 'var(--error)' } : undefined}
              >
                {x.v}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
