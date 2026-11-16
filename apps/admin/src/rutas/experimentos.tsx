import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Pruebas A/B.
 *
 * La pantalla está construida alrededor de una sola idea: que sea **difícil
 * decidir sin datos**. Con treinta visitas cualquier variante parece ganar por
 * diez puntos, y quien lo ve en una tabla se lo cree y cambia la tienda entera
 * por una casualidad.
 *
 * Por eso mientras faltan visitas no se enseña ninguna ganadora, se dice
 * cuántas faltan, y el botón de cerrar avisa cuando la lectura todavía no es
 * concluyente. No lo impide —a veces se cierra una prueba por motivos que no
 * están en los números— pero obliga a saber lo que se está haciendo.
 */

interface Variante {
  clave: string;
  peso: number;
  valor: unknown;
}

interface Lectura {
  variantes: {
    clave: string;
    visitas: number;
    conversiones: number;
    ingresoCents: number;
    tasa: number;
    ingresoPorVisitaCents: number;
  }[];
  ganadora: string | null;
  confianza: number;
  motivo: 'DATOS_INSUFICIENTES' | 'SIN_DIFERENCIA' | 'CONCLUYENTE';
  visitasQueFaltan: number;
}

interface Experimento {
  id: string;
  key: string;
  name: string;
  hypothesis: string | null;
  status: 'BORRADOR' | 'ACTIVO' | 'PARADO';
  variantes: Variante[];
  startedAt: string | null;
  endedAt: string | null;
  winner: string | null;
  lectura: Lectura;
}

const euros = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €';
const porcentaje = (v: number) => (v * 100).toFixed(1).replace('.', ',') + ' %';

const TONO: Record<string, 'exito' | 'info' | 'neutro'> = {
  ACTIVO: 'exito',
  PARADO: 'neutro',
  BORRADOR: 'info',
};

export function Experimentos() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [creando, setCreando] = useState(false);

  const experimentos = useQuery({
    queryKey: ['experimentos'],
    queryFn: () => get<Experimento[]>('/experiments'),
  });

  const refrescar = () => void qc.invalidateQueries({ queryKey: ['experimentos'] });

  const estado = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: string }) =>
      patch(`/experiments/${id}/estado`, { estado }),
    onSuccess: refrescar,
  });

  const ganadora = useMutation({
    mutationFn: ({ id, variante }: { id: string; variante: string }) =>
      patch(`/experiments/${id}/ganadora`, { variante }),
    onSuccess: refrescar,
  });

  const eliminar = useMutation({
    mutationFn: (id: string) => del(`/experiments/${id}`),
    onSuccess: refrescar,
  });

  if (experimentos.isLoading) return <Cargando />;
  if (experimentos.error)
    return <ErrorPanel error={experimentos.error} reintentar={() => void experimentos.refetch()} />;

  const items = experimentos.data ?? [];

  return (
    <div>
      <Encabezado
        titulo={t('experimentos.titulo')}
        descripcion={t('experimentos.descripcion')}
        acciones={
          <button
            type="button"
            className="btn btn-primario text-sm"
            onClick={() => setCreando(!creando)}
          >
            + {t('experimentos.nuevo')}
          </button>
        }
      />

      {creando && (
        <FormularioExperimento
          onHecho={() => {
            setCreando(false);
            refrescar();
          }}
          onCancelar={() => setCreando(false)}
        />
      )}

      {items.length === 0 ? (
        <Vacio
          titulo={t('experimentos.sin_datos')}
          descripcion={t('experimentos.sin_datos_ayuda')}
        />
      ) : (
        <div className="space-y-3">
          {items.map((e) => (
            <article key={e.id} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{e.name}</h2>
                    <span className="font-mono text-xs" style={{ color: 'var(--texto-tenue)' }}>
                      {e.key}
                    </span>
                    <Etiqueta
                      tono={TONO[e.status] ?? 'neutro'}
                      texto={t(`experimentos.estado_${e.status}`)}
                    />
                    {e.winner && (
                      <Etiqueta
                        tono="exito"
                        texto={t('experimentos.gano', { variante: e.winner })}
                      />
                    )}
                  </div>

                  {e.hypothesis && (
                    <p className="mt-1 text-xs italic" style={{ color: 'var(--texto-tenue)' }}>
                      {e.hypothesis}
                    </p>
                  )}
                </div>

                <Veredicto lectura={e.lectura} />
              </div>

              <Tabla lectura={e.lectura} variantes={e.variantes} />

              <div className="mt-3 flex flex-wrap gap-2">
                {e.status !== 'ACTIVO' && !e.winner && (
                  <button
                    type="button"
                    className="btn btn-fantasma text-sm"
                    onClick={() => estado.mutate({ id: e.id, estado: 'ACTIVO' })}
                  >
                    {t('experimentos.arrancar')}
                  </button>
                )}
                {e.status === 'ACTIVO' && (
                  <button
                    type="button"
                    className="btn btn-fantasma text-sm"
                    onClick={() => estado.mutate({ id: e.id, estado: 'PARADO' })}
                  >
                    {t('experimentos.parar')}
                  </button>
                )}

                {!e.winner &&
                  e.variantes.map((v) => (
                    <button
                      key={v.clave}
                      type="button"
                      className="btn btn-fantasma text-sm"
                      onClick={() => {
                        // El aviso no bloquea: a veces se cierra una prueba por
                        // motivos que no están en los números. Pero sí obliga a
                        // enterarse de que la evidencia no da para tanto.
                        if (
                          e.lectura.motivo !== 'CONCLUYENTE' &&
                          !window.confirm(t('experimentos.confirmar_sin_datos'))
                        ) {
                          return;
                        }
                        ganadora.mutate({ id: e.id, variante: v.clave });
                      }}
                    >
                      {t('experimentos.declarar', { variante: v.clave })}
                    </button>
                  ))}

                <button
                  type="button"
                  className="btn btn-fantasma text-sm"
                  style={{ color: 'var(--error)' }}
                  onClick={() => eliminar.mutate(e.id)}
                >
                  {t('app.eliminar')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/** El veredicto, que es lo primero que se mira y lo más fácil de malinterpretar. */
function Veredicto({ lectura }: { lectura: Lectura }) {
  const { t } = useTranslation();

  if (lectura.motivo === 'DATOS_INSUFICIENTES') {
    return (
      <div className="text-right text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('experimentos.faltan_visitas', { n: lectura.visitasQueFaltan })}
      </div>
    );
  }

  if (lectura.motivo === 'SIN_DIFERENCIA') {
    return (
      <div className="text-right text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('experimentos.sin_diferencia')}
        <span className="block text-xs">
          {t('experimentos.confianza', { valor: porcentaje(lectura.confianza) })}
        </span>
      </div>
    );
  }

  return (
    <div className="text-right text-sm">
      <span className="font-medium" style={{ color: 'var(--exito)' }}>
        {t('experimentos.gana', { variante: lectura.ganadora ?? '' })}
      </span>
      <span className="block text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {t('experimentos.confianza', { valor: porcentaje(lectura.confianza) })}
      </span>
    </div>
  );
}

function Tabla({ lectura, variantes }: { lectura: Lectura; variantes: Variante[] }) {
  const { t } = useTranslation();

  return (
    <table className="mt-3 w-full text-sm">
      <thead>
        <tr style={{ color: 'var(--texto-tenue)' }}>
          <th className="pb-1 text-left font-normal">{t('experimentos.variante')}</th>
          <th className="pb-1 text-right font-normal">{t('experimentos.visitas')}</th>
          <th className="pb-1 text-right font-normal">{t('experimentos.conversiones')}</th>
          <th className="pb-1 text-right font-normal">{t('experimentos.tasa')}</th>
          {/* El ingreso por visita va el último y es el que decide: una
              variante puede convertir más y vender menos si empuja al producto
              barato. */}
          <th className="pb-1 text-right font-normal">{t('experimentos.ingreso_visita')}</th>
        </tr>
      </thead>
      <tbody>
        {lectura.variantes.map((v) => {
          const definicion = variantes.find((d) => d.clave === v.clave);

          return (
            <tr key={v.clave} className="border-t" style={{ borderColor: 'var(--borde)' }}>
              <td className="py-1.5">
                <span className="font-mono">{v.clave}</span>
                <span className="ml-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {definicion ? `${String(definicion.peso)}% · ${String(definicion.valor)}` : ''}
                </span>
              </td>
              <td className="py-1.5 text-right tabular-nums">{v.visitas}</td>
              <td className="py-1.5 text-right tabular-nums">{v.conversiones}</td>
              <td className="py-1.5 text-right tabular-nums">{porcentaje(v.tasa)}</td>
              <td className="py-1.5 text-right tabular-nums">{euros(v.ingresoPorVisitaCents)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FormularioExperimento({
  onHecho,
  onCancelar,
}: {
  onHecho: () => void;
  onCancelar: () => void;
}) {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [valorA, setValorA] = useState('');
  const [valorB, setValorB] = useState('');
  const [peso, setPeso] = useState('50');

  const crear = useMutation({
    mutationFn: () =>
      post('/experiments', {
        key: key.trim(),
        name: name.trim(),
        ...(hypothesis.trim() ? { hypothesis: hypothesis.trim() } : {}),
        variantes: [
          { clave: 'a', peso: 100 - (Number(peso) || 50), valor: valorA },
          { clave: 'b', peso: Number(peso) || 50, valor: valorB },
        ],
      }),
    onSuccess: onHecho,
  });

  return (
    <div className="panel mb-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="etiqueta">{t('experimentos.clave')}</span>
          <input
            className="campo mt-1 w-full font-mono"
            placeholder="cta-producto"
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          />
        </label>

        <label className="text-sm">
          <span className="etiqueta">{t('experimentos.nombre')}</span>
          <input
            className="campo mt-1 w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>

      {/* Se pide antes de arrancar, no después: escribir qué se espera evita
          encontrar a posteriori una explicación bonita para cualquier
          resultado que haya salido. */}
      <label className="mt-3 block text-sm">
        <span className="etiqueta">{t('experimentos.hipotesis')}</span>
        <input
          className="campo mt-1 w-full"
          placeholder={t('experimentos.hipotesis_ejemplo')}
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="etiqueta">{t('experimentos.valor_a')}</span>
          <input
            className="campo mt-1 w-full"
            value={valorA}
            onChange={(e) => setValorA(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="etiqueta">{t('experimentos.valor_b')}</span>
          <input
            className="campo mt-1 w-full"
            value={valorB}
            onChange={(e) => setValorB(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="etiqueta">{t('experimentos.reparto_b')}</span>
          <input
            className="campo mt-1 w-full"
            inputMode="numeric"
            value={peso}
            onChange={(e) => setPeso(e.target.value)}
          />
          <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('experimentos.reparto_ayuda')}
          </span>
        </label>
      </div>

      {crear.error && (
        <p className="mt-3 text-sm" style={{ color: 'var(--error)' }} role="alert">
          {crear.error.message}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="btn btn-primario text-sm"
          disabled={!key.trim() || !name.trim() || crear.isPending}
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
