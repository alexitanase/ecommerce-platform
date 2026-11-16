'use client';

import { useTranslations } from 'next-intl';
import { Icono } from './ui/icono';
import { useVarianteActiva } from './variante-activa';

/**
 * Cuándo llega y desde dónde sale.
 *
 * Antes esto era una pastilla más entre las opciones: un botón que decía «China
 * Mainland» al lado de los colores, como si fuera una característica del
 * artículo que se elige por gusto. No informaba de nada —el cliente no tiene por
 * qué saber qué implica—, y encima era el único sitio de la ficha donde asomaba
 * el plazo de entrega, que es lo primero que se pregunta y lo que más se reclama
 * en el dropshipping.
 *
 * Ahora es lo que dice el art. 97.1.f del TRLGDCU que hay que informar antes de
 * vender: la fecha en que se recibe, en grande, y debajo de dónde sale. Se
 * anuncia como **estimada** cuando el plazo lo hemos calculado nosotros por el
 * país de origen y no lo ha declarado el proveedor: no se puede dar por firme
 * una fecha que nadie nos ha prometido.
 *
 * Los textos vienen ya escritos del servidor. Es a propósito: si el navegador
 * calculara las fechas, la ficha diría una cosa al pintarse y otra al hidratarse
 * cada vez que el reloj del visitante no coincidiera con el del servidor.
 */

export interface TextoEntrega {
  /** «17» o «29 de agosto», según si el rango cambia de mes. */
  desde: string;
  /** «27 de agosto». */
  hasta: string;
  unSoloDia: boolean;
  /** País de origen ya traducido, o lo que dijo el proveedor. */
  origen: string | null;
  /** El plazo lo hemos estimado nosotros, no lo ha declarado el proveedor. */
  estimado: boolean;
  maxDias: number;
}

/** A partir de aquí el plazo es largo y callarlo sería una omisión engañosa. */
const DIAS_LARGO = 15;

export function BloqueEntrega({
  entregas,
  predeterminada,
}: {
  /** Texto por variante: cada una puede salir de un país distinto. */
  entregas: Record<string, TextoEntrega>;
  predeterminada: TextoEntrega | null;
}) {
  const t = useTranslations('producto');
  const { variante } = useVarianteActiva();

  const entrega = (variante ? entregas[variante.id] : null) ?? predeterminada;
  if (!entrega) return null;

  const largo = entrega.maxDias > DIAS_LARGO;

  return (
    <div
      className="rounded-[--radius-card] border p-4"
      style={{ borderColor: 'var(--borde-fuerte)', background: 'var(--fondo-elevado)' }}
      data-prueba="entrega"
    >
      <div className="flex items-start gap-3">
        {/* En ámbar cuando el plazo pasa de dos semanas. No es decoración: un
            plazo largo hay que anunciarlo, y quien lo lea rápido debe notar que
            aquí hay algo que mirar. */}
        <span
          className="mt-0.5 flex-none"
          style={{ color: largo ? 'var(--aviso)' : 'var(--texto-suave)' }}
        >
          <Icono nombre="camion" tamano={20} />
        </span>

        <div className="min-w-0">
          <p className="text-base font-semibold text-balance">
            {entrega.unSoloDia
              ? t('entrega_dia', { fecha: entrega.hasta })
              : t('entrega_rango', { desde: entrega.desde, hasta: entrega.hasta })}
          </p>

          <p className="mt-1 text-sm text-[var(--texto-tenue)]">
            {entrega.origen ? t('envio_desde', { pais: entrega.origen }) : t('envio_internacional')}
            {entrega.estimado && <> · {t('entrega_estimada')}</>}
          </p>
        </div>
      </div>
    </div>
  );
}
