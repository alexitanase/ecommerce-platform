import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueries, useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { precio } from '@/lib/formato';
import { Alerta, Etiqueta, Frescura } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { Enlace } from '@/componentes/enlace';
import { useSesion } from '@/lib/sesion';
import { useFiltros } from '@/lib/filtros-globales';
import { useAvisos } from '@/lib/avisos';
import { FiltrosRango } from '@/componentes/ui/filtros-rango';
import { FilaKpis, TarjetaKpi } from '@/componentes/ui/kpi';
import { Tabla, type ColumnaTabla } from '@/componentes/ui/tabla';
import { Boton } from '@/componentes/ui/boton';
import { Cargando } from '@/componentes/estados';

/*
 * Los gráficos se cargan aparte.
 *
 * La librería de dibujo pesa más que todo el resto del panel junto, y la
 * pregunta principal —cómo va el negocio y qué hay que mirar hoy— la contestan
 * los avisos y las cuatro cifras de arriba. Cargarla en el mismo paquete
 * retrasaba esa respuesta sin motivo.
 */
const PanelGraficos = lazy(() => import('./panel-graficos'));

/**
 * Panel de inicio.
 *
 * Contesta una sola pregunta y la contesta sin bajar: **¿cómo va el negocio y
 * qué tengo que mirar hoy?** Lo accionable —incidencias, pedidos parados,
 * colas caídas— va primero y en color de alerta; después las cuatro cifras del
 * periodo con su comparativa; después la tendencia; y solo al final el detalle.
 *
 * Todo lo que se ve obedece al mismo rango de fechas, el de la barra de
 * filtros: sin eso, dos cifras contiguas pueden ser de periodos distintos sin
 * que nadie lo note.
 *
 * Seis bloques, no más. Un panel con doce widgets no responde nada: obliga a
 * buscar.
 */

interface Resumen {
  pedidos: number;
  ingresosCents: number;
  ingresoSinIvaCents: number;
  margenNetoCents: number;
  margenPorcentaje: number;
  ticketMedioCents: number;
}

interface DiaVentas {
  dia: string;
  pedidos: number;
  ingresosCents: number;
  costesCents: number;
}

interface ProductoInforme {
  sku: string;
  nombre: string;
  unidades: number;
  ingresosCents: number;
  margenCents: number;
  margenPorcentaje: number;
}

interface Pedido {
  id: string;
  number: string;
  email: string;
  status: string;
  estadoLegible: string;
  totalCents: number;
  supplierCostCents: number;
  createdAt: string;
}

export function Panel() {
  const { t, i18n } = useTranslation();
  const { usuario, puede } = useSesion();
  const { anterior, dias, query } = useFiltros();
  const { avisos, hayError } = useAvisos();

  const puedeInformes = puede('reports:read');
  const puedePedidos = puede('orders:read');

  /*
   * El resumen se pide dos veces: el periodo elegido y el mismo número de días
   * justo antes. Es lo que permite que ninguna cifra salga sola —«1.240 €» no
   * dice nada; «1.240 €, un 12 % más que los 30 días anteriores» sí—.
   */
  const [actual, previo, diario, productos] = useQueries({
    queries: [
      {
        queryKey: ['panel-resumen', query()],
        queryFn: () => get<Resumen>(`/reports/summary?${query()}`),
        enabled: puedeInformes,
      },
      {
        queryKey: ['panel-resumen-anterior', query(anterior)],
        queryFn: () => get<Resumen>(`/reports/summary?${query(anterior)}`),
        enabled: puedeInformes,
      },
      {
        queryKey: ['panel-diario', query()],
        queryFn: () => get<DiaVentas[]>(`/reports/daily?${query()}`),
        enabled: puedeInformes,
      },
      {
        queryKey: ['panel-productos', query()],
        queryFn: () => get<ProductoInforme[]>(`/reports/products?${query()}`),
        enabled: puedeInformes,
      },
    ],
  });

  const pedidos = useQuery({
    queryKey: ['panel-pedidos'],
    queryFn: () => get<{ items: Pedido[] }>('/orders?limite=8'),
    enabled: puedePedidos,
    refetchInterval: 60_000,
  });

  const r = actual.data;
  const p = previo.data;

  /** Serie diaria de ingresos, para las sparklines de las tarjetas. */
  const serieIngresos = (diario.data ?? []).map((d) => d.ingresosCents / 100);
  const seriePedidos = (diario.data ?? []).map((d) => d.pedidos);

  const datosGrafico = (diario.data ?? []).map((d) => ({
    x: new Date(d.dia).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short' }),
    ingresos: d.ingresosCents / 100,
    margen: (d.ingresosCents - d.costesCents) / 100,
  }));

  const topProductos = (productos.data ?? []).slice(0, 8).map((x) => ({
    x: x.nombre.length > 32 ? `${x.nombre.slice(0, 31)}…` : x.nombre,
    margen: x.margenCents / 100,
    sku: x.sku,
    unidades: x.unidades,
  }));

  const euros = (v: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(v);

  // El dato más viejo de los tres bloques: la pantalla es tan fresca como su
  // peor fuente, y presumir de la mejor sería mentir.
  const marcas = [actual, diario, pedidos].map((c) => c.dataUpdatedAt).filter((m) => m > 0);
  const actualizado = marcas.length > 0 ? Math.min(...marcas) : 0;

  const recargarTodo = () => {
    void actual.refetch();
    void previo.refetch();
    void diario.refetch();
    void productos.refetch();
    void pedidos.refetch();
  };

  const columnas: ColumnaTabla<Pedido>[] = [
    {
      clave: 'number',
      titulo: t('pedidos.numero'),
      valor: (o) => <span className="font-mono text-xs">{o.number}</span>,
      csv: (o) => o.number,
      ordenar: (a, b) => a.number.localeCompare(b.number),
    },
    {
      clave: 'email',
      titulo: t('pedidos.cliente'),
      valor: (o) => (
        <span className="block max-w-[220px] truncate" title={o.email}>
          {o.email}
        </span>
      ),
      csv: (o) => o.email,
      ordenar: (a, b) => a.email.localeCompare(b.email),
    },
    {
      clave: 'status',
      titulo: t('app.estado'),
      valor: (o) => (
        <Etiqueta
          texto={t(`pedidos.estados.${o.status}`, { defaultValue: o.estadoLegible })}
          tono={
            o.status === 'FAILED'
              ? 'error'
              : o.status === 'CLOSED' || o.status === 'DELIVERED'
                ? 'exito'
                : 'info'
          }
        />
      ),
      csv: (o) => o.estadoLegible,
    },
    {
      clave: 'totalCents',
      titulo: t('pedidos.importe'),
      numerica: true,
      valor: (o) => precio(o.totalCents),
      csv: (o) => (o.totalCents / 100).toFixed(2),
      ordenar: (a, b) => a.totalCents - b.totalCents,
      total: (filas) => precio(filas.reduce((a, o) => a + o.totalCents, 0)),
    },
    {
      clave: 'margen',
      titulo: t('pedidos.margen'),
      numerica: true,
      valor: (o) => precio(o.totalCents - o.supplierCostCents),
      csv: (o) => ((o.totalCents - o.supplierCostCents) / 100).toFixed(2),
      ordenar: (a, b) => a.totalCents - a.supplierCostCents - (b.totalCents - b.supplierCostCents),
      total: (filas) => precio(filas.reduce((a, o) => a + o.totalCents - o.supplierCostCents, 0)),
    },
  ];

  return (
    <div>
      <Encabezado
        titulo={t('panel.titulo') + (usuario?.firstName ? ` · ${usuario.firstName}` : '')}
        descripcion={t('panel.descripcion', { n: dias })}
        acciones={<FiltrosRango />}
        frescura={
          <Frescura
            actualizado={actualizado}
            refrescando={actual.isFetching || pedidos.isFetching}
            alRefrescar={recargarTodo}
          />
        }
      />

      {/* Lo que requiere atención va primero: es lo único de esta pantalla que
          hay que hacer hoy. */}
      {avisos.length > 0 && (
        <div className="mb-5">
          <Alerta
            tono={hayError ? 'error' : 'aviso'}
            titulo={t('panel.atencion')}
            accion={
              <Boton variante="secundario" tamano="sm" onClick={recargarTodo}>
                {t('ui.actualizar')}
              </Boton>
            }
          >
            <ul className="mt-1 space-y-0.5">
              {avisos.map((a) => (
                <li key={a.id}>
                  <Enlace a={a.ruta} className="underline underline-offset-2">
                    {a.texto}
                  </Enlace>
                </li>
              ))}
            </ul>
          </Alerta>
        </div>
      )}

      {/* ── Las cuatro cifras del periodo ── */}
      {puedeInformes && (
        <FilaKpis>
          <TarjetaKpi
            titulo={t('panel.ingresos')}
            valor={precio(r?.ingresosCents ?? 0)}
            actual={r?.ingresosCents ?? 0}
            anterior={p?.ingresosCents ?? 0}
            serie={serieIngresos}
            definicion={t('panel.def_ingresos')}
            destacado
          />
          <TarjetaKpi
            titulo={t('panel.pedidos')}
            valor={String(r?.pedidos ?? 0)}
            actual={r?.pedidos ?? 0}
            anterior={p?.pedidos ?? 0}
            serie={seriePedidos}
            definicion={t('panel.def_pedidos')}
          />
          <TarjetaKpi
            titulo={t('panel.ticket_medio')}
            valor={precio(r?.ticketMedioCents ?? 0)}
            actual={r?.ticketMedioCents ?? 0}
            anterior={p?.ticketMedioCents ?? 0}
            definicion={t('panel.def_ticket')}
          />
          <TarjetaKpi
            titulo={t('panel.margen')}
            valor={precio(r?.margenNetoCents ?? 0)}
            actual={r?.margenNetoCents ?? 0}
            anterior={p?.margenNetoCents ?? 0}
            definicion={t('panel.def_margen')}
          />
        </FilaKpis>
      )}

      {/* ── Tendencia y reparto ── */}
      <Suspense
        fallback={
          <div className="rejilla mt-4">
            <div className="col-8 panel p-4">
              <Cargando forma="grafico" />
            </div>
            <div className="col-4 panel p-4">
              <Cargando forma="grafico" />
            </div>
          </div>
        }
      >
        <PanelGraficos
          evolucion={datosGrafico}
          productos={topProductos}
          permiso={puedeInformes}
          cargandoEvolucion={diario.isLoading}
          errorEvolucion={diario.error}
          reintentarEvolucion={() => void diario.refetch()}
          cargandoProductos={productos.isLoading}
          errorProductos={productos.error}
          reintentarProductos={() => void productos.refetch()}
          formato={euros}
        />
      </Suspense>

      {/* ── Últimos pedidos ── */}
      {puedePedidos && (
        <section className="mt-4">
          <h2 className="mb-2 text-sm font-semibold">{t('panel.ultimos_pedidos')}</h2>
          <Tabla<Pedido>
            descripcion={t('panel.tabla_descripcion')}
            columnas={columnas}
            filas={pedidos.data?.items ?? []}
            idFila={(o) => o.id}
            cargando={pedidos.isLoading}
            error={pedidos.error}
            reintentar={() => void pedidos.refetch()}
            buscarEn={(o) => `${o.number} ${o.email} ${o.estadoLegible}`}
            totales
            nombreExport="ultimos-pedidos"
            vacio={{
              titulo: t('panel.sin_ventas'),
              descripcion: t('panel.sin_ventas_ayuda'),
            }}
            acciones={
              <Enlace a="/pedidos" className="btn btn-secundario text-xs">
                {t('panel.ver_todos')}
              </Enlace>
            }
          />
        </section>
      )}
    </div>
  );
}
