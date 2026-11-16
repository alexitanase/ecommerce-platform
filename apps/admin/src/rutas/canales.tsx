import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Canales de captación y afiliados.
 *
 * Google Ads y Meta Ads no admiten catálogo adulto —cierran la cuenta—, así
 * que aquí está lo que queda: qué canales sirven y con qué letra pequeña, de
 * dónde vienen de verdad las ventas, y a quién hay que pagarle por traerlas.
 *
 * El informe ordena por ingreso y no por número de pedidos, a propósito:
 * veinte pedidos de doce euros valen menos que cinco de noventa, y ordenar por
 * cantidad haría dedicar los meses siguientes al canal equivocado.
 */

interface Canal {
  clave: string;
  nombre: string;
  tipo: string;
  admiteAdulto: 'si' | 'limitado' | 'no';
  advertencia?: string;
}

interface FilaInforme {
  fuente: string;
  nombre: string;
  tipo: string;
  pedidos: number;
  ingresoCents: number;
  ticketMedioCents: number;
  cuota: number;
}

interface Afiliado {
  id: string;
  name: string;
  email: string;
  code: string;
  commissionPercent: number;
  status: string;
  ventas: number;
  pendienteCents: number;
  pagadoCents: number;
}

const euros = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €';
const porcentaje = (v: number) => (v * 100).toFixed(0) + ' %';

const TONO_ADMITE: Record<string, 'exito' | 'aviso' | 'error'> = {
  si: 'exito',
  limitado: 'aviso',
  no: 'error',
};

type Pestana = 'informe' | 'canales' | 'afiliados';

export function Canales() {
  const { t } = useTranslation();
  const [pestana, setPestana] = useState<Pestana>('informe');

  const pestanas: { id: Pestana; etiqueta: string }[] = [
    { id: 'informe', etiqueta: t('canales.informe') },
    { id: 'canales', etiqueta: t('canales.catalogo') },
    { id: 'afiliados', etiqueta: t('canales.afiliados') },
  ];

  return (
    <div>
      <Encabezado titulo={t('canales.titulo')} descripcion={t('canales.descripcion')} />

      <div
        className="mb-5 flex gap-1 border-b"
        style={{ borderColor: 'var(--borde)' }}
        role="tablist"
      >
        {pestanas.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={pestana === p.id}
            onClick={() => setPestana(p.id)}
            className="border-b-2 px-4 py-2 text-sm"
            style={
              pestana === p.id
                ? { borderColor: 'var(--marca-primario)', color: 'var(--marca-primario)' }
                : { borderColor: 'transparent', color: 'var(--texto-tenue)' }
            }
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      {pestana === 'informe' && <Informe />}
      {pestana === 'canales' && <Catalogo />}
      {pestana === 'afiliados' && <Afiliados />}
    </div>
  );
}

function Informe() {
  const { t } = useTranslation();
  const informe = useQuery({
    queryKey: ['canales', 'informe'],
    queryFn: () => get<{ total: number; canales: FilaInforme[] }>('/channels/informe'),
  });

  if (informe.isLoading) return <Cargando />;
  if (informe.error)
    return <ErrorPanel error={informe.error} reintentar={() => void informe.refetch()} />;

  const filas = informe.data?.canales ?? [];

  if (filas.length === 0) {
    return <Vacio titulo={t('canales.sin_ventas')} descripcion={t('canales.sin_ventas_ayuda')} />;
  }

  return (
    <div className="panel p-4">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: 'var(--texto-tenue)' }}>
            <th className="pb-2 text-left font-normal">{t('canales.canal')}</th>
            <th className="pb-2 text-right font-normal">{t('canales.pedidos')}</th>
            <th className="pb-2 text-right font-normal">{t('canales.ingreso')}</th>
            <th className="pb-2 text-right font-normal">{t('canales.ticket')}</th>
            <th className="pb-2 text-right font-normal">{t('canales.cuota')}</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.fuente} className="border-t" style={{ borderColor: 'var(--borde)' }}>
              <td className="py-2">{f.nombre}</td>
              <td className="py-2 text-right tabular-nums">{f.pedidos}</td>
              <td className="py-2 text-right font-medium tabular-nums">{euros(f.ingresoCents)}</td>
              <td className="py-2 text-right tabular-nums">{euros(f.ticketMedioCents)}</td>
              <td className="py-2 text-right tabular-nums">{porcentaje(f.cuota)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** El catálogo de canales, con lo que hay que saber de cada uno. */
function Catalogo() {
  const { t } = useTranslation();
  const [base, setBase] = useState('');
  const [fuente, setFuente] = useState('');
  const [campana, setCampana] = useState('');
  const [enlace, setEnlace] = useState('');

  const canales = useQuery({
    queryKey: ['canales', 'catalogo'],
    queryFn: () => get<Canal[]>('/channels'),
  });

  const construir = useMutation({
    mutationFn: () =>
      post<{ enlace: string }>('/channels/enlace', {
        base: base.trim(),
        fuente: fuente.trim(),
        ...(campana.trim() ? { campana: campana.trim() } : {}),
      }),
    onSuccess: (r) => {
      setEnlace(r.enlace);
    },
  });

  if (canales.isLoading) return <Cargando />;
  if (canales.error)
    return <ErrorPanel error={canales.error} reintentar={() => void canales.refetch()} />;

  return (
    <div className="space-y-4">
      {/* El constructor va arriba porque es lo que se usa a diario: un
          utm_source mal escrito no da ningún error, solo hace que la campaña no
          aparezca en el informe y parezca que no funcionó. */}
      <div className="panel p-4">
        <h2 className="font-medium">{t('canales.constructor')}</h2>
        <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {t('canales.constructor_ayuda')}
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="etiqueta">{t('canales.direccion')}</span>
            <input
              className="campo mt-1 w-full"
              placeholder="https://…"
              value={base}
              onChange={(e) => setBase(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="etiqueta">{t('canales.canal')}</span>
            <select
              className="campo mt-1 w-full"
              value={fuente}
              onChange={(e) => setFuente(e.target.value)}
            >
              <option value="">—</option>
              {(canales.data ?? [])
                .filter((c) => c.admiteAdulto !== 'no')
                .map((c) => (
                  <option key={c.clave} value={c.clave}>
                    {c.nombre}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="etiqueta">{t('canales.campana')}</span>
            <input
              className="campo mt-1 w-full"
              value={campana}
              onChange={(e) =>
                setCampana(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))
              }
            />
          </label>
        </div>

        <button
          type="button"
          className="btn btn-primario mt-3 text-sm"
          disabled={!base.trim() || !fuente || construir.isPending}
          onClick={() => construir.mutate()}
        >
          {t('canales.construir')}
        </button>

        {construir.error && (
          <p className="mt-3 text-sm" style={{ color: 'var(--error)' }} role="alert">
            {construir.error.message}
          </p>
        )}

        {enlace && (
          <p
            className="mt-3 break-all rounded p-2 font-mono text-xs"
            style={{ background: 'var(--fondo-sutil)' }}
          >
            {enlace}
          </p>
        )}
      </div>

      <div className="space-y-2">
        {(canales.data ?? []).map((c) => (
          <article key={c.clave} className="panel p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{c.nombre}</span>
              <Etiqueta
                tono={TONO_ADMITE[c.admiteAdulto] ?? 'neutro'}
                texto={t(`canales.admite_${c.admiteAdulto}`)}
              />
            </div>
            {/* Los que no admiten el catálogo se enseñan igual, con el motivo:
                sin esto, dentro de seis meses alguien volvería a investigar si
                Meta Ads acepta esto. */}
            {c.advertencia && (
              <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                {c.advertencia}
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function Afiliados() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [creando, setCreando] = useState(false);

  const afiliados = useQuery({
    queryKey: ['canales', 'afiliados'],
    queryFn: () => get<Afiliado[]>('/channels/afiliados'),
  });

  const refrescar = () => void qc.invalidateQueries({ queryKey: ['canales', 'afiliados'] });

  const cambiar = useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: { status?: string } }) =>
      patch(`/channels/afiliados/${id}`, datos),
    onSuccess: refrescar,
  });

  const liquidar = useMutation({
    mutationFn: (id: string) => post(`/channels/afiliados/${id}/liquidar`, {}),
    onSuccess: refrescar,
  });

  if (afiliados.isLoading) return <Cargando />;
  if (afiliados.error)
    return <ErrorPanel error={afiliados.error} reintentar={() => void afiliados.refetch()} />;

  const items = afiliados.data ?? [];

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          className="btn btn-primario text-sm"
          onClick={() => setCreando(!creando)}
        >
          + {t('canales.nuevo_afiliado')}
        </button>
      </div>

      {creando && (
        <FormularioAfiliado
          onHecho={() => {
            setCreando(false);
            refrescar();
          }}
          onCancelar={() => setCreando(false)}
        />
      )}

      {items.length === 0 ? (
        <Vacio titulo={t('canales.sin_afiliados')} descripcion={t('canales.sin_afiliados_ayuda')} />
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <article key={a.id} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    <span className="font-mono text-xs">{a.code}</span>
                    <Etiqueta
                      tono={a.status === 'ACTIVO' ? 'exito' : 'neutro'}
                      texto={t(`canales.estado_${a.status}`)}
                    />
                  </div>
                  <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {a.email} · {a.commissionPercent}% ·{' '}
                    {t('canales.ventas_traidas', { n: a.ventas })}
                  </p>
                </div>

                <div className="text-right text-sm">
                  {/* Separados a propósito: lo devengado todavía puede anularse
                      por una devolución y lo pagado ya salió de la cuenta.
                      Sumarlos daría una deuda que no es. */}
                  <p className="tabular-nums">
                    {t('canales.por_pagar')} <strong>{euros(a.pendienteCents)}</strong>
                  </p>
                  <p className="text-xs tabular-nums" style={{ color: 'var(--texto-tenue)' }}>
                    {t('canales.ya_pagado')} {euros(a.pagadoCents)}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-fantasma text-sm"
                  onClick={() =>
                    cambiar.mutate({
                      id: a.id,
                      datos: { status: a.status === 'ACTIVO' ? 'PAUSADO' : 'ACTIVO' },
                    })
                  }
                >
                  {a.status === 'ACTIVO' ? t('canales.pausar') : t('canales.reactivar')}
                </button>
                <button
                  type="button"
                  className="btn btn-fantasma text-sm"
                  disabled={liquidar.isPending}
                  onClick={() => liquidar.mutate(a.id)}
                >
                  {t('canales.liquidar')}
                </button>
              </div>

              {liquidar.error && (
                <p className="mt-2 text-sm" style={{ color: 'var(--error)' }} role="alert">
                  {liquidar.error.message}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function FormularioAfiliado({
  onHecho,
  onCancelar,
}: {
  onHecho: () => void;
  onCancelar: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [comision, setComision] = useState('10');

  const crear = useMutation({
    mutationFn: () =>
      post('/channels/afiliados', {
        name: name.trim(),
        email: email.trim(),
        code: code.trim(),
        commissionPercent: Number(comision.replace(',', '.')) || 0,
      }),
    onSuccess: onHecho,
  });

  // Aviso, no bloqueo: un 25 % puede ser deliberado con un creador que trae
  // mucho volumen, pero conviene verlo antes de guardarlo.
  const alta = Number(comision.replace(',', '.')) >= 20;

  return (
    <div className="panel mb-4 p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm">
          <span className="etiqueta">{t('canales.nombre')}</span>
          <input
            className="campo mt-1 w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="etiqueta">{t('canales.email')}</span>
          <input
            className="campo mt-1 w-full"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="etiqueta">{t('canales.codigo')}</span>
          <input
            className="campo mt-1 w-full font-mono"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
          />
        </label>
        <label className="text-sm">
          <span className="etiqueta">{t('canales.comision')}</span>
          <input
            className="campo mt-1 w-full"
            inputMode="decimal"
            value={comision}
            onChange={(e) => setComision(e.target.value)}
          />
        </label>
      </div>

      <p className="mt-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {t('canales.comision_ayuda')}
      </p>

      {alta && (
        <p className="mt-2 text-sm" style={{ color: 'var(--aviso)' }} role="alert">
          {t('canales.comision_alta')}
        </p>
      )}

      {crear.error && (
        <p className="mt-3 text-sm" style={{ color: 'var(--error)' }} role="alert">
          {crear.error.message}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="btn btn-primario text-sm"
          disabled={!name.trim() || !email.trim() || !code.trim() || crear.isPending}
          onClick={() => crear.mutate()}
        >
          {t('app.guardar')}
        </button>
        <button type="button" className="btn btn-fantasma text-sm" onClick={onCancelar}>
          {t('app.cancelar')}
        </button>
      </div>
    </div>
  );
}
