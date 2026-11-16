import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { fechaHora, fechaRelativa } from '@/lib/formato';
import { useSesion } from '@/lib/sesion';
import { Encabezado } from '@/componentes/encabezado';
import { Alerta, Etiqueta } from '@/componentes/estados';
import { Pestanas } from '@/componentes/ui/navegacion-pagina';
import { Tarjeta, ListaDatos, Avatar } from '@/componentes/ui/datos';
import { Entrada } from '@/componentes/ui/formulario';
import { Boton } from '@/componentes/ui/boton';
import { ConfirmarPeligro } from '@/componentes/ui/overlays';
import { useToast } from '@/componentes/ui/toast';

/**
 * Mi cuenta.
 *
 * La faltaba una pantalla propia: cambiar la contraseña o mirar desde dónde
 * está abierta la sesión son cosas que se hacen desde el panel, no desde la
 * base de datos. Y el 2FA es obligatorio para los roles con permisos de
 * administración, así que tiene que poder activarse sin salir de aquí.
 *
 * Todo lo que se ve es real: las sesiones son las que hay abiertas de verdad,
 * y el QR lo genera el servidor en el momento.
 */

interface SesionActiva {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  actual: boolean;
}

export function Perfil() {
  const { t, i18n } = useTranslation();
  const { usuario } = useSesion();

  return (
    <div>
      <Encabezado titulo={t('perfil.titulo')} descripcion={t('perfil.descripcion')} />

      <Pestanas
        etiqueta={t('perfil.titulo')}
        pestanas={[
          { id: 'cuenta', etiqueta: t('perfil.cuenta'), contenido: <BloqueCuenta /> },
          { id: 'seguridad', etiqueta: t('perfil.seguridad'), contenido: <BloqueSeguridad /> },
          { id: 'sesiones', etiqueta: t('perfil.sesiones'), contenido: <BloqueSesiones /> },
        ]}
      />

      <p className="mt-4 text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {usuario?.locale && `${t('perfil.idioma_cuenta')}: ${usuario.locale} · `}
        {i18n.language}
      </p>
    </div>
  );
}

/* ─────────────────────────────── Cuenta ─────────────────────────────── */

function BloqueCuenta() {
  const { t } = useTranslation();
  const { usuario } = useSesion();

  return (
    <Tarjeta titulo={t('perfil.datos')}>
      <div className="mb-4 flex items-center gap-3">
        <Avatar nombre={usuario?.firstName ?? usuario?.email ?? '?'} tamano={48} />
        <div className="min-w-0">
          <p className="font-medium">
            {[usuario?.firstName, usuario?.lastName].filter(Boolean).join(' ') || usuario?.email}
          </p>
          <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
            {usuario?.email}
          </p>
        </div>
      </div>

      <ListaDatos
        datos={[
          { nombre: t('perfil.tipo_cuenta'), valor: usuario?.type ?? '—' },
          {
            nombre: t('perfil.dos_pasos'),
            valor: usuario?.twoFactorEnabled ? (
              <Etiqueta texto={t('perfil.activo')} tono="exito" />
            ) : (
              <Etiqueta texto={t('perfil.inactivo')} tono="aviso" />
            ),
          },
          {
            nombre: t('perfil.permisos'),
            ancho: true,
            valor: (
              <span className="flex flex-wrap gap-1">
                {(usuario?.permissions ?? []).map((p) => (
                  <span key={p} className="tag font-mono text-[11px]">
                    {p}
                  </span>
                ))}
              </span>
            ),
          },
        ]}
      />
    </Tarjeta>
  );
}

/* ────────────────────────────── Seguridad ────────────────────────────── */

function BloqueSeguridad() {
  const { t } = useTranslation();
  const { usuario } = useSesion();
  const toast = useToast();

  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [alta2fa, setAlta2fa] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [codigosRecuperacion, setCodigosRecuperacion] = useState<string[] | null>(null);

  const noCoincide = repetida.length > 0 && nueva !== repetida;

  const cambiar = useMutation({
    mutationFn: () =>
      post<{ mensaje: string }>('/auth/change-password', {
        currentPassword: actual,
        newPassword: nueva,
      }),
    onSuccess: (r) => {
      toast.exito(r.mensaje);
      setActual('');
      setNueva('');
      setRepetida('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const iniciar2fa = useMutation({
    mutationFn: () => post<{ qrDataUrl: string; secret: string; uri: string }>('/auth/2fa/setup'),
    onSuccess: (r) => setAlta2fa({ qrDataUrl: r.qrDataUrl, secret: r.secret }),
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmar2fa = useMutation({
    mutationFn: () => post<{ recoveryCodes: string[] }>('/auth/2fa/enable', { totpCode: codigo }),
    onSuccess: (r) => {
      setCodigosRecuperacion(r.recoveryCodes);
      setAlta2fa(null);
      setCodigo('');
      toast.exito(t('perfil.dos_pasos_activado'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rejilla">
      <div className="col-6">
        <Tarjeta titulo={t('perfil.cambiar_password')}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              cambiar.mutate();
            }}
          >
            <Entrada
              etiqueta={t('perfil.password_actual')}
              type="password"
              autoComplete="current-password"
              required
              value={actual}
              onChange={(e) => setActual(e.target.value)}
            />
            <Entrada
              etiqueta={t('perfil.password_nueva')}
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              ayuda={t('perfil.password_ayuda')}
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
            />
            <Entrada
              etiqueta={t('perfil.password_repetir')}
              type="password"
              autoComplete="new-password"
              required
              value={repetida}
              {...(noCoincide ? { error: t('perfil.password_no_coincide') } : {})}
              onChange={(e) => setRepetida(e.target.value)}
            />
            <div className="mt-4">
              <Boton
                type="submit"
                variante="primario"
                cargando={cambiar.isPending}
                disabled={noCoincide || nueva.length < 12}
              >
                {t('app.guardar')}
              </Boton>
            </div>
            <p className="ayuda-campo mt-2">{t('perfil.password_cierra_sesiones')}</p>
          </form>
        </Tarjeta>
      </div>

      <div className="col-6">
        <Tarjeta titulo={t('perfil.dos_pasos')}>
          {usuario?.twoFactorEnabled ? (
            <Alerta tono="exito" titulo={t('perfil.dos_pasos_activo')}>
              {t('perfil.dos_pasos_activo_ayuda')}
            </Alerta>
          ) : alta2fa ? (
            <div className="space-y-3">
              <p className="text-sm">{t('perfil.escanea')}</p>
              {/* El QR lo genera el servidor como data URL; no sale a internet. */}
              <img
                src={alta2fa.qrDataUrl}
                alt={t('perfil.qr_alt')}
                width={180}
                height={180}
                style={{ background: '#fff', padding: 8, borderRadius: 8 }}
              />
              <p className="font-mono text-xs" style={{ color: 'var(--texto-tenue)' }}>
                {alta2fa.secret}
              </p>
              <Entrada
                etiqueta={t('perfil.codigo')}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
              <Boton
                variante="primario"
                cargando={confirmar2fa.isPending}
                disabled={codigo.length !== 6}
                onClick={() => confirmar2fa.mutate()}
              >
                {t('perfil.activar')}
              </Boton>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: 'var(--texto-suave)' }}>
                {t('perfil.dos_pasos_ayuda')}
              </p>
              <Boton
                variante="primario"
                cargando={iniciar2fa.isPending}
                onClick={() => iniciar2fa.mutate()}
              >
                {t('perfil.configurar')}
              </Boton>
            </div>
          )}

          {/*
           * Los códigos de recuperación se enseñan UNA vez: el servidor solo
           * guarda su hash. Si se cierra esta caja sin copiarlos, no hay forma
           * de volver a verlos, y eso hay que decirlo antes, no después.
           */}
          {codigosRecuperacion && (
            <Alerta tono="aviso" titulo={t('perfil.codigos_titulo')}>
              <p className="mb-2 text-sm">{t('perfil.codigos_ayuda')}</p>
              <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
                {codigosRecuperacion.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </Alerta>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}

/* ────────────────────────────── Sesiones ────────────────────────────── */

function BloqueSesiones() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmar, setConfirmar] = useState(false);

  const sesiones = useQuery({
    queryKey: ['mis-sesiones'],
    queryFn: () => get<SesionActiva[]>('/auth/sessions'),
  });

  const cerrarTodas = useMutation({
    mutationFn: () => post('/auth/logout-all'),
    onSuccess: () => {
      toast.exito(t('perfil.sesiones_cerradas'));
      void qc.invalidateQueries({ queryKey: ['mis-sesiones'] });
      setConfirmar(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Tarjeta
      titulo={t('perfil.sesiones')}
      descripcion={t('perfil.sesiones_ayuda')}
      acciones={
        <Boton variante="peligro" tamano="sm" onClick={() => setConfirmar(true)}>
          {t('perfil.cerrar_todas')}
        </Boton>
      }
    >
      {sesiones.isLoading ? (
        <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
          {t('app.cargando')}
        </p>
      ) : (
        <ul className="lista">
          {(sesiones.data ?? []).map((s) => (
            <li key={s.id}>
              <div className="lista-linea">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {s.userAgent ?? t('perfil.dispositivo_desconocido')}
                  </span>
                  <span className="block text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {s.ip ?? '—'} · {t('perfil.iniciada')} {fechaHora(s.createdAt, i18n.language)}
                    {s.lastUsedAt &&
                      ` · ${t('perfil.ultimo_uso')} ${fechaRelativa(s.lastUsedAt, i18n.language)}`}
                  </span>
                </span>
                {s.actual && <Etiqueta texto={t('perfil.esta_sesion')} tono="info" />}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmarPeligro
        abierto={confirmar}
        alCerrar={() => setConfirmar(false)}
        alConfirmar={() => cerrarTodas.mutate()}
        trabajando={cerrarTodas.isPending}
        titulo={t('perfil.cerrar_todas')}
        descripcion={t('perfil.cerrar_todas_ayuda')}
        textoConfirmar={t('perfil.cerrar_todas')}
      />
    </Tarjeta>
  );
}
