import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { precio } from '@/lib/formato';
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

interface Producto {
  id: string;
  handle: string;
  status: string;
  isAdult: boolean;
  name: string;
  imagen: string | null;
  categoria: string | null;
  variantes: number;
  stockTotal: number;
  precioDesde: number | null;
  /** Lo que cuesta comprarlo al proveedor, su envío incluido. */
  costeDesde: number | null;
  precioHasta: number | null;
  margenMedio: number | null;
}

export function Productos() {
  const { t, i18n } = useTranslation();
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('');
  // Se edita dentro de la lista, no en otra pantalla: cuadrar precios se hace
  // mirando el resto del catálogo, no producto a producto a ciegas.

  const productos = useListaPaginada<Producto>(
    ['productos', busqueda, estado, i18n.language],
    (cursor) =>
      // El idioma sale del panel y no fijo en 'es': con el panel en inglés, la
      // lista enseñaba los nombres en español mientras la ficha del producto,
      // que sí lo respeta, los enseñaba traducidos.
      `/catalog/products?${consulta(
        { locale: i18n.language, limite: 50, busqueda, status: estado },
        cursor,
      )}`,
  );

  const items = productos.items;
  const hayFiltros = busqueda !== '' || estado !== '';
  const limpiarFiltros = () => {
    setBusqueda('');
    setEstado('');
  };

  return (
    <div>
      <Encabezado
        titulo={t('productos.titulo')}
        cargados={productos.cargando ? undefined : items.length}
        hayMas={productos.hayMas}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={t('app.buscar')}
          className="campo max-w-xs"
          aria-label={t('app.buscar')}
        />
        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          className="campo w-auto"
          aria-label={t('app.estado')}
        >
          <option value="">{t('app.total')}</option>
          <option value="ACTIVE">{t('productos.publicado')}</option>
          <option value="DRAFT">{t('productos.borrador')}</option>
          <option value="ARCHIVED">{t('productos.archivado')}</option>
        </select>
        {hayFiltros && (
          <button type="button" onClick={limpiarFiltros} className="btn btn-fantasma text-sm">
            {t('app.limpiar_filtros')}
          </button>
        )}
      </div>

      {productos.cargando ? (
        <Cargando />
      ) : productos.error ? (
        <ErrorPanel error={productos.error} reintentar={productos.recargar} />
      ) : items.length === 0 ? (
        hayFiltros ? (
          <SinResultados alLimpiar={limpiarFiltros} />
        ) : (
          <Vacio titulo={t('app.sin_datos')} />
        )
      ) : (
        <>
          <div className="panel overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>{t('productos.nombre')}</th>
                  <th>{t('productos.categoria')}</th>
                  <th className="text-right">{t('productos.variantes')}</th>
                  <th className="text-right">{t('productos.stock')}</th>
                  {/* El coste va JUNTO al precio y antes que el margen: los
                      tres números se leen en la misma frase —compro a X, vendo
                      a Y, me queda Z— y separarlos obliga a saltar la vista. */}
                  <th className="text-right">{t('productos.coste_compra')}</th>
                  <th className="text-right">{t('productos.precio')}</th>
                  <th className="text-right">{t('pedidos.margen')}</th>
                  <th>{t('app.estado')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        {p.imagen ? (
                          <img src={p.imagen} alt="" className="h-9 w-9 rounded object-cover" />
                        ) : (
                          <span
                            className="h-9 w-9 rounded"
                            style={{ background: 'var(--fondo-sutil)' }}
                          />
                        )}
                        <span className="lineas-1 max-w-[280px] font-medium">{p.name}</span>
                        {p.isAdult && <Etiqueta texto={t('productos.adulto')} tono="aviso" />}
                      </div>
                    </td>
                    <td style={{ color: 'var(--texto-tenue)' }}>{p.categoria ?? '—'}</td>
                    <td className="text-right tabular-nums">{p.variantes}</td>
                    <td
                      className="text-right tabular-nums"
                      style={p.stockTotal === 0 ? { color: 'var(--error)' } : undefined}
                    >
                      {p.stockTotal}
                    </td>
                    <td className="text-right tabular-nums" style={{ color: 'var(--texto-tenue)' }}>
                      {p.costeDesde !== null ? precio(p.costeDesde) : '—'}
                    </td>
                    <td className="text-right tabular-nums">
                      {p.precioDesde !== null ? precio(p.precioDesde) : '—'}
                    </td>
                    <td
                      className="text-right tabular-nums"
                      style={
                        // Un margen por debajo del 25% se marca: en dropshipping
                        // suele significar que el proveedor ha subido el precio.
                        p.margenMedio !== null && p.margenMedio < 25
                          ? { color: 'var(--aviso)' }
                          : { color: 'var(--texto-tenue)' }
                      }
                    >
                      {p.margenMedio !== null ? `${String(p.margenMedio)}%` : '—'}
                    </td>
                    <td>
                      <Etiqueta
                        texto={
                          p.status === 'ACTIVE'
                            ? t('productos.publicado')
                            : p.status === 'DRAFT'
                              ? t('productos.borrador')
                              : t('productos.archivado')
                        }
                        tono={p.status === 'ACTIVE' ? 'exito' : 'neutro'}
                      />
                    </td>
                    <td className="text-right">
                      {/*
                       * Enlace y no desplegable.
                       *
                       * La edición vive en su propia pantalla desde que dejó
                       * de caber en una fila: así se puede compartir la
                       * dirección, abrirla en otra pestaña y volver con el
                       * botón atrás, tres cosas que un acordeón no permite.
                       */}
                      <Enlace
                        a="/productos/$productId"
                        params={{ productId: p.id }}
                        className="btn btn-secundario text-xs"
                      >
                        {t('productos.editar')}
                      </Enlace>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <VerMas
            hayMas={productos.hayMas}
            cargando={productos.cargandoMas}
            alPulsar={productos.cargarMas}
          />
        </>
      )}
    </div>
  );
}
