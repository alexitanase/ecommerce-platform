'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { cuentaAtras, precio } from '@/lib/formato';
import { Icono } from './ui/icono';
import { Pagina, TituloPagina } from '@/components/ui/pagina';
import { Cargando } from '@/components/ui/estados';

interface EstadoCobro {
  paymentId: string;
  provider: string;
  status: string;
  amountCents: number;
  currency: string;
  payAddress: string | null;
  payAmount: string | null;
  payCurrency: string | null;
  segundosRestantes: number | null;
  receivedCents?: number;
  txHash?: string | null;
  confirmations?: number;
  pedido?: string;
  estadoPedido?: string;
}

/** Cada cuánto se pregunta al servidor si ya ha llegado el pago. */
const INTERVALO_MS = 5000;

/**
 * Pantalla de pago en criptomoneda.
 *
 * Tres cosas que aquí no son opcionales:
 *
 *  · **El contador.** El tipo de cambio está bloqueado y caduca. Sin un
 *    contador visible, el cliente envía la transacción tarde y llega un
 *    importe que ya no cubre el pedido.
 *
 *  · **El aviso de red.** Enviar USDT por la red equivocada es la forma más
 *    habitual de perder fondos, y no tiene recuperación posible.
 *
 *  · **El estado en vivo.** El cliente necesita ver que su pago se ha
 *    detectado; si no, cierra la pestaña pensando que ha fallado y abre una
 *    incidencia por algo que iba bien.
 */
export function PagoCripto({ paymentId, locale }: { paymentId: string; locale: string }) {
  const t = useTranslations('pago');
  const tc = useTranslations('comun');

  const [estado, setEstado] = useState<EstadoCobro | null>(null);
  const [segundos, setSegundos] = useState<number | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const consultar = useCallback(async () => {
    try {
      const datos = await api<EstadoCobro>(`/payments/${paymentId}/status`);
      setEstado(datos);
      if (datos.segundosRestantes !== null) setSegundos(datos.segundosRestantes);
      setError(null);
      return datos.status;
    } catch {
      setError(tc('error'));
      return null;
    }
  }, [paymentId, tc]);

  // Consulta periódica del estado del pago.
  useEffect(() => {
    // La primera consulta se lanza en el siguiente tick, no de forma síncrona:
    // llamar a setState dentro del cuerpo del efecto encadena renders.
    const inicial = setTimeout(() => void consultar(), 0);

    const intervalo = setInterval(() => {
      void consultar().then((status) => {
        // Se deja de preguntar en cuanto el pago llega a un estado final:
        // seguir consultando cada 5 s indefinidamente castiga al servidor sin
        // aportar nada.
        if (status && ['PAID', 'OVERPAID', 'EXPIRED', 'FAILED', 'REFUNDED'].includes(status)) {
          clearInterval(intervalo);
        }
      });
    }, INTERVALO_MS);

    return () => {
      clearTimeout(inicial);
      clearInterval(intervalo);
    };
  }, [consultar]);

  // Cuenta atrás local: se descuenta en el navegador para no pedir al servidor
  // la hora cada segundo.
  useEffect(() => {
    if (segundos === null || segundos <= 0) return;
    const temporizador = setInterval(() => setSegundos((s) => (s === null ? null : s - 1)), 1000);
    return () => clearInterval(temporizador);
  }, [segundos]);

  const copiar = async (texto: string, cual: string) => {
    await navigator.clipboard.writeText(texto);
    setCopiado(cual);
    setTimeout(() => setCopiado(null), 2000);
  };

  if (!estado) {
    return (
      <Pagina ancho="formulario">
        <Cargando etiqueta={t('titulo')} filas={3} />
      </Pagina>
    );
  }

  const pagado = ['PAID', 'OVERPAID'].includes(estado.status);
  const confirmando = estado.status === 'AWAITING_CONFIRMATION';
  const parcial = estado.status === 'PARTIALLY_PAID';
  const caducado = estado.status === 'EXPIRED' || (segundos !== null && segundos <= 0);

  if (pagado) {
    return (
      <Pagina ancho="formulario" className="text-center">
        <div
          className="mx-auto grid h-16 w-16 place-items-center rounded-full"
          style={{ background: 'color-mix(in srgb, var(--exito) 15%, transparent)' }}
        >
          <Icono nombre="comprobado" tamano={32} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{t('confirmado')}</h1>
        {estado.pedido && <p className="mt-2 text-[var(--texto-suave)]">{estado.pedido}</p>}
      </Pagina>
    );
  }

  return (
    <Pagina ancho="formulario">
      <TituloPagina titulo={t('titulo')} />

      {caducado ? (
        <div className="card mt-6 p-6 text-center">
          <p className="font-medium" style={{ color: 'var(--aviso)' }}>
            {t('caducado')}
          </p>
          <p className="mt-2 text-sm text-[var(--texto-suave)]">{t('caducado_ayuda')}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn btn-primario mt-5"
          >
            {t('generar_nuevo')}
          </button>
        </div>
      ) : (
        <>
          {/* Contador de caducidad del tipo de cambio */}
          {segundos !== null && segundos > 0 && (
            <div
              className="mt-5 flex items-center justify-between rounded-[--radius-card] px-4 py-3 text-sm"
              style={{
                background:
                  segundos < 120
                    ? 'color-mix(in srgb, var(--error) 10%, transparent)'
                    : 'color-mix(in srgb, var(--info) 10%, transparent)',
                color: segundos < 120 ? 'var(--error)' : 'var(--info)',
              }}
            >
              <span>{t('caduca_en', { tiempo: '' })}</span>
              <span className="font-mono text-lg font-semibold tabular-nums">
                {cuentaAtras(segundos)}
              </span>
            </div>
          )}

          <div className="card mt-5 p-6">
            <p className="text-sm text-[var(--texto-suave)]">{t('envia_exacto')}</p>

            {estado.payAmount && (
              <button
                type="button"
                onClick={() => void copiar(estado.payAmount ?? '', 'importe')}
                className="mt-2 flex w-full items-center justify-between gap-3 rounded-lg bg-[var(--fondo-sutil)] px-4 py-3 text-left transition-colors hover:bg-[var(--borde)]"
              >
                <span className="font-mono text-lg font-semibold">
                  {estado.payAmount} {estado.payCurrency}
                </span>
                <span className="text-xs text-[var(--texto-tenue)]">
                  {copiado === 'importe' ? t('copiado') : t('copiar')}
                </span>
              </button>
            )}

            <p className="mt-5 text-sm text-[var(--texto-suave)]">{t('direccion_pago')}</p>
            {estado.payAddress && (
              <button
                type="button"
                onClick={() => void copiar(estado.payAddress ?? '', 'direccion')}
                className="mt-2 flex w-full items-center justify-between gap-3 rounded-lg bg-[var(--fondo-sutil)] px-4 py-3 text-left transition-colors hover:bg-[var(--borde)]"
              >
                <span className="min-w-0 break-all font-mono text-sm">{estado.payAddress}</span>
                <span className="flex-none text-xs text-[var(--texto-tenue)]">
                  {copiado === 'direccion' ? t('copiado') : t('copiar')}
                </span>
              </button>
            )}

            {/* Aviso de red: enviar por la cadena equivocada pierde los fondos. */}
            {estado.payCurrency && (
              <p
                role="alert"
                className="mt-4 rounded-lg px-3 py-2 text-xs"
                style={{
                  background: 'color-mix(in srgb, var(--aviso) 12%, transparent)',
                  color: 'var(--aviso)',
                }}
              >
                {t('red_correcta', { red: estado.payCurrency })}
              </p>
            )}
          </div>

          <div className="mt-5 flex items-center gap-3 text-sm">
            <span
              className="h-2 w-2 flex-none animate-pulse rounded-full"
              style={{ background: confirmando ? 'var(--info)' : 'var(--texto-tenue)' }}
              aria-hidden="true"
            />
            <span className="text-[var(--texto-suave)]">
              {confirmando ? t('detectado') : t('esperando')}
            </span>
          </div>

          {parcial && estado.receivedCents !== undefined && (
            <p
              role="alert"
              className="mt-4 rounded-[--radius-card] px-4 py-3 text-sm"
              style={{
                background: 'color-mix(in srgb, var(--aviso) 12%, transparent)',
                color: 'var(--aviso)',
              }}
            >
              {t('parcial', {
                recibido: precio(estado.receivedCents, locale),
                esperado: precio(estado.amountCents, locale),
              })}
            </p>
          )}

          {error && (
            <p className="mt-4 text-sm" style={{ color: 'var(--error)' }}>
              {error}
            </p>
          )}

          <p className="mt-6 text-center text-xs text-[var(--texto-tenue)]">{t('no_cierres')}</p>
        </>
      )}
    </Pagina>
  );
}
