import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { del, get, post } from '@/lib/api';
import { precio } from '@/lib/formato';
import { Cargando, ErrorPanel, Etiqueta, Frescura } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { Enlace } from '@/componentes/enlace';
import { Pestanas } from '@/componentes/ui/navegacion-pagina';
import { Boton } from '@/componentes/ui/boton';
import { ConfirmarPeligro } from '@/componentes/ui/overlays';
import { useToast } from '@/componentes/ui/toast';
import { Tarjeta, ListaDatos } from '@/componentes/ui/datos';
import { EditorProducto } from '@/rutas/producto-editor';
import { BloqueProveedor, type EnlaceProveedor } from '@/rutas/producto-proveedor';
import { ImagenesProducto } from '@/rutas/producto-imagenes';

/**
 * Ficha completa de un producto.
 *
 * Antes esto era un desplegable dentro de la fila del listado, y eso imponía
 * dos límites que no se notaban hasta que había que trabajar de verdad: no
 * cabía nada más que los campos justos, y no se podía enlazar —ni compartir,
 * ni abrir en otra pestaña, ni volver con el botón atrás—.
 *
 * Como pantalla propia cabe todo lo que hace falta para decidir sobre un
 * producto sin salir de aquí: sus textos en cada idioma, sus variantes con
 * precio y stock, y de dónde sale y cuánto cuesta en el proveedor, que es la
 * mitad de la información con la que se pone un precio y no estaba en ninguna
 * parte del panel.
 */

interface Traduccion {
  locale: string;
  name: string;
  slug: string;
}

interface Variante {
  id: string;
  sku: string;
  priceCents: number;
  costCents: number | null;
  stock: number;
  isActive: boolean;
  weightGrams: number | null;
}

interface Media {
  id: string;
  url: string;
  alt: string | null;
}

interface Detalle {
  id: string;
  status: string;
  handle: string;
  isAdult: boolean;
  taxRate: string;
  translations: Traduccion[];
  variants: Variante[];
  media: Media[];
  proveedores: EnlaceProveedor[];
  category?: { id: string; translations: { locale: string; name: string }[] } | null;
}

export function FichaProducto() {
  const { t, i18n } = useTranslation();
  /*
   * El árbol de rutas se define por código, no por ficheros, así que TanStack
   * no genera los tipos de cada ruta y `useParams` devuelve un objeto vacío en
   * tipos. Se acota aquí, en un solo sitio y documentado, en lugar de repartir
   * conversiones por la pantalla.
   */
  const qc = useQueryClient();
  const toast = useToast();
  const navegar = useNavigate();
  const [archivando, setArchivando] = useState(false);
  const parametros: Record<string, string | undefined> = useParams({ strict: false });
  const productId = parametros['productId'] ?? '';

  const producto = useQuery({
    queryKey: ['producto', productId],
    queryFn: () => get<Detalle>(`/catalog/products/${productId}`),
  });

  /*
   * Archivar y no borrar de verdad.
   *
   * Los pedidos ya hechos apuntan al producto: borrar la fila dejaría facturas
   * sin poder reconstruir, y hay obligación de conservarlas. Archivar lo saca de
   * la tienda y del buscador al instante, que es lo que se busca al «eliminar»,
   * y deja recuperarlo.
   */
  const archivar = useMutation({
    mutationFn: () => del(`/catalog/products/${productId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['productos'] });
      toast.exito(t('productos.archivado_ok'));
      void navegar({ to: '/productos' as never });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restaurar = useMutation({
    mutationFn: () => post(`/catalog/products/${productId}/restaurar`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['producto', productId] });
      void qc.invalidateQueries({ queryKey: ['productos'] });
      toast.exito(t('productos.restaurado_ok'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (producto.isLoading) return <Cargando filas={4} />;
  if (producto.error)
    return <ErrorPanel error={producto.error} reintentar={() => void producto.refetch()} />;
  if (!producto.data) return null;

  const p = producto.data;
  const nombre =
    p.translations.find((x) => x.locale === i18n.language)?.name ??
    p.translations.find((x) => x.locale === 'es')?.name ??
    p.handle;

  const categoria =
    p.category?.translations.find((x) => x.locale === i18n.language)?.name ??
    p.category?.translations[0]?.name ??
    null;

  const stockTotal = p.variants.reduce((a, v) => a + v.stock, 0);
  const precios = p.variants.map((v) => v.priceCents).filter((c) => c > 0);
  const desde = precios.length > 0 ? Math.min(...precios) : 0;
  const hasta = precios.length > 0 ? Math.max(...precios) : 0;

  return (
    <div>
      <Encabezado
        titulo={nombre}
        // El último nivel de las migas lo pone la pantalla: el nombre del
        // producto solo lo conoce ella.
        migas={[{ etiqueta: nombre }]}
        descripcion={categoria ?? undefined}
        frescura={
          <Frescura
            actualizado={producto.dataUpdatedAt}
            refrescando={producto.isFetching}
            alRefrescar={() => void producto.refetch()}
          />
        }
        acciones={
          <>
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
            {p.isAdult && <Etiqueta texto="+18" tono="aviso" />}
            <Enlace a="/productos" className="btn btn-secundario text-sm">
              {t('productos.volver_al_listado')}
            </Enlace>
            {p.status === 'ARCHIVED' ? (
              <Boton
                variante="secundario"
                tamano="sm"
                cargando={restaurar.isPending}
                onClick={() => restaurar.mutate()}
              >
                {t('productos.restaurar')}
              </Boton>
            ) : (
              <Boton variante="peligro" tamano="sm" onClick={() => setArchivando(true)}>
                {t('productos.archivar')}
              </Boton>
            )}
          </>
        }
      />

      {/* Un vistazo a lo que casi siempre se viene a mirar, sin abrir nada. */}
      <div className="rejilla mb-4">
        <div className="col-3">
          <Tarjeta titulo={t('productos.precio_venta')}>
            <p className="text-xl font-semibold">
              {desde === hasta ? precio(desde) : `${precio(desde)} – ${precio(hasta)}`}
            </p>
          </Tarjeta>
        </div>
        <div className="col-3">
          <Tarjeta titulo={t('productos.stock')}>
            <p
              className="cifra text-xl font-semibold"
              style={stockTotal <= 0 ? { color: 'var(--aviso)' } : undefined}
            >
              {stockTotal}
            </p>
          </Tarjeta>
        </div>
        <div className="col-3">
          <Tarjeta titulo={t('productos.variantes')}>
            <p className="cifra text-xl font-semibold">{p.variants.length}</p>
          </Tarjeta>
        </div>
        <div className="col-3">
          <Tarjeta titulo={t('productos.imagenes')}>
            <p
              className="cifra text-xl font-semibold"
              style={p.media.length === 0 ? { color: 'var(--error)' } : undefined}
            >
              {p.media.length}
            </p>
          </Tarjeta>
        </div>
      </div>

      <ConfirmarPeligro
        abierto={archivando}
        alCerrar={() => setArchivando(false)}
        alConfirmar={() => archivar.mutate()}
        trabajando={archivar.isPending}
        titulo={t('productos.archivar_titulo')}
        descripcion={t('productos.archivar_ayuda')}
        textoConfirmar={t('productos.archivar')}
      />

      <Pestanas
        etiqueta={t('productos.secciones_ficha')}
        pestanas={[
          {
            id: 'edicion',
            etiqueta: t('productos.edicion'),
            // El editor que ya existía, ahora con sitio de sobra en lugar de
            // apretado dentro de una fila de la tabla.
            contenido: <EditorProducto productId={productId} />,
          },
          {
            id: 'proveedor',
            etiqueta: t('productos.proveedor'),
            cantidad: p.proveedores.length,
            contenido: <BloqueProveedor enlaces={p.proveedores} idioma={i18n.language} />,
          },
          {
            id: 'medios',
            etiqueta: t('productos.imagenes'),
            cantidad: p.media.length,
            contenido: <ImagenesProducto productId={productId} imagenes={p.media} />,
          },
          {
            id: 'tecnico',
            etiqueta: t('productos.datos_tecnicos'),
            contenido: (
              <Tarjeta titulo={t('productos.datos_tecnicos')}>
                <ListaDatos
                  columnas={2}
                  datos={[
                    { nombre: t('productos.identificador'), valor: <code>{p.id}</code> },
                    { nombre: t('productos.direccion_tienda'), valor: <code>{p.handle}</code> },
                    { nombre: t('productos.iva'), valor: `${p.taxRate}%` },
                    {
                      nombre: t('productos.idiomas_con_ficha'),
                      valor: p.translations.map((x) => x.locale).join(', ') || '—',
                    },
                  ]}
                />
              </Tarjeta>
            ),
          },
        ]}
      />
    </div>
  );
}
