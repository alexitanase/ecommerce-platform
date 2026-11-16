import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leerImporte } from '@ecom/shared';
import { get, patch, post } from '@/lib/api';
import { precio } from '@/lib/formato';
import { Cargando, ErrorPanel, Etiqueta } from '@/componentes/estados';
import { EditorHtml } from '@/componentes/ui/editor-html';
import { useToast } from '@/componentes/ui/toast';

/**
 * Editor de un producto.
 *
 * Faltaba por completo: se podían listar productos e importarlos, pero no
 * tocarlos. En una tienda de dropshipping eso deja fuera lo que más se hace —
 * ajustar el precio, corregir el título que viene del proveedor, publicar una
 * ficha que estaba en borrador— y obligaba a borrar y reimportar, perdiendo el
 * histórico de precios y la URL del producto.
 *
 * Se abre dentro de la lista en vez de en una ruta aparte, igual que la ficha
 * de proveedor: se edita mirando el resto del catálogo, que es como se trabaja
 * cuando se están cuadrando precios.
 */

const IDIOMAS = ['es', 'ca', 'en'] as const;
type Idioma = (typeof IDIOMAS)[number];

interface Traduccion {
  locale: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

interface Variante {
  id: string;
  sku: string;
  priceCents: number;
  /**
   * El precio tachado que la tienda está anunciando ahora mismo, o `null`.
   *
   * **No es el que se edita.** Lo calcula la API con la regla de la directiva
   * Ómnibus —el mínimo de los últimos 30 días— y puede ser `null` aunque haya un
   * precio tachado guardado. Sirve para avisar de que lo guardado no se está
   * anunciando; para editar está `compareAtGuardadoCents`.
   */
  compareAtCents: number | null;
  /** El precio tachado tal como está guardado. Este es el editable. */
  compareAtGuardadoCents: number | null;
  costCents: number | null;
  stock: number;
  lowStockAlert: number;
  isActive: boolean;
  /** En gramos. Decide el tramo de porte; sin él, el envío sale aproximado. */
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  /** Fotos propias de la variante: el proveedor asigna una a cada color. */
  media?: { id: string; url: string }[];
}

/** Lo que cuesta la variante en el proveedor, envío suyo incluido. */
interface CosteProveedor {
  variantId: string | null;
  costCents: number;
  shippingCents: number;
  costeTotalCents: number;
  lastCheckedAt: string | null;
}

interface ProductoDetalle {
  proveedores?: CosteProveedor[];
  id: string;
  status: string;
  handle: string;
  isAdult: boolean;
  taxRate: string;
  /** Dónde se clasifica el producto. Las dos se podían guardar y no se pintaban. */
  categoryId: string | null;
  brandId: string | null;
  translations: Traduccion[];
  variants: Variante[];
}

/** Nodo del árbol de categorías tal y como lo manda la API. */
interface NodoCategoria {
  id: string;
  name: string;
  children: NodoCategoria[];
}

/** El árbol aplanado a una lista, conservando la profundidad para el sangrado. */
interface CategoriaPlana {
  id: string;
  name: string;
  depth: number;
}

interface Marca {
  id: string;
  name: string;
  isActive: boolean;
}

/**
 * Aplana el árbol a una lista para el desplegable.
 *
 * Un `<select>` no anida, así que la jerarquía se enseña con sangría. Se hace
 * aquí y no en la API porque el árbol es lo que necesitan las demás pantallas.
 */
function aplanarCategorias(nodos: NodoCategoria[], depth = 0): CategoriaPlana[] {
  return nodos.flatMap((n) => [
    { id: n.id, name: n.name, depth },
    ...aplanarCategorias(n.children, depth + 1),
  ]);
}

interface Problema {
  codigo: string;
  /** BLOQUEA impide publicar; el resto son avisos que conviene mirar. */
  gravedad: string;
  locale?: string;
  mensaje: string;
}

interface Fidelidad {
  puedePublicarse: boolean;
  problemas: Problema[];
  resumen: string;
}

interface SimulacionMargen {
  margenObjetivo: number;
  variantes: {
    variantId: string;
    sku: string;
    costeCents: number;
    envioCents: number;
    precioAntes: number;
    precioNuevo: number;
    margenReal: number | null;
    aviso?: string;
  }[];
}

interface RefrescoProveedor {
  comprobados: number;
  cambios: { sku: string | null; costeAntes: number; costeAhora: number }[];
  descatalogados: number;
  /** Fotos de variante que faltaban y se han traído en este refresco. */
  fotosRecuperadas: number;
  aviso?: string;
}

/** Céntimos a un texto editable en euros. La vuelta la hace `leerImporte`. */
const aEuros = (cents: number | null): string => (cents === null ? '' : (cents / 100).toFixed(2));

export function EditorProducto({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [idioma, setIdioma] = useState<Idioma>('es');
  const [guardado, setGuardado] = useState<string | null>(null);
  const [pesoParaTodas, setPesoParaTodas] = useState('');
  const [plazoParaTodas, setPlazoParaTodas] = useState('');
  const [confirmarPublicacion, setConfirmarPublicacion] = useState(false);
  const [margenObjetivo, setMargenObjetivo] = useState(60);

  const producto = useQuery({
    queryKey: ['producto', productId],
    queryFn: () => get<ProductoDetalle>(`/catalog/products/${productId}`),
  });

  /*
   * Categorías y marcas para los desplegables.
   *
   * Las inactivas también: un producto puede estar en una categoría que se
   * desactivó después, y si no saliera en la lista el desplegable aparecería
   * vacío y guardar cualquier otra cosa la borraría sin querer.
   */
  const arbolCategorias = useQuery({
    queryKey: ['categorias', 'arbol', 'todas'],
    queryFn: () => get<NodoCategoria[]>('/catalog/categories/tree?incluirInactivas=true'),
    staleTime: 5 * 60_000,
  });

  const marcas = useQuery({
    queryKey: ['marcas'],
    queryFn: () => get<Marca[]>('/brands'),
    staleTime: 5 * 60_000,
  });

  /** Qué le falta a la ficha para poder publicarse, según la propia API. */
  const fidelidad = useQuery({
    queryKey: ['producto', productId, 'fidelidad'],
    queryFn: () => get<Fidelidad>(`/catalog/products/${productId}/fidelity`),
  });

  const categorias = aplanarCategorias(arbolCategorias.data ?? []);

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['producto', productId] });
    void qc.invalidateQueries({ queryKey: ['productos'] });
  };

  const avisar = (mensaje: string) => {
    setGuardado(mensaje);
    setTimeout(() => setGuardado(null), 2500);
  };

  /**
   * Un campo de importe que se guarda al salir de él.
   *
   * Los tres campos de precio de una variante se comportaban distinto, y ahí
   * estaba el fallo: el de «precio» rechazaba lo que no entendía y restauraba el
   * valor, mientras el de «precio tachado» y el de «coste» mandaban un vacío.
   * Consecuencia: escribir `31,23 €` —con el símbolo, que es lo natural— no daba
   * ningún error y **borraba el precio tachado que ya estaba guardado**. Se veía
   * el campo vacío y parecía que no guardaba; lo que hacía era guardar un vacío.
   *
   * Ahora los tres pasan por aquí y los tres estados se tratan aparte:
   *
   *  · **No se entiende** → se deja como estaba y se explica.
   *  · **En blanco** → se vacía el dato, si el campo admite estar vacío. El
   *    precio de venta no lo admite: una variante sin precio no se puede vender.
   *  · **Un importe** → se guarda, y solo si de verdad ha cambiado.
   */
  const alSalirDeImporte = (
    campo: HTMLInputElement,
    guardadoEnServidor: number | null,
    aplicar: (cents: number | null) => void,
    admiteVacio: boolean,
  ) => {
    const leido = leerImporte(campo.value);
    const restaurar = () => {
      campo.value = aEuros(guardadoEnServidor);
    };

    if (leido.estado === 'invalido') {
      restaurar();
      toast.error(t('productos.importe_no_valido'));
      return;
    }

    if (leido.estado === 'vacio') {
      if (!admiteVacio) {
        restaurar();
        toast.error(t('productos.precio_obligatorio'));
        return;
      }
      if (guardadoEnServidor !== null) aplicar(null);
      return;
    }

    if (leido.cents === guardadoEnServidor) {
      // Mismo importe escrito de otra forma («31,23» por «31.23»): se deja el
      // formato canónico y no se manda nada, que si no la auditoría se llena de
      // cambios que no cambiaron nada.
      restaurar();
      return;
    }

    aplicar(leido.cents);
  };

  const guardarProducto = useMutation({
    mutationFn: (cambios: unknown) => patch(`/catalog/products/${productId}`, cambios),
    onSuccess: () => {
      refrescar();
      avisar(t('productos.guardado'));
    },
  });

  const guardarVariante = useMutation({
    mutationFn: ({ id, cambios }: { id: string; cambios: unknown }) =>
      patch(`/catalog/products/variants/${id}`, cambios),
    onSuccess: () => {
      refrescar();
      avisar(t('productos.guardado'));
    },
    /*
     * El rechazo va a un aviso flotante, no al cartel de arriba.
     *
     * Los campos de precio están a pantalla y media del principio del
     * formulario, y ahí es donde se pintaba el error. Cuando la API rechazaba un
     * precio tachado menor que el de venta —el caso frecuente: escribir el
     * precio ya rebajado— el mensaje aparecía fuera de la vista y desde el campo
     * parecía que simplemente no se guardaba nada.
     */
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Plazo de entrega del producto entero.
   *
   * El dato vive en el enlace con el proveedor, no en la variante, así que no
   * se puede tocar desde los campos de abajo. Sin esta vía el aviso de «no se
   * conoce el plazo» era irresoluble desde el panel.
   */
  const fijarPlazo = useMutation({
    mutationFn: (dias: number) => patch(`/catalog/products/${productId}/lead-time`, { dias }),
    onSuccess: () => {
      refrescar();
      void qc.invalidateQueries({ queryKey: ['producto', productId, 'fidelidad'] });
      avisar(t('productos.guardado'));
    },
  });

  /**
   * Qué precios saldrían con este margen, sin tocar nada todavía.
   *
   * Se consulta al servidor en lugar de calcularlo en el navegador porque el
   * cálculo no es una división: entra el envío del proveedor, el redondeo
   * psicológico y el margen mínimo pactado con él. Repetir esas reglas aquí
   * garantizaría que un día el precio previsto y el aplicado dejaran de
   * coincidir, y nadie sabría cuál de los dos está mal.
   */
  const simulacion = useQuery({
    queryKey: ['producto', productId, 'margen', margenObjetivo],
    queryFn: () =>
      post<SimulacionMargen>(`/catalog/products/${productId}/margen`, {
        margen: margenObjetivo,
        simular: true,
      }),
    // Se recalcula al mover el control, así que no conviene guardarlo.
    staleTime: 0,
  });

  const aplicarMargen = useMutation({
    mutationFn: () => post(`/catalog/products/${productId}/margen`, { margen: margenObjetivo }),
    onSuccess: () => {
      refrescar();
      void qc.invalidateQueries({ queryKey: ['producto', productId, 'fidelidad'] });
      avisar(t('productos.precios_actualizados'));
    },
  });

  /** Pregunta al proveedor cuánto cuesta AHORA, sin esperar a la sincronización nocturna. */
  const refrescarProveedor = useMutation({
    mutationFn: () => post<RefrescoProveedor>(`/suppliers/products/${productId}/refresh`),
    onSuccess: (r) => {
      refrescar();
      // Se dicen las dos cosas: el refresco trae precios Y las fotos de
      // variante que faltasen, y callarse las fotos haría parecer que no ha
      // hecho nada cuando el precio no ha cambiado.
      const partes = [
        r.cambios.length > 0
          ? t('productos.coste_cambiado', { n: r.cambios.length })
          : t('productos.coste_igual'),
        ...(r.fotosRecuperadas > 0
          ? [t('productos.fotos_recuperadas', { n: r.fotosRecuperadas })]
          : []),
      ];
      avisar(partes.join(' · '));
    },
  });

  const ajustarStock = useMutation({
    mutationFn: ({ id, stock }: { id: string; stock: number }) =>
      patch(`/catalog/inventory/${id}`, { stock }),
    onSuccess: () => {
      refrescar();
      avisar(t('productos.guardado'));
    },
    // Por lo mismo que en `guardarVariante`: el campo está lejos del cartel.
    onError: (e: Error) => toast.error(e.message),
  });

  if (producto.isLoading) return <Cargando filas={3} />;
  if (producto.error)
    return <ErrorPanel error={producto.error} reintentar={() => void producto.refetch()} />;
  if (!producto.data) return null;

  const p = producto.data;
  const traduccion = p.translations.find((tr) => tr.locale === idioma);
  // Solo lo del formulario de arriba: lo de las variantes va por aviso flotante,
  // porque sus campos no están a la vista de este cartel.
  const error = guardarProducto.error;

  /** Guarda una traducción entera; la API las quiere completas, no por campo. */
  const guardarTraduccion = (cambios: Partial<Traduccion>) => {
    const base = traduccion ?? {
      locale: idioma,
      name: '',
      slug: '',
      shortDescription: null,
      description: null,
      metaTitle: null,
      metaDescription: null,
    };
    const fusionada = { ...base, ...cambios };

    // Sin nombre y sin slug la API rechaza la traducción entera; es mejor no
    // mandarla que enseñar un error de validación al salir de un campo.
    if (!fusionada.name.trim() || !fusionada.slug.trim()) return;

    guardarProducto.mutate({
      translations: [
        {
          locale: idioma,
          name: fusionada.name,
          slug: fusionada.slug,
          ...(fusionada.shortDescription ? { shortDescription: fusionada.shortDescription } : {}),
          ...(fusionada.description ? { description: fusionada.description } : {}),
          ...(fusionada.metaTitle ? { metaTitle: fusionada.metaTitle } : {}),
          ...(fusionada.metaDescription ? { metaDescription: fusionada.metaDescription } : {}),
        },
      ],
    });
  };

  /*
   * Arreglos de un clic para lo que más frena al publicar.
   *
   * Los tres problemas que aparecen siempre —falta el nombre en otro idioma,
   * falta el peso, falta el plazo— tienen el mismo remedio repetido variante a
   * variante e idioma a idioma. Hacerlo a mano en un producto con ocho
   * variantes son dieciséis campos, y por eso nadie los rellena: se publica con
   * avisos o no se publica.
   */
  const nombreEnCastellano = p.translations.find((tr) => tr.locale === 'es')?.name?.trim() ?? '';

  const idiomasSinNombre = (fidelidad.data?.problemas ?? [])
    .filter((x) => (x.codigo === 'SIN_NOMBRE' || x.codigo === 'IDIOMA_INCOMPLETO') && x.locale)
    .map((x) => x.locale as string);

  const variantesSinPeso = p.variants.filter((v) => v.weightGrams === null || v.weightGrams <= 0);

  /*
   * Bloqueos que la API no deja omitir ni pidiéndolo.
   *
   * Se repiten aquí para no ofrecer un botón que se sabe que va a fallar: la
   * lista vive en el servidor, que es quien manda, y esto solo decide si se
   * enseña la salida.
   */
  const hayBloqueoInsalvable = (fidelidad.data?.problemas ?? []).some(
    (x) =>
      x.gravedad === 'BLOQUEA' &&
      (x.codigo === 'SIN_PRECIO' || x.codigo === 'DESCUENTO_SIN_REFERENCIA'),
  );

  /** Copia el nombre del castellano a los idiomas que lo tengan vacío. */
  const copiarNombreAOtrosIdiomas = () => {
    if (!nombreEnCastellano) return;

    guardarProducto.mutate({
      translations: idiomasSinNombre.map((locale) => {
        const previa = p.translations.find((tr) => tr.locale === locale);
        return {
          locale,
          name: nombreEnCastellano,
          // El slug tiene que ser distinto por idioma: repetir el del
          // castellano daría un choque de URL al guardar.
          slug: previa?.slug?.trim() || `${p.handle}-${locale}`,
          ...(previa?.shortDescription ? { shortDescription: previa.shortDescription } : {}),
          ...(previa?.description ? { description: previa.description } : {}),
        };
      }),
    });
  };

  /** Aplica el mismo peso a todas las variantes que no lo tengan. */
  const aplicarPesoATodas = (gramos: number) => {
    for (const v of variantesSinPeso) {
      guardarVariante.mutate({ id: v.id, cambios: { weightGrams: gramos } });
    }
  };

  return (
    <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--borde)' }}>
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-lg px-3 py-2 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--error) 12%, transparent)',
            color: 'var(--error)',
          }}
        >
          {error.message}
        </p>
      )}

      {guardado && (
        <p role="status" className="mb-3 text-sm" style={{ color: 'var(--exito)' }}>
          {guardado}
        </p>
      )}

      {/* ── Publicación ────────────────────────────────────── */}
      <section className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{t('productos.estado')}</h3>
          <Etiqueta
            texto={p.status}
            tono={p.status === 'ACTIVE' ? 'exito' : p.status === 'DRAFT' ? 'aviso' : 'neutro'}
          />
        </div>

        {/* Lo que impide publicar, dicho por la API, y cómo arreglarlo sin
            salir de aquí. Antes esto era una lista de reproches: decía qué
            faltaba pero había que ir campo por campo a resolverlo, y con ocho
            variantes eso son dieciséis casillas. */}
        {fidelidad.data && fidelidad.data.problemas.length > 0 && (
          <div className="mt-2 rounded-lg p-3" style={{ background: 'var(--fondo-sutil)' }}>
            <p className="text-xs font-medium">
              {fidelidad.data.puedePublicarse
                ? t('productos.avisos_ficha')
                : t('productos.falta_para_publicar')}
            </p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {fidelidad.data.problemas.map((problema, i) => (
                <li
                  key={`${problema.codigo}-${problema.locale ?? ''}-${String(i)}`}
                  style={{
                    // Lo que bloquea y lo que solo avisa no se leen igual: sin
                    // distinguirlo, la lista parece una pared de errores y no
                    // se ve qué hay que arreglar de verdad.
                    color: problema.gravedad === 'BLOQUEA' ? 'var(--error)' : 'var(--texto-tenue)',
                  }}
                >
                  · {problema.mensaje}
                </li>
              ))}
            </ul>

            {/* ── Arreglos de un clic ── */}
            <div className="mt-3 flex flex-col gap-2">
              {idiomasSinNombre.length > 0 && nombreEnCastellano && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-secundario text-xs"
                    disabled={guardarProducto.isPending}
                    onClick={copiarNombreAOtrosIdiomas}
                  >
                    {t('productos.copiar_nombre_idiomas', { idiomas: idiomasSinNombre.join(', ') })}
                  </button>
                  <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {t('productos.copiar_nombre_ayuda')}
                  </span>
                </div>
              )}

              {variantesSinPeso.length > 0 && (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const gramos = Number(pesoParaTodas);
                    if (Number.isInteger(gramos) && gramos > 0) aplicarPesoATodas(gramos);
                  }}
                >
                  <input
                    type="number"
                    min={1}
                    value={pesoParaTodas}
                    onChange={(e) => setPesoParaTodas(e.target.value)}
                    className="campo w-28 text-base sm:text-xs"
                    aria-label={t('productos.peso_gramos')}
                    placeholder="350"
                  />
                  <button
                    type="submit"
                    className="btn btn-secundario text-xs"
                    disabled={guardarVariante.isPending || !pesoParaTodas.trim()}
                  >
                    {t('productos.aplicar_peso', { n: variantesSinPeso.length })}
                  </button>
                  <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {t('productos.peso_ayuda')}
                  </span>
                </form>
              )}

              {fidelidad.data.problemas.some((x) => x.codigo === 'SIN_PLAZO_ENTREGA') && (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const dias = Number(plazoParaTodas);
                    if (Number.isInteger(dias) && dias > 0) fijarPlazo.mutate(dias);
                  }}
                >
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={plazoParaTodas}
                    onChange={(e) => setPlazoParaTodas(e.target.value)}
                    className="campo w-28 text-base sm:text-xs"
                    aria-label={t('productos.plazo_dias')}
                    placeholder="25"
                  />
                  <button
                    type="submit"
                    className="btn btn-secundario text-xs"
                    disabled={fijarPlazo.isPending || !plazoParaTodas.trim()}
                  >
                    {t('productos.aplicar_plazo')}
                  </button>
                  <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {t('productos.plazo_ayuda')}
                  </span>
                </form>
              )}
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {p.status !== 'ACTIVE' && (
            <>
              <button
                type="button"
                className="btn btn-primario text-sm"
                disabled={guardarProducto.isPending || fidelidad.data?.puedePublicarse === false}
                title={
                  fidelidad.data?.puedePublicarse === false
                    ? t('productos.falta_para_publicar')
                    : undefined
                }
                onClick={() => guardarProducto.mutate({ status: 'ACTIVE' })}
              >
                {t('productos.publicar')}
              </button>

              {/*
               * Publicar con la ficha incompleta.
               *
               * Es una decisión de negocio y la toma quien lleva la tienda, no
               * el programa: falta traducir al catalán o el peso exacto, la
               * tienda funciona igual y quien asume la consecuencia es quien
               * publica. Va en un botón aparte y secundario para que sea un acto
               * deliberado, y queda registrado en la auditoría con lo que se
               * saltó.
               *
               * No aparece cuando el bloqueo no se puede omitir —precio a cero o
               * descuento sin histórico— porque ahí no hay decisión que tomar.
               */}
              {fidelidad.data?.puedePublicarse === false && !hayBloqueoInsalvable && (
                <button
                  type="button"
                  className="btn btn-secundario text-sm"
                  disabled={guardarProducto.isPending}
                  onClick={() => {
                    if (confirmarPublicacion) {
                      guardarProducto.mutate({ status: 'ACTIVE', publicarConAvisos: true });
                      setConfirmarPublicacion(false);
                    } else {
                      setConfirmarPublicacion(true);
                    }
                  }}
                >
                  {confirmarPublicacion
                    ? t('productos.publicar_igual_confirmar')
                    : t('productos.publicar_igual')}
                </button>
              )}
            </>
          )}
          {p.status === 'ACTIVE' && (
            <button
              type="button"
              className="btn btn-secundario text-sm"
              disabled={guardarProducto.isPending}
              onClick={() => guardarProducto.mutate({ status: 'DRAFT' })}
            >
              {t('productos.despublicar')}
            </button>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={p.isAdult}
              onChange={(e) => guardarProducto.mutate({ isAdult: e.target.checked })}
            />
            {t('productos.adulto')}
          </label>
        </div>
      </section>

      {/*
        ── Clasificación ──────────────────────────────────
        Categoría y marca. La API aceptaba las dos desde el principio y esta
        pantalla no las pintaba, así que un producto importado se quedaba sin
        categoría para siempre: no había ninguna forma de asignársela.
      */}
      <section className="mb-5">
        <h3 className="mb-2 text-sm font-semibold">{t('productos.clasificacion')}</h3>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t('productos.categoria')}</span>
            <select
              className="campo"
              value={p.categoryId ?? ''}
              disabled={guardarProducto.isPending}
              onChange={(e) =>
                // Cadena vacía es «sin categoría», y por eso viaja como null:
                // mandarla tal cual la guardaría como un identificador vacío.
                guardarProducto.mutate({ categoryId: e.target.value || null })
              }
              data-prueba="categoria-producto"
            >
              <option value="">{t('productos.sin_categoria')}</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {/* Sangrado por profundidad: sin él, un árbol de tres niveles
                      aplanado en una lista no dice qué cuelga de qué. */}
                  {' '.repeat(c.depth * 3)}
                  {c.depth > 0 ? '└ ' : ''}
                  {c.name}
                </option>
              ))}
            </select>
            {categorias.length === 0 && (
              <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
                {t('productos.sin_categorias_ayuda')}
              </span>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t('productos.marca')}</span>
            <select
              className="campo"
              value={p.brandId ?? ''}
              disabled={guardarProducto.isPending}
              onChange={(e) => guardarProducto.mutate({ brandId: e.target.value || null })}
              data-prueba="marca-producto"
            >
              <option value="">{t('productos.sin_marca')}</option>
              {(marcas.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {!m.isActive ? ` · ${t('productos.marca_inactiva')}` : ''}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
              {t('productos.marca_ayuda')}
            </span>
          </label>
        </div>
      </section>

      {/* ── Textos por idioma ──────────────────────────────── */}
      <section className="mb-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{t('productos.textos')}</h3>
          <div className="flex gap-1">
            {IDIOMAS.map((codigo) => (
              <button
                key={codigo}
                type="button"
                onClick={() => setIdioma(codigo)}
                className={`btn text-xs ${idioma === codigo ? 'btn-primario' : 'btn-fantasma'}`}
                aria-pressed={idioma === codigo}
              >
                {codigo.toUpperCase()}
                {/* Un idioma sin traducir se marca: es lo que decide si la
                    ficha se ve en ese idioma o cae al español. */}
                {!p.translations.some((tr) => tr.locale === codigo) && ' ·'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t('productos.nombre')}</span>
            <input
              key={`nombre-${idioma}-${traduccion?.name ?? ''}`}
              type="text"
              defaultValue={traduccion?.name ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (traduccion?.name ?? '')) {
                  guardarTraduccion({ name: e.target.value });
                }
              }}
              className="campo"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t('productos.slug')}</span>
            <input
              key={`slug-${idioma}-${traduccion?.slug ?? ''}`}
              type="text"
              defaultValue={traduccion?.slug ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (traduccion?.slug ?? '')) {
                  guardarTraduccion({ slug: e.target.value });
                }
              }}
              className="campo font-mono text-base sm:text-sm"
            />
            <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
              {t('productos.slug_ayuda')}
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              {t('productos.descripcion_corta')}
            </span>
            <textarea
              key={`corta-${idioma}-${traduccion?.shortDescription ?? ''}`}
              rows={2}
              maxLength={500}
              defaultValue={traduccion?.shortDescription ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (traduccion?.shortDescription ?? '')) {
                  guardarTraduccion({ shortDescription: e.target.value });
                }
              }}
              className="campo"
            />
            {/* Sin HTML, y el servidor lo garantiza: este texto se usa en el
                listado, en las metaetiquetas y en lo que se comparte en redes,
                donde las etiquetas no se pintan sino que se leen. */}
            <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
              {t('productos.descripcion_corta_ayuda')}
            </span>
          </label>

          {/* La descripción larga es HTML: lo que llega del proveedor trae
              listas y tablas de medidas que la tienda pinta tal cual. */}
          <EditorHtml
            key={`larga-${idioma}-${traduccion?.description ?? ''}`}
            etiqueta={t('productos.descripcion')}
            valor={traduccion?.description ?? ''}
            alGuardar={(description: string) => guardarTraduccion({ description })}
          />
        </div>
      </section>

      {/* ── Variantes ──────────────────────────────────────── */}
      {/* ── Precios y margen ──
          Mover el porcentaje y ver el precio que sale ANTES de aplicarlo es la
          diferencia entre elegir un margen y adivinarlo. El cálculo lo hace el
          servidor porque no es una división: entra el envío del proveedor, el
          redondeo psicológico y el margen mínimo pactado con él. */}
      <section className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('productos.precios_y_margen')}</h3>
          <button
            type="button"
            className="btn btn-secundario text-xs"
            disabled={refrescarProveedor.isPending}
            onClick={() => refrescarProveedor.mutate()}
          >
            {refrescarProveedor.isPending
              ? t('productos.consultando')
              : t('productos.actualizar_coste')}
          </button>
        </div>

        {refrescarProveedor.error && (
          <p className="texto-error mt-2">{refrescarProveedor.error.message}</p>
        )}

        <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--fondo-sutil)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex flex-1 items-center gap-3" style={{ minWidth: 260 }}>
              <span className="text-xs font-medium whitespace-nowrap">
                {t('productos.margen_objetivo')}
              </span>
              <input
                type="range"
                min={0}
                max={90}
                step={1}
                value={margenObjetivo}
                onChange={(e) => setMargenObjetivo(Number(e.target.value))}
                className="rango"
              />
            </label>
            <output className="cifra w-14 text-right text-sm font-semibold">
              {margenObjetivo}%
            </output>
            <button
              type="button"
              className="btn btn-primario text-xs"
              disabled={aplicarMargen.isPending || simulacion.isLoading}
              onClick={() => aplicarMargen.mutate()}
            >
              {t('productos.aplicar_margen')}
            </button>
          </div>

          {/* La previsualización: qué pasaría con cada variante. */}
          {simulacion.data && (
            <ul className="mt-3 space-y-1 text-xs">
              {simulacion.data.variantes.map((x) => (
                <li key={x.variantId} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{x.sku}</span>
                  <span style={{ color: 'var(--texto-tenue)' }}>
                    {t('productos.compra_a')} {precio(x.costeCents + x.envioCents)}
                  </span>
                  <span aria-hidden="true" style={{ color: 'var(--texto-tenue)' }}>
                    →
                  </span>
                  <span className="cifra font-medium">
                    {precio(x.precioAntes)} → {precio(x.precioNuevo)}
                  </span>
                  {x.aviso && <span style={{ color: 'var(--aviso)' }}>{x.aviso}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('productos.variantes')}</h3>

        <div className="space-y-3">
          {p.variants.map((v) => {
            /*
             * El margen se mide contra el coste REAL de comprarlo: lo que
             * cuesta en el proveedor MÁS lo que cobra de envío. El `costCents`
             * de la variante es una copia nuestra que puede haberse quedado
             * atrás y que no incluye el porte, así que solo se usa cuando no
             * hay proveedor detrás.
             */
            const delProveedor =
              p.proveedores?.find((x) => x.variantId === v.id) ?? p.proveedores?.[0];
            const costeReal = delProveedor?.costeTotalCents ?? v.costCents ?? 0;
            const margen =
              costeReal > 0 && v.priceCents > 0
                ? Math.round(((v.priceCents - costeReal) / v.priceCents) * 100)
                : null;

            return (
              <div
                key={v.id}
                className="rounded-lg border p-3"
                style={{ borderColor: 'var(--borde)' }}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  {/* La foto de la variante, para poder comprobar de un vistazo
                      que cada color tiene la suya y no la del primero. */}
                  {v.media?.[0] ? (
                    <img
                      src={v.media[0].url}
                      alt=""
                      loading="lazy"
                      className="h-9 w-9 flex-none rounded object-cover"
                      style={{ border: '1px solid var(--borde)' }}
                    />
                  ) : (
                    <span
                      className="h-9 w-9 flex-none rounded"
                      style={{ background: 'var(--fondo-sutil)' }}
                      title={t('productos.variante_sin_foto')}
                    />
                  )}
                  <span className="font-mono text-xs">{v.sku}</span>
                  <span className="flex flex-wrap items-center gap-3 text-xs">
                    {delProveedor && (
                      <span className="tabular-nums" style={{ color: 'var(--texto-tenue)' }}>
                        {t('productos.compra_a')} {precio(delProveedor.costCents)}
                        {delProveedor.shippingCents > 0 && (
                          <>
                            {' '}
                            + {precio(delProveedor.shippingCents)} {t('productos.de_envio')}
                          </>
                        )}
                      </span>
                    )}
                    {margen !== null && (
                      <span
                        className="tabular-nums"
                        style={{
                          color:
                            margen < 15
                              ? 'var(--error)'
                              : margen < 25
                                ? 'var(--aviso)'
                                : 'var(--texto-tenue)',
                        }}
                      >
                        {t('pedidos.margen')} {margen}%
                      </span>
                    )}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium">{t('productos.precio')}</span>
                    <input
                      key={`precio-${v.id}-${v.priceCents}`}
                      type="text"
                      inputMode="decimal"
                      defaultValue={aEuros(v.priceCents)}
                      onBlur={(e) =>
                        alSalirDeImporte(
                          e.target,
                          v.priceCents,
                          (cents) => {
                            if (cents !== null) {
                              guardarVariante.mutate({
                                id: v.id,
                                cambios: { priceCents: cents },
                              });
                            }
                          },
                          false,
                        )
                      }
                      className="campo tabular-nums"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs font-medium">
                      {t('productos.precio_tachado')}
                    </span>
                    <input
                      key={`tachado-${v.id}-${v.compareAtGuardadoCents ?? ''}`}
                      type="text"
                      inputMode="decimal"
                      defaultValue={aEuros(v.compareAtGuardadoCents)}
                      onBlur={(e) =>
                        alSalirDeImporte(
                          e.target,
                          v.compareAtGuardadoCents,
                          (cents) =>
                            guardarVariante.mutate({
                              id: v.id,
                              cambios: { compareAtCents: cents },
                            }),
                          true,
                        )
                      }
                      className="campo tabular-nums"
                    />
                    {/*
                     * Qué va en este campo, dicho junto al campo.
                     *
                     * Es el precio de ANTES del descuento, y tiene que ser mayor
                     * que el de venta. Sin decirlo aquí, lo natural es escribir
                     * el precio ya rebajado —«un 20 % menos»— y entonces la API
                     * lo rechaza con razón, pero el aviso salía arriba del
                     * formulario, a pantalla y media de distancia del campo que
                     * lo ha provocado. Parecía que no guardaba.
                     */}
                    <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
                      {t('productos.precio_tachado_ayuda')}
                    </span>

                    {/*
                     * Guardado pero sin anunciar: hay que decirlo.
                     *
                     * La directiva Ómnibus obliga a que el precio tachado sea el
                     * mínimo de los últimos 30 días, así que la tienda puede
                     * estar sin anunciar ningún descuento aunque aquí haya un
                     * importe guardado —por ejemplo después de bajar el precio
                     * varias veces el mismo día—. Sin este aviso, el campo con un
                     * número dentro y la tienda sin tachar nada se contradicen y
                     * no hay forma de entender por qué.
                     */}
                    {v.compareAtGuardadoCents !== null && v.compareAtCents === null && (
                      <span
                        className="mt-1 block text-xs"
                        style={{ color: 'var(--aviso)' }}
                        role="status"
                      >
                        {t('productos.precio_tachado_sin_anunciar')}
                      </span>
                    )}
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs font-medium">{t('productos.coste')}</span>
                    <input
                      key={`coste-${v.id}-${v.costCents ?? ''}`}
                      type="text"
                      inputMode="decimal"
                      defaultValue={aEuros(v.costCents)}
                      onBlur={(e) =>
                        alSalirDeImporte(
                          e.target,
                          v.costCents,
                          (cents) =>
                            guardarVariante.mutate({ id: v.id, cambios: { costCents: cents } }),
                          true,
                        )
                      }
                      className="campo tabular-nums"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs font-medium">{t('productos.stock')}</span>
                    <input
                      key={`stock-${v.id}-${v.stock}`}
                      type="number"
                      min={0}
                      defaultValue={v.stock}
                      onBlur={(e) => {
                        const stock = Number(e.target.value);
                        if (Number.isInteger(stock) && stock >= 0 && stock !== v.stock) {
                          ajustarStock.mutate({ id: v.id, stock });
                        } else {
                          e.target.value = String(v.stock);
                        }
                      }}
                      className="campo tabular-nums"
                    />
                  </label>
                </div>

                <p className="mt-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {t('productos.precio_final')} {precio(v.priceCents)} ·{' '}
                  {t('productos.iva_incluido', { tipo: Number(p.taxRate) })}
                </p>

                {/* ── Envío ──
                    El peso decide el tramo de porte; sin él, el cliente ve un
                    coste de envío aproximado que puede no ser el real. Las
                    medidas solo hacen falta cuando el transportista cobra por
                    volumen, así que van juntas y en segundo plano. */}
                <details className="mt-3">
                  <summary
                    className="cursor-pointer text-xs"
                    style={{ color: 'var(--texto-tenue)' }}
                  >
                    {t('productos.envio_de_la_variante')}
                  </summary>
                  <div className="mt-2 grid gap-3 sm:grid-cols-4">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium">
                        {t('productos.peso_gramos')}
                      </span>
                      <input
                        key={`peso-${v.id}-${v.weightGrams ?? ''}`}
                        type="number"
                        min={0}
                        defaultValue={v.weightGrams ?? ''}
                        onBlur={(e) => {
                          const valor = e.target.value.trim();
                          const gramos = valor === '' ? null : Number(valor);
                          if (gramos !== v.weightGrams && (gramos === null || gramos >= 0)) {
                            guardarVariante.mutate({ id: v.id, cambios: { weightGrams: gramos } });
                          }
                        }}
                        className="campo tabular-nums"
                      />
                    </label>

                    {(
                      [
                        ['lengthMm', 'productos.largo_mm'],
                        ['widthMm', 'productos.ancho_mm'],
                        ['heightMm', 'productos.alto_mm'],
                      ] as const
                    ).map(([campo, clave]) => (
                      <label key={campo} className="block">
                        <span className="mb-1 block text-xs font-medium">{t(clave)}</span>
                        <input
                          key={`${campo}-${v.id}-${v[campo] ?? ''}`}
                          type="number"
                          min={0}
                          defaultValue={v[campo] ?? ''}
                          onBlur={(e) => {
                            const valor = e.target.value.trim();
                            const mm = valor === '' ? null : Number(valor);
                            if (mm !== v[campo] && (mm === null || mm >= 0)) {
                              guardarVariante.mutate({ id: v.id, cambios: { [campo]: mm } });
                            }
                          }}
                          className="campo tabular-nums"
                        />
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
