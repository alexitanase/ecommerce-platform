import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkline } from './graficos';
import { Tooltip } from './overlays';

/**
 * Tarjetas de indicador.
 *
 * La regla que las gobierna: **ningún número se enseña solo**. Un «1.240 €» sin
 * nada al lado no dice si el día ha ido bien o mal, y es exactamente sobre esa
 * clase de cifra sobre la que se toman decisiones equivocadas. Por eso la
 * comparativa contra el periodo anterior es obligatoria por tipos: o se pasa
 * `anterior`, o se declara por qué no la hay.
 *
 * Lo demás también está pensado:
 *
 *  · **La variación no es solo color.** Lleva signo y flecha, así que se lee sin
 *    distinguir el verde del rojo.
 *  · **Subir no siempre es bueno.** Los costes, las devoluciones y las
 *    incidencias empeoran al crecer; `subirEsBueno` decide el color, no el
 *    signo.
 *  · **La definición está a mano.** «Ticket medio» significa cosas distintas
 *    según quién lo diga; el tooltip dice exactamente qué se ha calculado.
 *  · **El valor grande usa cifras proporcionales** y solo la variación va con
 *    cifras tabulares: a tamaño grande, el ancho fijo de dígito deja huecos.
 */

interface Comun {
  titulo: string;
  /** Ya formateado: la tarjeta no sabe si son euros, unidades o porcentaje. */
  valor: string;
  /** Qué mide exactamente. Sale en un tooltip junto al título. */
  definicion?: string;
  /** Serie para la tendencia; suele ser el mismo periodo día a día. */
  serie?: number[];
  subirEsBueno?: boolean;
  /** Enlace a la pantalla donde se actúa sobre esta cifra. */
  accion?: ReactNode;
  destacado?: boolean;
}

type PropsKpi = Comun &
  (
    | {
        /** Valor bruto actual y del periodo anterior, para calcular la variación. */
        actual: number;
        anterior: number;
        sinComparativa?: never;
      }
    | {
        actual?: never;
        anterior?: never;
        /**
         * Motivo por el que esta cifra no tiene comparativa (stock actual, saldo,
         * cosas que no son de un periodo). Se escribe, no se calla.
         */
        sinComparativa: string;
      }
  );

export function TarjetaKpi({
  titulo,
  valor,
  definicion,
  serie,
  subirEsBueno = true,
  accion,
  destacado = false,
  actual,
  anterior,
  sinComparativa,
}: PropsKpi) {
  const { t } = useTranslation();
  const idValor = useId();

  const variacion =
    actual !== undefined && anterior !== undefined && anterior !== 0
      ? ((actual - anterior) / Math.abs(anterior)) * 100
      : undefined;

  // Sin periodo anterior no se inventa un «+100 %»: se dice que antes no había
  // nada, que es una información distinta y más honesta.
  const sinBase = actual !== undefined && anterior === 0;

  const mejora = variacion === undefined ? null : subirEsBueno ? variacion >= 0 : variacion <= 0;
  const color = mejora === null ? 'var(--texto-tenue)' : mejora ? 'var(--exito)' : 'var(--error)';
  const flecha = variacion === undefined ? '' : variacion > 0 ? '▲' : variacion < 0 ? '▼' : '■';

  return (
    <article className={`kpi ${destacado ? 'kpi-destacado' : ''}`} aria-labelledby={idValor}>
      <header className="kpi-titulo">
        <span id={idValor}>{titulo}</span>
        {definicion && (
          <Tooltip texto={definicion} posicion="abajo">
            <span className="kpi-info" tabIndex={0} role="note" aria-label={definicion}>
              ?
            </span>
          </Tooltip>
        )}
      </header>

      <div className="kpi-fila">
        <p className="kpi-valor">{valor}</p>
        {serie && serie.length > 1 && (
          <Sparkline valores={serie} color={destacado ? 'var(--serie-1)' : 'var(--serie-7)'} />
        )}
      </div>

      <p className="kpi-delta" style={{ color: variacion === undefined ? undefined : color }}>
        {variacion !== undefined ? (
          <>
            <span aria-hidden="true">{flecha}</span>{' '}
            <span className="cifra font-medium">
              {variacion > 0 ? '+' : ''}
              {variacion.toFixed(1).replace('.', ',')}%
            </span>{' '}
            <span style={{ color: 'var(--texto-tenue)' }}>{t('kpi.vs_anterior')}</span>
          </>
        ) : sinBase ? (
          <span style={{ color: 'var(--texto-tenue)' }}>{t('kpi.sin_base')}</span>
        ) : (
          <span style={{ color: 'var(--texto-tenue)' }}>{sinComparativa}</span>
        )}
      </p>

      {accion && <div className="mt-2">{accion}</div>}
    </article>
  );
}

/**
 * Fila de indicadores.
 *
 * Cuatro como mucho. Con seis, ninguno destaca y la pantalla deja de contestar
 * una pregunta para pasar a enumerar cifras; lo que sobra va a su propia
 * pantalla o a un gráfico.
 */
export function FilaKpis({ children }: { children: ReactNode }) {
  return <div className="rejilla kpis">{children}</div>;
}
