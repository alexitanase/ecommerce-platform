import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { fechaRelativa } from '@/lib/formato';
import { useAhora } from '@/lib/reloj';

/**
 * Estados de un bloque de datos.
 *
 * Todo bloque que enseñe datos del servidor tiene que saber pintar cinco cosas,
 * no una: cargando, vacío, error, sin permiso y dato viejo. Cuando falta
 * alguno, el hueco lo rellena la interpretación de quien mira, y siempre lo
 * hace mal: una tabla vacía por un filtro se lee como «no he vendido nada», y
 * unas tarjetas a cero porque la API no respondió se leen como un mal día.
 *
 * `BloqueDatos` obliga a resolverlos todos: es el envoltorio que decide qué
 * pintar, así que una pantalla nueva no puede olvidarse de ninguno.
 */

/* ─────────────────────────────── Carga ─────────────────────────────── */

/**
 * Bloque de carga con la forma aproximada del contenido que va a aparecer.
 *
 * Lleva `role="status"` y no solo `aria-label`: una etiqueta sobre un `div` sin
 * rol la ignoran los lectores de pantalla —y axe la marca como infracción—, así
 * que el aviso de «cargando» no llegaba a quien más lo necesita, que es quien
 * no ve moverse el esqueleto.
 */
export function Cargando({
  filas = 5,
  forma = 'filas',
}: {
  filas?: number;
  /** La silueta importa: un esqueleto con otra forma provoca un salto al llegar el dato. */
  forma?: 'filas' | 'tarjetas' | 'grafico' | 'texto';
}) {
  const { t } = useTranslation();

  if (forma === 'grafico') {
    return (
      <div role="status" aria-busy="true" aria-label={t('app.cargando')}>
        <div className="esqueleto h-56 w-full" />
      </div>
    );
  }

  if (forma === 'tarjetas') {
    return (
      <div className="rejilla" role="status" aria-busy="true" aria-label={t('app.cargando')}>
        {Array.from({ length: filas }, (_, i) => (
          <div key={i} className="col-3 esqueleto h-24" />
        ))}
      </div>
    );
  }

  if (forma === 'texto') {
    return (
      <div className="space-y-2" role="status" aria-busy="true" aria-label={t('app.cargando')}>
        {Array.from({ length: filas }, (_, i) => (
          <div key={i} className="esqueleto h-4" style={{ width: `${100 - i * 8}%` }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2" role="status" aria-busy="true" aria-label={t('app.cargando')}>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="esqueleto h-12" />
      ))}
    </div>
  );
}

/* ─────────────────────────────── Vacío ─────────────────────────────── */

/**
 * Estado vacío, con acción para salir de él.
 *
 * La acción no es un adorno: una pantalla vacía sin salida deja a quien llega
 * buscando en el menú cómo se crea lo que le falta.
 */
export function Vacio({
  titulo,
  descripcion,
  accion,
  icono,
}: {
  titulo: string;
  descripcion?: string;
  accion?: ReactNode;
  icono?: ReactNode;
}) {
  return (
    <div className="panel estado-bloque">
      {icono && (
        <span className="estado-icono" aria-hidden="true">
          {icono}
        </span>
      )}
      <p className="font-medium">{titulo}</p>
      {descripcion && (
        <p className="mt-1 text-sm" style={{ color: 'var(--texto-tenue)' }}>
          {descripcion}
        </p>
      )}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  );
}

/**
 * Una búsqueda o un filtro que no ha devuelto nada.
 *
 * No es lo mismo que `Vacio` y confundirlos despista de verdad: la pantalla de
 * pedidos decía «Aún no hay pedidos» cuando lo que pasaba era que el filtro
 * estaba puesto en «Cancelado». Quien lo lee entiende que no ha vendido nada.
 *
 * Por eso lleva siempre la salida —quitar los filtros— en vez de dejar a quien
 * mira buscando cuál de los tres controles de arriba tiene puesto.
 */
export function SinResultados({ alLimpiar }: { alLimpiar?: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="panel estado-bloque">
      <p className="font-medium">{t('app.sin_resultados')}</p>
      <p className="mt-1 text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('app.sin_resultados_ayuda')}
      </p>
      {alLimpiar && (
        <button type="button" onClick={alLimpiar} className="btn btn-secundario mt-4">
          {t('app.limpiar_filtros')}
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────── Error ─────────────────────────────── */

/**
 * Error con su traceId.
 *
 * Mostrar el identificador no es un detalle técnico inútil: es lo que permite
 * que quien reporta el problema dé un dato con el que encontrar la traza
 * exacta en el log, en lugar de "me ha dado error".
 */
export function ErrorPanel({ error, reintentar }: { error: unknown; reintentar?: () => void }) {
  const { t } = useTranslation();
  const mensaje = error instanceof Error ? error.message : String(error);
  const traceId =
    error && typeof error === 'object' && 'traceId' in error
      ? String((error as { traceId?: string }).traceId ?? '')
      : '';

  return (
    <div className="panel estado-bloque" role="alert">
      <p className="font-medium" style={{ color: 'var(--error)' }}>
        {t('app.error')}
      </p>
      <p className="mt-1 text-sm" style={{ color: 'var(--texto-suave)' }}>
        {mensaje}
      </p>
      {traceId && (
        <p className="mt-2 font-mono text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {traceId}
        </p>
      )}
      {reintentar && (
        <button type="button" onClick={reintentar} className="btn btn-secundario mt-4">
          {t('app.reintentar')}
        </button>
      )}
    </div>
  );
}

/**
 * Sin permiso para ver este bloque.
 *
 * No es un error y no debe parecerlo: nada está roto y reintentar no va a
 * arreglarlo. Lo único útil es decir a quién pedírselo.
 */
export function SinPermiso({ permiso }: { permiso?: string }) {
  const { t } = useTranslation();

  return (
    <div className="panel estado-bloque">
      <p className="font-medium">{t('estados.sin_permiso')}</p>
      <p className="mt-1 text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('estados.sin_permiso_ayuda')}
      </p>
      {permiso && (
        <p className="mt-2 font-mono text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {permiso}
        </p>
      )}
    </div>
  );
}

/* ────────────────────────── Frescura del dato ────────────────────────── */

/**
 * «Actualizado hace X».
 *
 * Una pantalla del panel puede llevar horas abierta en una pestaña de fondo.
 * Sin esta marca, el dato de ayer a las seis parece el de ahora mismo, y sobre
 * eso se toman decisiones. Cuando el dato pasa de viejo, además, avisa y ofrece
 * releer.
 */
export function Frescura({
  actualizado,
  refrescando = false,
  alRefrescar,
  umbralViejo = 300_000,
}: {
  /** Momento en milisegundos en que se leyó el dato. */
  actualizado: number;
  refrescando?: boolean;
  alRefrescar?: () => void;
  /** A partir de cuándo se considera viejo. Cinco minutos por defecto. */
  umbralViejo?: number;
}) {
  const { t, i18n } = useTranslation();
  // El reloj se relee cada medio minuto: sin eso, «hace 2 minutos» se queda
  // escrito para siempre y la marca de frescura miente más que no ponerla.
  const ahora = useAhora(30_000);
  if (!actualizado) return null;

  const viejo = ahora - actualizado > umbralViejo;

  return (
    <p className="frescura" style={viejo ? { color: 'var(--aviso)' } : undefined}>
      {refrescando ? (
        t('app.cargando')
      ) : (
        <>
          {viejo && <span aria-hidden="true">⚠ </span>}
          {t('ui.actualizado_hace', {
            cuando: fechaRelativa(new Date(actualizado), i18n.language),
          })}
          {alRefrescar && (
            <>
              {' · '}
              <button type="button" className="enlace-sutil" onClick={alRefrescar}>
                {t('ui.actualizar')}
              </button>
            </>
          )}
        </>
      )}
    </p>
  );
}

/* ────────────────────────── Alertas en línea ────────────────────────── */

/**
 * Alerta dentro del flujo.
 *
 * Para lo que hay que leer sí o sí antes de seguir (a diferencia del toast, que
 * se va solo). Con `role="alert"` cuando es un error, para que se anuncie al
 * aparecer, y con icono además de color.
 */
export function Alerta({
  tono = 'info',
  titulo,
  children,
  accion,
}: {
  tono?: 'info' | 'exito' | 'aviso' | 'error';
  titulo?: string;
  children?: ReactNode;
  accion?: ReactNode;
}) {
  const color = `var(--${tono})`;

  return (
    <div
      className="alerta"
      role={tono === 'error' ? 'alert' : undefined}
      style={{
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      <span aria-hidden="true" className="alerta-marca" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        {titulo && (
          <p className="text-sm font-medium" style={{ color }}>
            {titulo}
          </p>
        )}
        {children && <div className="text-sm">{children}</div>}
      </div>
      {accion && <div className="flex-shrink-0">{accion}</div>}
    </div>
  );
}

/* ───────────────────────────── Ver más ───────────────────────────── */

/**
 * Botón de traer la página siguiente.
 *
 * Se prefiere a la paginación numerada porque el servidor pagina por cursor:
 * no existe «página 7», solo «lo siguiente a esto». Fingir números obligaría a
 * contar filas en cada petición para saber cuántas páginas hay, que es
 * justamente lo que la paginación por cursor evita.
 */
export function VerMas({
  hayMas,
  cargando,
  alPulsar,
}: {
  hayMas: boolean;
  cargando: boolean;
  alPulsar: () => void;
}) {
  const { t } = useTranslation();
  if (!hayMas) return null;

  return (
    <div className="mt-4 flex justify-center">
      <button
        type="button"
        onClick={alPulsar}
        disabled={cargando}
        className="btn btn-secundario"
        aria-busy={cargando}
      >
        {cargando ? t('app.cargando') : t('app.ver_mas')}
      </button>
    </div>
  );
}

/* ───────────────────────────── Etiqueta ───────────────────────────── */

/** Etiqueta de estado con color según su significado. */
export function Etiqueta({
  texto,
  tono = 'neutro',
}: {
  texto: string;
  tono?: 'neutro' | 'exito' | 'aviso' | 'error' | 'info';
}) {
  const colores: Record<string, string> = {
    neutro: 'var(--texto-tenue)',
    exito: 'var(--exito)',
    aviso: 'var(--aviso)',
    error: 'var(--error)',
    info: 'var(--info)',
  };
  const color = colores[tono] ?? colores['neutro'] ?? 'currentColor';

  return (
    <span
      className="etiqueta"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
    >
      {texto}
    </span>
  );
}

/* ──────────────────────────── Bloque de datos ──────────────────────────── */

/**
 * Envoltorio que resuelve los cinco estados de un bloque de datos.
 *
 * Se le pasa el estado de la consulta y decide qué pintar. Lo importante no es
 * el ahorro de líneas, sino que sea imposible olvidarse de un caso: cuando el
 * estado vacío o el de error se escriben a mano en cada pantalla, siempre hay
 * tres que se los saltan y enseñan un cero como si fuera un dato.
 */
export function BloqueDatos<T>({
  permiso = true,
  permisoNombre,
  cargando,
  error,
  datos,
  vacio,
  hayFiltros = false,
  alLimpiarFiltros,
  reintentar,
  formaCarga = 'filas',
  filasCarga,
  children,
}: {
  /** Si quien mira puede ver estos datos. */
  permiso?: boolean;
  permisoNombre?: string;
  cargando: boolean;
  error?: unknown;
  datos: T[] | undefined;
  /** Qué enseñar cuando de verdad no hay nada (no cuando el filtro no encuentra). */
  vacio: { titulo: string; descripcion?: string; accion?: ReactNode };
  hayFiltros?: boolean;
  alLimpiarFiltros?: () => void;
  reintentar?: () => void;
  formaCarga?: 'filas' | 'tarjetas' | 'grafico' | 'texto';
  filasCarga?: number;
  children: (datos: T[]) => ReactNode;
}) {
  if (!permiso) return <SinPermiso permiso={permisoNombre} />;
  // El error va antes que la carga: al reintentar, react-query vuelve a poner
  // `isLoading` y el error parpadearía en esqueleto antes de volver a salir.
  if (error) return <ErrorPanel error={error} reintentar={reintentar} />;
  if (cargando)
    return <Cargando forma={formaCarga} {...(filasCarga ? { filas: filasCarga } : {})} />;

  const items = datos ?? [];
  if (items.length === 0) {
    return hayFiltros ? (
      <SinResultados {...(alLimpiarFiltros ? { alLimpiar: alLimpiarFiltros } : {})} />
    ) : (
      <Vacio {...vacio} />
    );
  }

  return <>{children(items)}</>;
}
