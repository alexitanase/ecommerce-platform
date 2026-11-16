import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Cupones.
 *
 * La cifra que decide si una campaña salió bien no es cuántas veces se usó,
 * sino **cuánto descuento se entregó**. Un cupón muy canjeado puede ser una
 * campaña ruinosa si se lo llevó gente que iba a comprar igualmente, así que
 * el importe entregado va tan visible como el número de usos.
 */

type TipoCupon = 'PERCENTAGE' | 'FIXED' | 'FREE_SHIPPING';

interface Cupon {
  id: string;
  code: string;
  type: TipoCupon;
  value: number;
  maxDiscountCents: number | null;
  minOrderCents: number;
  maxUses: number | null;
  maxUsesPerCustomer: number;
  usedCount: number;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  internalNote: string | null;
  canjes: number;
  descuentoEntregadoCents: number;
}

const euros = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €';
const aCentimos = (v: string) => Math.round(Number(v.replace(',', '.')) * 100) || 0;

/** Cómo se lee el valor según el tipo. */
function describir(c: Cupon, t: (k: string) => string): string {
  if (c.type === 'FREE_SHIPPING') return t('cupones.tipo_FREE_SHIPPING');
  if (c.type === 'PERCENTAGE') return `${c.value}%`;
  return euros(c.value);
}

export function Cupones() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [creando, setCreando] = useState(false);

  const cupones = useQuery({ queryKey: ['cupones'], queryFn: () => get<Cupon[]>('/coupons') });
  const refrescar = () => void qc.invalidateQueries({ queryKey: ['cupones'] });

  const cambiar = useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: { isActive?: boolean } }) =>
      patch(`/coupons/${id}`, datos),
    onSuccess: refrescar,
  });

  const eliminar = useMutation({
    mutationFn: (id: string) => del(`/coupons/${id}`),
    onSuccess: refrescar,
  });

  if (cupones.isLoading) return <Cargando />;
  if (cupones.error)
    return <ErrorPanel error={cupones.error} reintentar={() => void cupones.refetch()} />;

  const items = cupones.data ?? [];
  const entregadoTotal = items.reduce((a, c) => a + c.descuentoEntregadoCents, 0);

  return (
    <div>
      <Encabezado
        titulo={t('cupones.titulo')}
        descripcion={
          t('cupones.descripcion') +
          (entregadoTotal > 0
            ? ` · ${t('cupones.entregado_total', { importe: euros(entregadoTotal) })}`
            : '')
        }
        acciones={
          <button
            type="button"
            className="btn btn-primario text-sm"
            onClick={() => setCreando(!creando)}
          >
            + {t('cupones.nuevo')}
          </button>
        }
      />

      {creando && (
        <FormularioCupon
          onHecho={() => {
            setCreando(false);
            refrescar();
          }}
          onCancelar={() => setCreando(false)}
        />
      )}

      {items.length === 0 ? (
        <Vacio titulo={t('cupones.sin_cupones')} descripcion={t('cupones.sin_cupones_ayuda')} />
      ) : (
        <div className="space-y-2">
          {items.map((c) => {
            const agotado = c.maxUses !== null && c.usedCount >= c.maxUses;
            const caducado = c.validUntil !== null && new Date(c.validUntil) < new Date();

            return (
              <article key={c.id} className="panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{c.code}</span>
                      <Etiqueta tono="info" texto={describir(c, t)} />
                      {!c.isActive && <Etiqueta tono="neutro" texto={t('cupones.inactivo')} />}
                      {agotado && <Etiqueta tono="aviso" texto={t('cupones.agotado')} />}
                      {caducado && <Etiqueta tono="aviso" texto={t('cupones.caducado')} />}
                    </div>

                    <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                      {c.minOrderCents > 0 && `${t('cupones.minimo')} ${euros(c.minOrderCents)} · `}
                      {c.maxDiscountCents !== null &&
                        `${t('cupones.tope')} ${euros(c.maxDiscountCents)} · `}
                      {t('cupones.por_cliente', { n: c.maxUsesPerCustomer })}
                      {c.validUntil &&
                        ` · ${t('cupones.hasta')} ${new Date(c.validUntil).toLocaleDateString('es-ES')}`}
                    </p>

                    {c.internalNote && (
                      <p className="mt-1 text-xs italic" style={{ color: 'var(--texto-tenue)' }}>
                        {c.internalNote}
                      </p>
                    )}
                  </div>

                  <div className="text-right">
                    {/* Usos y dinero entregado juntos: el segundo es el que dice
                        si la campaña salió a cuenta. */}
                    <p className="text-sm tabular-nums">
                      {c.usedCount}
                      {c.maxUses !== null ? ` / ${c.maxUses}` : ''} {t('cupones.usos')}
                    </p>
                    <p className="text-xs tabular-nums" style={{ color: 'var(--texto-tenue)' }}>
                      {t('cupones.entregado')} {euros(c.descuentoEntregadoCents)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-fantasma text-sm"
                    onClick={() => cambiar.mutate({ id: c.id, datos: { isActive: !c.isActive } })}
                  >
                    {c.isActive ? t('cupones.desactivar') : t('cupones.activar')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-fantasma text-sm"
                    style={{ color: 'var(--error)' }}
                    onClick={() => eliminar.mutate(c.id)}
                  >
                    {t('app.eliminar')}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FormularioCupon({ onHecho, onCancelar }: { onHecho: () => void; onCancelar: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [tipo, setTipo] = useState<TipoCupon>('PERCENTAGE');
  const [valor, setValor] = useState('10');
  const [tope, setTope] = useState('');
  const [minimo, setMinimo] = useState('');
  const [maxUsos, setMaxUsos] = useState('');
  const [porCliente, setPorCliente] = useState('1');
  const [hasta, setHasta] = useState('');
  const [nota, setNota] = useState('');

  const esPorcentaje = tipo === 'PERCENTAGE';
  const esEnvio = tipo === 'FREE_SHIPPING';

  const crear = useMutation({
    mutationFn: () =>
      post('/coupons', {
        code: code.trim(),
        type: tipo,
        value: esEnvio ? 0 : esPorcentaje ? Number(valor) || 0 : aCentimos(valor),
        ...(tope.trim() && esPorcentaje ? { maxDiscountCents: aCentimos(tope) } : {}),
        ...(minimo.trim() ? { minOrderCents: aCentimos(minimo) } : {}),
        ...(maxUsos.trim() ? { maxUses: Number(maxUsos) } : {}),
        maxUsesPerCustomer: Number(porCliente) || 1,
        ...(hasta ? { validUntil: new Date(`${hasta}T23:59:59`).toISOString() } : {}),
        ...(nota.trim() ? { internalNote: nota.trim() } : {}),
      }),
    onSuccess: onHecho,
  });

  // Aviso, no bloqueo: un 30% sin tope puede ser deliberado en una campaña
  // corta, pero conviene verlo antes de publicarlo.
  const riesgo = esPorcentaje && Number(valor) >= 30 && !tope.trim();

  return (
    <div className="panel mb-4 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="etiqueta">{t('cupones.codigo')}</span>
          <input
            className="campo mt-1 w-full font-mono"
            placeholder="BIENVENIDA"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
          />
        </label>

        <label className="text-sm">
          <span className="etiqueta">{t('cupones.tipo')}</span>
          <select
            className="campo mt-1 w-full"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoCupon)}
          >
            <option value="PERCENTAGE">{t('cupones.tipo_PERCENTAGE')}</option>
            <option value="FIXED">{t('cupones.tipo_FIXED')}</option>
            <option value="FREE_SHIPPING">{t('cupones.tipo_FREE_SHIPPING')}</option>
          </select>
        </label>

        {!esEnvio && (
          <label className="text-sm">
            <span className="etiqueta">
              {esPorcentaje ? t('cupones.porcentaje') : t('cupones.importe')}
            </span>
            <input
              className="campo mt-1 w-full"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </label>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        {esPorcentaje && (
          <label className="text-sm">
            <span className="etiqueta">{t('cupones.tope_campo')}</span>
            <input
              className="campo mt-1 w-full"
              inputMode="decimal"
              placeholder={t('cupones.sin_tope')}
              value={tope}
              onChange={(e) => setTope(e.target.value)}
            />
          </label>
        )}

        <label className="text-sm">
          <span className="etiqueta">{t('cupones.minimo_campo')}</span>
          <input
            className="campo mt-1 w-full"
            inputMode="decimal"
            placeholder="0"
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="etiqueta">{t('cupones.max_usos')}</span>
          <input
            className="campo mt-1 w-full"
            inputMode="numeric"
            placeholder={t('cupones.sin_limite')}
            value={maxUsos}
            onChange={(e) => setMaxUsos(e.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="etiqueta">{t('cupones.por_cliente_campo')}</span>
          <input
            className="campo mt-1 w-full"
            inputMode="numeric"
            value={porCliente}
            onChange={(e) => setPorCliente(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="etiqueta">{t('cupones.caduca')}</span>
          <input
            className="campo mt-1 w-full"
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="etiqueta">{t('cupones.nota')}</span>
          <input
            className="campo mt-1 w-full"
            placeholder={t('cupones.nota_ayuda')}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
          />
        </label>
      </div>

      {riesgo && (
        <p className="mt-3 text-xs" style={{ color: 'var(--aviso)' }}>
          {t('cupones.aviso_sin_tope', { valor })}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="btn btn-primario text-sm"
          disabled={code.trim().length < 3 || crear.isPending}
          onClick={() => crear.mutate()}
        >
          {t('app.crear')}
        </button>
        <button type="button" className="btn btn-fantasma text-sm" onClick={onCancelar}>
          {t('app.cancelar')}
        </button>
      </div>

      {crear.error != null && (
        <p className="mt-2 text-sm" style={{ color: 'var(--error)' }}>
          {crear.error instanceof Error ? crear.error.message : t('app.error')}
        </p>
      )}
    </div>
  );
}
