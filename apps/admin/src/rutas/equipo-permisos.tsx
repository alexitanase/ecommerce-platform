import { useTranslation } from 'react-i18next';
import { Etiqueta } from '@/componentes/estados';
import { Tag } from '@/componentes/ui/datos';

/**
 * Elegir roles viendo lo que conceden.
 *
 * Lo comparten el alta y la edición, y existe por una razón concreta: una lista
 * de casillas con «Soporte» y «Almacén» no dice nada sobre qué va a poder hacer
 * esa persona. Quien reparte accesos necesita ver los permisos, y verlos
 * mientras elige, no después.
 *
 * Los permisos no se asignan de uno en uno a propósito: van en roles. Doce
 * personas con doce juegos de permisos hechos a mano es imposible de auditar
 * —nadie sabe ya quién puede devolver dinero— y basta con olvidarse de una para
 * dejar un agujero. Con roles, la pregunta «quién puede hacer esto» tiene una
 * respuesta que se lee de un vistazo.
 */

export interface Rol {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  usuarios: number;
  permissions: string[];
}

/**
 * Agrupa los permisos por el recurso al que se refieren.
 *
 * `orders:read` y `orders:refund` juntos y no en dos sitios distintos de una
 * lista alfabética de cuarenta: lo que se comprueba al repartir accesos es
 * «¿qué puede tocar de pedidos?», no si existe un permiso concreto.
 */
export function agruparPorRecurso(permisos: string[]): [string, string[]][] {
  const grupos = new Map<string, string[]>();

  for (const permiso of [...new Set(permisos)].sort()) {
    const recurso = permiso.split(':')[0] ?? permiso;
    grupos.set(recurso, [...(grupos.get(recurso) ?? []), permiso]);
  }

  return [...grupos.entries()];
}

/** Los permisos que resultan de un conjunto de roles, sin repetidos. */
export function permisosDe(roles: Rol[], elegidos: string[]): string[] {
  const ids = new Set(elegidos);
  return [...new Set(roles.filter((r) => ids.has(r.id)).flatMap((r) => r.permissions))].sort();
}

export function SelectorRoles({
  roles,
  elegidos,
  alCambiar,
  deshabilitado = false,
}: {
  roles: Rol[];
  elegidos: string[];
  alCambiar: (ids: string[]) => void;
  deshabilitado?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <fieldset className="space-y-2" disabled={deshabilitado}>
      <legend className="sr-only">{t('equipo.roles')}</legend>

      {roles.map((rol) => {
        const marcado = elegidos.includes(rol.id);

        return (
          <label
            key={rol.id}
            className="flex cursor-pointer gap-3 rounded-lg p-3"
            style={{
              border: '1px solid var(--borde)',
              background: marcado ? 'color-mix(in srgb, var(--info) 6%, transparent)' : undefined,
              borderColor: marcado ? 'color-mix(in srgb, var(--info) 40%, transparent)' : undefined,
            }}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={marcado}
              onChange={(e) =>
                alCambiar(
                  e.target.checked ? [...elegidos, rol.id] : elegidos.filter((id) => id !== rol.id),
                )
              }
            />

            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{rol.name}</span>
                <code className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {rol.key}
                </code>
                {rol.isSystem && <Etiqueta texto={t('equipo.rol_sistema')} tono="info" />}
              </span>

              <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
                {t('equipo.rol_resumen', {
                  permisos: rol.permissions.length,
                  usuarios: rol.usuarios,
                })}
              </span>

              <span className="mt-2 flex flex-wrap gap-1">
                {rol.permissions.length === 0 ? (
                  <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {t('equipo.rol_sin_permisos')}
                  </span>
                ) : (
                  rol.permissions.map((p) => <Tag key={p} texto={p} />)
                )}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * Lo que va a poder hacer esta persona, sumando todos sus roles.
 *
 * Se enseña aparte de las casillas porque los roles se solapan: con «Soporte» y
 * «Almacén» marcados, `orders:read` sale en los dos y la pregunta real —«¿tiene
 * acceso a los reembolsos?»— no se contesta mirando dos listas. Aquí está la
 * suma, que es lo que de verdad se concede.
 */
export function ResumenPermisos({ roles, elegidos }: { roles: Rol[]; elegidos: string[] }) {
  const { t } = useTranslation();
  const permisos = permisosDe(roles, elegidos);

  if (permisos.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('equipo.permisos_vacio')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {t('equipo.permisos_total', { total: permisos.length })}
      </p>

      {agruparPorRecurso(permisos).map(([recurso, claves]) => (
        <div key={recurso}>
          <p className="mb-1 text-xs font-medium uppercase" style={{ letterSpacing: '0.04em' }}>
            {recurso}
          </p>
          <div className="flex flex-wrap gap-1">
            {claves.map((clave) => (
              <Tag key={clave} texto={clave.split(':')[1] ?? clave} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
