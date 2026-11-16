import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { fechaHora, precio } from '@/lib/formato';
import {
  Cargando,
  ErrorPanel,
  Etiqueta,
  SinResultados,
  Vacio,
  VerMas,
} from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { Modal } from '@/componentes/ui/overlays';
import { consulta, useListaPaginada } from '@/lib/paginacion';
import { useSesion } from '@/lib/sesion';
import { useToast } from '@/componentes/ui/toast';

interface Linea {
  id: string;
  sku: string;
  name: string;
  variantName: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  totalCents: number;
}

interface Evento {
  id: string;
  type: string;
  description: string;
  actorType: string;
  createdAt: string;
}

interface Pago {
  id: string;
  provider: string;
  status: string;
  amountCents: number;
  receivedCents: number;
  payCurrency: string | null;
  txHash: string | null;
  createdAt: string;
}

interface Detalle {
  id: string;
  number: string;
  email: string;
  phone: string | null;
  status: string;
  estadoLegible: string;
  /**
   * A dónde puede moverse el pedido ahora mismo, según el servidor.
   *
   * No se calcula aquí a propósito: duplicar la máquina de estados en el panel
   * garantiza que un día diverge de la de la API y aparecen botones que dan
   * error al pulsarlos, o —peor— pasos legítimos que nadie ofrece y dejan el
   * pedido atascado sin explicación.
   */
  transicionesPermitidas: { estado: string; titulo: string }[];
  paymentStatus: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  supplierCostCents: number;
  gatewayFeeCents: number;
  margenNetoCents: number;
  margenPorcentaje: number;
  shippingAddress: Record<string, string>;
  customerNote: string | null;
  createdAt: string;
  items: Linea[];
  events: Evento[];
  payments: Pago[];
  subPedidos: SubPedido[];
}

/**
 * La compra al proveedor.
 *
 * Un pedido puede generar varias: si el cliente mezcla artículos de dos
 * proveedores, se compra por separado y cada compra tiene su propio estado y su
 * propio seguimiento. Enseñar solo el coste total escondía justo eso.
 */
interface SubPedido {
  id: string;
  proveedor: string;
  proveedorClave: string;
  estado: string;
  estadoProveedor: string | null;
  externalOrderId: string | null;
  costeCents: number;
  intentos: number;
  necesitaRevision: boolean;
  error: string | null;
  tipoError: string | null;
  creadoEn: string;
  enviadoEn: string | null;
  transportista: string | null;
  seguimiento: string | null;
  urlSeguimiento: string | null;
  estadoSeguimiento: string | null;
  entregadoEn: string | null;
}

interface Resumen {
  id: string;
  number: string;
  email: string;
  status: string;
  estadoLegible: string;
  totalCents: number;
  supplierCostCents: number;
  createdAt: string;
  items: { id: string }[];
}

/** Estado de la compra al proveedor. `PLACED` no es «entregado»: es «comprado». */
const TONO_PROVEEDOR: Record<string, 'exito' | 'aviso' | 'error' | 'info' | 'neutro'> = {
  PENDING: 'neutro',
  PLACING: 'info',
  PLACED: 'info',
  SHIPPED: 'aviso',
  DELIVERED: 'exito',
  FAILED: 'error',
  CANCELLED: 'neutro',
};

const TONO: Record<string, 'exito' | 'aviso' | 'error' | 'info' | 'neutro'> = {
  FAILED: 'error',
  CANCELLED: 'neutro',
  REFUNDED: 'aviso',
  DELIVERED: 'exito',
  PENDING_CLOSE: 'exito',
  CLOSED: 'neutro',
};

/**
 * Estados que se pueden filtrar, en el orden en que ocurren.
 *
 * El desplegable enseñaba los identificadores tal cual —`SENT_TO_SUPPLIER`—
 * mientras la tabla, a dos centímetros, ponía «Enviado al proveedor». Había que
 * saberse la correspondencia de memoria para filtrar.
 */
const ESTADOS = [
  'AWAITING_PAYMENT',
  'PAYMENT_CONFIRMING',
  'PAID',
  'PREPARING',
  'SENT_TO_SUPPLIER',
  'IN_TRANSIT',
  'DELIVERED',
  'PENDING_CLOSE',
  'CLOSED',
  'CANCELLED',
  'REFUNDED',
  'FAILED',
] as const;

/**
 * Listado y detalle de pedidos.
 *
 * El detalle se abre en un panel lateral en lugar de en otra página: quien
 * gestiona pedidos revisa muchos seguidos, y volver atrás cada vez rompe el
 * ritmo de trabajo.
 */
export function Pedidos() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { puede } = useSesion();
  const toast = useToast();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [estado, setEstado] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const pedidos = useListaPaginada<Resumen>(
    ['pedidos', estado, busqueda],
    // `busqueda` y no `email`: el campo dice «Nº de pedido o email» y con
    // `email` solo encontraba por email, así que escribir el número no daba nada.
    (cursor) => `/orders?${consulta({ limite: 50, status: estado, busqueda }, cursor)}`,
  );

  /** Nombre del estado en el idioma del panel, no en el del servidor. */
  const nombreEstado = (codigo: string) => t(`pedidos.estados.${codigo}`, { defaultValue: codigo });

  const hayFiltros = estado !== '' || busqueda !== '';
  const limpiarFiltros = () => {
    setEstado('');
    setBusqueda('');
  };

  const detalle = useQuery({
    queryKey: ['pedido', abierto],
    queryFn: () => get<Detalle>(`/orders/${abierto ?? ''}`),
    enabled: abierto !== null,
  });

  const refrescarPedido = () => {
    void qc.invalidateQueries({ queryKey: ['pedidos'] });
    void qc.invalidateQueries({ queryKey: ['pedido'] });
    // El tablero enseña los mismos pedidos: dejarlo con el estado viejo hace
    // que el siguiente movimiento se haga sobre datos que ya no son ciertos.
    void qc.invalidateQueries({ queryKey: ['kanban'] });
  };

  const cerrar = useMutation({
    mutationFn: (id: string) => post(`/orders/${id}/close`),
    onSuccess: refrescarPedido,
  });

  /**
   * Mover el pedido al siguiente paso.
   *
   * Hasta ahora esto solo se podía hacer arrastrando una tarjeta en el tablero,
   * así que quien trabajaba desde la ficha —que es donde está toda la
   * información para decidir— tenía que cambiar de pantalla para cada paso.
   */
  const avanzar = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: string }) =>
      post(`/orders/${id}/status`, { status: estado }),
    onSuccess: refrescarPedido,
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelar = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      post(`/orders/${id}/cancel`, { motivo }),
    onSuccess: refrescarPedido,
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Comprar al proveedor ahora.
   *
   * La compra la lanza sola la cola al confirmarse el cobro. Este botón es para
   * cuando eso no ocurrió —el worker estaba caído, el trabajo se perdió— y el
   * pedido se quedó pagado y sin comprar: sin él no había ninguna forma de
   * empujarlo, porque «reintentar» vive en la cola de incidencias y esa lista
   * mira sub-pedidos, que en ese caso no existen.
   *
   * Pulsarlo dos veces no compra dos veces: la clave de idempotencia es la
   * misma y lo ya comprado se salta.
   */
  const comprar = useMutation({
    mutationFn: (id: string) =>
      post<{ enviados: number; fallidos: number; requierenRevision: number }>(
        `/orders/${id}/procesar`,
      ),
    onSuccess: (r) => {
      refrescarPedido();
      if (r.fallidos > 0) toast.error(t('pedidos.compra_con_fallos', { n: r.fallidos }));
      else if (r.requierenRevision > 0) toast.mostrar(t('pedidos.compra_pendiente_manual'));
      else toast.exito(t('pedidos.compra_lanzada', { n: r.enviados }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /*
   * Marcar el cobro a mano.
   *
   * Hace falta cuando el aviso de la pasarela no llega: sin webhook dado de
   * alta, o con una transferencia, el dinero está y el pedido se queda esperando
   * para siempre. El motivo es obligatorio porque es lo único que explicará en
   * seis meses por qué este pedido consta pagado sin que ninguna pasarela lo
   * dijera; queda en el historial del pedido y en la auditoría.
   */
  const [pagando, setPagando] = useState(false);
  const [motivoPago, setMotivoPago] = useState('');

  const marcarPagado = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      post(`/orders/${id}/marcar-pagado`, { motivo }),
    onSuccess: () => {
      setPagando(false);
      setMotivoPago('');
      refrescarPedido();
    },
  });

  /*
   * Preguntar a la pasarela antes de marcar nada a mano.
   *
   * Si el cliente pagó y lo que falló fue el aviso, esto lo resuelve solo y sin
   * que nadie declare nada: se le pregunta a la pasarela por ese cobro y se
   * actualiza con lo que responda. Es el botón que hay que pulsar PRIMERO, y la
   * API lo tenía desde el principio sin que el panel lo usara.
   */
  const reconciliar = useMutation({
    mutationFn: (paymentId: string) => post(`/payments/${paymentId}/reconcile`),
    onSuccess: refrescarPedido,
  });

  const items = pedidos.items;
  const d = detalle.data;

  return (
    <div>
      <Encabezado
        titulo={t('pedidos.titulo')}
        cargados={pedidos.cargando ? undefined : items.length}
        hayMas={pedidos.hayMas}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={t('pedidos.buscar')}
          className="campo max-w-xs"
          aria-label={t('pedidos.buscar')}
        />
        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          className="campo w-auto"
          aria-label={t('app.estado')}
        >
          <option value="">{t('pedidos.todos_estados')}</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>
              {nombreEstado(e)}
            </option>
          ))}
        </select>
        {hayFiltros && (
          <button type="button" onClick={limpiarFiltros} className="btn btn-fantasma text-sm">
            {t('app.limpiar_filtros')}
          </button>
        )}
      </div>

      {pedidos.cargando ? (
        <Cargando />
      ) : pedidos.error ? (
        <ErrorPanel error={pedidos.error} reintentar={pedidos.recargar} />
      ) : items.length === 0 ? (
        // Con filtros puestos, «no hay pedidos» es falso y desconcierta: los
        // hay, pero ninguno cumple el filtro.
        hayFiltros ? (
          <SinResultados alLimpiar={limpiarFiltros} />
        ) : (
          <Vacio titulo={t('pedidos.sin_pedidos')} />
        )
      ) : (
        <>
          <div className="panel overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>{t('pedidos.numero')}</th>
                  <th>{t('pedidos.cliente')}</th>
                  <th>{t('app.estado')}</th>
                  <th className="text-right">{t('pedidos.articulos')}</th>
                  <th className="text-right">{t('pedidos.importe')}</th>
                  <th className="text-right">{t('pedidos.margen')}</th>
                  <th>{t('pedidos.creado')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setAbierto(p.id)}
                    className="cursor-pointer"
                    // Sin `role="button"`, aunque la fila entera se pueda
                    // pulsar. Poniéndolo se pierde el rol de fila y con él toda
                    // la semántica de la tabla: un lector de pantalla deja de
                    // decir en qué columna está cada dato, que en una tabla de
                    // siete columnas es justo lo que la hace legible. Se queda
                    // enfocable y activable, que es lo que hacía falta.
                    tabIndex={0}
                    aria-label={`${t('pedidos.ver')} ${p.number}`}
                    onKeyDown={(e) => {
                      // Espacio además de Enter: en un control de tipo botón
                      // se espera que funcionen los dos.
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setAbierto(p.id);
                      }
                    }}
                  >
                    <td className="font-mono text-xs">{p.number}</td>
                    {/* El recorte va en un span, no en el `td`: `lineas-1`
                        pone `display:-webkit-box`, que sobre una celda anula el
                        `table-cell` y deja el correo cortado a hueso, sin
                        puntos suspensivos y sin respetar el ancho. */}
                    <td>
                      <span
                        className="block max-w-[220px] truncate"
                        // El correo entero al pasar por encima: cortado no se
                        // puede ni leer ni copiar, y es por lo que se busca a
                        // un cliente cuando llama.
                        title={p.email}
                      >
                        {p.email}
                      </span>
                    </td>
                    <td>
                      <Etiqueta texto={nombreEstado(p.status)} tono={TONO[p.status] ?? 'info'} />
                    </td>
                    <td className="text-right tabular-nums">{p.items.length}</td>
                    <td className="text-right font-medium tabular-nums">{precio(p.totalCents)}</td>
                    <td className="text-right tabular-nums" style={{ color: 'var(--texto-tenue)' }}>
                      {precio(p.totalCents - p.supplierCostCents)}
                    </td>
                    <td className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                      {fechaHora(p.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <VerMas
            hayMas={pedidos.hayMas}
            cargando={pedidos.cargandoMas}
            alPulsar={pedidos.cargarMas}
          />
        </>
      )}

      {/* ── Panel lateral de detalle ── */}
      {abierto && (
        <>
          <button
            type="button"
            aria-label={t('app.cerrar')}
            onClick={() => setAbierto(null)}
            className="fixed inset-0 z-40 bg-black/40"
          />
          <aside
            className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto border-l sm:max-w-xl"
            style={{ background: 'var(--fondo-panel)', borderColor: 'var(--borde)' }}
            aria-label={t('pedidos.ver')}
          >
            {detalle.isLoading || !d ? (
              <div className="p-6">
                <Cargando />
              </div>
            ) : (
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-mono text-lg font-semibold">{d.number}</h2>
                    <p className="mt-1 text-sm" style={{ color: 'var(--texto-tenue)' }}>
                      {fechaHora(d.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAbierto(null)}
                    className="btn btn-fantasma h-8 w-8 p-0"
                    aria-label={t('app.cerrar')}
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Etiqueta texto={d.estadoLegible} tono={TONO[d.status] ?? 'info'} />
                  <Etiqueta
                    texto={d.paymentStatus}
                    tono={d.paymentStatus === 'PAID' ? 'exito' : 'aviso'}
                  />
                </div>

                {/* Rentabilidad real del pedido: lo que de verdad se gana */}
                <section className="panel mt-4 p-4">
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <dt style={{ color: 'var(--texto-suave)' }}>Subtotal</dt>
                      <dd className="tabular-nums">{precio(d.subtotalCents)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt style={{ color: 'var(--texto-suave)' }}>{t('pedidos.envio')}</dt>
                      <dd className="tabular-nums">{precio(d.shippingCents)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt style={{ color: 'var(--texto-tenue)' }}>IVA incluido</dt>
                      <dd className="tabular-nums" style={{ color: 'var(--texto-tenue)' }}>
                        {precio(d.taxCents)}
                      </dd>
                    </div>
                    <div
                      className="flex justify-between border-t pt-1.5 font-semibold"
                      style={{ borderColor: 'var(--borde)' }}
                    >
                      <dt>{t('app.total')}</dt>
                      <dd className="tabular-nums">{precio(d.totalCents)}</dd>
                    </div>
                    <div className="flex justify-between text-xs">
                      <dt style={{ color: 'var(--texto-tenue)' }}>Coste proveedor</dt>
                      <dd className="tabular-nums" style={{ color: 'var(--texto-tenue)' }}>
                        −{precio(d.supplierCostCents)}
                      </dd>
                    </div>
                    {d.gatewayFeeCents > 0 && (
                      <div className="flex justify-between text-xs">
                        <dt style={{ color: 'var(--texto-tenue)' }}>Comisión pasarela</dt>
                        <dd className="tabular-nums" style={{ color: 'var(--texto-tenue)' }}>
                          −{precio(d.gatewayFeeCents)}
                        </dd>
                      </div>
                    )}
                    <div
                      className="flex justify-between border-t pt-1.5 font-semibold"
                      style={{
                        borderColor: 'var(--borde)',
                        color: d.margenNetoCents > 0 ? 'var(--exito)' : 'var(--error)',
                      }}
                    >
                      <dt>{t('pedidos.margen')}</dt>
                      <dd className="tabular-nums">
                        {precio(d.margenNetoCents)} ({d.margenPorcentaje}%)
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold">{t('pedidos.lineas')}</h3>
                  <ul className="space-y-2">
                    {d.items.map((l) => (
                      <li key={l.id} className="panel flex items-center gap-3 p-2.5">
                        {l.imageUrl ? (
                          <img src={l.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
                        ) : (
                          <span
                            className="h-10 w-10 rounded"
                            style={{ background: 'var(--fondo-sutil)' }}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="lineas-1 text-sm font-medium">{l.name}</p>
                          <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                            {l.sku}
                            {l.variantName ? ` · ${l.variantName}` : ''} · ×{l.quantity}
                          </p>
                        </div>
                        <span className="text-sm tabular-nums">{precio(l.totalCents)}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                {/*
                 * La compra al proveedor.
                 *
                 * Antes solo se veía el coste total y una línea de texto en el
                 * historial, así que para saber si un pedido estaba realmente
                 * comprado —y con qué referencia— había que leerse la
                 * cronología entera. Es el dato que se busca cuando un cliente
                 * pregunta dónde está su paquete.
                 */}
                {d.subPedidos.length > 0 && (
                  <section className="mt-4">
                    <h3 className="mb-2 text-sm font-semibold">{t('pedidos.proveedor')}</h3>
                    <ul className="space-y-2">
                      {d.subPedidos.map((s) => (
                        <li key={s.id} className="panel p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{s.proveedor}</span>
                            <Etiqueta
                              texto={t(`pedidos.proveedor_${s.estado}`, { defaultValue: s.estado })}
                              tono={TONO_PROVEEDOR[s.estado] ?? 'neutro'}
                            />
                            {/* El estado que da el proveedor. Va junto al
                                nuestro porque son distintos a propósito: el
                                nuestro se queda quieto durante días mientras el
                                suyo avanza, y es el suyo el que dice si el
                                pedido progresa o está atascado. */}
                            {s.estadoProveedor && s.estadoProveedor !== s.estado && (
                              <Etiqueta
                                texto={t(`pedidos.proveedor_estado_${s.estadoProveedor}`, {
                                  defaultValue: s.estadoProveedor.toLowerCase(),
                                })}
                                tono="neutro"
                              />
                            )}
                            {s.necesitaRevision && (
                              <Etiqueta texto={t('pedidos.necesita_revision')} tono="error" />
                            )}
                            <span className="ml-auto tabular-nums">{precio(s.costeCents)}</span>
                          </div>

                          {/* La referencia del proveedor: es lo que hay que
                              buscar en su web para reclamar o cancelar. */}
                          {s.externalOrderId && (
                            <p
                              className="mt-1 font-mono text-xs break-all"
                              style={{ color: 'var(--texto-tenue)' }}
                            >
                              {s.externalOrderId}
                            </p>
                          )}

                          {s.enviadoEn && (
                            <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                              {t('pedidos.comprado_el')} {fechaHora(s.enviadoEn)}
                            </p>
                          )}

                          <SeguimientoDelEnvio
                            sub={s}
                            puedeEditar={puede('orders:fulfill')}
                            alGuardar={refrescarPedido}
                          />

                          {s.error && (
                            <p
                              className="mt-2 rounded px-2 py-1 text-xs"
                              style={{
                                background: 'color-mix(in srgb, var(--error) 10%, transparent)',
                                color: 'var(--error)',
                              }}
                            >
                              {s.error}
                              {s.intentos > 1 &&
                                ` · ${t('incidencias.intentos', { n: s.intentos })}`}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold">{t('pedidos.envio')}</h3>
                  <address
                    className="panel p-3 text-sm not-italic"
                    style={{ color: 'var(--texto-suave)' }}
                  >
                    {d.shippingAddress['firstName']} {d.shippingAddress['lastName']}
                    <br />
                    {d.shippingAddress['line1']}
                    {d.shippingAddress['line2'] ? <>, {d.shippingAddress['line2']}</> : null}
                    <br />
                    {d.shippingAddress['postalCode']} {d.shippingAddress['city']} (
                    {d.shippingAddress['province']})
                    <br />
                    {d.shippingAddress['countryCode']}
                    {d.phone ? (
                      <>
                        <br />
                        {d.phone}
                      </>
                    ) : null}
                    <br />
                    {d.email}
                  </address>
                </section>

                {d.payments.length > 0 && (
                  <section className="mt-4">
                    <h3 className="mb-2 text-sm font-semibold">{t('pedidos.pagos')}</h3>
                    <ul className="space-y-2">
                      {d.payments.map((p) => (
                        <li key={p.id} className="panel p-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{p.provider}</span>
                            <Etiqueta
                              texto={p.status}
                              tono={p.status === 'PAID' ? 'exito' : 'aviso'}
                            />
                          </div>
                          <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                            {precio(p.receivedCents)} de {precio(p.amountCents)}
                            {p.payCurrency ? ` · ${p.payCurrency}` : ''}
                          </p>
                          {p.txHash && (
                            <p
                              className="mt-1 break-all font-mono text-[10px]"
                              style={{ color: 'var(--texto-tenue)' }}
                            >
                              {p.txHash}
                            </p>
                          )}

                          {p.status !== 'PAID' &&
                            p.provider !== 'manual' &&
                            puede('payments:read') && (
                              <button
                                type="button"
                                className="btn btn-fantasma mt-2 text-xs"
                                disabled={reconciliar.isPending}
                                onClick={() => reconciliar.mutate(p.id)}
                                data-prueba="reconciliar"
                              >
                                {reconciliar.isPending && reconciliar.variables === p.id
                                  ? t('pedidos.comprobando')
                                  : t('pedidos.comprobar_pasarela')}
                              </button>
                            )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold">{t('pedidos.timeline')}</h3>
                  <ol className="space-y-2">
                    {d.events.map((e) => (
                      <li key={e.id} className="flex gap-3 text-sm">
                        <span
                          className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full"
                          style={{ background: 'var(--marca-primario)' }}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <p>{e.description}</p>
                          <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                            {fechaHora(e.createdAt)} · {e.actorType}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>

                {/*
                  El siguiente paso del pedido, aquí y no solo en el tablero.
                  Los destinos los da el servidor: el panel no lleva copia de la
                  máquina de estados, así que no puede ofrecer un paso que la
                  API rechace ni esconder uno legítimo.
                */}
                {d.transicionesPermitidas.length > 0 && puede('orders:write') && (
                  <section className="mt-6">
                    <h3 className="mb-2 text-sm font-semibold">{t('pedidos.siguiente_paso')}</h3>
                    <div className="flex flex-wrap gap-2">
                      {d.transicionesPermitidas.map((paso) => (
                        <button
                          key={paso.estado}
                          type="button"
                          className="btn btn-secundario text-sm"
                          disabled={avanzar.isPending}
                          onClick={() => avanzar.mutate({ id: d.id, estado: paso.estado })}
                          data-prueba={`avanzar-${paso.estado}`}
                        >
                          {nombreEstado(paso.estado)}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                <div className="mt-6 flex flex-wrap gap-2">
                  {/* Cobrado y sin comprar: el único botón que saca al pedido
                      de ahí cuando la cola no llegó a hacer su trabajo. */}
                  {['PAID', 'PREPARING', 'FAILED'].includes(d.status) &&
                    puede('orders:fulfill') && (
                      <button
                        type="button"
                        className="btn btn-primario"
                        disabled={comprar.isPending}
                        onClick={() => comprar.mutate(d.id)}
                        data-prueba="comprar-proveedor"
                      >
                        {comprar.isPending ? '…' : t('pedidos.comprar_proveedor')}
                      </button>
                    )}

                  {d.status === 'PENDING_CLOSE' && puede('orders:close') && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(t('pedidos.confirmar_cierre'))) cerrar.mutate(d.id);
                      }}
                      className="btn btn-primario"
                    >
                      {t('pedidos.cerrar')}
                    </button>
                  )}

                  {d.paymentStatus !== 'PAID' &&
                    !['CANCELLED', 'REFUNDED'].includes(d.status) &&
                    puede('orders:write') &&
                    puede('payments:write') && (
                      <button
                        type="button"
                        onClick={() => setPagando(true)}
                        className="btn btn-secundario"
                        data-prueba="marcar-pagado"
                      >
                        {t('pedidos.marcar_pagado')}
                      </button>
                    )}

                  {/* FAILED incluido: una incidencia es justo cuando más falta
                      hace cancelar y devolver el dinero, y la API lo permite al
                      equipo desde ese estado. El panel lo escondía. */}
                  {['AWAITING_PAYMENT', 'PAID', 'PREPARING', 'FAILED'].includes(d.status) &&
                    puede('orders:cancel') && (
                      <button
                        type="button"
                        onClick={() => {
                          const motivo = prompt(t('pedidos.motivo_cancelacion'));
                          if (motivo) cancelar.mutate({ id: d.id, motivo });
                        }}
                        className="btn btn-secundario"
                      >
                        {t('pedidos.cancelar')}
                      </button>
                    )}
                </div>

                <Modal
                  abierto={pagando}
                  alCerrar={() => setPagando(false)}
                  titulo={t('pedidos.marcar_pagado')}
                  descripcion={t('pedidos.marcar_pagado_ayuda')}
                  ancho="sm"
                  pie={
                    <>
                      <button
                        type="button"
                        className="btn btn-secundario"
                        onClick={() => setPagando(false)}
                      >
                        {t('app.cancelar')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primario"
                        // El mínimo es el mismo que exige la API: es mejor
                        // decirlo aquí que hacer el viaje para recibir un 400.
                        disabled={motivoPago.trim().length < 5 || marcarPagado.isPending}
                        onClick={() => marcarPagado.mutate({ id: d.id, motivo: motivoPago.trim() })}
                        data-prueba="confirmar-pagado"
                      >
                        {t('pedidos.marcar_pagado')}
                      </button>
                    </>
                  }
                >
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium">
                      {t('pedidos.motivo_pago')}
                    </span>
                    <textarea
                      rows={3}
                      className="campo"
                      value={motivoPago}
                      onChange={(e) => setMotivoPago(e.target.value)}
                      placeholder={t('pedidos.motivo_pago_ejemplo')}
                    />
                  </label>

                  {marcarPagado.error && (
                    <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--error)' }}>
                      {marcarPagado.error.message}
                    </p>
                  )}
                </Modal>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  );
}

/**
 * El seguimiento de un envío del proveedor.
 *
 * Con un proveedor que tiene API esto llega solo. Con uno que no la tiene
 * —Dreamlove manda un XML y se le compra a mano en su web— no llega nunca, y
 * sin este formulario el cliente no recibía el aviso de que su paquete iba en
 * camino, el pedido no avanzaba a «en tránsito» y el envío acababa apareciendo
 * semanas después en la lista de posibles perdidos.
 *
 * El enlace no se pide: se construye a partir del transportista. Lo que se
 * copia de la web del proveedor es un nombre y un número, y mandarle al cliente
 * un número suelto que no sabe dónde pegar es justo lo que provoca el correo de
 * «¿dónde está lo mío?».
 */
function SeguimientoDelEnvio({
  sub,
  puedeEditar,
  alGuardar,
}: {
  sub: SubPedido;
  puedeEditar: boolean;
  alGuardar: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [transportista, setTransportista] = useState(sub.transportista ?? '');
  const [numero, setNumero] = useState(sub.seguimiento ?? '');
  const [avisar, setAvisar] = useState(true);

  const transportistas = useQuery({
    queryKey: ['transportistas'],
    queryFn: () => get<string[]>('/orders/transportistas'),
    // Es una lista del código: no cambia salvo despliegue.
    staleTime: 60 * 60_000,
    enabled: abierto,
  });

  const guardar = useMutation({
    mutationFn: () =>
      post<{ mensaje: string }>(`/orders/sub-pedidos/${sub.id}/seguimiento`, {
        transportista: transportista.trim(),
        numero: numero.trim(),
        avisarCliente: avisar,
      }),
    onSuccess: (r) => {
      setAbierto(false);
      toast.exito(r.mensaje);
      alGuardar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /*
   * Solo se anota envío en lo que ya está comprado.
   *
   * En PENDIENTE la compra aún no se ha hecho —o está esperando a que alguien
   * la haga a mano— y anotar ahí un número de seguimiento avisaría al cliente
   * de que su paquete sale cuando todavía no lo ha comprado nadie.
   */
  const sePuedeAnotar = puedeEditar && ['PLACED', 'SHIPPED', 'DELIVERED'].includes(sub.estado);

  if (abierto) {
    return (
      <div
        className="mt-2 rounded-lg border p-3"
        style={{ borderColor: 'var(--borde)' }}
        data-prueba="formulario-seguimiento"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium">{t('pedidos.transportista')}</span>
            <input
              className="campo text-base sm:text-sm"
              list={`transportistas-${sub.id}`}
              value={transportista}
              onChange={(e) => setTransportista(e.target.value)}
              placeholder="Correos, SEUR, GLS…"
            />
            {/* Sugerencias, no opciones cerradas: el transportista lo decide el
                proveedor y siempre puede aparecer uno que no esté en la lista.
                Los que sí están tienen enlace de seguimiento propio. */}
            <datalist id={`transportistas-${sub.id}`}>
              {(transportistas.data ?? []).map((nombre) => (
                <option key={nombre} value={nombre} />
              ))}
            </datalist>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium">
              {t('pedidos.numero_seguimiento')}
            </span>
            <input
              className="campo font-mono text-base sm:text-sm"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="AB123456789ES"
            />
          </label>
        </div>

        <label className="control-linea mt-2 text-xs">
          <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
          <span>{t('pedidos.avisar_cliente')}</span>
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primario text-xs"
            disabled={transportista.trim().length < 2 || numero.trim().length < 4}
            onClick={() => guardar.mutate()}
            data-prueba="guardar-seguimiento"
          >
            {guardar.isPending ? '…' : t('app.guardar')}
          </button>
          <button
            type="button"
            className="btn btn-fantasma text-xs"
            onClick={() => setAbierto(false)}
          >
            {t('app.cancelar')}
          </button>
        </div>
      </div>
    );
  }

  if (!sub.seguimiento) {
    return sePuedeAnotar ? (
      <button
        type="button"
        className="btn btn-secundario mt-2 text-xs"
        onClick={() => setAbierto(true)}
        data-prueba="anotar-envio"
      >
        {t('pedidos.anotar_envio')}
      </button>
    ) : null;
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {sub.urlSeguimiento ? (
        <a
          href={sub.urlSeguimiento}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline"
          data-prueba="enlace-seguimiento"
        >
          {sub.transportista ?? ''} {sub.seguimiento}
        </a>
      ) : (
        <span className="text-xs" style={{ color: 'var(--texto-suave)' }}>
          {sub.transportista ?? ''} {sub.seguimiento}
        </span>
      )}

      {sePuedeAnotar && (
        <button
          type="button"
          className="btn btn-fantasma text-xs"
          onClick={() => setAbierto(true)}
          aria-label={`${t('pedidos.corregir_envio')} ${sub.seguimiento}`}
        >
          {t('pedidos.corregir_envio')}
        </button>
      )}

      {sub.entregadoEn && (
        <span className="text-xs" style={{ color: 'var(--exito)' }}>
          {t('pedidos.entregado_el')} {fechaHora(sub.entregadoEn)}
        </span>
      )}
    </div>
  );
}
