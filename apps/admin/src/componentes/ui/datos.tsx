import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Piezas para presentar datos que no son una tabla.
 *
 * Todas comparten la misma escala de espaciado y los mismos tokens, que es lo
 * que hace que una ficha de pedido y una de cliente se parezcan aunque las
 * escribiera otra persona seis meses después.
 */

/* ─────────────────────────────── Tarjeta ─────────────────────────────── */

/**
 * Tarjeta con cabecera.
 *
 * El título es un `h3` de verdad y no un `p` en negrita: el índice de
 * encabezados es como se recorre una pantalla larga con lector de pantalla, y
 * una ficha de pedido con ocho bloques sin encabezado es una pared de texto.
 */
export function Tarjeta({
  titulo,
  descripcion,
  acciones,
  children,
  pie,
  className = '',
}: {
  titulo?: string;
  descripcion?: string;
  acciones?: ReactNode;
  children: ReactNode;
  pie?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel tarjeta ${className}`}>
      {(titulo || acciones) && (
        <header className="tarjeta-cabecera">
          <div className="min-w-0">
            {titulo && <h3 className="text-sm font-semibold">{titulo}</h3>}
            {descripcion && (
              <p className="mt-0.5 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                {descripcion}
              </p>
            )}
          </div>
          {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
        </header>
      )}
      <div className="tarjeta-cuerpo">{children}</div>
      {pie && <footer className="tarjeta-pie">{pie}</footer>}
    </section>
  );
}

/* ──────────────────────── Lista clave · valor ──────────────────────── */

/**
 * Ficha de datos.
 *
 * Es una `<dl>` de verdad —`dt` para el nombre y `dd` para el valor— y no dos
 * columnas de `div`s: la relación entre el rótulo y su dato es lo único que
 * hace legible una ficha, y en una cuadrícula de `div`s esa relación solo
 * existe visualmente.
 */
export function ListaDatos({
  datos,
  columnas = 2,
}: {
  datos: { nombre: string; valor: ReactNode; ancho?: boolean }[];
  columnas?: 1 | 2 | 3;
}) {
  return (
    <dl className={`lista-datos lista-datos-${columnas}`}>
      {datos.map((d, i) => (
        <div key={`${d.nombre}-${i}`} className={d.ancho ? 'lista-datos-ancho' : undefined}>
          <dt>{d.nombre}</dt>
          <dd>{d.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ────────────────────────────── Timeline ────────────────────────────── */

export interface HitoTimeline {
  id: string;
  titulo: string;
  descripcion?: ReactNode;
  cuando: string;
  tono?: 'neutro' | 'exito' | 'aviso' | 'error' | 'info';
  autor?: string;
}

/**
 * Línea de actividad.
 *
 * Para el historial de un pedido o de una devolución: qué pasó, cuándo y quién
 * lo hizo. Es una lista ordenada porque el orden ES el dato; el hilo vertical
 * es decoración y se oculta a los lectores.
 *
 * El punto de cada hito cambia de forma además de color, para que «entregado» y
 * «fallido» no se distingan solo por el verde y el rojo.
 */
export function Timeline({ hitos }: { hitos: HitoTimeline[] }) {
  return (
    <ol className="timeline">
      {hitos.map((h) => (
        <li key={h.id}>
          <span
            className="timeline-punto"
            aria-hidden="true"
            style={{
              background: `var(--${h.tono && h.tono !== 'neutro' ? h.tono : 'texto-tenue'})`,
              borderRadius: h.tono === 'error' ? '2px' : '999px',
            }}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">{h.titulo}</p>
            {h.descripcion && (
              <div className="mt-0.5 text-sm" style={{ color: 'var(--texto-suave)' }}>
                {h.descripcion}
              </div>
            )}
            <p className="mt-0.5 text-xs" style={{ color: 'var(--texto-tenue)' }}>
              <time>{h.cuando}</time>
              {h.autor && ` · ${h.autor}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ────────────────────────────── Progreso ────────────────────────────── */

/**
 * Barra de progreso.
 *
 * Con `role="progressbar"` y sus tres valores, y con el porcentaje escrito al
 * lado: una barra sin número obliga a estimar a ojo, y a ojo un 60 % y un 70 %
 * son lo mismo.
 */
export function Progreso({
  valor,
  maximo = 100,
  etiqueta,
  tono = 'marca',
  mostrarValor = true,
}: {
  valor: number;
  maximo?: number;
  etiqueta: string;
  tono?: 'marca' | 'exito' | 'aviso' | 'error';
  mostrarValor?: boolean;
}) {
  const porcentaje = maximo > 0 ? Math.min(100, Math.round((valor / maximo) * 100)) : 0;
  const color = tono === 'marca' ? 'var(--marca-primario)' : `var(--${tono})`;

  return (
    <div className="progreso-caja">
      <div
        className="progreso"
        role="progressbar"
        aria-valuenow={valor}
        aria-valuemin={0}
        aria-valuemax={maximo}
        aria-label={etiqueta}
      >
        <span className="progreso-relleno" style={{ width: `${porcentaje}%`, background: color }} />
      </div>
      {mostrarValor && <span className="progreso-valor cifra">{porcentaje}%</span>}
    </div>
  );
}

/* ──────────────────────────── Insignias ──────────────────────────── */

/**
 * Contador de aviso.
 *
 * Distinto de `Etiqueta`: aquella nombra un estado, esta cuenta cosas
 * pendientes. Siempre con texto accesible, porque un número suelto no dice de
 * qué.
 */
export function Insignia({
  cantidad,
  etiqueta,
  tono = 'neutro',
}: {
  cantidad: number;
  etiqueta: string;
  tono?: 'neutro' | 'error' | 'aviso' | 'info';
}) {
  const color = tono === 'neutro' ? 'var(--texto-tenue)' : `var(--${tono})`;

  return (
    <span
      className="insignia cifra"
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
    >
      <span aria-hidden="true">{cantidad > 99 ? '99+' : cantidad}</span>
      <span className="solo-lectores">
        {cantidad} {etiqueta}
      </span>
    </span>
  );
}

/** Etiqueta libre, opcionalmente quitable (filtros aplicados, atributos). */
export function Tag({
  texto,
  alQuitar,
  color,
}: {
  texto: string;
  alQuitar?: () => void;
  color?: string;
}) {
  const { t } = useTranslation();

  return (
    <span className="tag" style={color ? { borderColor: color } : undefined}>
      {color && <span className="tag-punto" style={{ background: color }} aria-hidden="true" />}
      {texto}
      {alQuitar && (
        <button
          type="button"
          onClick={alQuitar}
          className="tag-quitar objetivo"
          aria-label={t('ui.quitar', { que: texto })}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </span>
  );
}

/* ─────────────────────────────── Avatar ─────────────────────────────── */

/**
 * Avatar por iniciales.
 *
 * No hay fotos de perfil en el panel y no hacen falta: el color sale del propio
 * nombre, así que la misma persona tiene siempre el mismo, y las iniciales
 * distinguen mejor que una foto de 24 px.
 */
export function Avatar({ nombre, tamano = 28 }: { nombre: string; tamano?: number }) {
  const iniciales = nombre
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  // Suma de códigos para elegir la serie: determinista y sin estado.
  const indice = [...nombre].reduce((a, c) => a + c.charCodeAt(0), 0) % 8;

  return (
    <span
      className="avatar-inicial"
      style={{
        width: tamano,
        height: tamano,
        fontSize: Math.round(tamano * 0.4),
        background: `color-mix(in srgb, var(--serie-${indice + 1}) 18%, transparent)`,
        color: 'var(--texto)',
      }}
      // La imagen ya la da el texto de al lado; aquí sobra repetirlo.
      aria-hidden="true"
    >
      {iniciales || '?'}
    </span>
  );
}

/** Grupo de avatares apilados, con el resto contado. */
export function GrupoAvatares({ nombres, maximo = 4 }: { nombres: string[]; maximo?: number }) {
  const visibles = nombres.slice(0, maximo);
  const resto = nombres.length - visibles.length;

  return (
    <span className="grupo-avatares">
      {visibles.map((n) => (
        <Avatar key={n} nombre={n} tamano={24} />
      ))}
      {resto > 0 && <span className="avatar-resto cifra">+{resto}</span>}
      <span className="solo-lectores">{nombres.join(', ')}</span>
    </span>
  );
}

/* ─────────────────────────────── Listas ─────────────────────────────── */

/**
 * Lista de elementos con acción.
 *
 * La alternativa a una tabla cuando cada fila tiene dos datos y un enlace:
 * montar una tabla de dos columnas para eso es peor en móvil y no aporta nada.
 */
export function Lista({
  items,
}: {
  items: {
    id: string;
    principal: ReactNode;
    secundario?: ReactNode;
    derecha?: ReactNode;
    alPulsar?: () => void;
  }[];
}) {
  return (
    <ul className="lista">
      {items.map((i) => (
        <li key={i.id}>
          {i.alPulsar ? (
            <button type="button" className="lista-linea" onClick={i.alPulsar}>
              <ContenidoLinea {...i} />
            </button>
          ) : (
            <div className="lista-linea">
              <ContenidoLinea {...i} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function ContenidoLinea({
  principal,
  secundario,
  derecha,
}: {
  principal: ReactNode;
  secundario?: ReactNode;
  derecha?: ReactNode;
}) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{principal}</span>
        {secundario && (
          <span className="block truncate text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {secundario}
          </span>
        )}
      </span>
      {derecha && <span className="flex-shrink-0 text-sm">{derecha}</span>}
    </>
  );
}
