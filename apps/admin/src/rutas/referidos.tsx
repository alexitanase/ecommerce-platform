import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Programa de referidos.
 *
 * Lo que decide si el programa sale a cuenta no es cuánta gente se ha traído,
 * sino **cuánto descuento se ha entregado** por traerla. Por eso el coste va
 * arriba, separado en emitido y canjeado: un cupón que caduca sin usarse no
 * cuesta nada, y confundir las dos cifras hace parecer caro un programa que no
 * lo es —o barato uno que sí.
 */

interface Reglas {
  activo: boolean;
  premioReferidorCents: number;
  premioReferidoCents: number;
  pedidoMinimoCents: number;
  maximoPorReferidor: number;
  diasDeValidez: number;
}

interface Referido {
  id: string;
  referidor: string;
  invitado: string;
  codigo: string;
  estado: string;
  motivoRechazo: string | null;
  fecha: string;
  completadoEl: string | null;
}

interface Listado {
  referidos: Referido[];
  resumen: { completados: number; emitidoCents: number; canjeadoCents: number };
}

const euros = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €';
const aCentimos = (v: string) => Math.round(Number(v.replace(',', '.')) * 100) || 0;

const TONO: Record<string, 'exito' | 'aviso' | 'neutro'> = {
  COMPLETADO: 'exito',
  RECHAZADO: 'aviso',
  PENDIENTE: 'neutro',
};

export function Referidos() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState('');

  const reglas = useQuery({
    queryKey: ['referidos', 'reglas'],
    queryFn: () => get<Reglas>('/referrals/reglas'),
  });

  const listado = useQuery({
    queryKey: ['referidos', 'listado', filtro],
    queryFn: () => get<Listado>(`/referrals${filtro ? `?estado=${filtro}` : ''}`),
  });

  if (reglas.isLoading) return <Cargando />;
  if (reglas.error)
    return <ErrorPanel error={reglas.error} reintentar={() => void reglas.refetch()} />;

  const resumen = listado.data?.resumen;

  return (
    <div>
      <Encabezado titulo={t('referidos.titulo')} descripcion={t('referidos.descripcion')} />

      {resumen && resumen.completados > 0 && (
        <div className="panel mb-4 grid gap-4 p-4 sm:grid-cols-3">
          <Cifra etiqueta={t('referidos.completados')} valor={String(resumen.completados)} />
          <Cifra etiqueta={t('referidos.emitido')} valor={euros(resumen.emitidoCents)} />
          {/* Emitido no es gastado: separarlos evita creer que el programa
              cuesta el doble de lo que cuesta. */}
          <Cifra
            etiqueta={t('referidos.canjeado')}
            valor={euros(resumen.canjeadoCents)}
            ayuda={t('referidos.canjeado_ayuda')}
          />
        </div>
      )}

      {/* La `key` hace que el formulario se rehaga cuando llegan reglas
          nuevas del servidor. Sin ella habría que copiar los valores en un
          efecto, y entonces lo que esté escribiendo alguien en ese momento se
          perdería con cualquier refresco. */}
      <FormularioReglas
        key={JSON.stringify(reglas.data)}
        reglas={reglas.data!}
        onGuardado={() => void qc.invalidateQueries({ queryKey: ['referidos'] })}
      />

      <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{t('referidos.movimientos')}</h2>
        <select
          className="campo ml-auto text-base sm:text-sm"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          aria-label={t('referidos.filtrar')}
        >
          <option value="">{t('referidos.todos')}</option>
          <option value="PENDIENTE">{t('referidos.estado_PENDIENTE')}</option>
          <option value="COMPLETADO">{t('referidos.estado_COMPLETADO')}</option>
          <option value="RECHAZADO">{t('referidos.estado_RECHAZADO')}</option>
        </select>
      </div>

      {listado.isLoading ? (
        <Cargando />
      ) : listado.error ? (
        <ErrorPanel error={listado.error} reintentar={() => void listado.refetch()} />
      ) : (listado.data?.referidos.length ?? 0) === 0 ? (
        <Vacio titulo={t('referidos.sin_datos')} descripcion={t('referidos.sin_datos_ayuda')} />
      ) : (
        <div className="space-y-2">
          {listado.data?.referidos.map((r) => (
            <article key={r.id} className="panel flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {r.referidor} <span style={{ color: 'var(--texto-tenue)' }}>→</span> {r.invitado}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  <span className="font-mono">{r.codigo}</span> ·{' '}
                  {new Date(r.fecha).toLocaleDateString('es-ES')}
                  {/* El motivo del rechazo se enseña siempre: sin él, quien
                      mira el panel no sabe si el programa funciona mal o si
                      alguien intentó colarse. */}
                  {r.motivoRechazo && ` · ${t(`referidos.motivo_${r.motivoRechazo}`)}`}
                </p>
              </div>
              <Etiqueta
                tono={TONO[r.estado] ?? 'neutro'}
                texto={t(`referidos.estado_${r.estado}`)}
              />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Cifra({ etiqueta, valor, ayuda }: { etiqueta: string; valor: string; ayuda?: string }) {
  return (
    <div>
      <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {etiqueta}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{valor}</p>
      {ayuda && (
        <p className="mt-0.5 text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {ayuda}
        </p>
      )}
    </div>
  );
}

function FormularioReglas({ reglas, onGuardado }: { reglas: Reglas; onGuardado: () => void }) {
  const { t } = useTranslation();
  const [activo, setActivo] = useState(reglas.activo);
  const [premioReferidor, setPremioReferidor] = useState(
    (reglas.premioReferidorCents / 100).toFixed(2),
  );
  const [premioReferido, setPremioReferido] = useState(
    (reglas.premioReferidoCents / 100).toFixed(2),
  );
  const [minimo, setMinimo] = useState((reglas.pedidoMinimoCents / 100).toFixed(2));
  const [maximo, setMaximo] = useState(String(reglas.maximoPorReferidor));
  const [dias, setDias] = useState(String(reglas.diasDeValidez));

  const guardar = useMutation({
    mutationFn: (datos: Partial<Reglas>) => patch<Reglas>('/referrals/reglas', datos),
    onSuccess: onGuardado,
  });

  const enviar = () =>
    guardar.mutate({
      activo,
      premioReferidorCents: aCentimos(premioReferidor),
      premioReferidoCents: aCentimos(premioReferido),
      pedidoMinimoCents: aCentimos(minimo),
      maximoPorReferidor: Number(maximo) || 0,
      diasDeValidez: Number(dias) || 90,
    });

  // El aviso replica la regla del servidor. Se enseña antes de guardar porque
  // ver por qué no se puede es más útil que recibir el error después.
  const ruinoso =
    aCentimos(premioReferidor) + aCentimos(premioReferido) >= aCentimos(minimo) &&
    aCentimos(minimo) > 0;

  return (
    <div className="panel p-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        {t('referidos.activo')}
      </label>
      <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {t('referidos.activo_ayuda')}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Campo
          etiqueta={t('referidos.premio_referidor')}
          valor={premioReferidor}
          onCambio={setPremioReferidor}
        />
        <Campo
          etiqueta={t('referidos.premio_referido')}
          valor={premioReferido}
          onCambio={setPremioReferido}
        />
        <Campo etiqueta={t('referidos.minimo')} valor={minimo} onCambio={setMinimo} />
        <Campo
          etiqueta={t('referidos.maximo')}
          valor={maximo}
          onCambio={setMaximo}
          ayuda={t('referidos.maximo_ayuda')}
        />
        <Campo etiqueta={t('referidos.dias')} valor={dias} onCambio={setDias} />
      </div>

      {ruinoso && (
        <p className="mt-3 text-sm" style={{ color: 'var(--error)' }} role="alert">
          {t('referidos.aviso_ruinoso')}
        </p>
      )}

      {guardar.error && (
        <p className="mt-3 text-sm" style={{ color: 'var(--error)' }} role="alert">
          {guardar.error.message}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className="btn btn-primario text-sm"
          disabled={ruinoso || guardar.isPending}
          onClick={enviar}
        >
          {t('app.guardar')}
        </button>
        {guardar.isSuccess && !guardar.isPending && (
          <span className="text-sm" style={{ color: 'var(--exito)' }}>
            {t('app.guardado')}
          </span>
        )}
      </div>
    </div>
  );
}

function Campo({
  etiqueta,
  valor,
  onCambio,
  ayuda,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  ayuda?: string;
}) {
  return (
    <label className="text-sm">
      <span className="etiqueta">{etiqueta}</span>
      <input
        className="campo mt-1 w-full"
        inputMode="decimal"
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
      />
      {ayuda && (
        <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {ayuda}
        </span>
      )}
    </label>
  );
}
