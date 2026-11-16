import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { precio, fechaRelativa } from '@/lib/formato';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { Boton } from '@/componentes/ui/boton';
import { useToast } from '@/componentes/ui/toast';
import { Enlace } from '@/componentes/enlace';

/**
 * Incidencias de compra al proveedor.
 *
 * Cada fila es **un cliente que ya ha pagado y cuyo pedido no se ha llegado a
 * comprar**. Es el peor fallo posible del negocio y además silencioso: el
 * cobro salió bien, el pedido figura como pagado, y lo único que falta es la
 * mercancía. Sin esta pantalla el aviso llega semanas después, y lo da el
 * cliente preguntando dónde está su paquete.
 *
 * No se reintenta solo. Los errores que llegan aquí —sin stock, el proveedor ha
 * subido el precio, la dirección no le vale, las credenciales caducaron— no se
 * arreglan repitiendo la misma llamada: hacen falta una decisión y, casi
 * siempre, un cambio antes de volver a intentarlo. Reintentar en bucle solo
 * retrasaría el aviso.
 *
 * Por eso cada incidencia trae la acción sugerida que manda el servidor: quien
 * abre esto a las nueve de la mañana necesita saber qué hacer con cada caso,
 * no interpretar un mensaje de error de una API china.
 */

interface Incidencia {
  supplierOrderId: string;
  orderId: string;
  numeroPedido: string;
  cliente: string;
  proveedor: string;
  /**
   * Un error que investigar o un recado que hacer.
   *
   * Son dos trabajos distintos y por eso van en dos listas: con un proveedor
   * sin API, las compras a mano son rutina diaria y mezclarlas con los fallos
   * haría que un fallo de verdad pasara desapercibido entre veinte recados.
   */
  tipo: 'incidencia' | 'compra_manual';
  error: string | null;
  tipoError: string | null;
  intentos: number;
  costeCents: number;
  desde: string;
  accionSugerida: string;
  /** Lo que hay que comprarle al proveedor, con sus códigos. */
  compra?: LineaDeCompra[];
}

/** Un paquete que lleva demasiado tiempo sin moverse. */
interface EnvioParado {
  supplierOrderId: string;
  orderId: string;
  numeroPedido: string;
  cliente: string;
  proveedor: string;
  seguimiento: string | null;
  ultimoEstado: string | null;
  diasEnTransito: number;
  importeCents: number;
}

interface LineaDeCompra {
  referencia: string;
  /** El código con el que se busca en la web del proveedor: «D-237595». */
  codigo: string;
  titulo: string;
  url: string | null;
  cantidad: number;
  costeUnitarioCents: number;
  disponible: boolean;
  stock: number;
}

/**
 * Gravedad por tipo de error.
 *
 * `CREDENCIALES` es rojo y no ámbar a propósito: no afecta a un pedido, afecta
 * a TODOS los que entren hasta que se arregle. Los demás son incidencias de un
 * pedido concreto.
 */
const TONO: Record<string, 'error' | 'aviso' | 'neutro'> = {
  CREDENCIALES: 'error',
  NO_ENCONTRADO: 'error',
  SIN_STOCK: 'aviso',
  PRECIO_CAMBIADO: 'aviso',
  DIRECCION_INVALIDA: 'aviso',
};

export function Incidencias() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();

  const incidencias = useQuery({
    queryKey: ['pedidos', 'incidencias'],
    queryFn: () => get<Incidencia[]>('/orders/incidencias'),
    // Aparecen solas, mientras la tienda vende y nadie mira.
    refetchInterval: 60_000,
  });

  /**
   * Envíos sin novedades desde hace semanas.
   *
   * Van en esta pantalla y no en una propia porque son el mismo trabajo: la
   * cola de lo que hay que mirar hoy. Y se consultan aparte porque cambian
   * despacio —de un día para otro—, no cada minuto como las incidencias.
   */
  const parados = useQuery({
    queryKey: ['pedidos', 'envios-parados'],
    queryFn: () => get<EnvioParado[]>('/orders/envios-parados'),
    staleTime: 10 * 60_000,
  });

  const reintentar = useMutation({
    mutationFn: (id: string) =>
      post<{ ok: boolean; mensaje: string }>(`/orders/incidencias/${id}/reintentar`),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['pedidos'] });
      // El servidor responde 200 aunque el reintento vuelva a fallar: lo que
      // dice si ha funcionado es `ok`, no el código HTTP. Dar por bueno el 200
      // pintaría «Reenviado correctamente» sobre un pedido que sigue sin
      // comprarse, que es exactamente el fallo que esta pantalla existe para
      // evitar.
      if (r.ok) toast.exito(r.mensaje);
      else toast.error(r.mensaje);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /*
   * Cerrar la incidencia porque se ha comprado a mano.
   *
   * Es lo que se hace de verdad cuando la compra automática no sale: alguien
   * entra en la web del proveedor y la hace. Sin esto, la única salida era
   * reintentar una y otra vez algo que no iba a funcionar, y el pedido se
   * quedaba en incidencia para siempre con el cliente esperando.
   */
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [referencia, setReferencia] = useState('');

  const resolver = useMutation({
    mutationFn: ({ id, ref }: { id: string; ref: string }) =>
      post<{ ok: boolean; mensaje: string }>(`/orders/incidencias/${id}/resolver`, {
        referencia: ref,
      }),
    onSuccess: (r) => {
      setResolviendo(null);
      setReferencia('');
      void qc.invalidateQueries({ queryKey: ['pedidos'] });
      if (r.ok) toast.exito(r.mensaje);
      else toast.error(r.mensaje);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (incidencias.isLoading) return <Cargando />;
  if (incidencias.error)
    return <ErrorPanel error={incidencias.error} reintentar={() => void incidencias.refetch()} />;

  const items = incidencias.data ?? [];
  const compras = items.filter((i) => i.tipo === 'compra_manual');
  const fallos = items.filter((i) => i.tipo !== 'compra_manual');

  /** El formulario para anotar la referencia de la compra, común a las dos listas. */
  const formularioReferencia = (i: Incidencia) => (
    <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--borde)' }}>
      <label htmlFor={`ref-${i.supplierOrderId}`} className="mb-1 block text-sm font-medium">
        {t('incidencias.referencia')}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={`ref-${i.supplierOrderId}`}
          className="campo max-w-xs"
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          placeholder="8171234567890123"
          aria-describedby={`ref-ayuda-${i.supplierOrderId}`}
        />
        <Boton
          variante="primario"
          tamano="sm"
          disabled={referencia.trim().length < 3}
          cargando={resolver.isPending}
          onClick={() => resolver.mutate({ id: i.supplierOrderId, ref: referencia.trim() })}
        >
          {t('incidencias.cerrar_incidencia')}
        </Boton>
      </div>
      <p
        id={`ref-ayuda-${i.supplierOrderId}`}
        className="mt-1 text-xs"
        style={{ color: 'var(--texto-tenue)' }}
      >
        {t('incidencias.referencia_ayuda')}
      </p>
    </div>
  );

  return (
    <div>
      <Encabezado
        titulo={t('incidencias.titulo')}
        descripcion={t('incidencias.descripcion')}
        cargados={items.length}
      />

      {/*
        Las compras a mano, primero y aparte.
        No han fallado: son proveedores sin API —el pedido llega a su web, no a
        un endpoint— y hasta que alguien las hace, hay un cliente que ha pagado
        y cuya mercancía no está comprada. Es trabajo de todos los días, no una
        avería, y por eso tiene su propia lista y su propio tono.
      */}
      {compras.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-1 font-medium">{t('incidencias.compras_manuales')}</h2>
          <p className="mb-3 text-sm" style={{ color: 'var(--texto-tenue)' }}>
            {t('incidencias.compras_manuales_ayuda')}
          </p>

          <div className="fichas fichas-anchas">
            {compras.map((i) => (
              <article
                key={i.supplierOrderId}
                className="panel p-4"
                style={{ borderColor: 'var(--info)' }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium">{i.numeroPedido}</span>
                      <Etiqueta texto={i.proveedor} tono="neutro" />
                    </div>
                    <p className="mt-1 text-sm" style={{ color: 'var(--texto-tenue)' }}>
                      {i.cliente} · {precio(i.costeCents)} · {fechaRelativa(i.desde)}
                    </p>
                  </div>

                  <Enlace a="/pedidos" className="btn btn-fantasma text-sm">
                    {t('incidencias.ver_pedido')}
                  </Enlace>
                </div>

                {/* La lista de la compra: el código del proveedor delante,
                    porque es lo que se teclea en su buscador. */}
                <ul className="mt-3 space-y-2">
                  {(i.compra ?? []).map((linea) => (
                    <li
                      key={linea.referencia}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                      style={{ borderColor: 'var(--borde)' }}
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-mono font-medium">{linea.codigo}</span>
                          <span className="lineas-1">{linea.titulo}</span>
                        </p>
                        <p className="mt-0.5 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                          {t('incidencias.cantidad')}: <strong>{linea.cantidad}</strong> ·{' '}
                          {precio(linea.costeUnitarioCents)}/ud
                          {!linea.disponible && (
                            // Antes de entrar en su web: si ya no hay stock, lo
                            // que toca no es comprar sino hablar con el cliente.
                            <span style={{ color: 'var(--error)' }}>
                              {' '}
                              · {t('incidencias.sin_stock_proveedor')}
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          className="btn btn-fantasma text-xs"
                          onClick={() => void navigator.clipboard.writeText(linea.codigo)}
                        >
                          {t('app.copiar')}
                        </button>
                        {linea.url && (
                          <a
                            href={linea.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secundario text-xs"
                          >
                            {t('incidencias.abrir_ficha')}
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>

                {/* El formulario va abierto: anotar la referencia ES la acción
                    de esta tarjeta, no una alternativa escondida a reintentar. */}
                {formularioReferencia(i)}
              </article>
            ))}
          </div>
        </section>
      )}

      {/*
        Paquetes que llevan semanas sin moverse.
        No son una incidencia todavía: son la que va a llegar. Adelantarse
        —reenviar o reembolsar por iniciativa propia— cuesta mucho menos que
        una disputa abierta por el cliente, y hasta ahora este cálculo existía
        en el servidor sin que ninguna pantalla lo enseñara.
      */}
      {(parados.data?.length ?? 0) > 0 && (
        <section className="mb-6">
          <h2 className="mb-1 font-medium">{t('incidencias.envios_parados')}</h2>
          <p className="mb-3 text-sm" style={{ color: 'var(--texto-tenue)' }}>
            {t('incidencias.envios_parados_ayuda')}
          </p>

          <div className="panel overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>{t('pedidos.numero')}</th>
                  <th>{t('pedidos.cliente')}</th>
                  <th>{t('pedidos.proveedor')}</th>
                  <th>{t('pedidos.numero_seguimiento')}</th>
                  <th className="text-right">{t('incidencias.dias_parado')}</th>
                  <th className="text-right">{t('pedidos.importe')}</th>
                </tr>
              </thead>
              <tbody>
                {(parados.data ?? []).map((e) => (
                  <tr key={e.supplierOrderId}>
                    <td className="font-mono text-xs">{e.numeroPedido}</td>
                    <td>
                      <span className="block max-w-[200px] truncate" title={e.cliente}>
                        {e.cliente}
                      </span>
                    </td>
                    <td>{e.proveedor}</td>
                    <td className="font-mono text-xs">
                      {e.seguimiento ?? '—'}
                      {e.ultimoEstado && (
                        <span className="block" style={{ color: 'var(--texto-tenue)' }}>
                          {e.ultimoEstado}
                        </span>
                      )}
                    </td>
                    <td
                      className="text-right tabular-nums"
                      // A partir de un mes ya no es «va lento»: está perdido.
                      style={{ color: e.diasEnTransito >= 30 ? 'var(--error)' : 'var(--aviso)' }}
                    >
                      {e.diasEnTransito}
                    </td>
                    <td className="text-right tabular-nums">{precio(e.importeCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {items.length === 0 ? (
        <Vacio titulo={t('incidencias.ninguna')} descripcion={t('incidencias.ninguna_ayuda')} />
      ) : (
        <div className="fichas fichas-anchas">
          {/* El título solo cuando hay de las dos: con una sola lista, el de
              la página ya dice de qué va. */}
          {fallos.length > 0 && compras.length > 0 && (
            <h2 className="col-span-full font-medium">{t('incidencias.fallos')}</h2>
          )}
          {fallos.map((i) => (
            <article key={i.supplierOrderId} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{i.numeroPedido}</span>
                    {i.tipoError && (
                      <Etiqueta
                        texto={t(`incidencias.tipo_${i.tipoError}`, { defaultValue: i.tipoError })}
                        tono={TONO[i.tipoError] ?? 'neutro'}
                      />
                    )}
                    <Etiqueta texto={i.proveedor} />
                  </div>

                  <p className="mt-1 text-sm" style={{ color: 'var(--texto-tenue)' }}>
                    {i.cliente} · {precio(i.costeCents)} · {fechaRelativa(i.desde)}
                    {i.intentos > 1 && ` · ${t('incidencias.intentos', { n: i.intentos })}`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Boton
                    variante="primario"
                    tamano="sm"
                    cargando={reintentar.isPending && reintentar.variables === i.supplierOrderId}
                    onClick={() => reintentar.mutate(i.supplierOrderId)}
                  >
                    {t('incidencias.reintentar')}
                  </Boton>

                  <Boton
                    variante="secundario"
                    tamano="sm"
                    onClick={() =>
                      setResolviendo((actual) =>
                        actual === i.supplierOrderId ? null : i.supplierOrderId,
                      )
                    }
                  >
                    {t('incidencias.comprado_a_mano')}
                  </Boton>

                  {/* Para cancelar y devolver el dinero: se decide en la ficha
                      del pedido, que es donde está toda la información. */}
                  <Enlace a="/pedidos" className="btn btn-fantasma text-sm">
                    {t('incidencias.ver_pedido')}
                  </Enlace>
                </div>
              </div>

              {/* Qué hacer, antes que qué ha fallado: es la decisión lo que
                  desbloquea el pedido. */}
              <p
                className="mt-3 rounded-lg px-3 py-2 text-sm"
                style={{
                  background: 'color-mix(in srgb, var(--marca-primario) 8%, transparent)',
                  color: 'var(--texto)',
                }}
              >
                {i.accionSugerida}
              </p>

              {resolviendo === i.supplierOrderId && formularioReferencia(i)}

              {i.error && (
                <p
                  className="mt-2 font-mono text-xs break-words"
                  style={{ color: 'var(--texto-tenue)' }}
                >
                  {i.error}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
