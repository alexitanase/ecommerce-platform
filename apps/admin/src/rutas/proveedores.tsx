import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post, subirFichero } from '@/lib/api';
import { fechaRelativa } from '@/lib/formato';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Progreso } from '@/componentes/ui/datos';
import { Encabezado } from '@/componentes/encabezado';
import { useToast } from '@/componentes/ui/toast';
import { Enlace } from '@/componentes/enlace';

/**
 * Proveedores.
 *
 * De aquí sale la mercancía, así que todo lo que decide qué se compra y a qué
 * precio se configura en esta pantalla: alta, credenciales, márgenes, prioridad
 * y desde dónde envía. Igual que las integraciones, y por el mismo motivo:
 * cambiar de proveedor es una decisión de negocio y no puede depender de que
 * alguien entre en el servidor.
 *
 * Las credenciales se guardan cifradas y no se vuelven a mostrar; la pantalla
 * solo dice si están puestas. Y hay un botón que las prueba contra la API del
 * proveedor: unas claves mal copiadas no fallan al guardarlas, fallan al enviar
 * el primer pedido de un cliente que ya ha pagado.
 */

interface Proveedor {
  id: string;
  key: string;
  name: string;
  isActive: boolean;
  priority: number;
  paisOrigen: string;
  credencialesConfiguradas: boolean;
  margenPorDefecto: number;
  margenMinimo: number;
  recargoCompraPct: number;
  cargoFijoCents: number;
  cargoFijoUmbralCents: number;
  /** Portes que cobra por pedido, no por artículo. */
  portesPedidoCents: number;
  /** Importe a partir del cual no cobra portes; 0 = siempre se pagan. */
  portesGratisDesdeCents: number;
  /** Artículos guardados de su catálogo, en los proveedores sin API. */
  articulosCatalogo: number;
  productos: number;
  pedidos: number;
  salud: string;
  erroresConsecutivos: number;
  ultimaSync: string | null;
  ultimaSyncEstado: string | null;
}

interface CampoCredencial {
  clave: string;
  etiqueta: string;
  secreto: boolean;
  /** Lo consigue el sistema al autorizar; no se le pide a nadie. */
  porOauth?: boolean;
  ayuda?: string;
  /** Opciones cerradas: se pinta un desplegable, no un cuadro de texto. */
  opciones?: { valor: string; etiqueta: string }[];
  porDefecto?: string;
  opcional?: boolean;
}

interface ProveedorDisponible {
  key: string;
  nombre: string;
  usaOauth?: boolean;
  /** No tiene API: su catálogo entra subiendo el fichero que ellos mandan. */
  catalogoPorFichero?: boolean;
  camposCredenciales: CampoCredencial[];
}

/** Lo que hay guardado del catálogo de un proveedor sin API. */
interface EstadoCatalogo {
  articulos: number;
  disponibles: number;
  retirados: number;
  /** Cuántos productos serían en la tienda, ya agrupados los colores. */
  productos: number;
  ultimaImportacion: { startedAt: string; finishedAt: string | null; itemsRead: number } | null;
}

interface ImportacionCatalogo {
  id: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  fileName: string;
  itemsRead: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsRemoved: number;
  priceChanges: number;
  errorDetail: string | null;
  startedAt: string;
}

interface EstadoAutorizacion {
  usaOauth: boolean;
  autorizado: boolean;
  caducaEl: string | null;
  cuenta: string | null;
  urlDeRetorno: string;
}

const TONO_SALUD: Record<string, 'exito' | 'aviso' | 'error' | 'neutro'> = {
  HEALTHY: 'exito',
  DEGRADED: 'aviso',
  ERROR: 'error',
  // Credenciales correctas pero sin autorizar: no es un fallo, es un paso que
  // falta. Pintarlo de rojo mandaría a revisar unas claves que están bien.
  PENDING_AUTH: 'aviso',
  UNKNOWN: 'neutro',
};

/**
 * Qué ha pasado al volver de AliExpress.
 *
 * El proveedor nos devuelve al panel con el resultado en la URL, porque quien
 * vuelve es una persona con una pestaña abierta, no un programa esperando un
 * JSON.
 */
function leerRetornoDeAutorizacion(): { estado: string; motivo?: string } | null {
  if (typeof window === 'undefined') return null;

  const parametros = new URLSearchParams(window.location.search);
  const estado = parametros.get('autorizacion');
  if (!estado) return null;

  const motivo = parametros.get('motivo');
  return { estado, ...(motivo ? { motivo } : {}) };
}

export function Proveedores() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [editando, setEditando] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [credenciales, setCredenciales] = useState<Record<string, Record<string, string>>>({});
  const [nuevo, setNuevo] = useState({ key: 'mock', name: '', margen: 60, margenMinimo: 25 });
  // Se lee una sola vez y se limpia la URL: si se quedara, recargar la página
  // volvería a enseñar "autorizado correctamente" días después.
  const toast = useToast();
  const [retorno, setRetorno] = useState(leerRetornoDeAutorizacion);

  const proveedores = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => get<Proveedor[]>('/suppliers'),
    refetchInterval: 60_000,
  });

  const disponibles = useQuery({
    queryKey: ['proveedores', 'disponibles'],
    queryFn: () => get<ProveedorDisponible[]>('/suppliers/available'),
  });

  const refrescar = () => void qc.invalidateQueries({ queryKey: ['proveedores'] });

  useEffect(() => {
    if (!retorno) return;
    window.history.replaceState(null, '', window.location.pathname);
    // Al volver de autorizar, el estado guardado es el de antes.
    void qc.invalidateQueries({ queryKey: ['proveedores'] });
  }, [retorno, qc]);

  const crear = useMutation({
    mutationFn: (datos: unknown) => post('/suppliers', datos),
    onSuccess: () => {
      setCreando(false);
      setNuevo({ key: 'mock', name: '', margen: 60, margenMinimo: 25 });
      setCredenciales((c) => ({ ...c, nuevo: {} }));
      refrescar();
    },
  });

  const actualizar = useMutation({
    mutationFn: ({ id, cambios }: { id: string; cambios: unknown }) =>
      patch(`/suppliers/${id}`, cambios),
    onSuccess: refrescar,
  });

  const guardarCredenciales = useMutation({
    mutationFn: ({ id, valores }: { id: string; valores: Record<string, string> }) =>
      patch(`/suppliers/${id}/credentials`, { credentials: valores }),
    onSuccess: (_, { id }) => {
      // No se conservan en memoria del navegador una vez guardadas.
      setCredenciales((c) => ({ ...c, [id]: {} }));
      toast.exito(t('proveedores.credenciales_guardadas'));
      refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verificar = useMutation({
    mutationFn: (id: string) =>
      post<{ ok: boolean; mensaje?: string; autorizado?: boolean }>(`/suppliers/${id}/verify`),
    onSuccess: refrescar,
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Manda al titular a la pantalla de permisos de AliExpress.
   *
   * Se navega en la MISMA pestaña a propósito: en una ventana emergente, el
   * bloqueador del navegador la corta a menudo y el usuario no ve nada. Al
   * terminar, AliExpress devuelve a esta misma pantalla con el resultado.
   */
  const autorizar = useMutation({
    mutationFn: (id: string) => post<{ url: string }>(`/suppliers/${id}/oauth/start`),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    // Sin esto, cuando la API rechazaba la petición no pasaba absolutamente
    // nada: ni mensaje, ni navegación, ni pista. El botón parecía roto cuando
    // en realidad estaba contestando que faltaba el App Key.
    onError: (e: Error) => toast.error(e.message),
  });

  const sincronizar = useMutation({
    mutationFn: (id: string) => post(`/suppliers/${id}/sync`, { tipo: 'incremental' }),
    onSuccess: refrescar,
  });

  const eliminar = useMutation({
    mutationFn: (id: string) => del(`/suppliers/${id}`),
    onSuccess: refrescar,
  });

  if (proveedores.isLoading) return <Cargando />;
  if (proveedores.error)
    return <ErrorPanel error={proveedores.error} reintentar={() => void proveedores.refetch()} />;

  const items = proveedores.data ?? [];
  const catalogo = disponibles.data ?? [];
  const camposDe = (key: string) => catalogo.find((c) => c.key === key)?.camposCredenciales ?? [];
  const usaOauth = (key: string) => catalogo.find((c) => c.key === key)?.usaOauth === true;

  const cambiarCredencial = (id: string, campo: string, valor: string) => {
    setCredenciales((c) => ({ ...c, [id]: { ...c[id], [campo]: valor } }));
  };

  const errorGeneral = crear.error ?? actualizar.error ?? eliminar.error;

  return (
    <div>
      <Encabezado
        titulo={t('proveedores.titulo')}
        descripcion={t('proveedores.descripcion')}
        acciones={
          <>
            <Enlace a="/proveedores/aliexpress" className="btn btn-secundario text-sm">
              {t('proveedores.ver_documentacion')}
            </Enlace>
            <button
              type="button"
              className="btn btn-primario text-sm"
              onClick={() => setCreando((v) => !v)}
            >
              + {t('proveedores.anadir')}
            </button>
          </>
        }
      />

      {retorno && (
        <div
          role="status"
          className="mb-4 flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm"
          style={
            retorno.estado === 'ok'
              ? {
                  background: 'color-mix(in srgb, var(--exito) 12%, transparent)',
                  color: 'var(--exito)',
                }
              : {
                  background: 'color-mix(in srgb, var(--aviso) 14%, transparent)',
                  color: 'var(--aviso)',
                }
          }
        >
          <span>
            {retorno.estado === 'ok' && t('proveedores.oauth_ok')}
            {retorno.estado === 'cancelada' && t('proveedores.oauth_cancelada')}
            {retorno.estado === 'error' &&
              `${t('proveedores.oauth_error')}: ${retorno.motivo ?? ''}`}
          </span>
          <button
            type="button"
            onClick={() => setRetorno(null)}
            className="shrink-0 underline"
            aria-label={t('app.cerrar')}
          >
            ✕
          </button>
        </div>
      )}

      {errorGeneral && (
        <p
          role="alert"
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--error) 12%, transparent)',
            color: 'var(--error)',
          }}
        >
          {errorGeneral.message}
        </p>
      )}

      {creando && (
        <section className="panel mb-4 p-4">
          <h2 className="mb-3 font-medium">{t('proveedores.anadir')}</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">{t('proveedores.tipo')}</span>
              <select
                value={nuevo.key}
                onChange={(e) => setNuevo({ ...nuevo, key: e.target.value })}
                className="campo"
              >
                {catalogo.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">{t('proveedores.nombre')}</span>
              <input
                type="text"
                value={nuevo.name}
                onChange={(e) => setNuevo({ ...nuevo, name: e.target.value })}
                className="campo"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                {t('proveedores.margen_defecto')} (%)
              </span>
              <input
                type="number"
                min={0}
                max={99}
                value={nuevo.margen}
                onChange={(e) => setNuevo({ ...nuevo, margen: Number(e.target.value) })}
                className="campo"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                {t('proveedores.margen_minimo')} (%)
              </span>
              <input
                type="number"
                min={0}
                max={99}
                value={nuevo.margenMinimo}
                onChange={(e) => setNuevo({ ...nuevo, margenMinimo: Number(e.target.value) })}
                className="campo"
              />
            </label>
          </div>

          {/* Las credenciales se piden ya en el alta: un proveedor sin ellas no
              puede sincronizar ni recibir pedidos, y quedaría ahí sin servir. */}
          <div className="mt-3 space-y-3">
            {/* Los campos que se consiguen autorizando NO se piden aquí: en
                el momento del alta todavía no existen. Pedirlos invitaba a
                dejarlos en blanco —o peor, a escribir el App Key en el
                recuadro equivocado— y el alta se guardaba igual. */}
            {camposDe(nuevo.key)
              .filter((campo) => !campo.porOauth)
              .map((campo) => (
                <label key={campo.clave} className="block">
                  <span className="mb-1 block text-sm font-medium">
                    {campo.etiqueta}
                    {!campo.opcional && (
                      <>
                        {' '}
                        <span aria-hidden="true" style={{ color: 'var(--error)' }}>
                          *
                        </span>
                      </>
                    )}
                  </span>
                  {campo.opciones ? (
                    // Lo que solo admite unos pocos valores se elige, no se
                    // escribe: la dirección de una pasarela mal tecleada da un
                    // error de red que parece del proveedor.
                    <select
                      className="campo"
                      value={credenciales['nuevo']?.[campo.clave] ?? campo.porDefecto ?? ''}
                      onChange={(e) => cambiarCredencial('nuevo', campo.clave, e.target.value)}
                    >
                      {campo.opciones.map((o) => (
                        <option key={o.valor} value={o.valor}>
                          {o.etiqueta}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={campo.secreto ? 'password' : 'text'}
                      autoComplete="off"
                      required={!campo.opcional}
                      value={credenciales['nuevo']?.[campo.clave] ?? ''}
                      onChange={(e) => cambiarCredencial('nuevo', campo.clave, e.target.value)}
                      className="campo"
                    />
                  )}
                  {campo.ayuda && <span className="ayuda-campo">{campo.ayuda}</span>}
                </label>
              ))}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn btn-primario text-sm"
              disabled={crear.isPending || nuevo.name.trim().length < 2}
              onClick={() =>
                crear.mutate({
                  key: nuevo.key,
                  name: nuevo.name.trim(),
                  defaultMarginPct: nuevo.margen,
                  minMarginPct: nuevo.margenMinimo,
                  ...(Object.keys(credenciales['nuevo'] ?? {}).length > 0
                    ? { credentials: credenciales['nuevo'] }
                    : {}),
                })
              }
            >
              {t('app.guardar')}
            </button>
            <button
              type="button"
              className="btn btn-fantasma text-sm"
              onClick={() => setCreando(false)}
            >
              {t('app.cancelar')}
            </button>
          </div>
        </section>
      )}

      {items.length === 0 ? (
        <Vacio titulo={t('app.sin_datos')} descripcion={t('proveedores.sin_proveedores_ayuda')} />
      ) : (
        <div className="fichas fichas-anchas">
          {items.map((p) => (
            <article key={p.id} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{p.name}</h2>
                    <Etiqueta texto={p.key} />
                    <Etiqueta texto={p.salud} tono={TONO_SALUD[p.salud] ?? 'neutro'} />
                    {!p.isActive && <Etiqueta texto={t('equipo.inactivo')} tono="neutro" />}
                    {p.credencialesConfiguradas ? (
                      <Etiqueta texto={t('proveedores.con_credenciales')} tono="exito" />
                    ) : (
                      <Etiqueta texto={t('proveedores.sin_credenciales')} tono="aviso" />
                    )}
                  </div>

                  <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {p.productos} {t('proveedores.productos').toLowerCase()} · {p.pedidos}{' '}
                    {t('proveedores.pedidos').toLowerCase()} · {t('proveedores.margen_defecto')}{' '}
                    {p.margenPorDefecto}% · {t('proveedores.margen_minimo')} {p.margenMinimo}%
                  </p>

                  <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {t('proveedores.ultima_sync')}:{' '}
                    {p.ultimaSync ? fechaRelativa(p.ultimaSync) : t('app.ninguno')}
                    {p.ultimaSyncEstado ? ` · ${p.ultimaSyncEstado}` : ''}
                  </p>

                  {p.erroresConsecutivos > 0 && (
                    <p className="mt-1 text-xs" style={{ color: 'var(--error)' }}>
                      {p.erroresConsecutivos} errores consecutivos
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEditando(editando === p.id ? null : p.id)}
                    className="btn btn-secundario text-xs"
                  >
                    {t('proveedores.configurar')}
                  </button>
                  <button
                    type="button"
                    onClick={() => verificar.mutate(p.id)}
                    disabled={verificar.isPending || !p.credencialesConfiguradas}
                    className="btn btn-secundario text-xs"
                  >
                    {t('proveedores.verificar')}
                  </button>
                  <button
                    type="button"
                    onClick={() => sincronizar.mutate(p.id)}
                    disabled={sincronizar.isPending || !p.credencialesConfiguradas}
                    className="btn btn-primario text-xs"
                  >
                    {sincronizar.isPending && sincronizar.variables === p.id
                      ? t('proveedores.sincronizando')
                      : t('proveedores.sincronizar')}
                  </button>
                </div>
              </div>

              {verificar.data && verificar.variables === p.id && (
                <p
                  className="mt-2 text-xs"
                  style={{ color: verificar.data.ok ? 'var(--exito)' : 'var(--error)' }}
                >
                  {verificar.data.ok
                    ? t('proveedores.credenciales_ok')
                    : (verificar.data.mensaje ?? t('proveedores.credenciales_mal'))}
                </p>
              )}

              {/* Siempre visible, no dentro de "Configurar": mientras falte
                  autorizar no se puede importar ni pedir nada, así que es LA
                  acción pendiente de esa tarjeta y esconderla tras un
                  desplegable la hace invisible. */}
              <BloqueAutorizacion
                proveedorId={p.id}
                autorizando={autorizar.isPending}
                onAutorizar={() => autorizar.mutate(p.id)}
              />

              {/* Y su equivalente para los que no tienen API: sin catálogo
                  subido no se puede buscar ni importar nada de ellos. */}
              {disponibles.data?.find((d) => d.key === p.key)?.catalogoPorFichero && (
                <BloqueCatalogo proveedorId={p.id} />
              )}

              {editando === p.id && (
                <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--borde)' }}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">
                        {t('proveedores.margen_defecto')} (%)
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={99}
                        defaultValue={p.margenPorDefecto}
                        onBlur={(e) =>
                          actualizar.mutate({
                            id: p.id,
                            cambios: { defaultMarginPct: Number(e.target.value) },
                          })
                        }
                        className="campo"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">
                        {t('proveedores.margen_minimo')} (%)
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={99}
                        defaultValue={p.margenMinimo}
                        onBlur={(e) =>
                          actualizar.mutate({
                            id: p.id,
                            cambios: { minMarginPct: Number(e.target.value) },
                          })
                        }
                        className="campo"
                      />
                    </label>

                    {/*
                      Los dos cargos que el proveedor añade AL PAGAR y su API
                      no menciona. Van juntos y justo debajo de los márgenes
                      porque son lo que decide si ese margen existe: un pedido
                      real cotizado a 13,99 € se cobró a 16,89 €.
                    */}
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">
                        {t('proveedores.recargo_compra')} (%)
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        defaultValue={p.recargoCompraPct}
                        aria-describedby={`recargo-${p.id}`}
                        onBlur={(e) =>
                          actualizar.mutate({
                            id: p.id,
                            cambios: { purchaseSurchargePct: Number(e.target.value) },
                          })
                        }
                        className="campo"
                      />
                      <span
                        id={`recargo-${p.id}`}
                        className="mt-1 block text-xs"
                        style={{ color: 'var(--texto-tenue)' }}
                      >
                        {t('proveedores.recargo_compra_ayuda')}
                      </span>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">
                        {t('proveedores.cargo_fijo')} (€)
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        defaultValue={p.cargoFijoCents / 100}
                        aria-describedby={`cargo-${p.id}`}
                        onBlur={(e) =>
                          actualizar.mutate({
                            id: p.id,
                            cambios: {
                              importFeeCents: Math.round(Number(e.target.value) * 100),
                            },
                          })
                        }
                        className="campo"
                      />
                      <span
                        id={`cargo-${p.id}`}
                        className="mt-1 block text-xs"
                        style={{ color: 'var(--texto-tenue)' }}
                      >
                        {t('proveedores.cargo_fijo_ayuda', {
                          umbral: (p.cargoFijoUmbralCents / 100).toFixed(0),
                        })}
                      </span>
                    </label>

                    {/*
                      Portes que el proveedor cobra por PEDIDO, no por artículo.
                      Es el caso de quien sirve desde su almacén con una tarifa
                      de envío: repercutirlo en cada línea subiría todos los PVP
                      en el importe entero del porte.
                    */}
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">
                        {t('proveedores.portes_pedido')} (€)
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        defaultValue={p.portesPedidoCents / 100}
                        aria-describedby={`portes-${p.id}`}
                        onBlur={(e) =>
                          actualizar.mutate({
                            id: p.id,
                            cambios: {
                              orderShippingCents: Math.round(Number(e.target.value) * 100),
                            },
                          })
                        }
                        className="campo"
                      />
                      <span
                        id={`portes-${p.id}`}
                        className="mt-1 block text-xs"
                        style={{ color: 'var(--texto-tenue)' }}
                      >
                        {t('proveedores.portes_pedido_ayuda')}
                      </span>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">
                        {t('proveedores.portes_gratis_desde')} (€)
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={p.portesGratisDesdeCents / 100}
                        aria-describedby={`portes-gratis-${p.id}`}
                        onBlur={(e) =>
                          actualizar.mutate({
                            id: p.id,
                            cambios: {
                              freeShippingThresholdCents: Math.round(Number(e.target.value) * 100),
                            },
                          })
                        }
                        className="campo"
                      />
                      <span
                        id={`portes-gratis-${p.id}`}
                        className="mt-1 block text-xs"
                        style={{ color: 'var(--texto-tenue)' }}
                      >
                        {t('proveedores.portes_gratis_ayuda')}
                      </span>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">
                        {t('proveedores.prioridad')}
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={p.priority}
                        onBlur={(e) =>
                          actualizar.mutate({
                            id: p.id,
                            cambios: { priority: Number(e.target.value) },
                          })
                        }
                        className="campo"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">
                        {t('proveedores.pais_origen')}
                      </span>
                      <input
                        type="text"
                        maxLength={2}
                        defaultValue={p.paisOrigen}
                        onBlur={(e) => {
                          const pais = e.target.value.trim().toUpperCase();
                          if (pais.length === 2 && pais !== p.paisOrigen) {
                            actualizar.mutate({ id: p.id, cambios: { shipsFromCountry: pais } });
                          } else {
                            e.target.value = p.paisOrigen;
                          }
                        }}
                        className="campo font-mono uppercase"
                      />
                      <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
                        {t('proveedores.pais_origen_ayuda')}
                      </span>
                    </label>
                  </div>

                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={p.isActive}
                      onChange={(e) =>
                        actualizar.mutate({ id: p.id, cambios: { isActive: e.target.checked } })
                      }
                    />
                    {t('proveedores.activo')}
                  </label>

                  {/* Credenciales: se escriben encima; en blanco se conservan. */}
                  <div className="mt-4 space-y-3">
                    <h3 className="text-sm font-semibold">{t('proveedores.credenciales')}</h3>

                    {/* Los campos que llegan por OAuth no se piden: no existen
                        hasta que alguien autoriza, y ponerlos aquí invitaba a
                        pegar a mano un token que el sistema renueva solo. */}
                    {camposDe(p.key)
                      .filter((campo) => !campo.porOauth)
                      .map((campo) => (
                        <label key={campo.clave} className="block">
                          <span className="mb-1 block text-sm font-medium">{campo.etiqueta}</span>
                          {campo.opciones ? (
                            <select
                              value={credenciales[p.id]?.[campo.clave] ?? campo.porDefecto ?? ''}
                              onChange={(e) => cambiarCredencial(p.id, campo.clave, e.target.value)}
                              className="campo"
                            >
                              {campo.opciones.map((o) => (
                                <option key={o.valor} value={o.valor}>
                                  {o.etiqueta}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={campo.secreto ? 'password' : 'text'}
                              autoComplete="off"
                              placeholder={
                                p.credencialesConfiguradas
                                  ? t('proveedores.dejar_vacio')
                                  : t('proveedores.sin_configurar')
                              }
                              value={credenciales[p.id]?.[campo.clave] ?? ''}
                              onChange={(e) => cambiarCredencial(p.id, campo.clave, e.target.value)}
                              className="campo"
                            />
                          )}
                          {campo.ayuda && (
                            <span
                              className="mt-1 block text-xs"
                              style={{ color: 'var(--texto-tenue)' }}
                            >
                              {campo.ayuda}
                            </span>
                          )}
                        </label>
                      ))}

                    {usaOauth(p.key) && (
                      <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                        {t('proveedores.oauth_por_oauth')}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-secundario text-sm"
                        disabled={
                          guardarCredenciales.isPending ||
                          Object.values(credenciales[p.id] ?? {}).every((v) => !v)
                        }
                        onClick={() =>
                          guardarCredenciales.mutate({
                            id: p.id,
                            valores: credenciales[p.id] ?? {},
                          })
                        }
                      >
                        {t('proveedores.guardar_credenciales')}
                      </button>

                      <button
                        type="button"
                        className="btn btn-fantasma text-sm"
                        style={{ color: 'var(--error)' }}
                        disabled={eliminar.isPending || p.pedidos > 0}
                        title={p.pedidos > 0 ? t('proveedores.no_borrable') : undefined}
                        onClick={() => eliminar.mutate(p.id)}
                      >
                        {t('app.eliminar')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Estado de autorización de un proveedor que usa OAuth.
 *
 * Va en su propio componente con su propia consulta porque el estado no está en
 * el listado: incluye cuándo caduca el acceso y qué cuenta lo concedió, datos
 * que hay que descifrar de las credenciales y que no tiene sentido devolver
 * para todos los proveedores en cada refresco de la lista.
 */
/**
 * El catálogo de un proveedor SIN API.
 *
 * Dreamlove no tiene endpoints: manda un XML de unos 340 MB y esa es la
 * integración entera. Este bloque es, para ese proveedor, lo que la
 * autorización es para AliExpress: la acción que lo desbloquea. Sin catálogo
 * subido no se puede buscar ni importar nada, así que se enseña siempre y no
 * escondido tras «Configurar».
 */
function BloqueCatalogo({ proveedorId }: { proveedorId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();

  const [porcentaje, setPorcentaje] = useState<number | null>(null);
  /** Estado de la última importación visto en la vuelta anterior. */
  const estadoPrevio = useRef<string | null>(null);

  const historial = useQuery({
    queryKey: ['proveedores', proveedorId, 'catalogo', 'historial'],
    queryFn: async () => {
      const filas = await get<ImportacionCatalogo[]>(
        `/suppliers/${proveedorId}/catalog-file/history`,
      );

      // Al terminar una importación cambia si el proveedor está listo y cuántos
      // productos tiene, y eso lo pinta la tarjeta de fuera. Se refresca justo
      // en la transición y no en cada vuelta, que serían dos peticiones cada
      // dos segundos durante todo el procesado.
      const ahora = filas[0]?.status ?? null;
      if (estadoPrevio.current === 'RUNNING' && ahora !== 'RUNNING') {
        void qc.invalidateQueries({ queryKey: ['proveedores'] });
      }
      estadoPrevio.current = ahora;

      return filas;
    },
    /*
     * Mientras haya una importación en curso, se pregunta cada dos segundos.
     *
     * El procesado va por detrás de la subida —escribir 12.913 artículos tarda
     * más de lo que aguanta una petición HTTP—, así que el estado real está en
     * la fila y no en esta pantalla. Derivarlo de ahí en vez de guardarlo aquí
     * hace además que recargar la página en mitad del proceso siga enseñando
     * lo que está pasando.
     */
    refetchInterval: (consulta) => (consulta.state.data?.[0]?.status === 'RUNNING' ? 2000 : false),
  });

  const ultima = historial.data?.[0];
  const procesando = ultima?.status === 'RUNNING';

  const estado = useQuery({
    queryKey: ['proveedores', proveedorId, 'catalogo'],
    queryFn: () => get<EstadoCatalogo>(`/suppliers/${proveedorId}/catalog-file/status`),
    // Mientras se procesa el fichero, los números cambian solos.
    refetchInterval: procesando ? 2000 : false,
  });

  const subir = async (fichero: File): Promise<void> => {
    setPorcentaje(0);
    try {
      await subirFichero(`/suppliers/${proveedorId}/catalog/upload`, fichero, {
        alProgresar: setPorcentaje,
      });
      // La fila de la importación ya existe cuando responde la subida: en
      // cuanto se relea el historial, la pantalla pasa sola a «procesando».
      estadoPrevio.current = 'RUNNING';
      await historial.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se ha podido subir el catálogo');
    } finally {
      setPorcentaje(null);
    }
  };

  const datos = estado.data;
  const sinCatalogo = (datos?.articulos ?? 0) === 0;

  return (
    <section
      className="mt-4 rounded-lg border p-4"
      style={{
        // Sin catálogo la tarjeta pide atención: es lo único que desbloquea a
        // este proveedor, igual que autorizar desbloquea a los que sí tienen API.
        borderColor: sinCatalogo ? 'var(--aviso)' : 'var(--borde)',
        background: sinCatalogo
          ? 'color-mix(in srgb, var(--aviso) 8%, transparent)'
          : 'transparent',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('proveedores.catalogo_fichero')}</h3>
        <Etiqueta
          texto={sinCatalogo ? t('proveedores.sin_catalogo') : t('proveedores.con_catalogo')}
          tono={sinCatalogo ? 'aviso' : 'exito'}
        />
      </div>

      <p className="mt-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {t('proveedores.catalogo_fichero_ayuda')}
      </p>

      {datos && !sinCatalogo && (
        <p className="mt-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
          <strong>{datos.articulos.toLocaleString('es-ES')}</strong>{' '}
          {t('proveedores.catalogo_articulos')} ·{' '}
          <strong>{datos.productos.toLocaleString('es-ES')}</strong>{' '}
          {t('proveedores.catalogo_productos')} · {datos.disponibles.toLocaleString('es-ES')}{' '}
          {t('proveedores.catalogo_disponibles')}
          {datos.retirados > 0 && ` · ${datos.retirados} ${t('proveedores.catalogo_retirados')}`}
          {datos.ultimaImportacion?.finishedAt &&
            ` · ${t('proveedores.catalogo_actualizado')} ${fechaRelativa(datos.ultimaImportacion.finishedAt)}`}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="btn btn-secundario cursor-pointer text-sm">
          {t('proveedores.catalogo_elegir')}
          <input
            type="file"
            // El ZIP primero porque es como lo mandan; los otros dos por si
            // alguien lo descomprime antes. Comprimido pesa una sexta parte, y
            // subir 60 MB por el navegador es mucho menos frágil que subir 340.
            accept=".zip,.xml,.gz,application/zip,application/xml,text/xml,application/gzip"
            className="hidden"
            disabled={porcentaje !== null || procesando}
            onChange={(e) => {
              const fichero = e.target.files?.[0];
              // Se limpia el input para poder volver a elegir el MISMO fichero
              // después de un fallo; si no, el navegador no dispara el cambio.
              e.target.value = '';
              if (fichero) void subir(fichero);
            }}
          />
        </label>

        {porcentaje !== null && !procesando && (
          <span className="text-xs tabular-nums" style={{ color: 'var(--texto-tenue)' }}>
            {t('proveedores.catalogo_subiendo')} {porcentaje}%
          </span>
        )}

        {procesando && (
          <span className="text-xs" style={{ color: 'var(--info)' }}>
            {t('proveedores.catalogo_procesando')}
          </span>
        )}
      </div>

      {/* El resultado del último catálogo, escrito y no en un aviso que se va
          solo: si la importación ha fallado a las tres de la mañana, alguien
          tiene que poder verlo por la mañana. */}
      {ultima?.status === 'FAILED' && (
        <p className="mt-2 text-xs" style={{ color: 'var(--error)' }}>
          {ultima.errorDetail ?? t('app.error')}
        </p>
      )}

      {ultima?.status === 'COMPLETED' && (
        <p className="mt-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {ultima.itemsCreated} {t('proveedores.catalogo_nuevos')} · {ultima.itemsUpdated}{' '}
          {t('proveedores.catalogo_actualizados')} · {ultima.itemsRemoved}{' '}
          {t('proveedores.catalogo_retirados')} · {ultima.priceChanges}{' '}
          {t('proveedores.catalogo_cambios_precio')}
        </p>
      )}

      {!sinCatalogo && <CategoriasDelProveedor proveedorId={proveedorId} />}

      {!sinCatalogo && (
        <ImportacionDelCatalogo proveedorId={proveedorId} familias={datos?.productos ?? 0} />
      )}

      {(historial.data?.length ?? 0) > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('proveedores.catalogo_historial')}
          </summary>
          <ul className="mt-2 space-y-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {(historial.data ?? []).map((i) => (
              <li key={i.id} className="flex flex-wrap gap-x-2">
                <span>{fechaRelativa(i.startedAt)}</span>
                <span>·</span>
                <span style={{ color: i.status === 'FAILED' ? 'var(--error)' : undefined }}>
                  {i.status === 'FAILED'
                    ? (i.errorDetail ?? t('app.error'))
                    : `${i.itemsRead} art. · ${i.itemsCreated} nuevos · ${i.itemsUpdated} act. · ${i.itemsRemoved} retirados · ${i.priceChanges} precios`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Una pasada del botón que sube el catálogo entero a la tienda. */
interface ImportacionMasiva {
  id: string;
  status: 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  total: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  imagesImported: number;
  /** Variantes con el precio tal cual lo recomienda el proveedor. */
  pricedFromRrp: number;
  /** Publicadas a su precio, pero por debajo del margen mínimo: a revisar. */
  belowMinMargin: number;
  /** Precios que se han dejado como estaban porque no se pidió repreciar. */
  pricesKept: number;
  /** Las que no traían PVPR y se han calculado con el margen de siempre. */
  pricedByMargin: number;
  /** Colores o tallas nuevos en productos que ya existían; no se crean solos. */
  newVariants: number;
  currentLabel: string | null;
  failures: { referencia: string; motivo: string }[];
  errorDetail: string | null;
  cancelRequested: boolean;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

/**
 * El botón que convierte el catálogo del proveedor en productos de la tienda.
 *
 * Son dos cosas distintas y hasta ahora solo estaba la primera: procesar el
 * fichero deja el catálogo del proveedor guardado, pero no pone ni un producto
 * a la venta. Eso había que hacerlo artículo por artículo desde el buscador, y
 * con 945 familias significa que la tienda no se llena nunca.
 *
 * La pantalla es casi toda progreso a propósito. Una pasada completa con fotos
 * pasa de la hora, y un botón que se queda pensando una hora sin decir nada es
 * indistinguible de uno roto: se enseña por dónde va, qué está creando ahora
 * mismo y qué ha salido mal, y se puede parar sin perder lo hecho.
 */
function ImportacionDelCatalogo({
  proveedorId,
  familias,
}: {
  proveedorId: string;
  familias: number;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();

  const [publicar, setPublicar] = useState(true);
  const [descargarImagenes, setDescargarImagenes] = useState(true);
  /**
   * Repreciar lo que ya está importado.
   *
   * Encendido por defecto, que es la regla de la casa: el precio lo pone el
   * proveedor. Se apaga para arreglar categorías, marcas o existencias sin
   * mover el escaparate en mitad de una campaña.
   */
  const [actualizarPrecios, setActualizarPrecios] = useState(true);
  /** Estado visto en la vuelta anterior, para refrescar justo al terminar. */
  const estadoPrevio = useRef<string | null>(null);

  const trabajo = useQuery({
    queryKey: ['proveedores', proveedorId, 'importacion-masiva'],
    queryFn: async () => {
      const fila = await get<ImportacionMasiva | null>(
        `/suppliers/${proveedorId}/catalog-file/import-all/status`,
      );

      // Al terminar hay productos nuevos en la tienda: lo que los cuenta está
      // fuera de este bloque. Se refresca en la transición y no en cada vuelta.
      const ahora = fila?.status ?? null;
      if (estadoPrevio.current === 'RUNNING' && ahora !== 'RUNNING') {
        void qc.invalidateQueries({ queryKey: ['proveedores'] });
        void qc.invalidateQueries({ queryKey: ['productos'] });
      }
      estadoPrevio.current = ahora;

      return fila;
    },
    /*
     * Cada segundo y medio mientras corre.
     *
     * El trabajo va por detrás de la petición, así que el estado real está en
     * su fila y no en esta pantalla: derivarlo de ahí hace que recargar el
     * navegador —o abrirlo en otro sitio— siga enseñando lo que está pasando.
     */
    refetchInterval: (consulta) => (consulta.state.data?.status === 'RUNNING' ? 1500 : false),
  });

  const lanzar = useMutation({
    mutationFn: (limite?: number) =>
      post(`/suppliers/${proveedorId}/catalog-file/import-all`, {
        precio: 'pvpr',
        publicar,
        actualizarPrecios,
        descargarImagenes,
        ...(limite ? { limite } : {}),
      }),
    onSuccess: () => {
      // La fila ya existe cuando responde: en cuanto se relea, la pantalla
      // pasa sola a «importando».
      estadoPrevio.current = 'RUNNING';
      toast.exito(t('proveedores.masiva_lanzada'));
      void trabajo.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelar = useMutation({
    mutationFn: () => post(`/suppliers/${proveedorId}/catalog-file/import-all/cancel`),
    onSuccess: () => void trabajo.refetch(),
    onError: (e: Error) => toast.error(e.message),
  });

  const t_ = trabajo.data;
  const corriendo = t_?.status === 'RUNNING';
  const nunca = !t_;

  const minutos = t_?.durationMs ? Math.max(1, Math.round(t_.durationMs / 60_000)) : 0;

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--borde)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{t('proveedores.masiva_titulo')}</h4>
        {corriendo && <Etiqueta texto={t('proveedores.masiva_en_curso')} tono="info" />}
      </div>

      <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {t('proveedores.masiva_ayuda')}
      </p>

      {corriendo ? (
        <div className="mt-3">
          <Progreso
            valor={t_.processed}
            maximo={Math.max(1, t_.total)}
            etiqueta={t('proveedores.masiva_titulo')}
          />

          <p className="mt-2 text-xs tabular-nums" style={{ color: 'var(--texto-tenue)' }}>
            {t('proveedores.masiva_progreso', {
              hechos: t_.processed.toLocaleString('es-ES'),
              total: t_.total.toLocaleString('es-ES'),
            })}
            {' · '}
            {t_.created} {t('proveedores.masiva_creados')} · {t_.updated}{' '}
            {t('proveedores.masiva_actualizados')}
            {t_.errors > 0 && (
              <span style={{ color: 'var(--error)' }}>
                {' · '}
                {t_.errors} {t('proveedores.masiva_errores')}
              </span>
            )}
          </p>

          {/* Qué está creando AHORA. Es lo que convierte una barra que avanza
              sola en algo que se puede seguir: sin esto, un tramo lento parece
              un cuelgue y alguien acaba recargando o cancelando. */}
          {t_.currentLabel && (
            <p className="mt-1 truncate text-xs" style={{ color: 'var(--texto-suave)' }}>
              {t_.currentLabel}
            </p>
          )}

          <button
            type="button"
            className="btn btn-secundario mt-3 text-xs"
            disabled={cancelar.isPending || t_.cancelRequested}
            onClick={() => cancelar.mutate()}
          >
            {t_.cancelRequested
              ? t('proveedores.masiva_cancelando')
              : t('proveedores.masiva_cancelar')}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={publicar}
                onChange={(e) => setPublicar(e.target.checked)}
              />
              {t('proveedores.masiva_publicar')}
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={descargarImagenes}
                onChange={(e) => setDescargarImagenes(e.target.checked)}
              />
              {t('proveedores.masiva_imagenes')}
            </label>

            {/* Solo afecta a lo que ya existe: lo que se cree entra con el
                precio del proveedor de todas formas, porque ahí no hay ningún
                precio puesto que respetar. */}
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={actualizarPrecios}
                onChange={(e) => setActualizarPrecios(e.target.checked)}
              />
              {t('proveedores.masiva_actualizar_precios')}
            </label>
          </div>

          <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('proveedores.masiva_imagenes_ayuda')}
          </p>

          <p
            className="mt-1 text-xs"
            style={{ color: actualizarPrecios ? 'var(--texto-tenue)' : 'var(--aviso)' }}
          >
            {actualizarPrecios
              ? t('proveedores.masiva_actualizar_precios_ayuda')
              : t('proveedores.masiva_precios_congelados_ayuda')}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primario text-sm"
              disabled={lanzar.isPending || familias === 0}
              onClick={() => lanzar.mutate(undefined)}
            >
              {nunca
                ? t('proveedores.masiva_importar', { n: familias.toLocaleString('es-ES') })
                : t('proveedores.masiva_repetir', { n: familias.toLocaleString('es-ES') })}
            </button>

            {/* Antes de soltar mil productos con sus fotos conviene ver qué
                pinta tienen veinte. Cuesta un minuto y evita descubrir con la
                tienda llena que la categoría o el precio no eran los buenos. */}
            <button
              type="button"
              className="btn btn-secundario text-sm"
              disabled={lanzar.isPending || familias === 0}
              onClick={() => lanzar.mutate(20)}
            >
              {t('proveedores.masiva_probar')}
            </button>
          </div>
        </>
      )}

      {/* El resultado se queda escrito. Si la pasada terminó de madrugada,
          alguien tiene que poder ver por la mañana qué pasó. */}
      {t_ && !corriendo && (
        <div className="mt-3 text-xs" style={{ color: 'var(--texto-tenue)' }}>
          <p style={{ color: t_.status === 'FAILED' ? 'var(--error)' : undefined }}>
            {t_.status === 'COMPLETED' && t('proveedores.masiva_terminada')}
            {t_.status === 'CANCELLED' && t('proveedores.masiva_cancelada')}
            {t_.status === 'FAILED' &&
              `${t('proveedores.masiva_fallida')}: ${t_.errorDetail ?? ''}`}
            {' · '}
            {t_.created} {t('proveedores.masiva_creados')} · {t_.updated}{' '}
            {t('proveedores.masiva_actualizados')} · {t_.skipped} {t('proveedores.masiva_saltados')}{' '}
            · {t_.errors} {t('proveedores.masiva_errores')}
            {t_.imagesImported > 0 &&
              ` · ${t_.imagesImported.toLocaleString('es-ES')} ${t('proveedores.masiva_fotos')}`}
            {minutos > 0 && ` · ${t('proveedores.masiva_duracion', { n: String(minutos) })}`}
          </p>

          {/* De dónde ha salido cada precio, y cuántos hay que mirar. Lo
              segundo no es un fallo de la importación: son artículos que a su
              propio PVP dejan poco, y eso se arregla dejando de venderlos, no
              subiéndoles el precio hasta sacarlos del mercado. */}
          <p className="mt-1">
            {t_.pricedFromRrp.toLocaleString('es-ES')} {t('proveedores.masiva_precio_pvpr')}
            {t_.pricedByMargin > 0 &&
              ` · ${t_.pricedByMargin.toLocaleString('es-ES')} ${t('proveedores.masiva_precio_margen')}`}
          </p>

          {t_.belowMinMargin > 0 && (
            <p className="mt-1" style={{ color: 'var(--aviso)' }}>
              {t('proveedores.masiva_bajo_minimo', {
                n: t_.belowMinMargin.toLocaleString('es-ES'),
              })}
            </p>
          )}

          {/* La prueba de que el interruptor hizo caso. Sin una cifra, «no
              toques los precios» en una pasada de una hora es un botón en el
              que hay que creer. */}
          {t_.pricesKept > 0 && (
            <p className="mt-1">
              {t('proveedores.masiva_precios_respetados', {
                n: t_.pricesKept.toLocaleString('es-ES'),
              })}
            </p>
          )}

          {/* Lo que esto NO hace, dicho: un color que el proveedor añade a un
              producto que ya vendemos no se da de alta solo, porque tocar las
              opciones de una ficha viva a ciegas la deja a medias. */}
          {t_.newVariants > 0 && (
            <p className="mt-1" style={{ color: 'var(--aviso)' }}>
              {t('proveedores.masiva_variantes_nuevas', { n: String(t_.newVariants) })}
            </p>
          )}

          {t_.failures.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer">
                {t('proveedores.masiva_fallos', { n: String(t_.errors) })}
              </summary>
              <ul className="mt-1 space-y-0.5">
                {t_.failures.map((f) => (
                  <li key={`${f.referencia}-${f.motivo}`}>
                    <span className="font-medium">{f.referencia}</span>: {f.motivo}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/** Lo que devuelve el árbol de categorías del proveedor. */
interface CategoriasProveedor {
  total: number;
  enlazadas: number;
  articulos: number;
  ramas: {
    path: string;
    nombre: string;
    profundidad: number;
    articulos: number;
    categoryId: string | null;
  }[];
}

/**
 * Las categorías del proveedor, creadas de una vez.
 *
 * El catálogo trae su propia clasificación —311 ramas en el de Dreamlove, con
 * nombre en español— y hasta ahora se tiraba: al importar un producto había
 * que elegirle la categoría a mano, así que entraban sin ella y la tienda no
 * se podía navegar.
 *
 * Se crean todas de golpe y desde ese momento cada producto importado va sola
 * a la suya. Las que se queden vacías no se enseñan en la tienda, así que
 * crear el árbol entero no llena el menú de secciones sin nada dentro.
 */
function CategoriasDelProveedor({ proveedorId }: { proveedorId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();

  const categorias = useQuery({
    queryKey: ['proveedores', proveedorId, 'categorias'],
    queryFn: () => get<CategoriasProveedor>(`/suppliers/${proveedorId}/categories`),
  });

  const crear = useMutation({
    mutationFn: () =>
      post<{
        creadas: number;
        reutilizadas: number;
        yaEnlazadas: number;
        fallidas: { path: string; motivo: string }[];
      }>(`/suppliers/${proveedorId}/categories/sync`),
    onSuccess: (r) => {
      toast.exito(t('proveedores.categorias_creadas', { n: String(r.creadas + r.reutilizadas) }));
      // Las categorías nuevas salen en los desplegables de todo el panel.
      void qc.invalidateQueries({ queryKey: ['proveedores', proveedorId, 'categorias'] });
      void qc.invalidateQueries({ queryKey: ['categorias'] });

      // Un fallo no es un aviso que se va solo: se dice cuál y por qué.
      for (const f of r.fallidas.slice(0, 3)) toast.error(`${f.path}: ${f.motivo}`);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : t('app.error')),
  });

  const datos = categorias.data;
  if (!datos || datos.total === 0) return null;

  const faltan = datos.total - datos.enlazadas;

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--borde)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
          <strong>{datos.total.toLocaleString('es-ES')}</strong>{' '}
          {t('proveedores.categorias_del_proveedor')} · {datos.enlazadas.toLocaleString('es-ES')}{' '}
          {t('proveedores.categorias_creadas_ya')}
        </p>

        <button
          type="button"
          className="btn btn-secundario text-sm"
          disabled={faltan === 0 || crear.isPending}
          onClick={() => crear.mutate()}
        >
          {crear.isPending
            ? t('app.guardar')
            : faltan === 0
              ? t('proveedores.categorias_al_dia')
              : t('proveedores.categorias_crear', { n: String(faltan) })}
        </button>
      </div>

      {/* Las más pobladas, para poder decidir sin abrir el catálogo: son las
          que de verdad van a tener producto si se importan. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {t('proveedores.categorias_ver')}
        </summary>
        <ul className="mt-2 space-y-0.5 text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {[...datos.ramas]
            .sort((a, b) => b.articulos - a.articulos)
            .slice(0, 15)
            .map((r) => (
              <li key={r.path} className="flex justify-between gap-3">
                {/* Sangrado por nivel con margen y no con puntos: los puntos
                    se confundían con la marca de «sin crear» y la lista se
                    volvía ilegible. */}
                <span
                  className="truncate"
                  style={{ marginLeft: `${String((r.profundidad - 1) * 0.75)}rem` }}
                >
                  {r.nombre}
                  {r.categoryId === null && (
                    <span style={{ color: 'var(--aviso)' }}>
                      {' '}
                      {t('proveedores.categorias_nueva')}
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums">{r.articulos.toLocaleString('es-ES')}</span>
              </li>
            ))}
        </ul>
      </details>
    </div>
  );
}

function BloqueAutorizacion({
  proveedorId,
  onAutorizar,
  autorizando,
}: {
  proveedorId: string;
  onAutorizar: () => void;
  autorizando: boolean;
}) {
  const { t } = useTranslation();
  const [copiada, setCopiada] = useState(false);

  const estado = useQuery({
    queryKey: ['proveedores', proveedorId, 'oauth'],
    queryFn: () => get<EstadoAutorizacion>(`/suppliers/${proveedorId}/oauth/status`),
  });

  if (!estado.data?.usaOauth) return null;

  const { autorizado, caducaEl, cuenta, urlDeRetorno } = estado.data;

  const copiar = () => {
    void navigator.clipboard.writeText(urlDeRetorno).then(() => {
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    });
  };

  return (
    <section
      className="mt-4 rounded-lg border p-4"
      style={{
        // Sin autorizar, la tarjeta pide atención: es la única acción que
        // desbloquea el proveedor y sin ella no se puede importar nada.
        borderColor: autorizado ? 'var(--borde)' : 'var(--aviso)',
        background: autorizado ? 'transparent' : 'color-mix(in srgb, var(--aviso) 8%, transparent)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('proveedores.autorizacion')}</h3>
        <Etiqueta
          texto={autorizado ? t('proveedores.autorizado') : t('proveedores.sin_autorizar')}
          tono={autorizado ? 'exito' : 'aviso'}
        />
      </div>

      {autorizado ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {cuenta ? `${t('proveedores.autorizado_por')} ${cuenta} · ` : ''}
          {caducaEl ? `${t('proveedores.autorizado_hasta')} ${fechaRelativa(caducaEl)}` : ''}
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('proveedores.oauth_explicacion')}{' '}
            <Enlace a="/proveedores/aliexpress" className="underline">
              {t('proveedores.ver_documentacion')}
            </Enlace>
          </p>

          {/* Dos pasos, numerados y en este orden. Se separa a propósito de la
              lista blanca de IP, que es OTRO ajuste de su consola: permite que
              nuestro servidor llame a la API, pero no sustituye a la URL de
              retorno ni concede ningún permiso sobre la cuenta. */}
          <ol className="mt-3 space-y-2 text-xs">
            <li>
              <strong>1.</strong> {t('proveedores.oauth_paso_url')}
              <div className="mt-1 flex gap-2">
                <input
                  readOnly
                  value={urlDeRetorno}
                  onFocus={(e) => e.target.select()}
                  className="campo font-mono text-base sm:text-xs"
                  aria-label={t('proveedores.oauth_retorno')}
                />
                <button
                  type="button"
                  onClick={copiar}
                  className="btn btn-secundario shrink-0 text-xs"
                >
                  {copiada ? t('app.copiado') : t('app.copiar')}
                </button>
              </div>
              <span className="mt-1 block" style={{ color: 'var(--texto-tenue)' }}>
                {t('proveedores.oauth_no_es_ip')}
              </span>
            </li>
            <li>
              <strong>2.</strong> {t('proveedores.oauth_paso_boton')}
            </li>
          </ol>
        </>
      )}

      <button
        type="button"
        className="btn btn-primario mt-3 text-sm"
        disabled={autorizando}
        onClick={onAutorizar}
      >
        {autorizando ? '…' : autorizado ? t('proveedores.reautorizar') : t('proveedores.autorizar')}
      </button>
    </section>
  );
}
