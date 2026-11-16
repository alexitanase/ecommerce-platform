'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api, ErrorApi } from '@/lib/api';
import { useSesion } from '@/lib/sesion';
import { Direcciones, type Direccion } from '@/components/cuenta/direcciones';
import { BotonFactura } from './boton-factura';
import { Perfil } from '@/components/cuenta/perfil';
import { Seguridad } from '@/components/cuenta/seguridad';
import { fecha, precio } from '@/lib/formato';
import { Pagina, TituloPagina } from '@/components/ui/pagina';
import { Cargando, Esqueleto, Vacio } from '@/components/ui/estados';
import { Icono, type NombreIcono } from '@/components/ui/icono';

interface Pedido {
  id: string;
  number: string;
  status: string;
  /** Con el cobro confirmado se puede pedir la factura. */
  paymentStatus: string;
  estadoLegible: string;
  totalCents: number;
  createdAt: string;
  /** La clave con la que se abre el detalle del pedido. */
  publicToken: string;
  items: { id: string; name: string; quantity: number; imageUrl: string | null }[];
}

interface Programa {
  activo: boolean;
  premioReferidorCents?: number;
  premioReferidoCents?: number;
  pedidoMinimoCents?: number;
  diasDeValidez?: number;
}

type Seccion = 'pedidos' | 'direcciones' | 'perfil' | 'seguridad' | 'invita' | 'privacidad';

/**
 * Área de cliente.
 *
 * Es cliente y no servidor porque necesita el access token en memoria: si se
 * renderizara en servidor habría que enviarle el token al HTML, y ahí lo lee
 * cualquier extensión del navegador.
 */
export function AreaCliente({ locale }: { locale: string }) {
  const t = useTranslations('cuenta');
  const tp = useTranslations('pedido');
  const ta = useTranslations('auth');
  const tc = useTranslations('comun');

  /*
   * La sesión sale del store compartido y ya no se recupera aquí a mano.
   *
   * Antes esta pantalla hablaba con `/auth/refresh` por su cuenta, con su
   * propio `fetch` y su propio estado. Funcionaba, pero era la única parte de
   * la tienda que sabía quién había entrado: la cabecera no se enteraba y no
   * había forma de cerrar sesión desde ningún sitio.
   */
  const { usuario, token, cargando, recuperar, salir } = useSesion();

  /*
   * Qué sección se está mirando; `null` es el índice.
   *
   * En el móvil son dos pantallas: el índice y la sección, con vuelta atrás.
   * En escritorio se ven las dos a la vez —índice a la izquierda, contenido a
   * la derecha—, así que ahí `null` significa «enseña la primera».
   */
  const [seccion, setSeccion] = useState<Seccion | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [direcciones, setDirecciones] = useState<Direccion[]>([]);
  const [programa, setPrograma] = useState<Programa | null>(null);

  /** Vuelve a pedir las direcciones después de crear, editar o borrar. */
  const recargarDirecciones = () => {
    if (!token) return;
    void api<Direccion[]>('/addresses', { token })
      .then(setDirecciones)
      .catch(() => {
        // Si falla, se queda la lista anterior: es preferible a vaciarla y
        // hacer creer que se han borrado todas.
      });
  };

  useEffect(() => {
    void (async () => {
      const t = await recuperar();
      if (t) {
        const [p, d] = await Promise.all([
          api<{ items: Pedido[] }>('/orders/mine', { token: t }).catch(() => ({
            items: [] as Pedido[],
          })),
          api<Direccion[]>('/addresses', { token: t }).catch(() => [] as Direccion[]),
        ]);
        setPedidos(p.items);
        setDirecciones(d);
      }

      // Público: si el programa está apagado la pestaña ni aparece. Enseñar un
      // código de invitación que no premia nada es peor que no enseñarlo.
      setPrograma(await api<Programa>('/referrals/programa').catch(() => null));
    })();
  }, [recuperar]);

  /**
   * Abre una sección dejando el índice en el historial.
   *
   * Sin esto, en el móvil el botón «atrás» del teléfono sacaba de la cuenta
   * entera desde cualquier sección, que no es lo que espera nadie: se espera
   * volver al índice. Solo se apila la primera vez —al saltar de una sección a
   * otra se reemplaza— para no dejar veinte entradas en el historial de quien
   * curiosea.
   */
  const abrirSeccion = (id: Seccion) => {
    if (typeof window !== 'undefined') {
      if (seccion === null) window.history.pushState({ cuenta: id }, '');
      else window.history.replaceState({ cuenta: id }, '');
    }
    setSeccion(id);
  };

  const volverAlIndice = () => {
    // Se va hacia atrás en vez de cambiar el estado a mano: así el historial
    // queda como estaba y no se acumula una entrada por cada ida y vuelta.
    // `history.state` es `any`: se comprueba la forma antes de fiarse de ella.
    const estado: unknown = typeof window === 'undefined' ? null : window.history.state;
    const vinoDelIndice = typeof estado === 'object' && estado !== null && 'cuenta' in estado;

    if (vinoDelIndice) window.history.back();
    else setSeccion(null);
  };

  useEffect(() => {
    const alVolver = () => {
      setSeccion(null);
    };
    window.addEventListener('popstate', alVolver);
    return () => {
      window.removeEventListener('popstate', alVolver);
    };
  }, []);

  const exportarDatos = async () => {
    if (!token) return;
    try {
      const datos = await api<unknown>('/users/me/export', { token });
      // Se descarga como fichero: el RGPD exige que los datos se entreguen en
      // un formato estructurado y de uso común, no en pantalla.
      const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'mis-datos.json';
      enlace.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof ErrorApi ? e.message : tc('error'));
    }
  };

  /**
   * Lleva al mismo centro de preferencias que el pie de los correos.
   *
   * Se pide el token al vuelo en vez de guardarlo: así hay una sola pantalla
   * de preferencias y no dos que mantener en paralelo.
   */
  const abrirPreferencias = async () => {
    if (!token) return;
    try {
      const p = await api<{ token: string }>('/consent/preferences', { token });
      window.location.href = `/${locale}/preferencias?token=${p.token}`;
    } catch (e) {
      alert(e instanceof ErrorApi ? e.message : tc('error'));
    }
  };

  if (cargando) {
    return (
      <Pagina>
        <Esqueleto className="mb-6 h-8 w-40" />
        <Cargando etiqueta={t('titulo')} />
      </Pagina>
    );
  }

  if (!usuario) {
    return (
      <Pagina ancho="formulario">
        <TituloPagina titulo={t('titulo')} />
        <Vacio icono="usuario" titulo={ta('entrar')} descripcion={t('entrar_ayuda')}>
          <Link href="/entrar" className="btn btn-primario">
            {ta('entrar')}
          </Link>
        </Vacio>
      </Pagina>
    );
  }

  const secciones: { id: Seccion; etiqueta: string; ayuda: string; icono: NombreIcono }[] = [
    { id: 'pedidos', etiqueta: t('pedidos'), ayuda: t('pedidos_ayuda'), icono: 'caja' },
    {
      id: 'direcciones',
      etiqueta: t('direcciones'),
      ayuda: t('direcciones_ayuda'),
      icono: 'ubicacion',
    },
    { id: 'perfil', etiqueta: t('mis_datos'), ayuda: t('mis_datos_ayuda'), icono: 'usuario' },
    { id: 'seguridad', etiqueta: t('seguridad'), ayuda: t('seguridad_ayuda'), icono: 'candado' },
    ...(programa?.activo
      ? [
          {
            id: 'invita' as const,
            etiqueta: t('invita'),
            ayuda: t('invita_ayuda'),
            icono: 'regalo' as const,
          },
        ]
      : []),
    { id: 'privacidad', etiqueta: t('privacidad'), ayuda: t('privacidad_ayuda'), icono: 'escudo' },
  ];

  /** Cuántas cosas hay en cada sección; se enseña al lado del nombre. */
  const cuantos: Partial<Record<Seccion, number>> = {
    pedidos: pedidos.length,
    direcciones: direcciones.length,
  };

  /*
   * En escritorio siempre hay algo abierto; en el móvil, el índice.
   *
   * Es la única diferencia entre las dos disposiciones y se resuelve aquí en
   * lugar de duplicar el árbol: lo que decide qué se ve es el CSS.
   */
  const abierta: Seccion = seccion ?? 'pedidos';

  return (
    <Pagina>
      <TituloPagina titulo={t('titulo')} descripcion={usuario.email}>
        {/* No había ninguna forma de cerrar sesión en toda la tienda. En un
            ordenador compartido eso significa que la siguiente persona entra
            en la cuenta sin hacer nada. */}
        <button type="button" className="btn btn-secundario text-sm" onClick={() => void salir()}>
          {ta('salir')}
        </button>
      </TituloPagina>

      <div className="cuenta-disposicion">
        {/*
         * El índice.
         *
         * Antes eran pestañas, y seis pestañas en un móvil son dos filas de
         * botones diminutos con la mitad de las etiquetas cortadas. Una lista
         * de filas grandes es lo que se toca bien con el pulgar y lo que
         * cualquiera reconoce de otras tiendas.
         */}
        <nav className="cuenta-indice" data-abierto={seccion === null} aria-label={t('titulo')}>
          {secciones.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => abrirSeccion(s.id)}
              className="cuenta-fila"
              aria-current={seccion === s.id ? 'page' : undefined}
              data-activa={seccion === s.id}
              data-prueba={`seccion-${s.id}`}
            >
              <span className="cuenta-fila-icono" aria-hidden="true">
                <Icono nombre={s.icono} tamano={20} />
              </span>

              <span className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-medium">
                  {s.etiqueta}
                  {cuantos[s.id] !== undefined && cuantos[s.id]! > 0 ? (
                    <span className="ml-1.5 text-xs font-normal text-[var(--texto-tenue)]">
                      {cuantos[s.id]}
                    </span>
                  ) : null}
                </span>
                {/* La ayuda solo en el móvil: en el escritorio el índice es
                    estrecho y dos líneas por fila lo convierten en un muro. */}
                <span className="cuenta-fila-ayuda">{s.ayuda}</span>
              </span>

              <span className="cuenta-fila-flecha" aria-hidden="true">
                <Icono nombre="flecha-derecha" tamano={16} />
              </span>
            </button>
          ))}
        </nav>

        <div className="cuenta-panel" data-abierto={seccion !== null}>
          {/* La vuelta al índice, solo en el móvil: en escritorio el índice
              nunca se fue de la pantalla. */}
          <button type="button" onClick={volverAlIndice} className="cuenta-volver sm:hidden">
            <Icono nombre="flecha-izquierda" tamano={16} />
            {t('titulo')}
          </button>

          <h2 className="mb-4 text-lg font-semibold tracking-tight sm:sr-only">
            {secciones.find((s) => s.id === abierta)?.etiqueta}
          </h2>

          {abierta === 'pedidos' &&
            (pedidos.length === 0 ? (
              <Vacio icono="carrito" titulo={tp('sin_pedidos')}>
                <Link href="/buscar" className="btn btn-primario">
                  {tc('ver_mas')}
                </Link>
              </Vacio>
            ) : (
              <ul className="space-y-3">
                {pedidos.map((p) => (
                  <li key={p.id}>
                    {/*
                     * La tarjeta entera es el enlace, no un botón dentro.
                     * En el móvil se toca donde se mira, y lo que se mira es la
                     * foto o el número del pedido, no una palabra al final.
                     */}
                    <Link
                      href={{ pathname: '/pedido/[token]', params: { token: p.publicToken } }}
                      className="cuenta-pedido card"
                      data-prueba="pedido"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-[var(--texto-tenue)]">
                          {fecha(p.createdAt, locale)}
                        </span>
                        <span className="etiqueta bg-[var(--fondo-sutil)] text-[var(--texto-suave)]">
                          {tp(`estados.${p.status}`)}
                        </span>
                      </div>

                      <div className="mt-3 flex items-center gap-3">
                        {/* Las fotos primero: es lo que identifica el pedido de
                            un vistazo, mucho antes que su número. */}
                        <span className="flex -space-x-2">
                          {p.items.slice(0, 3).map((i) =>
                            i.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={i.id}
                                src={i.imageUrl}
                                alt=""
                                className="h-12 w-12 rounded-lg border-2 border-[var(--fondo)] object-cover"
                              />
                            ) : (
                              <span
                                key={i.id}
                                className="h-12 w-12 rounded-lg border-2 border-[var(--fondo)] bg-[var(--fondo-sutil)]"
                              />
                            ),
                          )}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-xs text-[var(--texto-tenue)]">
                            {p.number}
                          </span>
                          <span className="block text-sm">
                            {tp('articulos_n', {
                              n: p.items.reduce((total, i) => total + i.quantity, 0),
                            })}
                          </span>
                          <span className="block font-semibold">
                            {precio(p.totalCents, locale)}
                          </span>
                        </span>

                        <span className="shrink-0 text-[var(--texto-tenue)]" aria-hidden="true">
                          <Icono nombre="flecha-derecha" tamano={18} />
                        </span>
                      </div>
                    </Link>

                    {/* Fuera del enlace: dentro, pulsar «pedir factura»
                        navegaría al detalle del pedido en lugar de emitirla.
                        Solo en los pagados, que son los únicos facturables. */}
                    {p.paymentStatus === 'PAID' && token && (
                      <BotonFactura orderId={p.id} token={token} locale={locale} />
                    )}
                  </li>
                ))}
              </ul>
            ))}

          {abierta === 'direcciones' && (
            <Direcciones direcciones={direcciones} token={token} onCambio={recargarDirecciones} />
          )}

          {abierta === 'perfil' && <Perfil token={token} />}

          {abierta === 'seguridad' && <Seguridad locale={locale} />}

          {abierta === 'invita' && programa?.activo && (
            <PanelInvitacion locale={locale} programa={programa} token={token} />
          )}

          {abierta === 'privacidad' && (
            <div className="card space-y-4 p-5">
              <div>
                <h2 className="font-medium">{t('descargar_datos')}</h2>
                <p className="mt-1 text-sm text-[var(--texto-suave)]">
                  Obtén una copia de todos tus datos en formato JSON.
                </p>
                <button
                  type="button"
                  onClick={() => void exportarDatos()}
                  className="btn btn-secundario mt-3"
                >
                  {t('descargar_datos')}
                </button>
              </div>

              <div className="border-t pt-4" style={{ borderColor: 'var(--borde)' }}>
                <h2 className="font-medium">{t('preferencias_correo')}</h2>
                <p className="mt-1 text-sm text-[var(--texto-suave)]">
                  {t('preferencias_correo_ayuda')}
                </p>
                <button
                  type="button"
                  onClick={() => void abrirPreferencias()}
                  className="btn btn-secundario mt-3"
                >
                  {t('preferencias_correo')}
                </button>
              </div>

              <div className="border-t pt-4" style={{ borderColor: 'var(--borde)' }}>
                <h2 className="font-medium">{t('eliminar_cuenta')}</h2>
                <p className="mt-1 text-sm text-[var(--texto-suave)]">
                  Tus datos personales se eliminarán. Las facturas ya emitidas se conservan porque
                  la ley obliga a ello, pero sin datos que te identifiquen.
                </p>
                <p className="mt-2 text-xs text-[var(--texto-tenue)]">
                  Escríbenos para solicitarlo; te confirmaremos antes de proceder.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Pagina>
  );
}

/**
 * Invitar a alguien.
 *
 * Lo importante es que el enlace se pueda compartir de un toque: si hay que
 * seleccionar el texto a mano en el móvil, casi nadie lo comparte y el
 * programa no existe. Debajo van las condiciones, porque prometer un descuento
 * y que luego no se aplique es peor que no prometerlo.
 */
function PanelInvitacion({
  locale,
  programa,
  token,
}: {
  locale: string;
  programa: Programa;
  token: string | null;
}) {
  const t = useTranslations('cuenta');
  const [codigo, setCodigo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    void api<{ codigo: string }>('/referrals/mi-codigo', { token })
      .then((r) => {
        setCodigo(r.codigo);
      })
      .catch(() => {
        setError(true);
      });
  }, [token]);

  if (error) return <div className="card p-6 text-[var(--texto-suave)]">{t('invita_error')}</div>;
  if (!codigo)
    return <div className="card p-6 text-[var(--texto-suave)]">{t('invita_cargando')}</div>;

  const enlace = `${window.location.origin}/${locale}?ref=${codigo}`;

  const compartir = async () => {
    // El diálogo nativo del móvil, que es donde de verdad se comparte. Si no
    // existe —escritorio— se cae al portapapeles.
    if (typeof navigator.share === 'function') {
      await navigator.share({ url: enlace, title: t('invita_titulo') }).catch(() => {
        // Cancelar el diálogo no es un error.
      });
      return;
    }

    await navigator.clipboard.writeText(enlace).then(
      () => {
        setCopiado(true);
        setTimeout(() => {
          setCopiado(false);
        }, 2000);
      },
      () => {
        setError(true);
      },
    );
  };

  return (
    <div className="card space-y-4 p-5">
      <div>
        <h2 className="font-medium">{t('invita_titulo')}</h2>
        <p className="mt-1 text-sm text-[var(--texto-suave)]">
          {t('invita_como', {
            tuyo: precio(programa.premioReferidorCents ?? 0, locale),
            suyo: precio(programa.premioReferidoCents ?? 0, locale),
          })}
        </p>
      </div>

      <p className="text-center font-mono text-2xl font-semibold tracking-[0.2em]">{codigo}</p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void compartir()} className="btn btn-primario">
          {t('invita_compartir')}
        </button>
        {copiado && (
          <span className="text-sm text-[var(--texto-suave)]">{t('invita_copiado')}</span>
        )}
      </div>

      {/* Las condiciones van a la vista, no en letra pequeña al final: el
          mínimo y la caducidad son justo lo que genera la reclamación cuando
          se descubren al ir a pagar. */}
      <p
        className="border-t pt-4 text-xs text-[var(--texto-tenue)]"
        style={{ borderColor: 'var(--borde)' }}
      >
        {t('invita_condiciones', {
          minimo: precio(programa.pedidoMinimoCents ?? 0, locale),
          dias: programa.diasDeValidez ?? 0,
        })}
      </p>
    </div>
  );
}
