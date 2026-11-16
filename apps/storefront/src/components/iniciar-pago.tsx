'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, ErrorApi } from '@/lib/api';
import { PagoCripto } from './pago-cripto';
import { Pagina, TituloPagina } from '@/components/ui/pagina';
import { Cargando, ErrorCarga } from '@/components/ui/estados';

interface Metodo {
  key: string;
  nombre: string;
}

interface Cobro {
  paymentId: string;
  checkoutUrl?: string;
}

/**
 * Arranque del pago.
 *
 * Primero pregunta qué pasarelas hay activas. Si solo hay una —el caso
 * habitual— la usa directamente sin hacer elegir al cliente: un paso menos en
 * el embudo es un paso menos donde abandonar.
 */
export function IniciarPago({
  orderId,
  numero,
  locale,
}: {
  orderId: string;
  numero: string;
  locale: string;
}) {
  const t = useTranslations('pago');
  const tc = useTranslations('comun');

  const [metodos, setMetodos] = useState<Metodo[] | null>(null);
  const [cobro, setCobro] = useState<Cobro | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(false);

  useEffect(() => {
    api<Metodo[]>(`/payments/methods?orderId=${encodeURIComponent(orderId)}`)
      .then(setMetodos)
      .catch(() => setMetodos([]));
  }, [orderId]);

  const iniciar = useCallback(
    async (provider?: string) => {
      setIniciando(true);
      setError(null);
      try {
        const resultado = await api<Cobro>('/payments/checkout', {
          method: 'POST',
          body: JSON.stringify({ orderId, ...(provider ? { provider } : {}) }),
        });

        // Pasarelas con página propia (Stripe, PayPal): se redirige.
        if (resultado.checkoutUrl) {
          window.location.href = resultado.checkoutUrl;
          return;
        }
        setCobro(resultado);
      } catch (e) {
        setError(e instanceof ErrorApi ? e.message : tc('error'));
        setIniciando(false);
      }
    },
    [orderId, tc],
  );

  // Con una sola pasarela activa se arranca sola. Se difiere un tick para no
  // llamar a setState de forma síncrona dentro del efecto.
  useEffect(() => {
    if (!metodos || metodos.length !== 1 || cobro || iniciando || !orderId) return;

    const t = setTimeout(() => void iniciar(metodos[0]?.key), 0);
    return () => clearTimeout(t);
  }, [metodos, cobro, iniciando, orderId, iniciar]);

  if (cobro) {
    return <PagoCripto paymentId={cobro.paymentId} locale={locale} />;
  }

  if (!metodos) {
    return (
      <Pagina ancho="formulario">
        <Cargando etiqueta={t('titulo')} filas={2} />
      </Pagina>
    );
  }

  if (metodos.length === 0) {
    return (
      <Pagina ancho="formulario">
        <TituloPagina titulo={t('titulo')} descripcion={numero} />
        <ErrorCarga titulo={t('sin_metodos')} descripcion={t('sin_metodos_ayuda')} />
      </Pagina>
    );
  }

  return (
    <Pagina ancho="formulario">
      <TituloPagina titulo={t('titulo')} descripcion={numero} />

      <div className="space-y-2">
        {metodos.map((m) => (
          <button
            key={m.key}
            type="button"
            disabled={iniciando}
            onClick={() => void iniciar(m.key)}
            className="card flex w-full items-center justify-between p-4 text-left transition-shadow hover:shadow-[var(--sombra-elevada)]"
          >
            <span className="font-medium">{m.nombre}</span>
            <span aria-hidden="true">→</span>
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </Pagina>
  );
}
