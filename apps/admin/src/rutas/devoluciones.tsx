import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Devoluciones y desistimientos.
 *
 * Lo que esta pantalla tiene que dejar claro de un vistazo, porque es lo que
 * decide bien o mal el trabajo diario de postventa:
 *
 *  1. **Cuánto queda para reembolsar.** Hay 14 días naturales desde que el
 *     cliente comunica el desistimiento. Pasarse es incumplir, y nada avisa
 *     solo: por eso lo urgente sale primero y en rojo.
 *  2. **Quién paga los portes de vuelta.** Lo decide el motivo, no una
 *     negociación, y cobrárselos al cliente cuando no toca es una reclamación.
 *  3. **Qué resoluciones caben.** Ofrecer una reparación a quien desiste es
 *     negarle el dinero al que tiene derecho; la API lo rechaza, pero es mejor
 *     no ofrecerlo siquiera.
 */

type EstadoDevolucion =
  'REQUESTED' | 'APPROVED' | 'IN_RETURN' | 'RECEIVED' | 'RESOLVED' | 'REJECTED' | 'CANCELLED';

type Motivo =
  | 'DEFECTIVE'
  | 'NOT_AS_DESCRIBED'
  | 'DAMAGED_IN_TRANSIT'
  | 'WRONG_ITEM'
  | 'MISSING_ITEM'
  | 'WITHDRAWAL';

type Resolucion = 'REPAIR' | 'REPLACE' | 'REFUND' | 'PRICE_REDUCTION' | 'REJECTED';

interface LineaDevolucion {
  id: string;
  orderItemId: string;
  quantity: number;
  condition: string | null;
  restocked: boolean;
  refundCents: number;
}

interface Devolucion {
  id: string;
  number: string;
  reason: Motivo;
  status: EstadoDevolucion;
  resolution: Resolucion | null;
  customerNote: string | null;
  photoUrls: string[];
  returnShippingPaidBy: string;
  refundAmountCents: number;
  rejectionReason: string | null;
  supplierClaimRef: string | null;
  createdAt: string;
  items: LineaDevolucion[];
  order: { number: string; email: string; deliveredAt: string | null };
}

interface Desistimiento {
  id: string;
  status: string;
  requestedAt: string;
  refundAmountCents: number;
  refundShippingCents: number;
  order: { number: string; email: string };
}

/** Resoluciones que admite cada motivo. Espejo de las reglas de la API. */
const REMEDIOS: Record<Motivo, Resolucion[]> = {
  DEFECTIVE: ['REPAIR', 'REPLACE', 'REFUND', 'PRICE_REDUCTION'],
  NOT_AS_DESCRIBED: ['REPLACE', 'REFUND', 'PRICE_REDUCTION'],
  DAMAGED_IN_TRANSIT: ['REPLACE', 'REFUND'],
  WRONG_ITEM: ['REPLACE', 'REFUND'],
  MISSING_ITEM: ['REPLACE', 'REFUND'],
  WITHDRAWAL: ['REFUND'],
};

const TONO_ESTADO: Record<EstadoDevolucion, 'exito' | 'aviso' | 'error' | 'neutro' | 'info'> = {
  REQUESTED: 'aviso',
  APPROVED: 'info',
  IN_RETURN: 'info',
  RECEIVED: 'info',
  RESOLVED: 'exito',
  REJECTED: 'error',
  CANCELLED: 'neutro',
};

const euros = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €';

/**
 * Días que quedan para reembolsar desde que se comunicó.
 *
 * Negativo significa que el plazo legal ya se ha pasado, y eso hay que verlo
 * antes que cualquier otra cosa de la pantalla.
 */
function diasParaReembolsar(comunicadoEn: string): number {
  const limite = new Date(comunicadoEn);
  limite.setDate(limite.getDate() + 14);
  return Math.ceil((limite.getTime() - Date.now()) / 86_400_000);
}

export function Devoluciones() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const devoluciones = useQuery({
    queryKey: ['devoluciones'],
    queryFn: () => get<Devolucion[]>('/returns'),
  });

  const desistimientos = useQuery({
    queryKey: ['desistimientos'],
    queryFn: () => get<Desistimiento[]>('/withdrawals'),
  });

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['devoluciones'] });
    void qc.invalidateQueries({ queryKey: ['desistimientos'] });
  };

  if (devoluciones.isLoading || desistimientos.isLoading) return <Cargando />;
  if (devoluciones.error)
    return <ErrorPanel error={devoluciones.error} reintentar={() => void devoluciones.refetch()} />;

  const items = devoluciones.data ?? [];
  const pendientes = items.filter((d) => !['RESOLVED', 'REJECTED', 'CANCELLED'].includes(d.status));
  const cerradas = items.filter((d) => ['RESOLVED', 'REJECTED', 'CANCELLED'].includes(d.status));

  // Los desistimientos aún sin reembolsar corren un plazo legal: van arriba,
  // ordenados por urgencia, para que nadie tenga que buscarlos.
  const abiertos = (desistimientos.data ?? [])
    .filter((d) => d.status !== 'REFUNDED' && d.status !== 'REJECTED' && d.status !== 'CANCELLED')
    .sort((a, b) => diasParaReembolsar(a.requestedAt) - diasParaReembolsar(b.requestedAt));

  return (
    <div>
      <Encabezado titulo={t('devoluciones.titulo')} descripcion={t('devoluciones.descripcion')} />

      {abiertos.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold">{t('devoluciones.reembolsos_pendientes')}</h2>
          <div className="space-y-2">
            {abiertos.map((d) => (
              <FilaDesistimiento key={d.id} desistimiento={d} onCambio={refrescar} />
            ))}
          </div>
        </section>
      )}

      <h2 className="mb-2 text-sm font-semibold">{t('devoluciones.pendientes')}</h2>
      {pendientes.length === 0 ? (
        <Vacio titulo={t('devoluciones.sin_pendientes')} />
      ) : (
        <div className="space-y-3">
          {pendientes.map((d) => (
            <TarjetaDevolucion key={d.id} devolucion={d} onCambio={refrescar} />
          ))}
        </div>
      )}

      {cerradas.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-sm font-semibold">{t('devoluciones.cerradas')}</h2>
          <div className="space-y-2">
            {cerradas.map((d) => (
              <div key={d.id} className="panel flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="font-medium">{d.number}</span>
                <Etiqueta
                  tono={TONO_ESTADO[d.status]}
                  texto={t(`devoluciones.estado.${d.status}`)}
                />
                <span style={{ color: 'var(--texto-tenue)' }}>
                  {d.order.number} · {t(`devoluciones.motivo.${d.reason}`)}
                </span>
                {d.resolution && (
                  <span style={{ color: 'var(--texto-tenue)' }}>
                    → {t(`devoluciones.resolucion.${d.resolution}`)}
                  </span>
                )}
                {d.refundAmountCents > 0 && (
                  <span className="tabular-nums">{euros(d.refundAmountCents)}</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Desistimiento pendiente de reembolso, con el plazo legal a la vista. */
function FilaDesistimiento({
  desistimiento,
  onCambio,
}: {
  desistimiento: Desistimiento;
  onCambio: () => void;
}) {
  const { t } = useTranslation();
  const dias = diasParaReembolsar(desistimiento.requestedAt);
  const vencido = dias < 0;
  const urgente = dias >= 0 && dias <= 3;

  const marcar = useMutation({
    mutationFn: (estado: string) => patch(`/withdrawals/${desistimiento.id}`, { estado }),
    onSuccess: onCambio,
  });

  const total = desistimiento.refundAmountCents + desistimiento.refundShippingCents;

  return (
    <div
      className="panel flex flex-wrap items-center justify-between gap-3 p-3"
      style={vencido || urgente ? { borderColor: 'var(--error)' } : undefined}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{desistimiento.order.number}</span>
          <Etiqueta
            tono={vencido ? 'error' : urgente ? 'aviso' : 'neutro'}
            texto={
              vencido
                ? t('devoluciones.plazo_vencido', { dias: Math.abs(dias) })
                : t('devoluciones.plazo_quedan', { dias })
            }
          />
        </div>
        <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {desistimiento.order.email} · {t('devoluciones.a_devolver')}: {euros(total)}
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primario text-sm"
          disabled={marcar.isPending}
          onClick={() => marcar.mutate('REFUNDED')}
        >
          {t('devoluciones.marcar_reembolsado')}
        </button>
      </div>
    </div>
  );
}

function TarjetaDevolucion({
  devolucion,
  onCambio,
}: {
  devolucion: Devolucion;
  onCambio: () => void;
}) {
  const { t } = useTranslation();
  const [recibiendo, setRecibiendo] = useState(false);
  const [resolviendo, setResolviendo] = useState(false);

  const aprobar = useMutation({
    mutationFn: () => post(`/returns/${devolucion.number}/approve`),
    onSuccess: onCambio,
  });

  const portesCliente = devolucion.returnShippingPaidBy === 'customer';

  return (
    <article className="panel p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{devolucion.number}</h3>
            <Etiqueta
              tono={TONO_ESTADO[devolucion.status]}
              texto={t(`devoluciones.estado.${devolucion.status}`)}
            />
            <Etiqueta tono="neutro" texto={t(`devoluciones.motivo.${devolucion.reason}`)} />
            {/* Quién paga el porte lo decide el motivo. Verlo aquí evita
                cobrárselo al cliente cuando no le corresponde. */}
            <Etiqueta
              tono={portesCliente ? 'neutro' : 'aviso'}
              texto={
                portesCliente ? t('devoluciones.portes_cliente') : t('devoluciones.portes_tienda')
              }
            />
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {devolucion.order.number} · {devolucion.order.email}
          </p>
        </div>

        <span className="tabular-nums text-sm font-medium">
          {euros(devolucion.refundAmountCents)}
        </span>
      </header>

      {devolucion.customerNote && (
        <p
          className="mt-3 rounded-lg p-3 text-sm"
          style={{ background: 'var(--fondo-sutil)', color: 'var(--texto-suave)' }}
        >
          {devolucion.customerNote}
        </p>
      )}

      {devolucion.photoUrls.length > 0 && (
        <div className="mt-3 flex gap-2">
          {devolucion.photoUrls.map((url) => (
            // En una falta de conformidad las fotos son la prueba: se abren a
            // tamaño completo porque el detalle es lo que se está juzgando.
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover" />
            </a>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {devolucion.status === 'REQUESTED' && (
          <button
            type="button"
            className="btn btn-primario text-sm"
            disabled={aprobar.isPending}
            onClick={() => aprobar.mutate()}
          >
            {t('devoluciones.aprobar')}
          </button>
        )}

        {(devolucion.status === 'APPROVED' || devolucion.status === 'IN_RETURN') && (
          <button
            type="button"
            className="btn btn-secundario text-sm"
            onClick={() => setRecibiendo(!recibiendo)}
          >
            {t('devoluciones.recibir')}
          </button>
        )}

        {devolucion.status !== 'REQUESTED' && (
          <button
            type="button"
            className="btn btn-secundario text-sm"
            onClick={() => setResolviendo(!resolviendo)}
          >
            {t('devoluciones.resolver')}
          </button>
        )}
      </div>

      {recibiendo && (
        <FormularioRecepcion
          devolucion={devolucion}
          onHecho={() => {
            setRecibiendo(false);
            onCambio();
          }}
        />
      )}

      {resolviendo && (
        <FormularioResolucion
          devolucion={devolucion}
          onHecho={() => {
            setResolviendo(false);
            onCambio();
          }}
        />
      )}
    </article>
  );
}

/** Estados en que puede llegar lo devuelto. Solo los dos primeros reponen. */
const CONDICIONES = ['nuevo', 'perfecto', 'usado', 'dañado', 'incompleto'] as const;

function FormularioRecepcion({
  devolucion,
  onHecho,
}: {
  devolucion: Devolucion;
  onHecho: () => void;
}) {
  const { t } = useTranslation();
  const [condiciones, setCondiciones] = useState<Record<string, string>>({});

  const recibir = useMutation({
    mutationFn: () =>
      post(`/returns/${devolucion.number}/receive`, {
        lineas: devolucion.items.map((i) => ({
          orderItemId: i.orderItemId,
          condicion: condiciones[i.orderItemId] ?? 'usado',
        })),
      }),
    onSuccess: onHecho,
  });

  return (
    <div className="mt-4 rounded-lg border p-3" style={{ borderColor: 'var(--borde)' }}>
      <p className="mb-2 text-sm font-medium">{t('devoluciones.estado_recibido')}</p>
      <p className="mb-3 text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {t('devoluciones.estado_recibido_ayuda')}
      </p>

      <div className="space-y-2">
        {devolucion.items.map((item) => (
          <label key={item.id} className="flex items-center gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {t('devoluciones.unidades', { n: item.quantity })}
            </span>
            <select
              className="campo"
              value={condiciones[item.orderItemId] ?? 'usado'}
              onChange={(e) =>
                setCondiciones({ ...condiciones, [item.orderItemId]: e.target.value })
              }
            >
              {CONDICIONES.map((c) => (
                <option key={c} value={c}>
                  {t(`devoluciones.condicion.${c}`)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <button
        type="button"
        className="btn btn-primario mt-3 text-sm"
        disabled={recibir.isPending}
        onClick={() => recibir.mutate()}
      >
        {t('devoluciones.confirmar_recepcion')}
      </button>
    </div>
  );
}

function FormularioResolucion({
  devolucion,
  onHecho,
}: {
  devolucion: Devolucion;
  onHecho: () => void;
}) {
  const { t } = useTranslation();
  const remedios = REMEDIOS[devolucion.reason];
  const [resolucion, setResolucion] = useState<Resolucion>(remedios[0] ?? 'REFUND');
  const [importe, setImporte] = useState((devolucion.refundAmountCents / 100).toFixed(2));
  const [motivoRechazo, setMotivoRechazo] = useState('');

  const resolver = useMutation({
    mutationFn: () =>
      patch(`/returns/${devolucion.number}/resolve`, {
        resolucion,
        ...(resolucion === 'REFUND' || resolucion === 'PRICE_REDUCTION'
          ? { importeCents: Math.round(Number(importe.replace(',', '.')) * 100) }
          : {}),
        ...(resolucion === 'REJECTED' ? { motivoRechazo } : {}),
      }),
    onSuccess: onHecho,
  });

  const conImporte = resolucion === 'REFUND' || resolucion === 'PRICE_REDUCTION';

  return (
    <div className="mt-4 rounded-lg border p-3" style={{ borderColor: 'var(--borde)' }}>
      <label className="block text-sm">
        <span className="etiqueta">{t('devoluciones.resolucion_label')}</span>
        <select
          className="campo mt-1 w-full"
          value={resolucion}
          onChange={(e) => setResolucion(e.target.value as Resolucion)}
        >
          {/* Solo las que admite este motivo, más el rechazo. Ofrecer una
              reparación a quien desiste sería negarle su dinero. */}
          {[...remedios, 'REJECTED' as const].map((r) => (
            <option key={r} value={r}>
              {t(`devoluciones.resolucion.${r}`)}
            </option>
          ))}
        </select>
      </label>

      {conImporte && (
        <label className="mt-3 block text-sm">
          <span className="etiqueta">{t('devoluciones.importe')}</span>
          <input
            className="campo mt-1 w-full"
            inputMode="decimal"
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
          />
          <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('devoluciones.importe_ayuda', { maximo: euros(devolucion.refundAmountCents) })}
          </span>
        </label>
      )}

      {resolucion === 'REJECTED' && (
        <label className="mt-3 block text-sm">
          <span className="etiqueta">{t('devoluciones.motivo_rechazo')}</span>
          <textarea
            className="campo mt-1 w-full"
            rows={2}
            value={motivoRechazo}
            onChange={(e) => setMotivoRechazo(e.target.value)}
          />
          <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('devoluciones.motivo_rechazo_ayuda')}
          </span>
        </label>
      )}

      <button
        type="button"
        className="btn btn-primario mt-3 text-sm"
        disabled={resolver.isPending || (resolucion === 'REJECTED' && !motivoRechazo.trim())}
        onClick={() => resolver.mutate()}
      >
        {t('devoluciones.confirmar_resolucion')}
      </button>
    </div>
  );
}
