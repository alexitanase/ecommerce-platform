import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { precio } from '@/lib/formato';
import { useQuery } from '@tanstack/react-query';
import { Cargando, ErrorPanel, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { Enlace } from '@/componentes/enlace';
import { get } from '@/lib/api';

/**
 * Lo que se está vendiendo por debajo del margen.
 *
 * Existe porque el aviso llegó tarde una vez: un producto comprado a 13,99 € se
 * puso a 18,99 € «con un 26 % de margen», se vendió, y de esos 18,99 € había
 * 3,30 € de IVA. Con la comisión de la pasarela, cada venta perdía dinero. El
 * cálculo ya está arreglado —el margen se mide sobre la base, no sobre el
 * precio de escaparate— pero un número correcto que nadie mira no sirve: hacía
 * falta una pantalla que enseñe la lista sin que haya que ir a buscarla.
 *
 * El coste que se compara es el del PROVEEDOR y con su porte incluido, no la
 * copia guardada en la variante: esa se queda vieja justo cuando importa, que
 * es cuando el proveedor sube el precio.
 */
interface VarianteBajoMargen {
  variantId: string;
  sku: string;
  productId: string;
  handle: string;
  status: string;
  precioVenta: number;
  ingresoCents: number;
  coste: number;
  margenBrutoCents: number;
  margenPorcentaje: number;
  multiplicador: number;
}

/** Umbrales que se ofrecen. El 0 % es «solo lo que pierde dinero». */
const UMBRALES = [0, 15, 25, 40];

export function Margenes() {
  const { t } = useTranslation();
  const [minimo, setMinimo] = useState(25);

  const lista = useQuery({
    queryKey: ['bajo-margen', minimo],
    queryFn: () =>
      get<VarianteBajoMargen[]>(`/catalog/pricing/low-margin?margenMinimo=${String(minimo)}`),
  });

  const items = lista.data ?? [];
  const enPerdidas = items.filter((v) => v.margenBrutoCents < 0).length;

  return (
    <div>
      <Encabezado
        titulo={t('margenes.titulo')}
        cargados={lista.isPending ? undefined : items.length}
      />

      <p className="mb-4 max-w-2xl text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('margenes.explicacion')}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label htmlFor="minimo" className="text-sm">
          {t('margenes.umbral')}
        </label>
        <select
          id="minimo"
          value={minimo}
          onChange={(e) => setMinimo(Number(e.target.value))}
          className="campo w-auto"
        >
          {UMBRALES.map((u) => (
            <option key={u} value={u}>
              {u === 0 ? t('margenes.solo_perdidas') : `${String(u)}%`}
            </option>
          ))}
        </select>
      </div>

      {enPerdidas > 0 && (
        <div
          className="mb-4 rounded p-3 text-sm"
          style={{ background: 'var(--burbuja-error)', color: 'var(--texto)' }}
          role="alert"
        >
          {t('margenes.en_perdidas', { count: enPerdidas })}
        </div>
      )}

      {lista.isPending ? (
        <Cargando />
      ) : lista.error ? (
        <ErrorPanel error={lista.error} reintentar={() => void lista.refetch()} />
      ) : items.length === 0 ? (
        <Vacio titulo={t('margenes.ninguna')} />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>{t('productos.referencia')}</th>
                {/* En el mismo orden en que se lee la frase: compro a X, se
                    ingresa Y de los Z que paga el cliente, me queda W. */}
                <th className="text-right">{t('productos.coste_compra')}</th>
                <th className="text-right">{t('productos.precio')}</th>
                <th className="text-right">{t('margenes.ingreso')}</th>
                <th className="text-right">{t('pedidos.margen')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.variantId}>
                  <td>
                    <span className="font-medium">{v.sku}</span>
                    <span className="ms-2 text-sm" style={{ color: 'var(--texto-tenue)' }}>
                      {v.handle}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{precio(v.coste)}</td>
                  <td className="text-right tabular-nums">{precio(v.precioVenta)}</td>
                  <td
                    className="text-right tabular-nums"
                    style={{ color: 'var(--texto-tenue)' }}
                    // Lo que queda del precio una vez fuera el IVA. Es la cifra
                    // que faltaba: sin ella el margen parece salir de una resta
                    // que no cuadra.
                    title={t('margenes.ingreso_ayuda')}
                  >
                    {precio(v.ingresoCents)}
                  </td>
                  <td
                    className="text-right font-medium tabular-nums"
                    style={{
                      color: v.margenBrutoCents < 0 ? 'var(--error)' : 'var(--aviso)',
                    }}
                  >
                    {precio(v.margenBrutoCents)} · {String(v.margenPorcentaje)}%
                  </td>
                  <td className="text-right">
                    <Enlace
                      a="/productos/$productId"
                      params={{ productId: v.productId }}
                      className="btn btn-fantasma text-sm"
                    >
                      {t('app.ver')}
                    </Enlace>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
