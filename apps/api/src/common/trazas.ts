import {
  SpanStatusCode,
  context as contextoOtel,
  propagation,
  trace,
  type Span,
} from '@opentelemetry/api';

/**
 * Correlación de trazas a través de las colas.
 *
 * El problema que resuelve: una compra empieza en una petición HTTP, sigue en
 * un trabajo de BullMQ y termina en una llamada al proveedor, cada cosa en un
 * momento distinto y quizá en otro proceso. Sin propagar el contexto, eso son
 * tres trazas sueltas y nadie puede responder "¿por qué este pedido tardó
 * cuarenta minutos en llegar a AliExpress?".
 *
 * El contexto viaja dentro de los datos del trabajo, en formato W3C
 * traceparent, que es el mismo estándar que usan las cabeceras HTTP.
 */

/** Clave donde se guarda el contexto dentro de los datos del trabajo. */
const CLAVE_TRAZA = '__traza';

export type ConTraza<T> = T & { [CLAVE_TRAZA]?: Record<string, string> };

/**
 * Saca el contexto guardado dentro de un payload para ponerlo en la raíz del
 * trabajo, que es donde lo busca el worker.
 */
export function extraerTraza(payload: unknown): Record<string, string> | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const valor = (payload as Record<string, unknown>)[CLAVE_TRAZA];
  return typeof valor === 'object' && valor !== null
    ? (valor as Record<string, string>)
    : undefined;
}

/**
 * Añade el contexto de traza actual a los datos de un trabajo antes de encolarlo.
 */
export function inyectarTraza<T extends object>(datos: T): ConTraza<T> {
  // Si ya trae contexto, se respeta: el del outbox se capturó en la petición
  // original y es el bueno; el de ahora sería el del temporizador que publica.
  if (extraerTraza(datos)) return datos;

  const portador: Record<string, string> = {};
  propagation.inject(contextoOtel.active(), portador);

  // Sin traza activa no se ensucia el payload con una clave vacía.
  if (Object.keys(portador).length === 0) return datos;

  return { ...datos, [CLAVE_TRAZA]: portador };
}

/**
 * Ejecuta el procesado de un trabajo dentro del contexto de quien lo encoló.
 *
 * El span del worker queda colgando del span de la petición HTTP original, por
 * lejos que quede en el tiempo.
 */
export async function conTrazaDelTrabajo<T, R>(
  datos: ConTraza<T>,
  nombre: string,
  fn: () => Promise<R>,
): Promise<R> {
  const portador = datos[CLAVE_TRAZA];
  const padre = portador
    ? propagation.extract(contextoOtel.active(), portador)
    : contextoOtel.active();

  const tracer = trace.getTracer('colas');

  return contextoOtel.with(padre, () =>
    tracer.startActiveSpan(nombre, async (span) => {
      try {
        const resultado = await fn();
        return resultado;
      } catch (error) {
        // Sin esto el span se cierra en verde y la traza dice que todo fue
        // bien mientras el trabajo se reintenta en bucle.
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        span.end();
      }
    }),
  );
}

/**
 * Cuelga identificadores de negocio del span activo.
 *
 * Es lo que convierte la traza en algo buscable: en Jaeger se filtra por
 * `pedido.id=...` y sale la historia completa de ese pedido, desde el clic en
 * pagar hasta la respuesta del proveedor. Sin esto solo se puede buscar por
 * tiempo y ruta, que con volumen no sirve de nada.
 */
export function marcar(atributos: Record<string, string | number | undefined>): void {
  const span: Span | undefined = trace.getActiveSpan();
  if (!span) return;

  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor !== undefined) span.setAttribute(clave, valor);
  }
}
