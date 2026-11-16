import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { fechaRelativa } from '@/lib/formato';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { Enlace } from '@/componentes/enlace';
import { useSesion } from '@/lib/sesion';

/**
 * El equipo, en una tabla y nada más.
 *
 * Aquí antes vivían dos formularios metidos a presión: el de invitar, que se
 * desplegaba sobre la tabla, y el de las sesiones, que abría una fila extra
 * dentro del `tbody`. Los dos se han ido a su propia pantalla —`/equipo/nuevo` y
 * `/equipo/$userId`— y esta se queda con lo que una lista tiene que hacer:
 * enseñar quién hay, con qué accesos, y llevar a cada uno.
 *
 * Lo que se gana no es solo sitio. Editar accesos tiene URL, así que se puede
 * mandar por chat, abrir en otra pestaña y volver atrás; y la tabla vuelve a ser
 * una tabla para un lector de pantalla, sin filas que aparecen y desaparecen.
 */

interface Miembro {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  totpEnabledAt: string | null;
  lastLoginAt: string | null;
  roles: { id: string; key: string; name: string }[];
}

export function Equipo() {
  const { t } = useTranslation();
  const { puede } = useSesion();
  const [busqueda, setBusqueda] = useState('');
  const [soloActivos, setSoloActivos] = useState<'todos' | 'si' | 'no'>('todos');

  /*
   * El filtro va en la consulta, no sobre lo que ya se trajo.
   *
   * Filtrar en el navegador solo funciona mientras quepan todas las cuentas en
   * una petición: en cuanto no caben, buscar «ana» deja de encontrar a quien
   * esté en la página siguiente y parece que no existe.
   */
  const equipo = useQuery({
    queryKey: ['equipo', busqueda, soloActivos],
    queryFn: () =>
      get<{ items: Miembro[] }>(
        `/users?tipo=STAFF&limite=100${busqueda ? `&busqueda=${encodeURIComponent(busqueda)}` : ''}${
          soloActivos === 'todos' ? '' : `&activos=${soloActivos === 'si' ? 'true' : 'false'}`
        }`,
      ),
  });

  if (equipo.isLoading) return <Cargando />;
  if (equipo.error)
    return <ErrorPanel error={equipo.error} reintentar={() => void equipo.refetch()} />;

  const items = equipo.data?.items ?? [];

  return (
    <div>
      <Encabezado
        titulo={t('equipo.titulo')}
        cargados={items.length}
        acciones={
          puede('users:write') && (
            <Enlace a="/equipo/nuevo" className="btn btn-primario text-sm">
              {t('equipo.nuevo_titulo')}
            </Enlace>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="campo w-full max-w-sm"
          placeholder={t('equipo.buscar')}
          aria-label={t('equipo.buscar')}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <select
          className="campo w-auto"
          aria-label={t('app.estado')}
          value={soloActivos}
          onChange={(e) => setSoloActivos(e.target.value as 'todos' | 'si' | 'no')}
        >
          <option value="todos">{t('equipo.estado_todos')}</option>
          <option value="si">{t('equipo.activo')}</option>
          <option value="no">{t('equipo.inactivo')}</option>
        </select>
        {(busqueda !== '' || soloActivos !== 'todos') && (
          <button
            type="button"
            className="btn btn-fantasma text-sm"
            onClick={() => {
              setBusqueda('');
              setSoloActivos('todos');
            }}
          >
            {t('app.limpiar_filtros')}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <Vacio titulo={t('app.sin_datos')} />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>{t('equipo.email')}</th>
                <th>{t('equipo.roles')}</th>
                <th>2FA</th>
                <th>{t('equipo.ultimo_acceso')}</th>
                <th>{t('app.estado')}</th>
                <th className="text-right">{t('app.acciones')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => {
                const nombreCompleto =
                  [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email;

                return (
                  <tr key={m.id}>
                    <td>
                      {/* El nombre es el enlace a la ficha: es lo que se busca
                          pulsar, y así no hace falta una columna de «ver». */}
                      <Enlace
                        a="/equipo/$userId"
                        params={{ userId: m.id }}
                        className="font-medium hover:underline"
                      >
                        {nombreCompleto}
                      </Enlace>
                      <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                        {m.email}
                      </p>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {m.roles.length === 0 ? (
                          <Etiqueta texto={t('equipo.sin_roles')} tono="aviso" />
                        ) : (
                          m.roles.map((r) => <Etiqueta key={r.id} texto={r.name} />)
                        )}
                      </div>
                    </td>
                    <td>
                      {m.totpEnabledAt ? (
                        <Etiqueta texto={t('app.si')} tono="exito" />
                      ) : (
                        <Etiqueta texto={t('app.no')} tono="aviso" />
                      )}
                    </td>
                    <td className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                      {m.lastLoginAt ? fechaRelativa(m.lastLoginAt) : t('app.ninguno')}
                    </td>
                    <td>
                      <Etiqueta
                        texto={m.isActive ? t('equipo.activo') : t('equipo.inactivo')}
                        tono={m.isActive ? 'exito' : 'neutro'}
                      />
                    </td>
                    <td className="text-right">
                      <Enlace
                        a="/equipo/$userId"
                        params={{ userId: m.id }}
                        className="btn btn-fantasma text-xs"
                      >
                        {t('equipo.gestionar')}
                      </Enlace>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
