import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { del, get, patch } from '@/lib/api';
import { fechaHora, fechaRelativa } from '@/lib/formato';
import {
  Alerta,
  Cargando,
  ErrorPanel,
  Etiqueta,
  Frescura,
  SinPermiso,
} from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { Enlace } from '@/componentes/enlace';
import { Boton } from '@/componentes/ui/boton';
import { Entrada } from '@/componentes/ui/formulario';
import { ListaDatos, Tarjeta } from '@/componentes/ui/datos';
import { ConfirmarPeligro } from '@/componentes/ui/overlays';
import { useToast } from '@/componentes/ui/toast';
import { useSesion } from '@/lib/sesion';
import { SelectorRoles, ResumenPermisos, type Rol } from '@/rutas/equipo-permisos';

/**
 * Ficha de un miembro del equipo, y el único sitio donde se editan sus accesos.
 *
 * Hasta ahora los roles solo se podían elegir al invitar: si alguien cambiaba de
 * puesto, no había forma de tocarlos desde el panel —la API sí sabía hacerlo,
 * pero no había pantalla— y la única salida era entrar a la base de datos. Eso
 * hace que en la práctica se reparta de más «por si acaso», que es como se acaba
 * con seis personas capaces de devolver dinero.
 *
 * El guardado manda el conjunto completo de roles en una sola petición. Ir
 * pidiendo «asigna este» y «quita ese otro» desde aquí dejaría los permisos a
 * medias en cuanto una se perdiera, y con los permisos a medias alguien se queda
 * fuera de su trabajo o dentro de donde no debía.
 */

interface Sesion {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface Detalle {
  id: string;
  email: string;
  type: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  emailVerifiedAt: string | null;
  totpEnabledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  roles: { id: string; key: string; name: string }[];
  sesiones: Sesion[];
}

export function EquipoFicha() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const { usuario, puede } = useSesion();

  const parametros: Record<string, string | undefined> = useParams({ strict: false });
  const userId = parametros['userId'] ?? '';

  const [cerrando, setCerrando] = useState(false);

  const miembro = useQuery({
    queryKey: ['miembro', userId],
    queryFn: () => get<Detalle>(`/users/${userId}`),
  });

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => get<Rol[]>('/roles'),
  });

  const cambiarEstado = useMutation({
    mutationFn: (activo: boolean) => patch(`/users/${userId}/status`, { isActive: activo }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['miembro', userId] });
      void qc.invalidateQueries({ queryKey: ['equipo'] });
      toast.exito(t('equipo.estado_ok'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cerrarSesiones = useMutation({
    mutationFn: () => del(`/users/${userId}/sessions`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['miembro', userId] });
      setCerrando(false);
      toast.exito(t('equipo.sesiones_cerradas'));
    },
    onError: (e: Error) => {
      setCerrando(false);
      toast.error(e.message);
    },
  });

  if (!puede('users:read')) return <SinPermiso permiso="users:read" />;
  if (miembro.isLoading || roles.isLoading) return <Cargando filas={4} />;
  if (miembro.error)
    return <ErrorPanel error={miembro.error} reintentar={() => void miembro.refetch()} />;
  if (!miembro.data) return null;

  const m = miembro.data;
  const editable = puede('users:write');
  const esUnoMismo = m.id === usuario?.id;
  const nombreCompleto = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email;

  return (
    <div>
      <Encabezado
        titulo={nombreCompleto}
        descripcion={m.email}
        migas={[{ etiqueta: nombreCompleto }]}
        frescura={
          <Frescura
            actualizado={miembro.dataUpdatedAt}
            refrescando={miembro.isFetching}
            alRefrescar={() => void miembro.refetch()}
          />
        }
        acciones={
          <>
            <Etiqueta
              texto={m.isActive ? t('equipo.activo') : t('equipo.inactivo')}
              tono={m.isActive ? 'exito' : 'neutro'}
            />
            {m.totpEnabledAt && <Etiqueta texto={t('equipo.con_2fa')} tono="exito" />}
            <Enlace a="/equipo" className="btn btn-secundario text-sm">
              {t('equipo.volver_al_listado')}
            </Enlace>
          </>
        }
      />

      <div className="grid gap-4" style={{ maxWidth: '46rem' }}>
        <Tarjeta titulo={t('equipo.cuenta')}>
          <ListaDatos
            datos={[
              { nombre: t('equipo.email'), valor: m.email },
              { nombre: t('equipo.alta'), valor: fechaHora(m.createdAt) },
              {
                nombre: t('equipo.ultimo_acceso'),
                valor: m.lastLoginAt ? fechaRelativa(m.lastLoginAt) : t('equipo.nunca'),
              },
              { nombre: '2FA', valor: m.totpEnabledAt ? t('app.si') : t('app.no') },
            ]}
          />
        </Tarjeta>

        {/*
         * El formulario es un hijo con `key`, y eso es lo que impide que un
         * refresco en segundo plano pise lo que se está escribiendo.
         *
         * React Query vuelve a pedir el dato al recuperar el foco de la pestaña.
         * Si el estado del formulario viviera aquí y se sincronizara con lo que
         * llega, los cambios a medio hacer desaparecerían sin explicación. Con la
         * `key` atada al id, el estado se inicializa una vez al montar y solo se
         * vuelve a inicializar si de verdad se está mirando a otra persona.
         */}
        <FormularioAccesos
          key={m.id}
          miembro={m}
          roles={roles.data ?? []}
          editable={editable}
          esUnoMismo={esUnoMismo}
        />

        <Tarjeta
          titulo={t('equipo.sesiones')}
          descripcion={t('equipo.sesiones_ayuda')}
          acciones={
            /*
             * Cerrar las propias echaría de la pantalla a quien la está mirando,
             * sin avisar y sin haber terminado. Las suyas se cierran desde su
             * perfil, que es donde se esperan.
             */
            editable && !esUnoMismo && m.sesiones.length > 0 ? (
              <Boton variante="peligro" tamano="sm" onClick={() => setCerrando(true)}>
                {t('equipo.cerrar_sesiones')}
              </Boton>
            ) : undefined
          }
        >
          {m.sesiones.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
              {t('equipo.sin_sesiones')}
            </p>
          ) : (
            <ul className="space-y-2">
              {m.sesiones.map((s) => (
                <li key={s.id} className="text-sm">
                  <p>{s.userAgent ?? t('equipo.dispositivo_desconocido')}</p>
                  <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {s.ip ?? '—'} · {fechaRelativa(s.lastUsedAt ?? s.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        {editable && !esUnoMismo && (
          <Tarjeta titulo={t('equipo.estado')} descripcion={t('equipo.estado_ayuda')}>
            <Boton
              variante={m.isActive ? 'peligro' : 'secundario'}
              cargando={cambiarEstado.isPending}
              onClick={() => cambiarEstado.mutate(!m.isActive)}
            >
              {m.isActive ? t('equipo.desactivar') : t('equipo.activar')}
            </Boton>
          </Tarjeta>
        )}
      </div>

      <ConfirmarPeligro
        abierto={cerrando}
        titulo={t('equipo.cerrar_sesiones')}
        descripcion={t('equipo.cerrar_sesiones_aviso', { nombre: nombreCompleto })}
        textoConfirmar={t('equipo.cerrar_sesiones')}
        trabajando={cerrarSesiones.isPending}
        alConfirmar={() => cerrarSesiones.mutate()}
        alCerrar={() => setCerrando(false)}
      />
    </div>
  );
}

/**
 * Nombre, roles y el resumen de lo que conceden, con un solo botón de guardar.
 *
 * Va aparte de la pantalla para poder montarlo con `key`: así el estado sale de
 * lo guardado al montar y nada lo vuelve a tocar por su cuenta.
 */
function FormularioAccesos({
  miembro: m,
  roles,
  editable,
  esUnoMismo,
}: {
  miembro: Detalle;
  roles: Rol[];
  editable: boolean;
  esUnoMismo: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();

  const [nombre, setNombre] = useState(m.firstName ?? '');
  const [apellidos, setApellidos] = useState(m.lastName ?? '');
  const [elegidos, setElegidos] = useState<string[]>(m.roles.map((r) => r.id));

  const guardar = useMutation({
    mutationFn: () =>
      patch<Detalle>(`/users/${m.id}`, {
        ...(nombre.trim() ? { firstName: nombre.trim() } : {}),
        ...(apellidos.trim() ? { lastName: apellidos.trim() } : {}),
        roleIds: elegidos,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['miembro', m.id] });
      void qc.invalidateQueries({ queryKey: ['equipo'] });
      void qc.invalidateQueries({ queryKey: ['roles'] });
      toast.exito(t('equipo.guardado_ok'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /*
   * Guardar solo se ofrece si hay algo distinto de lo guardado.
   *
   * Un botón siempre activo invita a pulsarlo «por si acaso», y cada pulsación
   * es una entrada más en el registro de auditoría diciendo que se cambiaron los
   * permisos de alguien cuando en realidad no se tocó nada.
   */
  const hayCambios =
    nombre.trim() !== (m.firstName ?? '') ||
    apellidos.trim() !== (m.lastName ?? '') ||
    [...m.roles.map((r) => r.id)].sort().join(',') !== [...elegidos].sort().join(',');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (hayCambios) guardar.mutate();
      }}
      className="grid gap-4"
    >
      <Tarjeta titulo={t('equipo.datos')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Entrada
            etiqueta={t('equipo.nombre')}
            value={nombre}
            disabled={!editable}
            autoComplete="off"
            onChange={(e) => setNombre(e.target.value)}
          />
          <Entrada
            etiqueta={t('equipo.apellidos')}
            value={apellidos}
            disabled={!editable}
            autoComplete="off"
            onChange={(e) => setApellidos(e.target.value)}
          />
        </div>
      </Tarjeta>

      <Tarjeta titulo={t('equipo.roles')} descripcion={t('equipo.roles_ayuda')}>
        {/*
         * Quitarse accesos a uno mismo se permite —la API protege lo único
         * irreversible, quedarse sin ningún propietario— pero se avisa: el
         * cambio vale en la siguiente petición, así que la pantalla en la que
         * estés puede dejar de cargar a mitad de lo que estuvieras haciendo.
         */}
        {esUnoMismo && (
          <Alerta tono="aviso" titulo={t('equipo.eres_tu_titulo')}>
            {t('equipo.eres_tu_ayuda')}
          </Alerta>
        )}

        <div className={esUnoMismo ? 'mt-3' : undefined}>
          <SelectorRoles
            roles={roles}
            elegidos={elegidos}
            alCambiar={setElegidos}
            deshabilitado={!editable}
          />
        </div>
      </Tarjeta>

      <Tarjeta titulo={t('equipo.permisos_efectivos')} descripcion={t('equipo.permisos_ayuda')}>
        <ResumenPermisos roles={roles} elegidos={elegidos} />
      </Tarjeta>

      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <Boton
            type="submit"
            variante="primario"
            cargando={guardar.isPending}
            disabled={!hayCambios || elegidos.length === 0}
          >
            {t('equipo.guardar_cambios')}
          </Boton>

          {elegidos.length === 0 && (
            <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
              {t('equipo.hace_falta_un_rol')}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
