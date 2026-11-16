import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { get, obtenerToken } from '@/lib/api';
import { Cargando, ErrorPanel, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Informes.
 *
 * El número que importa no es lo facturado sino el **margen**: facturar 10.000 €
 * suena bien hasta que se descuenta el proveedor, el porte y la comisión de la
 * pasarela. Por eso el desglose va entero y no solo el total.
 *
 * El IVA se resta también: se recauda para Hacienda, no es ingreso. Contarlo
 * como margen es lo que hace que un negocio se crea rentable hasta el
 * trimestre en que presenta el 303.
 */

interface Resumen {
  pedidos: number;
  ingresosCents: number;
  ivaRepercutidoCents: number;
  ingresoSinIvaCents: number;
  costeProveedorCents: number;
  comisionesPasarelaCents: number;
  descuentosCents: number;
  envioCobradoCents: number;
  margenNetoCents: number;
  margenPorcentaje: number;
  ticketMedioCents: number;
}

interface ProductoInforme {
  sku: string;
  nombre: string;
  unidades: number;
  ingresosCents: number;
  costeCents: number;
  margenCents: number;
  margenPorcentaje: number;
}

interface LineaOss {
  pais: string;
  tipo: number;
  baseCents: number;
  cuotaCents: number;
  pedidos: number;
}

interface Declaracion {
  anio: number;
  trimestre: number;
  presentarAntesDe: string;
  regimenUnion: LineaOss[];
  regimenImportacion: LineaOss[];
  baseTotalCents: number;
  cuotaTotalCents: number;
  aRevisar: { numero: string; motivo: string }[];
}

interface Recuperacion {
  avisados: number;
  recuperados: number;
  tasa: number;
  ingresosCents: number;
}

interface UmbralOss {
  anio: number;
  acumuladoCents: number;
  umbralCents: number;
  restanteCents: number;
  superado: boolean;
  porcentaje: number;
  aviso?: string;
  altaPendiente: boolean;
}

const euros = (c: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(c / 100);

/** Rangos habituales, para no tener que elegir fechas cada vez. */
const RANGOS = [7, 30, 90] as const;

export function Informes() {
  const { t } = useTranslation();
  const [dias, setDias] = useState<number>(30);

  /**
   * Fecha de inicio, estable dentro del mismo día.
   *
   * Con `Date.now()` a pelo el valor cambia en cada renderizado, y como forma
   * parte de la clave de consulta la pantalla se quedaría recargando sola sin
   * parar. Se ancla al comienzo del día para que además la caché acierte entre
   * visitas.
   */
  const params = useMemo(() => {
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    inicio.setDate(inicio.getDate() - dias);
    return `?desde=${encodeURIComponent(inicio.toISOString())}`;
  }, [dias]);

  const resumen = useQuery({
    queryKey: ['informes', 'resumen', dias],
    queryFn: () => get<Resumen>(`/reports/summary${params}`),
  });

  const productos = useQuery({
    queryKey: ['informes', 'productos', dias],
    queryFn: () => get<ProductoInforme[]>(`/reports/products${params}`),
  });

  // La ventanilla única va por trimestre natural, no por el rango de arriba: la
  // declaración es de un trimestre entero o no es nada.
  const umbral = useQuery({
    queryKey: ['informes', 'umbral-oss'],
    queryFn: () => get<UmbralOss>('/orders/oss-threshold'),
  });

  const oss = useQuery({
    queryKey: ['informes', 'oss'],
    queryFn: () => get<Declaracion>('/reports/oss'),
  });

  const recuperacion = useQuery({
    queryKey: ['informes', 'recuperacion', dias],
    queryFn: () => get<Recuperacion>(`/reports/recovery${params}`),
  });

  /**
   * Descarga el CSV con el token en la cabecera.
   *
   * Un enlace normal no sirve: sería una navegación del navegador y no lleva
   * la autorización, y el token del admin vive en memoria a propósito.
   */
  const descargar = async (informe: string) => {
    const base = '/api/v1';
    const r = await fetch(`${base}/reports/export/${informe}${params}`, {
      headers: { Authorization: `Bearer ${obtenerToken() ?? ''}` },
    });

    if (!r.ok) throw new Error(`No se pudo exportar el informe (${r.status})`);

    // El nombre lo pone el servidor, con el rango de fechas dentro. Al bajar
    // por blob el navegador ignora la cabecera `Content-Disposition`, así que
    // hay que leerla a mano: si no, todo se descarga como "iva.csv" y a la
    // segunda exportación queda "iva(1).csv" sin forma de saber cuál es cuál.
    const cabecera = r.headers.get('content-disposition') ?? '';
    const nombre = /filename="?([^";]+)"?/.exec(cabecera)?.[1] ?? `${informe}.csv`;

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (resumen.isLoading) return <Cargando />;
  if (resumen.error)
    return <ErrorPanel error={resumen.error} reintentar={() => void resumen.refetch()} />;

  const r = resumen.data;

  return (
    <div>
      <Encabezado
        titulo={t('informes.titulo')}
        descripcion={t('informes.descripcion')}
        acciones={
          <div className="flex gap-1" role="group" aria-label={t('informes.titulo')}>
            {RANGOS.map((d) => (
              <button
                key={d}
                type="button"
                className={`btn text-sm ${dias === d ? 'btn-primario' : 'btn-fantasma'}`}
                onClick={() => setDias(d)}
                // Es un selector de rango, no botones sueltos: sin esto un
                // lector de pantalla no dice cuál está elegido.
                aria-pressed={dias === d}
              >
                {t('informes.dias', { n: d })}
              </button>
            ))}
          </div>
        }
      />

      {r && r.pedidos === 0 ? (
        <Vacio titulo={t('informes.sin_ventas')} descripcion={t('informes.sin_ventas_ayuda')} />
      ) : (
        r && (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Cifra titulo={t('informes.ingresos')} valor={euros(r.ingresosCents)} />
              <Cifra
                titulo={t('informes.margen')}
                valor={euros(r.margenNetoCents)}
                nota={`${r.margenPorcentaje}%`}
                destacada
              />
              <Cifra titulo={t('informes.pedidos')} valor={String(r.pedidos)} />
              <Cifra titulo={t('informes.ticket_medio')} valor={euros(r.ticketMedioCents)} />
            </div>

            {/* El desglose completo: si el margen cae, saber si fue el
                proveedor, el porte o la comisión es lo que permite arreglarlo. */}
            <section className="panel mb-6 p-4">
              <h2 className="mb-3 text-sm font-semibold">{t('informes.desglose')}</h2>
              <dl className="space-y-1.5 text-sm">
                <Linea titulo={t('informes.ingresos')} valor={euros(r.ingresosCents)} />
                <Linea
                  titulo={t('informes.iva')}
                  valor={`− ${euros(r.ivaRepercutidoCents)}`}
                  ayuda={t('informes.iva_ayuda')}
                />
                <Linea
                  titulo={t('informes.coste_proveedor')}
                  valor={`− ${euros(r.costeProveedorCents)}`}
                />
                <Linea
                  titulo={t('informes.comisiones')}
                  valor={`− ${euros(r.comisionesPasarelaCents)}`}
                />
                <div
                  className="flex justify-between border-t pt-2 font-semibold"
                  style={{ borderColor: 'var(--borde)' }}
                >
                  <dt>{t('informes.margen')}</dt>
                  <dd className="tabular-nums">{euros(r.margenNetoCents)}</dd>
                </div>
              </dl>
            </section>

            <section className="mb-6">
              <h2 className="mb-2 text-sm font-semibold">{t('informes.productos')}</h2>
              <p className="mb-3 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                {t('informes.productos_ayuda')}
              </p>

              {(productos.data ?? []).length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
                  {t('informes.sin_productos')}
                </p>
              ) : (
                <ul className="space-y-1">
                  {(productos.data ?? []).slice(0, 15).map((p) => (
                    <li key={p.sku} className="panel flex flex-wrap items-center gap-3 p-3 text-sm">
                      <span className="font-mono text-xs">{p.sku}</span>
                      <span className="min-w-0 flex-1 truncate">{p.nombre}</span>
                      <span style={{ color: 'var(--texto-tenue)' }}>
                        {t('informes.unidades', { n: p.unidades })}
                      </span>
                      <span className="tabular-nums">{euros(p.ingresosCents)}</span>
                      <span
                        className="tabular-nums font-medium"
                        style={{ color: p.margenPorcentaje < 20 ? 'var(--aviso)' : undefined }}
                      >
                        {euros(p.margenCents)} ({p.margenPorcentaje}%)
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )
      )}

      {/* Carritos abandonados. Se mide sobre los avisados, no sobre todos los
          abandonados: la pregunta es si la secuencia de correos funciona. */}
      {recuperacion.data && recuperacion.data.avisados > 0 && (
        <section className="mb-6">
          <h2 className="mb-1 text-sm font-semibold">{t('informes.recuperacion')}</h2>
          <p className="mb-3 text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('informes.recuperacion_ayuda')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Cifra
              titulo={t('informes.recuperacion_avisados')}
              valor={String(recuperacion.data.avisados)}
            />
            <Cifra
              titulo={t('informes.recuperacion_recuperados')}
              valor={String(recuperacion.data.recuperados)}
              nota={`${String(recuperacion.data.tasa)}%`}
            />
            <Cifra
              titulo={t('informes.recuperacion_ingresos')}
              valor={euros(recuperacion.data.ingresosCents)}
              destacada
            />
          </div>
        </section>
      )}

      {/* Ventanilla única. Va aparte del rango de fechas de arriba a propósito:
          el 369 se presenta por trimestre natural completo. */}
      <section className="mb-6">
        <h2 className="mb-1 text-sm font-semibold">{t('informes.oss')}</h2>
        <p className="mb-3 text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {t('informes.oss_ayuda')}
        </p>

        {umbral.data && <BarraUmbral umbral={umbral.data} />}

        {oss.data && <TablaOss declaracion={oss.data} />}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{t('informes.exportar')}</h2>
        <div className="flex flex-wrap gap-2">
          {['pedidos', 'productos', 'iva', 'oss'].map((informe) => (
            <button
              key={informe}
              type="button"
              className="btn btn-secundario text-sm"
              onClick={() => void descargar(informe)}
            >
              {t(`informes.csv_${informe}`)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {t('informes.csv_ayuda')}
        </p>
      </section>
    </div>
  );
}

/**
 * Cuánto queda del umbral de los 10.000 €.
 *
 * Se enseña siempre, no solo al superarlo: enterarse después obliga a
 * regularizar ventas ya facturadas con un tipo que no era, y esa diferencia
 * sale del margen porque al cliente ya no se le puede reclamar.
 */
function BarraUmbral({ umbral }: { umbral: UmbralOss }) {
  const { t } = useTranslation();
  const pct = Math.min(100, umbral.porcentaje);
  const color = umbral.superado
    ? 'var(--error)'
    : pct >= 80
      ? 'var(--aviso)'
      : 'var(--marca-primario)';

  return (
    <div className="panel mb-3 p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{t('informes.oss_umbral')}</span>
        <span className="tabular-nums" style={{ color: 'var(--texto-tenue)' }}>
          {euros(umbral.acumuladoCents)} / {euros(umbral.umbralCents)} · {umbral.anio}
        </span>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('informes.oss_umbral')}
        style={{ background: 'var(--borde)' }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${String(pct)}%`, background: color }}
        />
      </div>

      <p className="mt-2 text-xs" style={{ color: umbral.superado ? color : 'var(--texto-tenue)' }}>
        {umbral.superado
          ? t('informes.oss_superado')
          : t('informes.oss_restante', { importe: euros(umbral.restanteCents) })}
      </p>

      {umbral.altaPendiente && (
        <p className="mt-1 text-xs font-medium" style={{ color: 'var(--error)' }}>
          {t('informes.oss_alta_pendiente')}
        </p>
      )}
    </div>
  );
}

/** La declaración del trimestre, con sus dos apartados por separado. */
function TablaOss({ declaracion }: { declaracion: Declaracion }) {
  const { t } = useTranslation();
  const vacia =
    declaracion.regimenUnion.length === 0 && declaracion.regimenImportacion.length === 0;

  const apartado = (titulo: string, lineas: LineaOss[]) =>
    lineas.length === 0 ? null : (
      <div key={titulo} className="mb-3">
        <h3 className="mb-1 text-xs font-semibold" style={{ color: 'var(--texto-suave)' }}>
          {titulo}
        </h3>
        <ul className="space-y-1">
          {lineas.map((l) => (
            <li
              key={`${l.pais}-${String(l.tipo)}`}
              className="flex flex-wrap items-center gap-3 text-sm"
            >
              <span className="font-mono">{l.pais}</span>
              <span style={{ color: 'var(--texto-tenue)' }}>{l.tipo}%</span>
              <span className="ml-auto tabular-nums">{euros(l.baseCents)}</span>
              <span className="w-24 text-right font-medium tabular-nums">
                {euros(l.cuotaCents)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          {t('informes.oss_trimestre', {
            trimestre: declaracion.trimestre,
            anio: declaracion.anio,
          })}
        </span>
        <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {t('informes.oss_plazo', {
            fecha: new Date(declaracion.presentarAntesDe).toLocaleDateString('es-ES'),
          })}
        </span>
      </div>

      {vacia ? (
        <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
          {t('informes.oss_vacio')}
        </p>
      ) : (
        <>
          {apartado(t('informes.oss_union'), declaracion.regimenUnion)}
          {apartado(t('informes.oss_importacion'), declaracion.regimenImportacion)}

          <div
            className="flex justify-between border-t pt-2 text-sm font-semibold"
            style={{ borderColor: 'var(--borde)' }}
          >
            <span>{t('informes.oss_total')}</span>
            <span className="tabular-nums">{euros(declaracion.cuotaTotalCents)}</span>
          </div>
        </>
      )}

      {/* Los pedidos que no se clasifican solos se listan en vez de repartirse
          a ojo: un importe en el país equivocado no lo detecta nadie. */}
      {declaracion.aRevisar.length > 0 && (
        <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--borde)' }}>
          <h3 className="mb-1 text-xs font-semibold" style={{ color: 'var(--aviso)' }}>
            {t('informes.oss_revisar')}
          </h3>
          <ul className="space-y-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {declaracion.aRevisar.map((r) => (
              <li key={`${r.numero}-${r.motivo.slice(0, 12)}`}>
                <span className="font-mono">{r.numero}</span> · {r.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Cifra({
  titulo,
  valor,
  nota,
  destacada,
}: {
  titulo: string;
  valor: string;
  nota?: string;
  destacada?: boolean;
}) {
  return (
    <div
      className="panel p-4"
      style={destacada ? { borderColor: 'var(--marca-primario)' } : undefined}
    >
      <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {titulo}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{valor}</p>
      {nota && (
        <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {nota}
        </p>
      )}
    </div>
  );
}

function Linea({ titulo, valor, ayuda }: { titulo: string; valor: string; ayuda?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>
        {titulo}
        {ayuda && (
          <span className="ml-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {ayuda}
          </span>
        )}
      </dt>
      <dd className="tabular-nums">{valor}</dd>
    </div>
  );
}
