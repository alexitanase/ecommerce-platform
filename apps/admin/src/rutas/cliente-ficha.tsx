import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { del, get, patch } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta, Frescura, SinPermiso } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { Enlace } from '@/componentes/enlace';
import { Pestanas, type Pestana } from '@/componentes/ui/navegacion-pagina';
import { fechaRelativa } from '@/lib/formato';
import { useSesion } from '@/lib/sesion';
import {
  euros,
  nombre as nombreDe,
  type Acceso,
  type Carrito,
  type Direccion,
  type Ficha,
  type PedidoResumen,
  type Sesion,
} from '@/rutas/clientes-comun';

/**
 * Ficha de un cliente.
 *
 * Era un desplegable dentro del listado y ahora es una pantalla, por la misma
 * razón que la ficha de producto: seis pestañas de datos —cifras, pedidos,
 * carritos, sesiones, direcciones y RGPD— no caben debajo de una fila. Como
 * pantalla propia tiene URL, así que atención al cliente puede pasarse el enlace
 * de una persona concreta en lugar de explicar cómo llegar a ella.
 */

export function ClienteFicha() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { puede } = useSesion();

  const parametros: Record<string, string | undefined> = useParams({ strict: false });
  const id = parametros['clienteId'] ?? '';

  const ficha = useQuery({
    queryKey: ['cliente', id],
    queryFn: () => get<Ficha>(`/users/customers/${id}`),
  });

  /** Todo lo que cambia la cuenta refresca la ficha Y la lista. */
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['clientes'] });
    void qc.invalidateQueries({ queryKey: ['cliente', id] });
  };

  const anonimizar = useMutation({
    mutationFn: () => del(`/users/${id}`),
    onSuccess: refrescar,
  });

  const estado = useMutation({
    mutationFn: (activo: boolean) => patch(`/users/customers/${id}/status`, { isActive: activo }),
    onSuccess: refrescar,
  });

  const cerrarSesiones = useMutation({
    mutationFn: () => del(`/users/customers/${id}/sessions`),
    onSuccess: refrescar,
  });

  const [exportando, setExportando] = useState(false);

  /**
   * Descarga el fichero con el token en la cabecera.
   *
   * No sirve un `<a href download>`: eso es una navegación del navegador y no
   * lleva la cabecera de autorización. El token del admin vive en memoria —no
   * en una cookie, para que un XSS no pueda robarlo— así que hay que pedirlo
   * con fetch y montar la descarga desde la respuesta.
   */
  const exportar = async () => {
    setExportando(true);
    try {
      const datos = await get<unknown>(`/users/${id}/export`);
      const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = `datos-cliente-${id}.json`;
      enlace.click();
      // Sin revocar, el fichero se queda en memoria hasta recargar la página.
      URL.revokeObjectURL(url);
    } finally {
      setExportando(false);
    }
  };

  if (!puede('customers:read')) return <SinPermiso permiso="customers:read" />;
  if (ficha.isLoading) return <Cargando filas={3} />;
  if (ficha.error)
    return <ErrorPanel error={ficha.error} reintentar={() => void ficha.refetch()} />;

  const c = ficha.data;
  if (!c) return null;

  /*
   * Pestañas y no una página larga.
   *
   * Antes esto era todo seguido: cifras, direcciones, historial y RGPD uno
   * detrás de otro. Con seis cosas que mirar —y ahora son seis, no cuatro— hay
   * que recorrer la pantalla entera para dar con lo que se busca, y las acciones
   * peligrosas de RGPD quedaban al final, junto a lo que se consulta a diario.
   *
   * El contador va en la pestaña porque responde sin abrirla: «Carritos 2» ya
   * dice que hay conversación de venta pendiente.
   */
  const pestanas: Pestana[] = [
    {
      id: 'resumen',
      etiqueta: t('clientes.tab_resumen'),
      contenido: <Resumen cliente={c} alCambiarEstado={(activo) => estado.mutate(activo)} />,
    },
    {
      id: 'pedidos',
      etiqueta: t('clientes.tab_pedidos'),
      cantidad: c.historial.length,
      contenido: <Pedidos historial={c.historial} />,
    },
    {
      id: 'carritos',
      etiqueta: t('clientes.tab_carritos'),
      cantidad: c.carritos.length,
      contenido: <Carritos carritos={c.carritos} />,
    },
    {
      id: 'sesiones',
      etiqueta: t('clientes.tab_sesiones'),
      cantidad: c.sesiones.length,
      contenido: (
        <Sesiones
          sesiones={c.sesiones}
          cerrando={cerrarSesiones.isPending}
          alCerrar={() => cerrarSesiones.mutate()}
        />
      ),
    },
    {
      id: 'direcciones',
      etiqueta: t('clientes.tab_direcciones'),
      cantidad: c.addresses.length,
      contenido: <Direcciones direcciones={c.addresses} />,
    },
    {
      id: 'privacidad',
      etiqueta: t('clientes.tab_privacidad'),
      contenido: (
        <Privacidad
          anonimizado={c.deletedAt !== null}
          exportando={exportando}
          alExportar={() => void exportar()}
          alAnonimizar={() => anonimizar.mutate()}
        />
      ),
    },
  ];

  return (
    <div>
      <Encabezado
        titulo={nombreDe(c)}
        descripcion={c.email}
        // «Clientes» ya lo pone la navegación al reconocer la ruta padre.
        migas={[{ etiqueta: nombreDe(c) }]}
        frescura={
          <Frescura
            actualizado={ficha.dataUpdatedAt}
            refrescando={ficha.isFetching}
            alRefrescar={() => void ficha.refetch()}
          />
        }
        acciones={
          <>
            {!c.isActive && <Etiqueta tono="neutro" texto={t('clientes.desactivado')} />}
            {!c.emailVerifiedAt && <Etiqueta tono="aviso" texto={t('clientes.sin_verificar')} />}
            {c.marketingConsentAt && (
              <Etiqueta tono="info" texto={t('clientes.acepta_marketing')} />
            )}
            <Enlace a="/clientes" className="btn btn-secundario text-sm">
              {t('clientes.volver_al_listado')}
            </Enlace>
          </>
        }
      />

      <div className="panel p-4">
        <Pestanas pestanas={pestanas} etiqueta={t('clientes.tabs')} />
      </div>
    </div>
  );
}

/* ── Resumen ── */

function Resumen({
  cliente: c,
  alCambiarEstado,
}: {
  cliente: Ficha;
  alCambiarEstado: (activo: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Cifra titulo={t('clientes.gastado')} valor={euros(c.gastadoCents)} />
        <Cifra titulo={t('clientes.pedidos')} valor={String(c.pedidos)} />
        {/* El ticket medio distingue a quien compró mucho una vez de quien
            vuelve cada mes. El gasto total solo no lo dice. */}
        <Cifra titulo={t('clientes.ticket_medio')} valor={euros(c.ticketMedioCents)} />
      </div>

      <dl className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Dato titulo={t('clientes.email')} valor={c.email} />
        <Dato titulo={t('clientes.telefono')} valor={c.phone ?? '—'} />
        <Dato titulo={t('clientes.alta')} valor={fechaRelativa(c.createdAt)} />
        <Dato
          titulo={t('clientes.ultimo_acceso')}
          valor={c.lastLoginAt ? fechaRelativa(c.lastLoginAt) : t('clientes.nunca')}
        />
        {/*
          Cómo entró, y esto resuelve una llamada entera.
          «No me deja entrar con mi contraseña» tiene una respuesta distinta si
          la cuenta se creó con Google y nunca tuvo contraseña: antes no había
          forma de saberlo sin entrar en la base de datos.
        */}
        <Dato titulo={t('clientes.como_accede')} valor={<ViaDeAcceso acceso={c.acceso} />} />
        <Dato
          titulo={t('clientes.marketing')}
          valor={
            c.marketingConsentAt
              ? t('clientes.acepta_desde', { fecha: fechaRelativa(c.marketingConsentAt) })
              : t('clientes.sin_marketing')
          }
        />
      </dl>

      <div
        className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4"
        style={{ borderColor: 'var(--borde)' }}
      >
        {c.isActive ? (
          <>
            <Etiqueta tono="exito" texto={t('clientes.activa')} />
            {/* Bloquear cierra además sus sesiones: si no, quien esté dentro
                sigue comprando hasta que caduque su token. */}
            <button
              type="button"
              className="btn btn-fantasma text-sm"
              style={{ color: 'var(--error)' }}
              onClick={() => alCambiarEstado(false)}
            >
              {t('clientes.bloquear')}
            </button>
          </>
        ) : (
          <>
            <Etiqueta tono="neutro" texto={t('clientes.desactivado')} />
            <button
              type="button"
              className="btn btn-secundario text-sm"
              onClick={() => alCambiarEstado(true)}
            >
              {t('clientes.reactivar')}
            </button>
          </>
        )}
        {!c.emailVerifiedAt && <Etiqueta tono="aviso" texto={t('clientes.sin_verificar')} />}
      </div>
    </div>
  );
}

function ViaDeAcceso({ acceso }: { acceso: Acceso }) {
  const { t } = useTranslation();

  const vias = [
    ...(acceso.directo ? [t('clientes.acceso_directo')] : []),
    ...acceso.proveedores.map((p) => p.charAt(0).toUpperCase() + p.slice(1)),
  ];

  if (vias.length === 0) return <span>{t('clientes.acceso_ninguno')}</span>;

  return <span>{vias.join(' · ')}</span>;
}

/* ── Pedidos ── */

function Pedidos({ historial }: { historial: PedidoResumen[] }) {
  const { t } = useTranslation();

  if (historial.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('clientes.sin_pedidos')}
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {historial.map((p) => (
        <li
          key={p.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--borde)' }}
        >
          <span className="font-medium">{p.number}</span>
          <span style={{ color: 'var(--texto-tenue)' }}>{fechaRelativa(p.createdAt)}</span>
          <span className="tabular-nums">{euros(p.totalCents)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ── Carritos abandonados ── */

/**
 * Lo que se dejó a medias.
 *
 * Es la conversación de venta más directa que hay: se sabe qué quería y cuánto
 * valía. Se enseña el precio al que lo añadió, no el de hoy: si ha cambiado, la
 * conversación no cuadra.
 */
function Carritos({ carritos }: { carritos: Carrito[] }) {
  const { t } = useTranslation();

  if (carritos.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('clientes.sin_carritos')}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {carritos.map((c) => (
        <li key={c.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--borde)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span style={{ color: 'var(--texto-tenue)' }}>
              {t('clientes.carrito_visto', { fecha: fechaRelativa(c.actualizadoEn) })}
            </span>
            <span className="flex items-center gap-2">
              {c.sinAvisos ? (
                <Etiqueta tono="neutro" texto={t('clientes.sin_avisos')} />
              ) : (
                <Etiqueta
                  tono={c.avisosEnviados > 0 ? 'info' : 'neutro'}
                  texto={t('clientes.avisos', { n: c.avisosEnviados })}
                />
              )}
              <span className="tabular-nums font-medium">{euros(c.totalCents)}</span>
            </span>
          </div>

          <ul className="mt-2 space-y-0.5 text-xs" style={{ color: 'var(--texto-suave)' }}>
            {c.lineas.map((l) => (
              <li key={l.sku}>
                {l.cantidad}× {l.nombre}{' '}
                <span style={{ color: 'var(--texto-tenue)' }}>{euros(l.precioCents)}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/* ── Sesiones ── */

/**
 * Lo que está abierto ahora mismo.
 *
 * Es lo que se mira cuando alguien dice que le han entrado en la cuenta, y por
 * eso el botón de cerrarlas todas está aquí y no escondido en otro sitio.
 */
function Sesiones({
  sesiones,
  cerrando,
  alCerrar,
}: {
  sesiones: Sesion[];
  cerrando: boolean;
  alCerrar: () => void;
}) {
  const { t } = useTranslation();

  if (sesiones.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('clientes.sin_sesiones')}
      </p>
    );
  }

  return (
    <div>
      <ul className="space-y-1">
        {sesiones.map((s) => (
          <li
            key={s.id}
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--borde)' }}
          >
            <p className="truncate">{s.userAgent ?? t('clientes.dispositivo_desconocido')}</p>
            <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
              {s.ip ?? '—'} · {t('clientes.sesion_desde', { fecha: fechaRelativa(s.createdAt) })}
              {s.lastUsedAt &&
                ` · ${t('clientes.sesion_usada', { fecha: fechaRelativa(s.lastUsedAt) })}`}
            </p>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="btn btn-fantasma mt-3 text-sm"
        style={{ color: 'var(--error)' }}
        disabled={cerrando}
        onClick={alCerrar}
      >
        {t('clientes.cerrar_sesiones')}
      </button>
    </div>
  );
}

/* ── Direcciones ── */

function Direcciones({ direcciones }: { direcciones: Direccion[] }) {
  const { t } = useTranslation();

  if (direcciones.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('clientes.sin_direcciones')}
      </p>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {direcciones.map((d) => (
        <address
          key={d.id}
          className="rounded-lg border p-3 text-sm not-italic"
          style={{ borderColor: 'var(--borde)', color: 'var(--texto-suave)' }}
        >
          {d.isDefault && <Etiqueta tono="neutro" texto={t('clientes.predeterminada')} />}
          <div className="mt-1">
            {d.firstName} {d.lastName}
            <br />
            {d.line1}
            {d.line2 ? `, ${d.line2}` : ''}
            <br />
            {d.postalCode} {d.city} ({d.province}) · {d.countryCode}
          </div>
        </address>
      ))}
    </div>
  );
}

/* ── Privacidad ── */

/**
 * Exportar y anonimizar, en su propia pestaña.
 *
 * Son obligaciones con plazo —un mes desde que la persona lo pide— así que
 * tienen que estar a la vista, pero no junto a lo que se consulta a diario:
 * anonimizar no se deshace, y un botón así no debe quedar al alcance de un clic
 * distraído mientras se mira el historial.
 */
function Privacidad({
  anonimizado,
  exportando,
  alExportar,
  alAnonimizar,
}: {
  anonimizado: boolean;
  exportando: boolean;
  alExportar: () => void;
  alAnonimizar: () => void;
}) {
  const { t } = useTranslation();
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div>
      <p className="mb-3 text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {t('clientes.rgpd_ayuda')}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secundario text-sm"
          disabled={exportando}
          onClick={alExportar}
        >
          {t('clientes.exportar')}
        </button>

        {anonimizado ? (
          <Etiqueta tono="neutro" texto={t('clientes.ya_anonimizado')} />
        ) : confirmando ? (
          <>
            <button
              type="button"
              className="btn btn-peligro text-sm"
              onClick={() => {
                alAnonimizar();
                setConfirmando(false);
              }}
            >
              {t('clientes.anonimizar_confirmar')}
            </button>
            <button
              type="button"
              className="btn btn-fantasma text-sm"
              onClick={() => setConfirmando(false)}
            >
              {t('app.cancelar')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-fantasma text-sm"
            style={{ color: 'var(--error)' }}
            onClick={() => setConfirmando(true)}
          >
            {t('clientes.anonimizar')}
          </button>
        )}
      </div>

      {confirmando && (
        <p className="mt-2 text-xs" style={{ color: 'var(--error)' }}>
          {t('clientes.anonimizar_aviso')}
        </p>
      )}
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {titulo}
      </dt>
      <dd className="mt-0.5">{valor}</dd>
    </div>
  );
}

function Cifra({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--fondo-sutil)' }}>
      <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {titulo}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
