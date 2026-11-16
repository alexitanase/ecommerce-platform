import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { Cargando, ErrorPanel, Alerta, SinPermiso } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { Enlace } from '@/componentes/enlace';
import { Boton } from '@/componentes/ui/boton';
import { Entrada } from '@/componentes/ui/formulario';
import { Tarjeta } from '@/componentes/ui/datos';
import { useToast } from '@/componentes/ui/toast';
import { useSesion } from '@/lib/sesion';
import { SelectorRoles, ResumenPermisos, type Rol } from '@/rutas/equipo-permisos';

/**
 * Alta de un miembro del equipo.
 *
 * Es una pantalla propia y no un desplegable en el listado, por lo mismo que la
 * ficha de producto dejó de serlo: aquí hay que elegir accesos leyendo lo que
 * conceden, y eso no cabe en una tira de casillas metida entre la cabecera y la
 * tabla. Además tiene URL, así que se puede compartir, recargar y volver atrás.
 *
 * **No se le pone contraseña.** Se crea la cuenta sin ella y se emite un token
 * para que la establezca la persona. Mandarle una contraseña generada aquí
 * significaría que queda escrita en un buzón para siempre, y que alguien del
 * equipo conoce la contraseña de otro. El token se enseña en pantalla porque el
 * correo puede fallar —hoy mismo falla, ver DESPLIEGUE.md— y sin eso no habría
 * forma de dar de alta a nadie.
 */

interface Creado {
  usuario: { id: string; email: string };
  invitacionToken: string;
}

export function EquipoNuevo() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const { puede } = useSesion();

  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [creado, setCreado] = useState<Creado | null>(null);
  const [copiado, setCopiado] = useState(false);

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => get<Rol[]>('/roles'),
  });

  const crear = useMutation({
    mutationFn: () =>
      post<Creado>('/users/invite', {
        email: email.trim(),
        ...(nombre.trim() ? { firstName: nombre.trim() } : {}),
        ...(apellidos.trim() ? { lastName: apellidos.trim() } : {}),
        roleIds: elegidos,
      }),
    onSuccess: (r) => {
      setCreado(r);
      void qc.invalidateQueries({ queryKey: ['equipo'] });
      void qc.invalidateQueries({ queryKey: ['roles'] });
      toast.exito(t('equipo.creado_ok'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!puede('users:write')) return <SinPermiso permiso="users:write" />;
  if (roles.isLoading) return <Cargando filas={3} />;
  if (roles.error)
    return <ErrorPanel error={roles.error} reintentar={() => void roles.refetch()} />;

  const listaRoles = roles.data ?? [];
  const listo = email.trim().length > 0 && elegidos.length > 0;

  /*
   * Tras crear la cuenta, la pantalla cambia de trabajo.
   *
   * Deja de ser un formulario y pasa a ser el sitio donde se recoge el token,
   * que es lo único que queda por hacer. Dejar el formulario relleno al lado
   * invita a pulsar «crear» otra vez y llevarse un «ya existe una cuenta con ese
   * email» sin entender por qué.
   */
  if (creado) {
    return (
      <div>
        <Encabezado
          titulo={t('equipo.nuevo_titulo')}
          // «Equipo» ya lo pone la navegación al reconocer la ruta padre; aquí
          // solo va el último nivel, que es lo único que esta pantalla sabe.
          migas={[{ etiqueta: creado.usuario.email }]}
          acciones={
            <Enlace a="/equipo" className="btn btn-secundario text-sm">
              {t('equipo.volver_al_listado')}
            </Enlace>
          }
        />

        <div className="grid gap-4" style={{ maxWidth: '46rem' }}>
          <Alerta tono="exito" titulo={t('equipo.creado_titulo', { email: creado.usuario.email })}>
            {t('equipo.creado_ayuda')}
          </Alerta>

          <Tarjeta
            titulo={t('equipo.invitacion_titulo')}
            descripcion={t('equipo.invitacion_ayuda')}
          >
            <p
              className="break-all rounded-lg p-3 font-mono text-xs"
              style={{ background: 'var(--fondo-sutil)' }}
            >
              {creado.invitacionToken}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Boton
                variante="secundario"
                tamano="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(creado.invitacionToken).then(
                    () => {
                      setCopiado(true);
                      toast.exito(t('equipo.copiado'));
                    },
                    () => toast.error(t('equipo.copiar_error')),
                  );
                }}
              >
                {copiado ? t('equipo.copiado') : t('equipo.copiar')}
              </Boton>

              <Enlace
                a="/equipo/$userId"
                params={{ userId: creado.usuario.id }}
                className="btn btn-secundario text-sm"
              >
                {t('equipo.ir_a_la_ficha')}
              </Enlace>

              <Boton
                variante="fantasma"
                tamano="sm"
                onClick={() => {
                  setCreado(null);
                  setCopiado(false);
                  setEmail('');
                  setNombre('');
                  setApellidos('');
                  setElegidos([]);
                }}
              >
                {t('equipo.crear_otro')}
              </Boton>
            </div>
          </Tarjeta>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Encabezado
        titulo={t('equipo.nuevo_titulo')}
        descripcion={t('equipo.nuevo_descripcion')}
        migas={[{ etiqueta: t('equipo.nuevo_titulo') }]}
        acciones={
          <Enlace a="/equipo" className="btn btn-secundario text-sm">
            {t('equipo.volver_al_listado')}
          </Enlace>
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (listo) crear.mutate();
        }}
        className="grid gap-4"
        style={{ maxWidth: '46rem' }}
      >
        <Tarjeta titulo={t('equipo.datos')}>
          <div className="grid gap-4">
            <Entrada
              etiqueta={t('equipo.email')}
              type="email"
              required
              autoComplete="off"
              value={email}
              ayuda={t('equipo.email_ayuda')}
              onChange={(e) => setEmail(e.target.value)}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Entrada
                etiqueta={t('equipo.nombre')}
                value={nombre}
                autoComplete="off"
                onChange={(e) => setNombre(e.target.value)}
              />
              <Entrada
                etiqueta={t('equipo.apellidos')}
                value={apellidos}
                autoComplete="off"
                onChange={(e) => setApellidos(e.target.value)}
              />
            </div>
          </div>
        </Tarjeta>

        <Tarjeta titulo={t('equipo.roles')} descripcion={t('equipo.roles_ayuda')}>
          {listaRoles.length === 0 ? (
            <Alerta tono="aviso" titulo={t('equipo.sin_roles_titulo')}>
              {t('equipo.sin_roles_ayuda')}
            </Alerta>
          ) : (
            <SelectorRoles roles={listaRoles} elegidos={elegidos} alCambiar={setElegidos} />
          )}
        </Tarjeta>

        <Tarjeta titulo={t('equipo.permisos_efectivos')} descripcion={t('equipo.permisos_ayuda')}>
          <ResumenPermisos roles={listaRoles} elegidos={elegidos} />
        </Tarjeta>

        <div className="flex flex-wrap items-center gap-3">
          <Boton type="submit" variante="primario" cargando={crear.isPending} disabled={!listo}>
            {t('equipo.crear')}
          </Boton>

          {elegidos.length === 0 && (
            <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
              {t('equipo.hace_falta_un_rol')}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
