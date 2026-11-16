import { getTranslations } from 'next-intl/server';
import { fecha } from '@/lib/formato';
import { Icono } from './ui/icono';

/**
 * Dónde está el pedido, contado como lo vive el cliente.
 *
 * Nuestro proceso interno tiene trece estados y habla de proveedores, de
 * sub-pedidos y de incidencias. Nada de eso es asunto de quien compra: lo que
 * quiere saber es si su paquete ya salió y cuándo llega. Aquí se traduce a
 * cinco pasos y se enseña con una barra y una línea de tiempo.
 *
 * **No se inventa ningún paso.** «En reparto» solo se da por alcanzado cuando
 * el transportista lo dice —o cuando el pedido ya está entregado, que por
 * fuerza pasó por ahí—. Un pedido en camino sin esa señal deja ese punto
 * apagado en vez de encenderlo por si acaso: prometer que el paquete sale hoy
 * cuando no lo sabemos es la clase de detalle que genera una reclamación.
 */

export interface EstadoDelPedido {
  estado: string;
  creadoEn: string;
  pagadoEn: string | null;
  enviadoEn: string | null;
  entregadoEn: string | null;
  envios: { estado: string | null; enviadoEn: string | null; entregadoEn: string | null }[];
}

/** Los cinco pasos, en el orden en que ocurren. */
const PASOS = ['realizado', 'preparando', 'en_camino', 'en_reparto', 'entregado'] as const;
type Paso = (typeof PASOS)[number];

/** Los que se salen del recorrido: ahí una barra de progreso sería una mentira. */
const EXCEPCIONALES = new Set(['CANCELLED', 'REFUNDED', 'FAILED']);

/**
 * Lo que dicen los transportistas cuando el paquete sale a repartir.
 *
 * Cada uno lo escribe a su manera y en su idioma, así que se busca por
 * fragmentos. Lo que no encaje deja el paso apagado, que es lo honesto.
 */
const EN_REPARTO = /reparto|out for delivery|last ?mile|en ?entrega|delivering|repartidor/i;

/**
 * Cuántos pasos lleva completados el pedido.
 *
 * Devuelve un número entre 0 y 5: 0 es «aún no ha empezado» —falta el pago— y
 * 5 es «entregado». Los estados internos se agrupan: al cliente le da igual la
 * diferencia entre «enviado al proveedor» y «en preparación».
 */
export function pasosCompletados(pedido: EstadoDelPedido): number {
  switch (pedido.estado) {
    case 'AWAITING_PAYMENT':
    case 'PAYMENT_CONFIRMING':
      return 0;
    case 'PAID':
      return 1;
    case 'PREPARING':
    case 'SENT_TO_SUPPLIER':
      return 2;
    case 'IN_TRANSIT':
      // El cuarto paso solo si el transportista dice que va en reparto.
      return pedido.envios.some((e) => e.estado && EN_REPARTO.test(e.estado)) ? 4 : 3;
    case 'DELIVERED':
    case 'PENDING_CLOSE':
    case 'CLOSED':
      return 5;
    default:
      return 0;
  }
}

/** La fecha que se conoce de cada paso, si se conoce alguna. */
function fechaDelPaso(paso: Paso, pedido: EstadoDelPedido): string | null {
  if (paso === 'realizado') return pedido.pagadoEn ?? pedido.creadoEn;
  if (paso === 'en_camino') return pedido.enviadoEn ?? pedido.envios[0]?.enviadoEn ?? null;
  if (paso === 'entregado') return pedido.entregadoEn ?? pedido.envios[0]?.entregadoEn ?? null;
  return null;
}

export async function EstadoPedido({
  pedido,
  locale,
}: {
  pedido: EstadoDelPedido;
  locale: string;
}) {
  const t = await getTranslations('pedido');
  const completados = pasosCompletados(pedido);
  const excepcional = EXCEPCIONALES.has(pedido.estado);

  /*
   * Un pedido cancelado o reembolsado no tiene recorrido que enseñar.
   *
   * Pintarle la barra con tres pasos verdes daría a entender que sigue en
   * marcha, que es justo lo contrario de lo que ha pasado.
   */
  if (excepcional) {
    return (
      <section className="card p-5" role="status">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--fondo-sutil)] text-[var(--texto-tenue)]">
            <Icono nombre="alerta" tamano={20} />
          </span>
          <div>
            <p className="font-semibold">{t(`estados.${pedido.estado}`)}</p>
            <p className="text-sm text-[var(--texto-suave)]">{t(`resumen_${pedido.estado}`)}</p>
          </div>
        </div>
      </section>
    );
  }

  const fechaEntrega = fechaDelPaso('entregado', pedido);
  const fechaEnvio = fechaDelPaso('en_camino', pedido);

  /** El titular: una frase, la que resume dónde está el pedido ahora mismo. */
  const titular = completados === 0 ? t('paso_pago') : t(`paso_${PASOS[completados - 1] ?? ''}`);

  const detalle =
    completados === 5 && fechaEntrega
      ? t('entregado_el', { fecha: fecha(fechaEntrega, locale) })
      : completados >= 3 && fechaEnvio
        ? t('enviado_el', { fecha: fecha(fechaEnvio, locale) })
        : t(`ayuda_${completados === 0 ? 'pago' : (PASOS[completados - 1] ?? '')}`);

  return (
    <section className="card p-5" aria-label={t('estado')}>
      {/*
       * El titular, grande. Es lo único que mira la mayoría: entra, lee «En
       * camino» y se va. Todo lo demás está por si quiere más detalle.
       */}
      <p className="text-lg font-semibold tracking-tight">{titular}</p>
      <p className="mt-0.5 text-sm text-[var(--texto-suave)]">{detalle}</p>

      {/*
       * La barra: cinco tramos, uno por paso.
       *
       * Va antes que la lista porque se lee de un vistazo y sin leer nada. Los
       * tramos se separan con un hueco en vez de una línea continua para que
       * se distinga cuántos pasos hay y cuántos faltan.
       */}
      <div className="mt-4 flex gap-1" aria-hidden="true">
        {PASOS.map((paso, i) => (
          <span
            key={paso}
            className="h-1.5 flex-1 rounded-full transition-colors"
            style={{
              background: i < completados ? 'var(--marca-primario)' : 'var(--fondo-sutil)',
            }}
          />
        ))}
      </div>

      {/*
       * Y la línea de tiempo, en vertical.
       *
       * En vertical y no en horizontal a propósito: cinco etiquetas en una fila
       * de móvil dan 75 px por palabra y «En reparto» no cabe sin cortarse. En
       * vertical se leen enteras, caben las fechas al lado y funciona igual en
       * un teléfono que en un escritorio.
       */}
      <ol className="mt-5">
        {PASOS.map((paso, i) => {
          const hecho = i < completados;
          const actual = i === completados - 1;
          const fechaPaso = fechaDelPaso(paso, pedido);

          return (
            <li key={paso} className="flex gap-3">
              {/* Columna del hilo: el punto y la línea que baja al siguiente. */}
              <div className="flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
                  style={{
                    background: hecho ? 'var(--marca-primario)' : 'var(--fondo)',
                    color: 'var(--marca-primario-contraste)',
                    border: hecho ? 'none' : '2px solid var(--borde)',
                    // El paso actual lleva un halo: sin él, «hecho» y «en curso»
                    // se ven igual y no se sabe dónde está el pedido.
                    boxShadow: actual
                      ? '0 0 0 4px color-mix(in srgb, var(--marca-primario) 22%, transparent)'
                      : 'none',
                  }}
                >
                  {hecho ? <Icono nombre="comprobado" tamano={14} /> : null}
                </span>

                {i < PASOS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="w-0.5 flex-1"
                    style={{
                      minHeight: '1.75rem',
                      background: i < completados - 1 ? 'var(--marca-primario)' : 'var(--borde)',
                    }}
                  />
                )}
              </div>

              <div className="flex-1 pb-6">
                <p
                  className="text-sm"
                  style={{
                    color: hecho ? 'var(--texto)' : 'var(--texto-tenue)',
                    fontWeight: actual ? 600 : 400,
                  }}
                >
                  {t(`paso_${paso}`)}
                </p>
                {fechaPaso && hecho ? (
                  <p className="text-xs text-[var(--texto-tenue)]">{fecha(fechaPaso, locale)}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
