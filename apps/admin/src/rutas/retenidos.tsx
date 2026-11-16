import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { precio, fechaRelativa } from '@/lib/formato';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Pedidos retenidos por el control de riesgo.
 *
 * Estos pedidos **están cobrados pero no se han enviado al proveedor**. Es
 * justamente lo que hace barato equivocarse: si el pedido es bueno, soltarlo
 * cuesta un clic y solo se ha retrasado unas horas; si era fraude, no se ha
 * gastado un céntimo en mercancía que no se va a recuperar.
 *
 * Por eso esta pantalla no puede quedarse sin mirar: cada fila es una venta
 * legítima esperando o un fraude a punto de costar el producto y el porte.
 */

interface Motivo {
  codigo: string;
  puntos: number;
  detalle: string;
}

interface Retenido {
  id: string;
  number: string;
  email: string;
  totalCents: number;
  status: string;
  paymentStatus: string;
  riskScore: number;
  riskReasons: Motivo[] | null;
  createdAt: string;
}

/** Cuanto más alta la puntuación, más conviene mirarlo con calma. */
function tonoDe(puntuacion: number): 'error' | 'aviso' | 'neutro' {
  if (puntuacion >= 70) return 'error';
  if (puntuacion >= 40) return 'aviso';
  return 'neutro';
}

export function Retenidos() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const pedidos = useQuery({
    queryKey: ['pedidos', 'retenidos'],
    queryFn: () => get<Retenido[]>('/orders/retenidos'),
    // Llegan solos, mientras la tienda vende: la pantalla se refresca sola
    // para que quien la tenga abierta no trabaje con una lista de hace una hora.
    refetchInterval: 60_000,
  });

  const liberar = useMutation({
    mutationFn: (id: string) => post(`/orders/${id}/liberar-riesgo`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pedidos'] }),
  });

  if (pedidos.isLoading) return <Cargando />;
  if (pedidos.error)
    return <ErrorPanel error={pedidos.error} reintentar={() => void pedidos.refetch()} />;

  const items = pedidos.data ?? [];

  return (
    <div>
      <Encabezado titulo={t('riesgo.titulo')} descripcion={t('riesgo.descripcion')} />

      {liberar.error && (
        <p
          role="alert"
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--error) 12%, transparent)',
            color: 'var(--error)',
          }}
        >
          {liberar.error.message}
        </p>
      )}

      {items.length === 0 ? (
        <Vacio titulo={t('riesgo.ninguno')} descripcion={t('riesgo.ninguno_ayuda')} />
      ) : (
        <div className="fichas fichas-anchas">
          {items.map((p) => (
            <article key={p.id} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{p.number}</span>
                    <Etiqueta
                      texto={`${t('riesgo.puntuacion')} ${String(p.riskScore)}`}
                      tono={tonoDe(p.riskScore)}
                    />
                    <Etiqueta
                      texto={p.paymentStatus}
                      tono={p.paymentStatus === 'PAID' ? 'exito' : 'neutro'}
                    />
                  </div>

                  <p className="mt-1 text-sm" style={{ color: 'var(--texto-tenue)' }}>
                    {p.email} · {precio(p.totalCents)} · {fechaRelativa(p.createdAt)}
                  </p>
                </div>

                <button
                  type="button"
                  className="btn btn-primario text-sm"
                  disabled={liberar.isPending}
                  onClick={() => liberar.mutate(p.id)}
                >
                  {liberar.isPending && liberar.variables === p.id ? '…' : t('riesgo.liberar')}
                </button>
              </div>

              {/* Por qué está retenido. Sin esto, quien decide soltar un pedido
                  de trescientos euros lo hace a ciegas. */}
              {p.riskReasons && p.riskReasons.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs">
                  {p.riskReasons.map((motivo) => (
                    <li
                      key={motivo.codigo}
                      style={{
                        color: motivo.puntos > 0 ? 'var(--texto-suave)' : 'var(--exito)',
                      }}
                    >
                      {motivo.puntos > 0 ? '▲' : '▼'} {motivo.detalle} (
                      {motivo.puntos > 0 ? '+' : ''}
                      {motivo.puntos})
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
