import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { precio } from '@/lib/formato';
import { Alerta, Cargando, ErrorPanel, Etiqueta, Frescura } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { useSesion } from '@/lib/sesion';
import { Boton, GrupoBotones } from '@/componentes/ui/boton';
import { Menu } from '@/componentes/ui/menu';
import { ConfirmarPeligro } from '@/componentes/ui/overlays';
import { Calendario } from '@/componentes/ui/calendario';
import { useToast } from '@/componentes/ui/toast';
import { useRef } from 'react';

interface Tarjeta {
  id: string;
  numero: string;
  email: string;
  totalCents: number;
  margenCents: number;
  lineas: number;
  articulos: number;
  imagen: string | null;
  creadoEn: string;
  diasEnEstado: number;
  alerta: 'critica' | 'aviso' | null;
}

interface Columna {
  estado: string;
  titulo: string;
  tarjetas: Tarjeta[];
}

interface Tablero {
  columnas: Columna[];
  total: number;
  incidencias: number;
}

interface DefColumna {
  estado: string;
  titulo: string;
  destinos: { estado: string; titulo: string }[];
}

/**
 * Tablero de pedidos.
 *
 * Las transiciones permitidas las dicta el servidor (`/orders/kanban/columns`),
 * no el cliente. Duplicar aquí las reglas de la máquina de estados garantizaría
 * que un día divergen: el tablero permitiría un movimiento que la API rechaza,
 * o al revés, bloquearía uno legítimo.
 *
 * Dos formas de mover una tarjeta, no una:
 *
 *  · **Arrastrando**, que es lo cómodo con ratón y resalta a dónde SÍ se puede
 *    soltar en lugar de dejar descubrirlo por ensayo y error.
 *  · **Desde el menú de la tarjeta**, con los mismos destinos permitidos. Es la
 *    única vía si no se usa ratón, y hasta ahora no existía: el tablero entero
 *    era inalcanzable desde el teclado.
 *
 * Y dos vistas de los mismos pedidos: el tablero contesta «en qué punto está
 * cada uno» y el calendario contesta «cuándo entraron», que es otra pregunta.
 */
export function Kanban() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { puede } = useSesion();
  const toast = useToast();

  const [vista, setVista] = useState<'tablero' | 'calendario'>('tablero');
  const [soloIncidencias, setSoloIncidencias] = useState(false);
  const [arrastrando, setArrastrando] = useState<Tarjeta | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [porCerrar, setPorCerrar] = useState<Tarjeta | null>(null);

  const tablero = useQuery({
    queryKey: ['kanban', soloIncidencias],
    queryFn: () => get<Tablero>(`/orders/kanban?soloIncidencias=${String(soloIncidencias)}`),
    // El tablero lo mueven también los workers: sin refresco periódico, el
    // equipo vería un estado obsoleto y trabajaría sobre datos viejos.
    refetchInterval: 15_000,
  });

  const columnas = useQuery({
    queryKey: ['kanban-columnas'],
    queryFn: () => get<DefColumna[]>('/orders/kanban/columns'),
    // Las reglas de transición no cambian salvo despliegue.
    staleTime: 30 * 60_000,
  });

  const mover = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: string }) =>
      post(`/orders/${id}/status`, { status: estado }),
    onSuccess: () => {
      setAviso(null);
      void qc.invalidateQueries({ queryKey: ['kanban'] });
    },
    onError: (error: unknown) => {
      // El mensaje de la API explica POR QUÉ no se permite el movimiento;
      // mostrarlo tal cual es más útil que un "error" genérico.
      setAviso(error instanceof Error ? error.message : t('kanban.mover_no_permitido'));
    },
  });

  const cerrar = useMutation({
    mutationFn: (id: string) => post(`/orders/${id}/close`),
    onSuccess: () => {
      toast.exito(t('pedidos.cerrado'));
      setPorCerrar(null);
      void qc.invalidateQueries({ queryKey: ['kanban'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Todas las tarjetas del tablero, para la vista de calendario. */
  const eventos = useMemo(
    () =>
      (tablero.data?.columnas ?? []).flatMap((c) =>
        c.tarjetas.map((x) => ({
          fecha: x.creadoEn,
          cantidad: 1,
          detalle: precio(x.totalCents),
          tono:
            x.alerta === 'critica'
              ? ('error' as const)
              : x.alerta
                ? ('aviso' as const)
                : ('neutro' as const),
        })),
      ),
    [tablero.data],
  );

  if (tablero.isLoading) return <Cargando filas={4} />;
  if (tablero.error)
    return <ErrorPanel error={tablero.error} reintentar={() => void tablero.refetch()} />;

  const destinosDe = (estado: string) =>
    columnas.data?.find((c) => c.estado === estado)?.destinos ?? [];

  return (
    <div>
      <Encabezado
        titulo={t('kanban.titulo')}
        cargados={tablero.data?.total ?? 0}
        frescura={
          <Frescura
            actualizado={tablero.dataUpdatedAt}
            refrescando={tablero.isFetching}
            alRefrescar={() => void tablero.refetch()}
            umbralViejo={120_000}
          />
        }
        acciones={
          <>
            {(tablero.data?.incidencias ?? 0) > 0 && (
              <Etiqueta
                texto={`${String(tablero.data?.incidencias)} ${t('panel.incidencias')}`}
                tono="error"
              />
            )}

            <label className="control-linea">
              <input
                type="checkbox"
                checked={soloIncidencias}
                onChange={(e) => setSoloIncidencias(e.target.checked)}
              />
              <span>{t('kanban.incidencias')}</span>
            </label>

            <GrupoBotones etiqueta={t('kanban.vista')}>
              <Boton
                tamano="sm"
                variante={vista === 'tablero' ? 'primario' : 'secundario'}
                aria-pressed={vista === 'tablero'}
                onClick={() => setVista('tablero')}
              >
                {t('kanban.vista_tablero')}
              </Boton>
              <Boton
                tamano="sm"
                variante={vista === 'calendario' ? 'primario' : 'secundario'}
                aria-pressed={vista === 'calendario'}
                onClick={() => setVista('calendario')}
              >
                {t('kanban.vista_calendario')}
              </Boton>
            </GrupoBotones>
          </>
        }
      />

      {aviso && (
        <div className="mb-4">
          <Alerta tono="aviso" titulo={t('kanban.mover_no_permitido')}>
            {aviso}
          </Alerta>
        </div>
      )}

      {vista === 'calendario' ? (
        <div className="panel p-4">
          <Calendario
            eventos={eventos}
            etiqueta={t('kanban.calendario_ayuda')}
            pie={t('kanban.calendario_pie')}
          />
        </div>
      ) : (
        <div className="tablero">
          {tablero.data?.columnas.map((columna) => {
            const origen = arrastrando
              ? (tablero.data.columnas.find((c) => c.tarjetas.some((x) => x.id === arrastrando.id))
                  ?.estado ?? '')
              : '';
            const admite = arrastrando
              ? destinosDe(origen).some((d) => d.estado === columna.estado)
              : false;

            return (
              <section
                key={columna.estado}
                onDragOver={(e) => {
                  if (admite) e.preventDefault();
                }}
                onDrop={() => {
                  if (arrastrando && admite) {
                    mover.mutate({ id: arrastrando.id, estado: columna.estado });
                  }
                  setArrastrando(null);
                }}
                className={`tablero-columna ${admite ? 'tablero-columna-admite' : ''}`}
                aria-label={`${columna.titulo}: ${columna.tarjetas.length}`}
              >
                <header className="tablero-cabecera">
                  <h2 className="text-sm font-medium">{columna.titulo}</h2>
                  <span className="cifra text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {columna.tarjetas.length}
                  </span>
                </header>

                <div className="space-y-2">
                  {columna.tarjetas.length === 0 ? (
                    <p className="tablero-vacio">{t('kanban.vacio')}</p>
                  ) : (
                    columna.tarjetas.map((tarjeta) => (
                      <TarjetaPedido
                        key={tarjeta.id}
                        tarjeta={tarjeta}
                        columna={columna}
                        destinos={destinosDe(columna.estado)}
                        puedeMover={puede('orders:write')}
                        puedeCerrar={puede('orders:close')}
                        alArrastrar={setArrastrando}
                        alMover={(estado) => mover.mutate({ id: tarjeta.id, estado })}
                        alCerrar={() => setPorCerrar(tarjeta)}
                        idioma={i18n.language}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <ConfirmarPeligro
        abierto={porCerrar !== null}
        alCerrar={() => setPorCerrar(null)}
        alConfirmar={() => porCerrar && cerrar.mutate(porCerrar.id)}
        trabajando={cerrar.isPending}
        titulo={t('pedidos.cerrar')}
        descripcion={t('pedidos.confirmar_cierre_detalle', { numero: porCerrar?.numero ?? '' })}
        textoConfirmar={t('pedidos.cerrar')}
      />
    </div>
  );
}

/**
 * Tarjeta de pedido.
 *
 * El menú de movimiento repite exactamente los destinos que da el servidor. No
 * es una comodidad: es la única forma de mover un pedido sin ratón, y el
 * tablero es la pantalla donde más tiempo se pasa.
 */
function TarjetaPedido({
  tarjeta,
  columna,
  destinos,
  puedeMover,
  puedeCerrar,
  alArrastrar,
  alMover,
  alCerrar,
  idioma,
}: {
  tarjeta: Tarjeta;
  columna: Columna;
  destinos: { estado: string; titulo: string }[];
  puedeMover: boolean;
  puedeCerrar: boolean;
  alArrastrar: (t: Tarjeta | null) => void;
  alMover: (estado: string) => void;
  alCerrar: () => void;
  idioma: string;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const ancla = useRef<HTMLDivElement>(null);

  const color = tarjeta.alerta === 'critica' ? 'var(--error)' : 'var(--aviso)';

  return (
    <article
      draggable={puedeMover}
      onDragStart={() => alArrastrar(tarjeta)}
      onDragEnd={() => alArrastrar(null)}
      className="panel tablero-tarjeta"
      style={tarjeta.alerta ? { borderLeftWidth: '3px', borderLeftColor: color } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs font-medium">{tarjeta.numero}</span>
        <span className="cifra text-sm font-semibold">{precio(tarjeta.totalCents)}</span>
      </div>

      <p className="lineas-1 mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {tarjeta.email}
      </p>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="cifra" style={{ color: 'var(--texto-tenue)' }}>
          {tarjeta.articulos} · {precio(tarjeta.margenCents)}
        </span>

        {tarjeta.alerta && (
          // Icono además de color: el aviso de antigüedad no puede depender de
          // distinguir el ámbar del rojo.
          <span
            style={{ color }}
            title={
              tarjeta.alerta === 'critica' ? t('pedidos.alerta_critica') : t('pedidos.alerta_aviso')
            }
          >
            <span aria-hidden="true">{tarjeta.alerta === 'critica' ? '⛔ ' : '⚠ '}</span>
            {t('pedidos.dias_en_estado', { dias: tarjeta.diasEnEstado })}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {puedeMover && destinos.length > 0 && (
          <div ref={ancla} className="relative flex-1">
            <Boton
              variante="secundario"
              tamano="sm"
              ancho
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
            >
              {t('kanban.mover')}
            </Boton>
            <Menu
              abierto={menu}
              alCerrar={() => setMenu(false)}
              ancla={ancla}
              alineacion="izquierda"
              opciones={destinos.map((d) => ({
                etiqueta: d.titulo,
                alElegir: () => alMover(d.estado),
              }))}
            />
          </div>
        )}

        {columna.estado === 'PENDING_CLOSE' && puedeCerrar && (
          <Boton variante="primario" tamano="sm" ancho onClick={alCerrar}>
            {t('pedidos.cerrar')}
          </Boton>
        )}
      </div>

      <p className="mt-2 text-[11px]" style={{ color: 'var(--texto-tenue)' }}>
        <time dateTime={tarjeta.creadoEn}>
          {new Date(tarjeta.creadoEn).toLocaleDateString(idioma, {
            day: '2-digit',
            month: 'short',
          })}
        </time>
      </p>
    </article>
  );
}
