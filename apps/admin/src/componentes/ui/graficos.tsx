import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Boton } from './boton';
import { Menu } from './menu';
import { Cargando, ErrorPanel, SinPermiso, Vacio } from '@/componentes/estados';
import { exportarCsv, exportarPng } from '@/lib/exportar';
import { useToast } from './toast';

/**
 * Catálogo de gráficos del panel.
 *
 * Reglas que no se negocian, porque cada una viene de un gráfico que engañaba:
 *
 *  · **Un solo eje Y.** Nunca dos escalas en el mismo dibujo: la alineación
 *    entre ellas es arbitraria y fabrica una correlación que no está en los
 *    datos. Dos magnitudes distintas son dos gráficos.
 *  · **El color sigue a la entidad, no a su posición.** Filtrar una serie no
 *    repinta a las demás; quien aprendió que «AliExpress es azul» lo sigue
 *    teniendo azul.
 *  · **Nunca el color solo.** Todo gráfico con dos o más series lleva leyenda, y
 *    todos ofrecen ver los mismos datos como tabla.
 *  · **Marcas finas y rejilla discreta.** Líneas de 2 px, puntos de 8, rejilla
 *    de 1 px continua (nunca discontinua) y sin 3D ni sombras.
 *  · **Nada de tartas con muchas categorías.** El donut admite seis como mucho;
 *    lo demás se agrupa en «Otros» o se dibuja en barras.
 */

/* ───────────────────────── Tokens del tema ───────────────────────── */

const CLAVES_SERIE = [
  '--serie-1',
  '--serie-2',
  '--serie-3',
  '--serie-4',
  '--serie-5',
  '--serie-6',
  '--serie-7',
  '--serie-8',
] as const;

interface TokensGrafico {
  series: string[];
  texto: string;
  tenue: string;
  rejilla: string;
  superficie: string;
  secuencial: string[];
}

/**
 * Colores resueltos desde las variables CSS.
 *
 * Se leen del documento y no se escriben aquí para que el tema claro/oscuro y
 * la marca configurada por la tienda lleguen también a los gráficos. Se vuelven
 * a leer cuando cambia el tema: `getComputedStyle` no es reactivo, y sin el
 * observador los gráficos se quedaban con los colores del tema anterior hasta
 * recargar la página.
 */
export function useTokensGrafico(): TokensGrafico {
  const leer = (): TokensGrafico => {
    const estilo = getComputedStyle(document.documentElement);
    const v = (nombre: string) => estilo.getPropertyValue(nombre).trim();
    return {
      series: CLAVES_SERIE.map((c) => v(c)),
      texto: v('--texto'),
      tenue: v('--texto-tenue'),
      rejilla: v('--rejilla-grafico'),
      superficie: v('--fondo-panel'),
      secuencial: ['--sec-1', '--sec-2', '--sec-3', '--sec-4', '--sec-5', '--sec-6', '--sec-7'].map(
        (c) => v(c),
      ),
    };
  };

  const [tokens, setTokens] = useState<TokensGrafico>(leer);

  useEffect(() => {
    const observador = new MutationObserver(() => setTokens(leer()));
    observador.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => observador.disconnect();
  }, []);

  return tokens;
}

/* ─────────────────────── Contenedor estándar ─────────────────────── */

export interface SerieGrafico {
  /** Campo del dato. */
  clave: string;
  nombre: string;
  /** Índice fijo de color: la serie mantiene su tono aunque se filtre otra. */
  color?: number;
}

/**
 * Marco común de todos los gráficos: título, rango, leyenda, exportación y los
 * cinco estados.
 *
 * Que sea el mismo en todos no es estética: es lo que permite que quien mira
 * sepa sin pensar dónde está el selector de periodo y dónde el botón de
 * exportar, en cualquier pantalla del panel.
 */
export function ContenedorGrafico({
  titulo,
  descripcion,
  rango,
  leyenda,
  children,
  datos,
  columnasCsv,
  nombreExport = 'grafico',
  cargando = false,
  error,
  reintentar,
  permiso = true,
  vacio,
  alto = 260,
  acciones,
}: {
  titulo: string;
  descripcion?: string;
  /** Selector de rango propio del gráfico; si no, manda el filtro global. */
  rango?: ReactNode;
  leyenda?: { nombre: string; color: string }[];
  children: ReactNode;
  /** Los mismos datos que dibuja, para exportar y para la vista de tabla. */
  datos?: Record<string, unknown>[];
  columnasCsv?: { clave: string; titulo: string }[];
  nombreExport?: string;
  cargando?: boolean;
  error?: unknown;
  reintentar?: () => void;
  permiso?: boolean;
  vacio?: { titulo: string; descripcion?: string };
  alto?: number;
  acciones?: ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const caja = useRef<HTMLDivElement>(null);
  const anclaMenu = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const [verTabla, setVerTabla] = useState(false);

  const columnas =
    columnasCsv ??
    (datos && datos[0] ? Object.keys(datos[0]).map((k) => ({ clave: k, titulo: k })) : []);

  const exportarImagen = async () => {
    const svg = caja.current?.querySelector('svg');
    if (!svg) return;
    try {
      await exportarPng(svg, nombreExport);
    } catch {
      toast.error(t('graficos.png_fallo'));
    }
  };

  const cuerpo = () => {
    if (!permiso) return <SinPermiso />;
    if (error) return <ErrorPanel error={error} reintentar={reintentar} />;
    if (cargando) return <Cargando forma="grafico" />;
    if (datos && datos.length === 0) {
      return (
        <Vacio
          titulo={vacio?.titulo ?? t('graficos.sin_datos')}
          {...(vacio?.descripcion ? { descripcion: vacio.descripcion } : {})}
        />
      );
    }
    if (verTabla && datos) return <TablaDelGrafico datos={datos} columnas={columnas} />;
    return (
      <div style={{ height: alto }} ref={caja}>
        {children}
      </div>
    );
  };

  return (
    <section className="panel grafico" data-imprimir="true" aria-label={titulo}>
      <header className="grafico-cabecera">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{titulo}</h3>
          {descripcion && (
            <p className="mt-0.5 text-xs" style={{ color: 'var(--texto-tenue)' }}>
              {descripcion}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {rango}
          {acciones}
          <div ref={anclaMenu} className="relative">
            <Boton
              variante="fantasma"
              tamano="sm"
              soloIcono
              etiqueta={t('graficos.opciones')}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
              icono={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="5" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="12" cy="19" r="1.6" />
                </svg>
              }
            />
            <Menu
              abierto={menu}
              alCerrar={() => setMenu(false)}
              ancla={anclaMenu}
              opciones={[
                {
                  etiqueta: verTabla ? t('graficos.ver_grafico') : t('graficos.ver_tabla'),
                  alElegir: () => setVerTabla((v) => !v),
                },
                {
                  etiqueta: t('graficos.exportar_png'),
                  alElegir: () => void exportarImagen(),
                  desactivada: verTabla || !datos,
                  separada: true,
                },
                {
                  etiqueta: t('graficos.exportar_csv'),
                  alElegir: () =>
                    exportarCsv(
                      nombreExport,
                      datos ?? [],
                      columnas.map((c) => ({
                        clave: c.clave,
                        titulo: c.titulo,
                        valor: (fila: Record<string, unknown>) => fila[c.clave],
                      })),
                    ),
                  desactivada: !datos || datos.length === 0,
                },
              ]}
            />
          </div>
        </div>
      </header>

      {/*
       * Leyenda propia y no la de la librería: la de recharts colorea el texto
       * con el color de la serie, y un amarillo o un aqua como texto sobre
       * blanco no se leen. Aquí el color va en la marca de al lado y el texto
       * conserva su token.
       */}
      {leyenda && leyenda.length > 1 && (
        <ul className="grafico-leyenda">
          {leyenda.map((l) => (
            <li key={l.nombre}>
              <span className="leyenda-marca" style={{ background: l.color }} aria-hidden="true" />
              {l.nombre}
            </li>
          ))}
        </ul>
      )}

      <div className="grafico-cuerpo">{cuerpo()}</div>
    </section>
  );
}

/** Vista de tabla del propio gráfico: la salida accesible de cualquier dibujo. */
function TablaDelGrafico({
  datos,
  columnas,
}: {
  datos: Record<string, unknown>[];
  columnas: { clave: string; titulo: string }[];
}) {
  return (
    <div className="overflow-auto" style={{ maxHeight: 320 }}>
      <table className="tabla tabla-pegajosa">
        <thead>
          <tr>
            {columnas.map((c) => (
              <th key={c.clave} scope="col">
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {datos.map((fila, i) => (
            <tr key={i}>
              {columnas.map((c) => (
                <td key={c.clave} className="cifra">
                  {textoDeCelda(fila[c.clave])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────── Tooltip común ─────────────────────────── */

/**
 * Texto de una celda en la tabla del gráfico.
 *
 * Los datos de un gráfico son números y fechas; si llegara un objeto, escribir
 * «[object Object]» sería peor que dejar el hueco, porque esta tabla es la
 * versión accesible del dibujo.
 */
function textoDeCelda(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'number' || typeof valor === 'string' || typeof valor === 'boolean') {
    return String(valor);
  }
  return '';
}

interface PropsTooltip {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string }[];
  label?: string | number;
  formato?: (valor: number) => string;
}

function TooltipGrafico({ active, payload, label, formato }: PropsTooltip) {
  if (!active || !payload?.length) return null;

  return (
    <div className="grafico-tooltip">
      {label !== undefined && <p className="grafico-tooltip-titulo">{String(label)}</p>}
      {payload.map((p, i) => (
        <p key={i} className="grafico-tooltip-linea">
          <span className="leyenda-marca" style={{ background: p.color }} aria-hidden="true" />
          <span className="flex-1">{p.name}</span>
          <span className="cifra font-medium">
            {formato ? formato(Number(p.value ?? 0)) : String(p.value ?? '')}
          </span>
        </p>
      ))}
    </div>
  );
}

/** Ejes comunes: rejilla fina, continua y sin línea de eje redundante. */
function ejes(tokens: TokensGrafico, formatoY?: (v: number) => string, claveX = 'x') {
  return (
    <>
      <CartesianGrid stroke={tokens.rejilla} strokeWidth={1} vertical={false} />
      <XAxis
        dataKey={claveX}
        tick={{ fill: tokens.tenue, fontSize: 11 }}
        tickLine={false}
        axisLine={{ stroke: tokens.rejilla }}
        minTickGap={24}
      />
      <YAxis
        tick={{ fill: tokens.tenue, fontSize: 11 }}
        tickLine={false}
        axisLine={false}
        width={56}
        {...(formatoY ? { tickFormatter: formatoY } : {})}
      />
    </>
  );
}

/* ──────────────────────────── Línea y área ──────────────────────────── */

export function GraficoLinea({
  datos,
  series,
  claveX = 'x',
  formato,
}: {
  datos: Record<string, unknown>[];
  series: SerieGrafico[];
  claveX?: string;
  formato?: (valor: number) => string;
}) {
  const tokens = useTokensGrafico();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        {ejes(tokens, formato, claveX)}
        <Tooltip
          content={<TooltipGrafico {...(formato ? { formato } : {})} />}
          cursor={{ stroke: tokens.rejilla, strokeWidth: 1 }}
        />
        {series.map((s, i) => (
          <Line
            key={s.clave}
            type="monotone"
            dataKey={s.clave}
            name={s.nombre}
            stroke={tokens.series[s.color ?? i] ?? tokens.series[0]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            // Punto solo al pasar por encima, con anillo del color de la
            // superficie: así se ve dónde cruza otra línea. Con punto en cada
            // valor, una serie de 90 días es una fila de bolas, no una línea.
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: tokens.superficie }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function GraficoArea({
  datos,
  series,
  claveX = 'x',
  formato,
  apilado = false,
}: {
  datos: Record<string, unknown>[];
  series: SerieGrafico[];
  claveX?: string;
  formato?: (valor: number) => string;
  apilado?: boolean;
}) {
  const tokens = useTokensGrafico();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        {ejes(tokens, formato, claveX)}
        <Tooltip
          content={<TooltipGrafico {...(formato ? { formato } : {})} />}
          cursor={{ stroke: tokens.rejilla, strokeWidth: 1 }}
        />
        {series.map((s, i) => {
          const color = tokens.series[s.color ?? i] ?? tokens.series[0];
          return (
            <Area
              key={s.clave}
              type="monotone"
              dataKey={s.clave}
              name={s.nombre}
              stroke={color}
              strokeWidth={2}
              // Relleno al 10 %: un lavado, no un bloque saturado. Con dos áreas
              // superpuestas, un relleno opaco esconde la de abajo.
              fill={color}
              fillOpacity={0.1}
              {...(apilado ? { stackId: 'a' } : {})}
              activeDot={{ r: 4, strokeWidth: 2, stroke: tokens.superficie }}
              isAnimationActive={false}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ──────────────────────────────- Barras ──────────────────────────────- */

export function GraficoBarras({
  datos,
  series,
  claveX = 'x',
  formato,
  horizontal = false,
  apilado = false,
}: {
  datos: Record<string, unknown>[];
  series: SerieGrafico[];
  claveX?: string;
  formato?: (valor: number) => string;
  /** Barras horizontales: obligatorio cuando las etiquetas son nombres largos. */
  horizontal?: boolean;
  apilado?: boolean;
}) {
  const tokens = useTokensGrafico();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={datos}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        barGap={2}
      >
        <CartesianGrid
          stroke={tokens.rejilla}
          strokeWidth={1}
          vertical={horizontal}
          horizontal={!horizontal}
        />
        {horizontal ? (
          <>
            <XAxis
              type="number"
              tick={{ fill: tokens.tenue, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              {...(formato ? { tickFormatter: formato } : {})}
            />
            <YAxis
              type="category"
              dataKey={claveX}
              tick={{ fill: tokens.tenue, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: tokens.rejilla }}
              width={140}
            />
          </>
        ) : (
          ejes(tokens, formato, claveX)
        )}
        <Tooltip
          content={<TooltipGrafico {...(formato ? { formato } : {})} />}
          cursor={{ fill: `color-mix(in srgb, ${tokens.tenue} 10%, transparent)` }}
        />
        {series.map((s, i) => (
          <Bar
            key={s.clave}
            dataKey={s.clave}
            name={s.nombre}
            fill={tokens.series[s.color ?? i] ?? tokens.series[0]}
            // Extremo redondeado en la punta y recto en la base, y un tope de
            // grosor: una barra que llena su banda entera lee como un bloque.
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={24}
            {...(apilado ? { stackId: 'a' } : {})}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─────────────────────────────── Donut ─────────────────────────────── */

/**
 * Donut de reparto.
 *
 * Solo para parte-de-un-todo y de un vistazo. Con más de seis trozos deja de
 * poder leerse, así que el resto se agrupa en «Otros» automáticamente en vez de
 * dibujar una tarta imposible. Para comparar valores parecidos, barras.
 */
export function GraficoDonut({
  datos,
  formato,
  centro,
}: {
  datos: { nombre: string; valor: number }[];
  formato?: (valor: number) => string;
  /** Texto del hueco: el total, normalmente. */
  centro?: { valor: string; etiqueta: string };
}) {
  const { t } = useTranslation();
  const tokens = useTokensGrafico();

  const trozos = useMemo(() => {
    const ordenados = [...datos].sort((a, b) => b.valor - a.valor);
    if (ordenados.length <= 6) return ordenados;
    const principales = ordenados.slice(0, 5);
    const resto = ordenados.slice(5).reduce((a, d) => a + d.valor, 0);
    return [...principales, { nombre: t('graficos.otros'), valor: resto }];
  }, [datos, t]);

  return (
    <div className="relative h-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<TooltipGrafico {...(formato ? { formato } : {})} />} />
          <Pie
            data={trozos}
            dataKey="valor"
            nameKey="nombre"
            innerRadius="62%"
            outerRadius="90%"
            // 2 px del color de la superficie entre trozos: separa sin dibujar
            // un borde, que sería tinta que no es dato.
            stroke={tokens.superficie}
            strokeWidth={2}
            isAnimationActive={false}
          >
            {trozos.map((d, i) => (
              <Cell key={d.nombre} fill={tokens.series[i % tokens.series.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {centro && (
        <div className="donut-centro" aria-hidden="true">
          <p className="text-xl font-semibold">{centro.valor}</p>
          <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {centro.etiqueta}
          </p>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────── Heatmap ────────────────────────────── */

/**
 * Mapa de calor.
 *
 * Para «cuándo pasa» —qué días y a qué horas entran los pedidos—, que es una
 * pregunta que una línea de 168 puntos no contesta. Un solo tono de claro a
 * oscuro, y el valor en el `title` de cada celda para quien no distingue los
 * escalones de color.
 */
export function Heatmap({
  filas,
  columnas,
  valores,
  formato,
  etiqueta,
}: {
  filas: string[];
  columnas: string[];
  /** valores[fila][columna]. */
  valores: number[][];
  formato?: (valor: number) => string;
  etiqueta: string;
}) {
  const tokens = useTokensGrafico();
  const maximo = Math.max(1, ...valores.flat());

  const color = (valor: number) => {
    if (valor === 0) return 'var(--fondo-sutil)';
    const escalon = Math.min(
      tokens.secuencial.length - 1,
      Math.floor((valor / maximo) * (tokens.secuencial.length - 1)),
    );
    return tokens.secuencial[escalon];
  };

  return (
    <div className="heatmap-caja">
      <table className="heatmap">
        <caption className="solo-lectores">{etiqueta}</caption>
        <thead>
          <tr>
            <th scope="col" className="solo-lectores">
              {etiqueta}
            </th>
            {columnas.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={f}>
              <th scope="row">{f}</th>
              {columnas.map((c, j) => {
                const valor = valores[i]?.[j] ?? 0;
                return (
                  <td key={c}>
                    <span
                      className="heatmap-celda"
                      style={{ background: color(valor) }}
                      title={`${f} · ${c}: ${formato ? formato(valor) : valor}`}
                    >
                      <span className="solo-lectores">
                        {f} {c}: {formato ? formato(valor) : valor}
                      </span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="heatmap-escala" aria-hidden="true">
        <span>0</span>
        {tokens.secuencial.map((c) => (
          <span key={c} className="heatmap-paso" style={{ background: c }} />
        ))}
        <span>{formato ? formato(maximo) : maximo}</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Gauge ─────────────────────────────── */

/**
 * Indicador de progreso hacia un objetivo.
 *
 * Un arco, el valor en el centro y el objetivo escrito. Sin agujas ni marcas de
 * velocímetro: adornan y no aportan precisión. El color solo cambia cuando el
 * estado cambia de verdad (por debajo del umbral), y va acompañado del texto.
 */
export function Gauge({
  valor,
  objetivo,
  formato,
  etiqueta,
  umbralAviso = 0.6,
}: {
  valor: number;
  objetivo: number;
  formato?: (valor: number) => string;
  etiqueta: string;
  /** Por debajo de esta fracción del objetivo, el arco avisa. */
  umbralAviso?: number;
}) {
  const fraccion = objetivo > 0 ? Math.min(valor / objetivo, 1) : 0;
  const radio = 70;
  const perimetro = Math.PI * radio; // Medio círculo.
  const color =
    fraccion >= 1 ? 'var(--exito)' : fraccion >= umbralAviso ? 'var(--serie-1)' : 'var(--aviso)';

  return (
    <div className="gauge">
      <svg viewBox="0 0 180 100" width="100%" height="100%" role="img" aria-label={etiqueta}>
        <path
          d="M 20 90 A 70 70 0 0 1 160 90"
          fill="none"
          stroke="var(--fondo-sutil)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M 20 90 A 70 70 0 0 1 160 90"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${perimetro * fraccion} ${perimetro}`}
        />
      </svg>
      <div className="gauge-texto">
        <p className="text-2xl font-semibold">{formato ? formato(valor) : valor}</p>
        <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {Math.round(fraccion * 100)}% · {formato ? formato(objetivo) : objetivo}
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────────── Sparkline ───────────────────────────── */

/**
 * Sparkline.
 *
 * La tendencia dentro de una tarjeta KPI: sin ejes, sin rejilla y sin números,
 * porque su trabajo es decir «sube» o «baja», no cuánto. El cuánto lo dice la
 * cifra que tiene al lado.
 *
 * Es decorativa para un lector de pantalla (`aria-hidden`): la información ya
 * está en el valor y en la comparativa, y leer 30 números seguidos no ayuda a
 * nadie.
 */
export function Sparkline({
  valores,
  color = 'var(--serie-1)',
  ancho = 96,
  alto = 28,
}: {
  valores: number[];
  color?: string;
  ancho?: number;
  alto?: number;
}) {
  if (valores.length < 2) return null;

  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const rango = max - min || 1;
  const paso = ancho / (valores.length - 1);

  const puntos = valores.map((v, i) => {
    const x = i * paso;
    // 2 px de margen arriba y abajo para que el trazo no se corte con el borde.
    const y = alto - 2 - ((v - min) / rango) * (alto - 4);
    return [x, y] as const;
  });

  const d = puntos
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const ultimo = puntos[puntos.length - 1];

  return (
    <svg
      width={ancho}
      height={alto}
      viewBox={`0 0 ${ancho} ${alto}`}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {ultimo && <circle cx={ultimo[0]} cy={ultimo[1]} r="2.5" fill={color} />}
    </svg>
  );
}
