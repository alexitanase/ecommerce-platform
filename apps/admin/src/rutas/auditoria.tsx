import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import {
  Cargando,
  ErrorPanel,
  Etiqueta,
  SinResultados,
  Vacio,
  VerMas,
} from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { consulta, useListaPaginada } from '@/lib/paginacion';
import { fechaRelativa } from '@/lib/formato';

/**
 * Registro de actividad.
 *
 * Para qué sirve de verdad: cuando un pedido aparece cancelado, un precio ha
 * cambiado o un cliente se ha quedado sin acceso, esto es lo único que dice
 * **quién** lo hizo y **qué valores** había antes. Sin él la respuesta a "¿esto
 * quién lo ha tocado?" es una conversación en vez de un dato.
 *
 * Solo lectura: un registro que se puede editar desde la aplicación no
 * acredita nada.
 */

interface Registro {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actorIp: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
}

interface Filtros {
  acciones: { valor: string; registros: number }[];
  recursos: { valor: string; registros: number }[];
}

/**
 * Acciones que conviene mirar antes que las demás.
 *
 * No es una lista de "cosas malas": son las que mueven dinero, permisos o
 * datos personales, y por tanto las que hay que poder justificar si alguien
 * pregunta.
 */
const SENSIBLES = [
  'order.refund',
  'order.cancel',
  'withdrawal.status_change',
  'return.status_change',
  'user.delete',
  'users.anonymize',
  'roles.assign',
  'settings.update',
];

const esSensible = (accion: string) => SENSIBLES.some((s) => accion.startsWith(s));

const nombreActor = (a: Registro['actor']) =>
  a ? [a.firstName, a.lastName].filter(Boolean).join(' ') || a.email : null;

export function Auditoria() {
  const { t } = useTranslation();
  const [recurso, setRecurso] = useState('');
  const [accion, setAccion] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);

  const filtros = useQuery({
    queryKey: ['auditoria', 'filtros'],
    queryFn: () => get<Filtros>('/audit/actions'),
  });

  // El registro de auditoría es donde más falta hace poder seguir hacia atrás:
  // se entra a él justamente para reconstruir qué pasó, y cortarlo en la
  // primera página deja fuera lo anterior a la última hora movida.
  const registros = useListaPaginada<Registro>(
    ['auditoria', recurso, accion],
    (cursor) => `/audit?${consulta({ resource: recurso, action: accion }, cursor)}`,
  );

  const limpiarFiltros = () => {
    setRecurso('');
    setAccion('');
  };

  if (registros.cargando) return <Cargando />;
  if (registros.error)
    return <ErrorPanel error={registros.error} reintentar={registros.recargar} />;

  const items = registros.items;

  return (
    <div>
      <Encabezado
        titulo={t('auditoria.titulo')}
        descripcion={t('auditoria.descripcion')}
        cargados={items.length}
        hayMas={registros.hayMas}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className="campo"
          value={recurso}
          onChange={(e) => setRecurso(e.target.value)}
          aria-label={t('auditoria.todos_recursos')}
        >
          <option value="">{t('auditoria.todos_recursos')}</option>
          {(filtros.data?.recursos ?? []).map((r) => (
            <option key={r.valor} value={r.valor}>
              {r.valor} ({r.registros})
            </option>
          ))}
        </select>

        <select
          className="campo"
          value={accion}
          onChange={(e) => setAccion(e.target.value)}
          aria-label={t('auditoria.todas_acciones')}
        >
          <option value="">{t('auditoria.todas_acciones')}</option>
          {(filtros.data?.acciones ?? []).map((a) => (
            <option key={a.valor} value={a.valor}>
              {a.valor} ({a.registros})
            </option>
          ))}
        </select>

        {(recurso || accion) && (
          <button type="button" className="btn btn-fantasma text-sm" onClick={limpiarFiltros}>
            {t('auditoria.limpiar')}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        recurso || accion ? (
          <SinResultados alLimpiar={limpiarFiltros} />
        ) : (
          <Vacio
            titulo={t('auditoria.sin_registros')}
            descripcion={t('auditoria.sin_registros_ayuda')}
          />
        )
      ) : (
        <div className="space-y-1">
          {items.map((r) => (
            <div key={r.id}>
              <button
                type="button"
                className="panel flex w-full flex-wrap items-center gap-3 p-3 text-left text-sm"
                onClick={() => setAbierto(abierto === r.id ? null : r.id)}
              >
                <span className="tabular-nums text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {fechaRelativa(r.createdAt)}
                </span>

                <span className="font-medium">{r.action}</span>

                {esSensible(r.action) && <Etiqueta tono="aviso" texto={t('auditoria.sensible')} />}

                <span style={{ color: 'var(--texto-tenue)' }}>
                  {r.resource}
                  {r.resourceId ? ` · ${r.resourceId.slice(0, 10)}…` : ''}
                </span>

                <span className="ml-auto" style={{ color: 'var(--texto-tenue)' }}>
                  {nombreActor(r.actor) ?? t('auditoria.sistema')}
                </span>
              </button>

              {abierto === r.id && <Detalle registro={r} />}
            </div>
          ))}

          <VerMas
            hayMas={registros.hayMas}
            cargando={registros.cargandoMas}
            alPulsar={registros.cargarMas}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Antes y después, uno al lado del otro.
 *
 * Es lo que convierte "alguien cambió esto" en "cambió de X a Y", que es la
 * única forma de saber si el cambio estuvo bien.
 */
function Detalle({ registro }: { registro: Registro }) {
  const { t } = useTranslation();

  return (
    <div className="panel mt-1 p-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <Bloque titulo={t('auditoria.antes')} valor={registro.before} />
        <Bloque titulo={t('auditoria.despues')} valor={registro.after} />
      </div>

      {registro.metadata != null && (
        <div className="mt-3">
          <Bloque titulo={t('auditoria.contexto')} valor={registro.metadata} />
        </div>
      )}

      <p className="mt-3 text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {new Date(registro.createdAt).toLocaleString('es-ES')}
        {registro.actorIp ? ` · IP ${registro.actorIp}` : ''}
        {registro.resourceId ? ` · ${registro.resource} ${registro.resourceId}` : ''}
      </p>
    </div>
  );
}

function Bloque({ titulo, valor }: { titulo: string; valor: unknown }) {
  const { t } = useTranslation();

  return (
    <div>
      <p className="mb-1 text-xs font-medium" style={{ color: 'var(--texto-tenue)' }}>
        {titulo}
      </p>
      {valor == null ? (
        <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {t('auditoria.sin_valor')}
        </p>
      ) : (
        <pre
          className="overflow-x-auto rounded-lg p-3 text-xs"
          style={{ background: 'var(--fondo-sutil)' }}
        >
          {JSON.stringify(valor, null, 2)}
        </pre>
      )}
    </div>
  );
}
