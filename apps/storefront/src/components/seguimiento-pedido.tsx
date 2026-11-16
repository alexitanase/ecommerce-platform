import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { precio, fecha, fechaHora } from '@/lib/formato';
import { Pagina } from '@/components/ui/pagina';
import { EstadoPedido, pasosCompletados } from '@/components/estado-pedido';

/**
 * Confirmación y seguimiento de un pedido.
 *
 * Es un componente de servidor: no hay nada interactivo y así el cliente recibe
 * la página ya montada, sin esperar a que cargue JavaScript. Quien acaba de
 * pagar quiere ver su pedido de inmediato, no un esqueleto girando.
 */

export interface PedidoSeguimiento {
  numero: string;
  estado: string;
  pagado: boolean;
  creadoEn: string;
  pagadoEn: string | null;
  enviadoEn: string | null;
  entregadoEn: string | null;
  lineas: {
    id: string;
    name: string;
    variantName: string | null;
    sku: string;
    imageUrl: string | null;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }[];
  subtotalCents: number;
  descuentoCents: number;
  envioCents: number;
  ivaCents: number;
  totalCents: number;
  tipoIva: number;
  direccionEnvio: Record<string, string | undefined>;
  email: string;
  /**
   * Los hitos del pedido, en claves y no en frases.
   *
   * La API manda `realizado`, `pagado`, `preparando`… y el texto lo pone la
   * tienda. Antes mandaba la descripción del evento interno y ahí salían el
   * proveedor con su referencia, lo que nos había cobrado y la pasarela del
   * pago, en una página que se abre solo con el enlace.
   */
  historial: { clave: string; createdAt: string }[];
  envios: {
    transportista: string | null;
    seguimiento: string | null;
    url: string | null;
    estado: string | null;
    enviadoEn: string | null;
    entregadoEn: string | null;
  }[];
}

export async function SeguimientoPedido({
  pedido,
  locale,
}: {
  pedido: PedidoSeguimiento;
  locale: string;
}) {
  const t = await getTranslations('pedido');
  const dir = pedido.direccionEnvio;

  /*
   * Esta página hace dos cosas y el titular tiene que decir cuál.
   *
   * Es la pantalla de «gracias por tu compra» justo después de pagar, y es
   * también el detalle del pedido al que se entra desde la cuenta semanas
   * después. Dar las gracias por una compra de hace un mes que se está
   * consultando para ver si ya llegó suena a mensaje automático.
   *
   * Se decide por el recorrido: mientras el pedido no haya pasado de
   * «realizado» se acaba de comprar; a partir de ahí, se está consultando.
   */
  const recienComprado = pasosCompletados(pedido) <= 1;

  // Sin IVA en el desglose es una entrega exenta (Canarias, Ceuta, Melilla):
  // hay que decirlo, no dejar un hueco donde el cliente espera ver el impuesto.
  const exento = pedido.ivaCents === 0 && pedido.totalCents > 0;

  /*
   * Solo los hitos que esta tienda sabe nombrar.
   *
   * Si la API añadiera una clave antes de que existiera su traducción, pintar
   * la clave en crudo —«hito_devuelto_parcial»— sería feo pero tolerable; lo
   * que no es tolerable es que reviente la página del pedido por una cadena
   * que falta. Se descarta y el resto del historial se ve igual.
   */
  const hitos = pedido.historial.filter((h) => t.has(`hito_${h.clave}`));

  return (
    <Pagina ancho="lectura">
      {/* Uno de los dos títulos que se salen de la escala a propósito —el otro
          es el de la portada—. Es la pantalla de "gracias por tu compra": el
          énfasis es la única señal de que la compra ha terminado bien. */}
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {!pedido.pagado ? t('titulo_seguimiento') : recienComprado ? t('gracias') : t('detalles')}
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--texto-tenue)' }}>
          {t('numero', { numero: pedido.numero })} · {fecha(pedido.creadoEn, locale)}
        </p>
        <p className="mt-1 text-sm" style={{ color: 'var(--texto-tenue)' }}>
          {t('confirmacion_email', { email: pedido.email })}
        </p>
      </header>

      {/* ── Dónde está el pedido ── */}
      <div className="mt-8">
        <EstadoPedido pedido={pedido} locale={locale} />
      </div>

      {/* ── Envíos ── */}
      <section className="card mt-8 p-5">
        <h2 className="text-sm font-semibold">{t('seguimiento')}</h2>
        {pedido.envios.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: 'var(--texto-tenue)' }}>
            {t('sin_seguimiento')}
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pedido.envios.map((envio) => (
              <li key={envio.seguimiento} className="text-sm">
                <span style={{ color: 'var(--texto-tenue)' }}>{t('transportista')}: </span>
                {envio.transportista ?? '—'} ·{' '}
                {envio.url ? (
                  <a
                    href={envio.url}
                    // El seguimiento vive en la web del transportista: se abre
                    // aparte para no sacar al cliente de su pedido. noreferrer
                    // evita filtrarle nuestra URL, que lleva la clave dentro.
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {envio.seguimiento}
                  </a>
                ) : (
                  <span>{envio.seguimiento}</span>
                )}
                {envio.estado ? (
                  <span style={{ color: 'var(--texto-tenue)' }}> · {envio.estado}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Artículos ── */}
      <section className="card mt-4 p-5">
        <h2 className="text-sm font-semibold">{t('articulos')}</h2>
        <ul className="mt-3 divide-y" style={{ borderColor: 'var(--borde)' }}>
          {pedido.lineas.map((linea) => (
            <li key={linea.id} className="flex gap-3 py-3">
              {linea.imageUrl ? (
                <Image
                  src={linea.imageUrl}
                  alt=""
                  width={56}
                  height={56}
                  className="h-14 w-14 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div
                  className="h-14 w-14 shrink-0 rounded-lg"
                  style={{ background: 'var(--fondo-sutil)' }}
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="lineas-2 text-sm font-medium">{linea.name}</p>
                {linea.variantName ? (
                  <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {linea.variantName}
                  </p>
                ) : null}
                <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {t('unidades', { n: linea.quantity })}
                </p>
              </div>
              <p className="shrink-0 text-sm font-medium tabular-nums">
                {precio(linea.totalCents, locale)}
              </p>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt style={{ color: 'var(--texto-tenue)' }}>{t('subtotal')}</dt>
            <dd className="tabular-nums">{precio(pedido.subtotalCents, locale)}</dd>
          </div>
          {pedido.descuentoCents > 0 ? (
            <div className="flex justify-between">
              <dt style={{ color: 'var(--texto-tenue)' }}>{t('descuento')}</dt>
              <dd className="tabular-nums">−{precio(pedido.descuentoCents, locale)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt style={{ color: 'var(--texto-tenue)' }}>{t('envio')}</dt>
            <dd className="tabular-nums">
              {pedido.envioCents === 0 ? t('envio_gratis') : precio(pedido.envioCents, locale)}
            </dd>
          </div>
          <div
            className="flex justify-between border-t pt-2 text-base font-semibold"
            style={{ borderColor: 'var(--borde)' }}
          >
            <dt>{t('total')}</dt>
            <dd className="tabular-nums">{precio(pedido.totalCents, locale)}</dd>
          </div>
          <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {exento ? t('exento_iva') : t('iva_incluido', { tipo: pedido.tipoIva })}
          </p>
        </dl>
      </section>

      {/* ── Dirección ── */}
      <section className="card mt-4 p-5">
        <h2 className="text-sm font-semibold">{t('direccion_envio')}</h2>
        <address className="mt-2 text-sm not-italic" style={{ color: 'var(--texto-tenue)' }}>
          {[dir['firstName'], dir['lastName']].filter(Boolean).join(' ')}
          <br />
          {dir['line1']}
          {dir['line2'] ? (
            <>
              <br />
              {dir['line2']}
            </>
          ) : null}
          <br />
          {[dir['postalCode'], dir['city']].filter(Boolean).join(' ')}
          <br />
          {[dir['province'], dir['countryCode']].filter(Boolean).join(', ')}
        </address>
      </section>

      {/* ── Historial ── */}
      {hitos.length > 0 ? (
        <section className="card mt-4 p-5">
          <h2 className="text-sm font-semibold">{t('historial')}</h2>
          <ol className="mt-3 space-y-2.5 text-sm">
            {hitos.map((hito, i) => (
              <li key={`${hito.clave}-${i}`} className="flex items-baseline gap-3">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: 'var(--marca-primario)' }}
                />
                <span className="flex-1">{t(`hito_${hito.clave}`)}</span>
                <span
                  className="shrink-0 tabular-nums text-xs"
                  style={{ color: 'var(--texto-tenue)' }}
                >
                  {fechaHora(hito.createdAt, locale)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <p className="mt-6 text-center text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {t('guarda_enlace')}
      </p>
    </Pagina>
  );
}
