'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, ErrorApi } from '@/lib/api';
import { fecha } from '@/lib/formato';
import { Icono } from './ui/icono';

interface Factura {
  id: string;
  fullNumber: string;
  issuedAt: string;
  totalCents: number;
}

/**
 * «Quiero mi factura», desde el pedido en el área de cliente.
 *
 * Hasta ahora la factura solo la emitía el equipo desde el panel: quien la
 * necesitaba —y quien compra a nombre de una empresa la necesita siempre—
 * tenía que escribir un correo y esperar. Esto la emite en el momento.
 *
 * No aparece hasta que el pedido está pagado, y no porque quede feo: facturar
 * algo no cobrado declara un IVA que todavía no se ha repercutido. El servidor
 * lo rechaza igualmente; esconder el botón evita ofrecer algo que va a fallar.
 *
 * La primera llamada EMITE —número de serie y anotación en el libro de IVA— y
 * las siguientes devuelven la misma: la numeración de facturas tiene que ser
 * correlativa y sin huecos, así que pulsar dos veces no puede crear dos.
 */
export function BotonFactura({
  orderId,
  token,
  locale,
}: {
  orderId: string;
  /** El de la sesión: la API comprueba que el pedido es de quien lo pide. */
  token: string;
  locale: string;
}) {
  const t = useTranslations('cuenta');
  const [factura, setFactura] = useState<Factura | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pedir = () => {
    setPidiendo(true);
    setError(null);

    api<Factura>(`/invoices/mine/${orderId}`, { method: 'POST', token })
      .then(setFactura)
      .catch((e: unknown) => {
        // El mensaje de la API se enseña tal cual: dice el motivo concreto
        // —«todavía no consta como pagado»— y es más útil que un «ha fallado».
        setError(e instanceof ErrorApi ? e.message : t('factura_error'));
      })
      .finally(() => setPidiendo(false));
  };

  if (factura) {
    return (
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--texto-suave)]">
        <Icono nombre="comprobado" tamano={16} className="text-[var(--exito)]" />
        <span>
          {t('factura_emitida', {
            numero: factura.fullNumber,
            fecha: fecha(factura.issuedAt, locale),
          })}
        </span>
      </p>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={pedir}
        disabled={pidiendo}
        className="btn btn-secundario text-sm"
        data-prueba="pedir-factura"
      >
        {pidiendo ? t('factura_pidiendo') : t('factura_pedir')}
      </button>

      {error && (
        <p className="mt-1 text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
