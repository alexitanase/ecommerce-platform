import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Boton, GrupoBotones } from './boton';

/**
 * Calendario mensual.
 *
 * Contesta la pregunta que ni la tabla ni el tablero contestan: **cuándo**.
 * Qué días entran los pedidos, qué días no entra ninguno y en qué días se
 * acumulan las entregas. Una lista ordenada por fecha no enseña el hueco de
 * tres días sin ventas; una rejilla de mes, sí.
 *
 * Es una `<table>` de verdad, con `scope` en los días de la semana y `time` en
 * cada fecha, porque una cuadrícula de `div`s no se puede recorrer con lector
 * de pantalla. Cada día es un botón: se llega con Tab y se abre con Enter.
 */

export interface EventoCalendario {
  /** Fecha en formato ISO (YYYY-MM-DD o fecha completa). */
  fecha: string;
  cantidad: number;
  /** Segundo dato del día: importe, margen… ya formateado. */
  detalle?: string;
  tono?: 'neutro' | 'exito' | 'aviso' | 'error';
}

const claveDia = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function Calendario({
  eventos,
  mesInicial,
  alElegirDia,
  etiqueta,
  pie,
}: {
  eventos: EventoCalendario[];
  mesInicial?: Date;
  alElegirDia?: (fecha: string) => void;
  etiqueta: string;
  pie?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [mes, setMes] = useState(() => {
    const base = mesInicial ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const porDia = useMemo(() => {
    const mapa = new Map<string, EventoCalendario>();
    for (const e of eventos) {
      const clave = claveDia(new Date(e.fecha));
      const previo = mapa.get(clave);
      mapa.set(
        clave,
        previo
          ? {
              ...previo,
              cantidad: previo.cantidad + e.cantidad,
              detalle: e.detalle ?? previo.detalle,
            }
          : { ...e, fecha: clave },
      );
    }
    return mapa;
  }, [eventos]);

  const maximo = Math.max(1, ...[...porDia.values()].map((e) => e.cantidad));

  /*
   * La semana empieza en lunes: es lo que espera quien trabaja en España, y
   * `getDay()` devuelve 0 para el domingo, así que hay que desplazarlo.
   */
  const primerDia = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const desplazamiento = (primerDia.getDay() + 6) % 7;
  const diasDelMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();

  const celdas: (Date | null)[] = [
    ...Array.from({ length: desplazamiento }, () => null),
    ...Array.from(
      { length: diasDelMes },
      (_, i) => new Date(mes.getFullYear(), mes.getMonth(), i + 1),
    ),
  ];
  while (celdas.length % 7 !== 0) celdas.push(null);

  const semanas: (Date | null)[][] = [];
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));

  const nombresDia = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(
      // 2024-01-01 fue lunes: sirve de ancla para sacar los nombres en orden.
      new Date(2024, 0, 1 + i),
    ),
  );

  const hoy = claveDia(new Date());

  return (
    <div>
      <div className="calendario-barra">
        <h3 className="text-sm font-semibold">
          {new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(mes)}
        </h3>
        <GrupoBotones etiqueta={t('calendario.navegacion')}>
          <Boton
            tamano="sm"
            soloIcono
            etiqueta={t('calendario.mes_anterior')}
            onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
            icono={<span aria-hidden="true">‹</span>}
          />
          <Boton
            tamano="sm"
            onClick={() => setMes(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
          >
            {t('calendario.hoy')}
          </Boton>
          <Boton
            tamano="sm"
            soloIcono
            etiqueta={t('calendario.mes_siguiente')}
            onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
            icono={<span aria-hidden="true">›</span>}
          />
        </GrupoBotones>
      </div>

      <table className="calendario">
        <caption className="solo-lectores">{etiqueta}</caption>
        <thead>
          <tr>
            {nombresDia.map((d) => (
              <th key={d} scope="col">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semanas.map((semana, i) => (
            <tr key={i}>
              {semana.map((dia, j) => {
                if (!dia) return <td key={j} className="calendario-fuera" />;

                const clave = claveDia(dia);
                const evento = porDia.get(clave);
                const intensidad = evento ? 0.15 + (evento.cantidad / maximo) * 0.45 : 0;
                const color =
                  evento?.tono && evento.tono !== 'neutro'
                    ? `var(--${evento.tono})`
                    : 'var(--serie-1)';

                return (
                  <td key={clave}>
                    <button
                      type="button"
                      className={`calendario-dia ${clave === hoy ? 'calendario-hoy' : ''}`}
                      disabled={!alElegirDia}
                      onClick={() => alElegirDia?.(clave)}
                      style={
                        evento
                          ? {
                              background: `color-mix(in srgb, ${color} ${intensidad * 100}%, transparent)`,
                            }
                          : undefined
                      }
                    >
                      <time dateTime={clave} className="calendario-numero cifra">
                        {dia.getDate()}
                      </time>
                      {evento && (
                        <>
                          <span className="calendario-cantidad cifra">{evento.cantidad}</span>
                          {evento.detalle && (
                            <span className="calendario-detalle">{evento.detalle}</span>
                          )}
                        </>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {pie && (
        <div className="mt-3 text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {pie}
        </div>
      )}
    </div>
  );
}
