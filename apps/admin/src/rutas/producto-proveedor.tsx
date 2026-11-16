import { useTranslation } from 'react-i18next';
import { precio, fechaRelativa } from '@/lib/formato';
import { Enlace } from '@/componentes/enlace';
import { Etiqueta } from '@/componentes/estados';
import { Tarjeta, ListaDatos } from '@/componentes/ui/datos';

/**
 * De dónde sale este producto y cuánto cuesta de verdad.
 *
 * Es la información con la que se decide un precio, y hasta ahora no estaba en
 * ninguna pantalla del panel: había que mirar en la web del proveedor. Aquí va
 * junta la que importa:
 *
 *  · **El coste real**, que es el artículo MÁS el envío que cobra el proveedor.
 *    El margen calculado sobre el precio a secas sale inflado justo en los
 *    productos baratos, que es donde el porte pesa más.
 *  · **Su stock**, para distinguir «lo hemos agotado nosotros» de «el proveedor
 *    se ha quedado sin existencias», que se arreglan de forma muy distinta.
 *  · **Cuándo se comprobó por última vez.** Un coste leído hace tres semanas
 *    puede haber cambiado, y el margen que se ve sería el de entonces.
 *  · **Si lo ha descatalogado**, que es la señal de que hay que despublicar
 *    antes de que alguien lo compre y no se pueda servir.
 */

export interface EnlaceProveedor {
  id: string;
  supplierId: string;
  supplierKey: string;
  supplierNombre: string;
  supplierActivo: boolean;
  externalProductId: string;
  externalVariantId: string | null;
  variantId: string | null;
  variantSku: string | null;
  costCents: number;
  shippingCents: number;
  costeTotalCents: number;
  currency: string;
  stock: number;
  available: boolean;
  discontinued: boolean;
  discontinuedAt: string | null;
  leadTimeMinDays: number | null;
  leadTimeMaxDays: number | null;
  lastCheckedAt: string | null;
  margenPorcentaje: number | null;
}

/** URL de la ficha en la web del proveedor, cuando se sabe construirla. */
function urlEnProveedor(enlace: EnlaceProveedor): string | null {
  if (enlace.supplierKey === 'aliexpress') {
    return `https://es.aliexpress.com/item/${enlace.externalProductId}.html`;
  }
  return null;
}

export function BloqueProveedor({
  enlaces,
  idioma,
}: {
  enlaces: EnlaceProveedor[];
  idioma: string;
}) {
  const { t } = useTranslation();

  if (enlaces.length === 0) {
    return (
      <Tarjeta titulo={t('productos.proveedor')} descripcion={t('productos.sin_proveedor_ayuda')}>
        <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
          {t('productos.sin_proveedor')}
        </p>
      </Tarjeta>
    );
  }

  const primero = enlaces[0]!;
  const descatalogados = enlaces.filter((e) => e.discontinued).length;
  const sinStock = enlaces.filter((e) => e.stock <= 0 || !e.available).length;

  return (
    <Tarjeta
      titulo={t('productos.proveedor')}
      descripcion={primero.supplierNombre}
      acciones={
        <Enlace a="/proveedores" className="btn btn-secundario text-xs">
          {t('productos.ver_proveedor')}
        </Enlace>
      }
    >
      {/* Lo que exige actuar va primero y no dentro de una tabla: si el
          proveedor ha retirado el producto, hay que despublicarlo antes de que
          alguien lo compre y no se pueda servir. */}
      {descatalogados > 0 && (
        <p
          className="mb-3 rounded-lg px-3 py-2 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--error) 10%, transparent)',
            color: 'var(--error)',
          }}
        >
          {t('productos.descatalogado_aviso', { n: descatalogados })}
        </p>
      )}
      {descatalogados === 0 && sinStock > 0 && (
        <p
          className="mb-3 rounded-lg px-3 py-2 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--aviso) 12%, transparent)',
            color: 'var(--aviso)',
          }}
        >
          {t('productos.sin_stock_proveedor', { n: sinStock })}
        </p>
      )}

      <ListaDatos
        columnas={3}
        datos={[
          { nombre: t('productos.proveedor'), valor: primero.supplierNombre },
          {
            nombre: t('productos.id_en_proveedor'),
            valor: (
              <span className="font-mono text-xs">
                {urlEnProveedor(primero) ? (
                  <a
                    href={urlEnProveedor(primero) ?? '#'}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline underline-offset-2"
                  >
                    {primero.externalProductId}
                  </a>
                ) : (
                  primero.externalProductId
                )}
              </span>
            ),
          },
          {
            nombre: t('productos.comprobado'),
            valor: primero.lastCheckedAt ? (
              fechaRelativa(primero.lastCheckedAt, idioma)
            ) : (
              <span style={{ color: 'var(--aviso)' }}>{t('productos.nunca_comprobado')}</span>
            ),
          },
        ]}
      />

      <div className="tabla-caja mt-4">
        <table className="tabla">
          <caption className="solo-lectores">{t('productos.coste_por_variante')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('productos.variante')}</th>
              <th scope="col" className="text-right">
                {t('productos.coste_articulo')}
              </th>
              <th scope="col" className="text-right">
                {t('productos.envio_proveedor')}
              </th>
              <th scope="col" className="text-right">
                {t('productos.coste_total')}
              </th>
              <th scope="col" className="text-right">
                {t('productos.margen')}
              </th>
              <th scope="col" className="text-right">
                {t('productos.stock_proveedor')}
              </th>
              <th scope="col">{t('productos.plazo')}</th>
            </tr>
          </thead>
          <tbody>
            {enlaces.map((e) => (
              <tr key={e.id}>
                <td className="font-mono text-xs">{e.variantSku ?? e.externalVariantId ?? '—'}</td>
                <td className="text-right cifra">{precio(e.costCents)}</td>
                <td className="text-right cifra" style={{ color: 'var(--texto-tenue)' }}>
                  {e.shippingCents > 0 ? precio(e.shippingCents) : '—'}
                </td>
                <td className="text-right cifra font-medium">{precio(e.costeTotalCents)}</td>
                <td
                  className="text-right cifra"
                  style={{
                    // El margen se colorea solo cuando es malo: en verde todo
                    // el rato, deja de significar nada.
                    color:
                      e.margenPorcentaje === null
                        ? 'var(--texto-tenue)'
                        : e.margenPorcentaje < 15
                          ? 'var(--error)'
                          : e.margenPorcentaje < 30
                            ? 'var(--aviso)'
                            : 'var(--texto)',
                  }}
                >
                  {e.margenPorcentaje === null ? '—' : `${String(e.margenPorcentaje)}%`}
                </td>
                <td className="text-right cifra">
                  {e.discontinued ? (
                    <Etiqueta texto={t('productos.descatalogado')} tono="error" />
                  ) : !e.available || e.stock <= 0 ? (
                    <Etiqueta texto={t('productos.agotado_proveedor')} tono="aviso" />
                  ) : (
                    e.stock
                  )}
                </td>
                <td className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {e.leadTimeMaxDays
                    ? t('productos.dias_entrega', { n: e.leadTimeMaxDays })
                    : t('productos.plazo_desconocido')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="ayuda-campo mt-2">{t('productos.coste_ayuda')}</p>
    </Tarjeta>
  );
}
