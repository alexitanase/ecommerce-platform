import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cargando,
  ErrorPanel,
  Etiqueta,
  SinResultados,
  Vacio,
  VerMas,
} from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { Enlace } from '@/componentes/enlace';
import { consulta, useListaPaginada } from '@/lib/paginacion';
import { fechaRelativa } from '@/lib/formato';
import { euros, nombre, type Cliente } from '@/rutas/clientes-comun';

/**
 * Clientes.
 *
 * La lista enseña las cifras de compra —pedidos, gasto, último pedido— porque
 * son lo que distingue a un cliente habitual de uno que compró una vez, y esa
 * distinción es la que decide cómo se atiende una incidencia.
 *
 * La ficha ya no se despliega debajo de la fila: está en `/clientes/$clienteId`.
 * Seis pestañas de datos no caben bajo una fila, y como pantalla propia tiene
 * URL, así que atención al cliente puede pasarse el enlace de una persona
 * concreta en lugar de explicar cómo llegar a ella. Las acciones de RGPD viven
 * dentro de esa ficha, en su pestaña: son obligaciones con plazo —un mes desde
 * que se piden— y anonimizar no se deshace.
 */

export function Clientes() {
  const { t } = useTranslation();
  const [busqueda, setBusqueda] = useState('');

  const clientes = useListaPaginada<Cliente>(
    ['clientes', busqueda],
    (cursor) => `/users/customers?${consulta({ busqueda }, cursor)}`,
  );

  if (clientes.cargando) return <Cargando />;
  if (clientes.error) return <ErrorPanel error={clientes.error} reintentar={clientes.recargar} />;

  const items = clientes.items;

  return (
    <div>
      <Encabezado
        titulo={t('clientes.titulo')}
        descripcion={t('clientes.descripcion')}
        cargados={items.length}
        hayMas={clientes.hayMas}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="campo w-full max-w-sm"
          placeholder={t('clientes.buscar')}
          aria-label={t('clientes.buscar')}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        {busqueda !== '' && (
          <button
            type="button"
            onClick={() => setBusqueda('')}
            className="btn btn-fantasma text-sm"
          >
            {t('app.limpiar_filtros')}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        busqueda !== '' ? (
          <SinResultados alLimpiar={() => setBusqueda('')} />
        ) : (
          <Vacio titulo={t('clientes.sin_clientes')} />
        )
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            /*
             * La fila entera es el enlace, no un botón que despliega.
             *
             * Siendo un enlace de verdad se puede abrir en otra pestaña, copiar
             * la dirección y volver con el botón atrás. Un `button` que cambiaba
             * estado local no permitía ninguna de las tres.
             */
            <Enlace
              key={c.id}
              a="/clientes/$clienteId"
              params={{ clienteId: c.id }}
              className="panel flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{nombre(c)}</span>
                  {!c.isActive && <Etiqueta tono="neutro" texto={t('clientes.desactivado')} />}
                  {!c.emailVerifiedAt && (
                    <Etiqueta tono="aviso" texto={t('clientes.sin_verificar')} />
                  )}
                  {c.marketingConsentAt && (
                    <Etiqueta tono="info" texto={t('clientes.acepta_marketing')} />
                  )}
                </div>
                <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {c.email}
                  {c.ultimoPedido &&
                    ` · ${t('clientes.ultimo_pedido')} ${fechaRelativa(c.ultimoPedido)}`}
                </p>
              </div>

              <div className="flex items-center gap-4 text-sm">
                <span style={{ color: 'var(--texto-tenue)' }}>
                  {t('clientes.n_pedidos', { n: c.pedidos })}
                </span>
                <span className="tabular-nums font-medium">{euros(c.gastadoCents)}</span>
              </div>
            </Enlace>
          ))}

          <VerMas
            hayMas={clientes.hayMas}
            cargando={clientes.cargandoMas}
            alPulsar={clientes.cargarMas}
          />
        </div>
      )}
    </div>
  );
}
