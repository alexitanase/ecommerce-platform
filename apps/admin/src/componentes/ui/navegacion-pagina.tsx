import { useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouterState } from '@tanstack/react-router';
import { Enlace, type Ruta } from '@/componentes/enlace';
import { useNavegacion } from '@/lib/navegacion';

/**
 * Orientación dentro del panel: dónde estoy, qué puedo hacer aquí y cómo paso a
 * la siguiente página.
 *
 * Son piezas pequeñas pero es lo que convierte 25 pantallas sueltas en una sola
 * aplicación: el mismo sitio para el título, las mismas migas, las mismas
 * pestañas y la misma paginación en todas.
 */

/* ─────────────────────────────── Migas ─────────────────────────────── */

export interface Miga {
  etiqueta: string;
  ruta?: Ruta;
}

/**
 * Migas de pan.
 *
 * El grupo del menú y la pantalla actual salen solos de la navegación, así que
 * una pantalla normal no tiene que declarar nada. Las pantallas de detalle
 * añaden el último nivel —el número de pedido, el nombre del producto— que solo
 * ellas conocen.
 *
 * El último elemento no es un enlace: llevar a donde ya estás no es navegación,
 * es una trampa. Se marca con `aria-current="page"`.
 */
export function Migas({ extra = [] }: { extra?: Miga[] }) {
  const { t } = useTranslation();
  const { buscarRuta } = useNavegacion();
  const ruta = useRouterState({ select: (s) => s.location.pathname });
  const actual = buscarRuta(ruta);

  const migas: Miga[] = [
    { etiqueta: t('nav.panel'), ruta: '/' },
    ...(actual && actual.ruta !== '/'
      ? [
          ...(actual.grupo && actual.grupo !== actual.etiqueta ? [{ etiqueta: actual.grupo }] : []),
          { etiqueta: actual.etiqueta, ruta: actual.ruta },
        ]
      : []),
    ...extra,
  ];

  if (migas.length <= 1) return null;

  return (
    <nav aria-label={t('ui.migas')} className="migas">
      <ol>
        {migas.map((m, i) => {
          const ultima = i === migas.length - 1;
          return (
            <li key={`${m.etiqueta}-${i}`}>
              {i > 0 && (
                <span aria-hidden="true" className="migas-separador">
                  /
                </span>
              )}
              {m.ruta && !ultima ? (
                <Enlace a={m.ruta} className="migas-enlace">
                  {m.etiqueta}
                </Enlace>
              ) : (
                <span {...(ultima ? { 'aria-current': 'page' as const } : {})}>{m.etiqueta}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ─────────────────────────── Cabecera de página ─────────────────────────── */

/**
 * Cabecera de pantalla.
 *
 * Existe porque las 27 pantallas del panel la escribían a mano y habían
 * derivado en tres convenciones distintas de espaciado: al navegar entre
 * pantallas el contenido daba un salto de unos píxeles, que es el tipo de
 * incoherencia que no se sabe nombrar pero se nota.
 *
 * Unifica además tres cosas que estaban a medias:
 *
 *  · **El recuento.** Varias pantallas ponían `items.length` junto al título.
 *    Como las listas venían cortadas por el servidor, ese número era el de la
 *    página, no el del total: «Pedidos 50» con trescientos pedidos en la base.
 *    Aquí se distingue lo cargado de lo que hay (`hayMas`).
 *  · **Las acciones.** Siempre arriba a la derecha, que es donde se buscan.
 *  · **La frescura del dato.** Cuándo se leyó lo que se está mirando. Sin eso,
 *    una pantalla abierta desde ayer parece de ahora mismo.
 */
export function CabeceraPagina({
  titulo,
  descripcion,
  cargados,
  hayMas,
  acciones,
  migas,
  sinMigas = false,
  frescura,
}: {
  titulo: string;
  descripcion?: string;
  cargados?: number;
  hayMas?: boolean;
  acciones?: ReactNode;
  /** Niveles adicionales por debajo de la pantalla actual. */
  migas?: Miga[];
  sinMigas?: boolean;
  /** Marca de «actualizado hace X» (ver `Frescura`). */
  frescura?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="cabecera-pagina">
      {!sinMigas && <Migas extra={migas} />}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
            {cargados !== undefined && (
              <span
                className="etiqueta cifra"
                style={{ background: 'var(--fondo-sutil)', color: 'var(--texto-tenue)' }}
              >
                {hayMas ? t('app.cargados_y_mas', { n: cargados }) : cargados}
              </span>
            )}
          </div>
          {descripcion && (
            <p className="mt-1 max-w-2xl text-sm" style={{ color: 'var(--texto-tenue)' }}>
              {descripcion}
            </p>
          )}
          {frescura && <div className="mt-1">{frescura}</div>}
        </div>

        {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      </div>
    </div>
  );
}

/* ────────────────────────────── Pestañas ────────────────────────────── */

export interface Pestana {
  id: string;
  etiqueta: string;
  /** Contador opcional; útil en bandejas («Pendientes 3»). */
  cantidad?: number;
  contenido: ReactNode;
}

/**
 * Pestañas.
 *
 * Con el patrón de ARIA completo, que es más de lo que parece: solo la pestaña
 * activa es tabulable, las flechas mueven entre ellas y Inicio/Fin saltan a los
 * extremos. Sin eso, recorrer ocho pestañas con teclado son ocho tabulaciones
 * antes de llegar al contenido.
 *
 * Se puede controlar desde fuera (`valor` + `alCambiar`) para que la pestaña
 * activa viva en la URL y una vista se pueda compartir tal cual está.
 */
export function Pestanas({
  pestanas,
  valor,
  alCambiar,
  etiqueta,
}: {
  pestanas: Pestana[];
  valor?: string;
  alCambiar?: (id: string) => void;
  etiqueta: string;
}) {
  const [interno, setInterno] = useState(pestanas[0]?.id ?? '');
  const activa = valor ?? interno;
  const lista = useRef<HTMLDivElement>(null);
  const base = useId();

  const cambiar = (id: string) => {
    setInterno(id);
    alCambiar?.(id);
  };

  const mover = (paso: 1 | -1 | 'inicio' | 'fin') => {
    const i = pestanas.findIndex((p) => p.id === activa);
    const destino =
      paso === 'inicio'
        ? 0
        : paso === 'fin'
          ? pestanas.length - 1
          : (i + paso + pestanas.length) % pestanas.length;
    const siguiente = pestanas[destino];
    if (!siguiente) return;
    cambiar(siguiente.id);
    lista.current?.querySelector<HTMLElement>(`#${CSS.escape(`${base}-${siguiente.id}`)}`)?.focus();
  };

  return (
    <>
      <div ref={lista} role="tablist" aria-label={etiqueta} className="pestanas">
        {pestanas.map((p) => {
          const seleccionada = p.id === activa;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`${base}-${p.id}`}
              aria-selected={seleccionada}
              aria-controls={`${base}-panel-${p.id}`}
              // Solo la activa entra en el orden de tabulación: el resto se
              // alcanza con las flechas, que es el patrón que espera un lector.
              tabIndex={seleccionada ? 0 : -1}
              className={`pestana ${seleccionada ? 'pestana-activa' : ''}`}
              onClick={() => cambiar(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  mover(1);
                } else if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  mover(-1);
                } else if (e.key === 'Home') {
                  e.preventDefault();
                  mover('inicio');
                } else if (e.key === 'End') {
                  e.preventDefault();
                  mover('fin');
                }
              }}
            >
              {p.etiqueta}
              {p.cantidad !== undefined && (
                <span className="pestana-cifra cifra">{p.cantidad}</span>
              )}
            </button>
          );
        })}
      </div>

      {pestanas.map((p) => (
        <div
          key={p.id}
          role="tabpanel"
          id={`${base}-panel-${p.id}`}
          aria-labelledby={`${base}-${p.id}`}
          hidden={p.id !== activa}
          tabIndex={0}
          className="pestana-panel"
        >
          {p.id === activa && p.contenido}
        </div>
      ))}
    </>
  );
}

/* ───────────────────────────── Paginación ───────────────────────────── */

/**
 * Paginación numerada.
 *
 * Para las listas que sí saben cuántas páginas hay. Donde el servidor pagina
 * por cursor —pedidos, productos, auditoría— se sigue usando `VerMas`: fingir
 * «página 7» obligaría a contar todas las filas en cada petición, que es
 * justamente lo que el cursor evita.
 *
 * Los saltos se marcan con «…» y nunca se pintan veinte números: con más de
 * siete páginas se enseñan las de los extremos y el entorno de la actual.
 */
export function Paginacion({
  pagina,
  totalPaginas,
  alCambiar,
  etiqueta,
}: {
  /** Página actual, empezando en 1. */
  pagina: number;
  totalPaginas: number;
  alCambiar: (pagina: number) => void;
  etiqueta?: string;
}) {
  const { t } = useTranslation();
  if (totalPaginas <= 1) return null;

  const numeros: (number | '…')[] = [];
  for (let i = 1; i <= totalPaginas; i++) {
    const cerca = Math.abs(i - pagina) <= 1;
    const extremo = i === 1 || i === totalPaginas;
    if (cerca || extremo) numeros.push(i);
    else if (numeros[numeros.length - 1] !== '…') numeros.push('…');
  }

  return (
    <nav aria-label={etiqueta ?? t('ui.paginacion')} className="paginacion">
      <button
        type="button"
        className="pagina-boton objetivo"
        disabled={pagina <= 1}
        onClick={() => alCambiar(pagina - 1)}
      >
        {t('ui.anterior')}
      </button>

      {numeros.map((n, i) =>
        n === '…' ? (
          <span key={`salto-${i}`} className="pagina-salto" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            className={`pagina-boton objetivo cifra ${n === pagina ? 'pagina-activa' : ''}`}
            aria-current={n === pagina ? 'page' : undefined}
            aria-label={t('ui.ir_a_pagina', { n })}
            onClick={() => alCambiar(n)}
          >
            {n}
          </button>
        ),
      )}

      <button
        type="button"
        className="pagina-boton objetivo"
        disabled={pagina >= totalPaginas}
        onClick={() => alCambiar(pagina + 1)}
      >
        {t('ui.siguiente')}
      </button>
    </nav>
  );
}
