'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import type { Producto } from '@/app/[locale]/producto/[slug]/page';
import { useVarianteActiva, type VarianteElegida } from './variante-activa';
import { Icono } from './ui/icono';
import { BloqueEntrega, type TextoEntrega } from './bloque-entrega';
import { useCarrito } from '@/lib/carrito';
import { anadirAlCarrito, verProducto } from '@/lib/analitica';
import {
  etiquetaValor,
  fotosPorValor,
  nombreVariante,
  precioPorValor,
  valoresPorPrecio,
  variantePreseleccionada,
} from '@/lib/variantes';
import { useExperimento } from '@/lib/use-experimentos';
import { usePrecio } from './proveedor-divisa';

/**
 * Selección de variante y añadir al carrito.
 *
 * La combinación de opciones (color × talla) determina la variante concreta.
 * Se deshabilitan las combinaciones que no existen en lugar de dejar que el
 * cliente las elija y descubra después que no hay: es la diferencia entre una
 * ficha que guía y una que frustra.
 *
 * Cada valor se enseña con su foto cuando el proveedor le ha asignado una: en un
 * producto de once colores, once nombres de texto obligan a elegir a ciegas.
 * Cuál es la opción que lleva las fotos lo decide `fotosPorValor`, que no se fía
 * del nombre de la opción.
 */
export function SelectorVariante({
  producto,
  locale,
  entregas,
  entregaPredeterminada,
}: {
  producto: Producto;
  locale: string;
  /** Texto de entrega por variante, ya escrito en el servidor. */
  entregas: Record<string, TextoEntrega>;
  entregaPredeterminada: TextoEntrega | null;
}) {
  // Los precios se enseñan en la divisa que haya elegido el visitante. El
  // importe sigue siendo el mismo en euros: esto solo convierte para mostrar.
  const fmtPrecio = usePrecio(locale);

  const t = useTranslations('producto');
  const anadir = useCarrito((s) => s.anadir);
  /*
   * Si ya hay algo en el carrito, se ofrece ir a la caja.
   *
   * Se mira el carrito y no un `useState` local: quien vuelve a la ficha con
   * el carrito ya lleno también tiene que ver por dónde se termina, y con una
   * bandera local solo aparecería justo después de pulsar.
   */
  const hayEnCarrito = useCarrito((s) => s.lineas.length > 0);

  // Prueba A/B del texto del botón. Si no hay experimento activo —o la API no
  // responde— sale el texto traducido de siempre: la ficha nunca se queda sin
  // botón por una prueba.
  const textoBoton = useExperimento<string>('cta-producto', '');

  const [seleccion, setSeleccion] = useState<Record<string, string>>(() => {
    // La misma regla que usa el servidor para el precio inicial, o el precio
    // grande y el del botón no coincidirían en el primer pintado.
    const inicial = variantePreseleccionada(producto.variants);
    if (!inicial) return {};

    const elegido: Record<string, string> = {};
    for (const opcion of producto.options) {
      const valor = inicial.optionValues.find((ov) =>
        opcion.values.some((v) => v.id === ov.optionValue.id),
      );
      if (valor) elegido[opcion.key] = valor.optionValue.value;
    }
    return elegido;
  });

  const [cantidad, setCantidad] = useState(1);
  const [anadido, setAnadido] = useState(false);

  /** Variante que corresponde a la combinación elegida. */
  const variante = useMemo(() => {
    if (producto.options.length === 0) return producto.variants[0];

    return producto.variants.find((v) =>
      producto.options.every((opcion) => {
        const elegido = seleccion[opcion.key];
        if (!elegido) return false;
        return v.optionValues.some((ov) => ov.optionValue.value === elegido);
      }),
    );
  }, [producto, seleccion]);

  /** Qué valores llevan foto propia, y de qué opción. */
  const fotos = useMemo(
    () => fotosPorValor(producto.variants, producto.options),
    [producto.variants, producto.options],
  );

  /**
   * Lo que cuesta cada valor, para enseñarlos del más barato al más caro.
   *
   * El orden que trae el proveedor no significa nada —es el que tenía en su
   * ficha—, así que el cliente se encontraba el color de 54,99 € delante del de
   * 18,99 €. Ordenado por precio, lo primero que ve es la puerta de entrada al
   * producto, que además es el importe que anuncia la tarjeta del catálogo.
   */
  const precios = useMemo(() => precioPorValor(producto.variants), [producto.variants]);

  /*
   * Se publica la variante elegida para el resto de la ficha.
   *
   * De ella salen la foto de la galería, su rótulo y el precio grande. En un
   * efecto y no durante el render porque escribe en un estado que no es suyo:
   * hacerlo mientras se pinta es actualizar otro componente a mitad de render.
   *
   * El objeto está memorizado para que el efecto se dispare cuando cambia la
   * elección y no en cada render.
   */
  const { elegirVariante } = useVarianteActiva();

  const elegida = useMemo<VarianteElegida | null>(() => {
    if (!variante) return null;
    return {
      id: variante.id,
      nombre: nombreVariante(variante, producto.options, locale),
      precioCents: variante.priceCents,
      compareAtCents: variante.compareAtCents,
      descuentoPorcentaje: variante.descuentoPorcentaje ?? null,
      fotoUrl: variante.media[0]?.url ?? null,
    };
  }, [variante, producto.options, locale]);

  useEffect(() => {
    if (elegida) elegirVariante(elegida);
  }, [elegida, elegirVariante]);

  /** Valores que llevan a una variante existente, dado el resto de la selección. */
  const valoresPosibles = useMemo(() => {
    const mapa = new Map<string, Set<string>>();

    for (const opcion of producto.options) {
      const posibles = new Set<string>();

      for (const v of producto.variants) {
        // Se comprueba si la variante encaja con TODO lo seleccionado salvo
        // esta opción: eso dice qué valores siguen siendo alcanzables.
        const encajaResto = producto.options
          .filter((o) => o.key !== opcion.key)
          .every((o) => {
            const elegido = seleccion[o.key];
            return !elegido || v.optionValues.some((ov) => ov.optionValue.value === elegido);
          });

        if (!encajaResto) continue;

        for (const ov of v.optionValues) {
          if (opcion.values.some((val) => val.id === ov.optionValue.id)) {
            posibles.add(ov.optionValue.value);
          }
        }
      }

      mapa.set(opcion.key, posibles);
    }

    return mapa;
  }, [producto, seleccion]);

  const disponible = variante && (variante.stock > 0 || variante.allowBackorder);
  const stockBajo = variante && variante.stock > 0 && variante.stock <= 5;
  const traduccion =
    producto.translations.find((x) => x.locale === locale) ?? producto.translations[0];

  /**
   * La visita a la ficha se mide desde aquí y no desde la página.
   *
   * La página es un componente de servidor: allí no hay navegador, no hay
   * consentimiento que consultar y el evento no llegaría nunca. Este es el
   * primer punto del árbol que se ejecuta en el cliente.
   */
  useEffect(() => {
    if (!variante) return;

    verProducto({
      id: producto.id,
      nombre: traduccion?.name ?? producto.handle,
      precioCents: variante.priceCents,
    });
    // Solo al abrir la ficha: cambiar de talla no es una visita nueva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto.id]);

  const alAnadir = () => {
    if (!variante || !disponible) return;

    anadir(
      {
        variantId: variante.id,
        productId: producto.id,
        sku: variante.sku,
        nombre: traduccion?.name ?? variante.sku,
        variante: variante.optionValues.map((ov) => ov.optionValue.value).join(' / ') || null,
        // La foto de la variante y no la primera del producto: en el carrito se
        // revisa lo que se ha elegido, y ver otro color ahí parece un error.
        imagen: variante.media[0]?.url ?? producto.media[0]?.url ?? null,
        precioCents: variante.priceCents,
        stockDisponible: variante.stock,
        slug: traduccion?.slug ?? producto.handle,
      },
      cantidad,
    );

    // Después de añadir, no antes: si el carrito fallara, se habría medido una
    // intención de compra que no ocurrió.
    anadirAlCarrito({
      id: variante.id,
      nombre: traduccion?.name ?? variante.sku,
      precioCents: variante.priceCents,
      cantidad,
      ...(variante.optionValues.length > 0
        ? { variante: variante.optionValues.map((ov) => ov.optionValue.value).join(' / ') }
        : {}),
    });

    setAnadido(true);
    setTimeout(() => setAnadido(false), 2500);
  };

  return (
    <div className="mt-8 space-y-6">
      {producto.options.map((opcion) => {
        /*
         * De dónde se envía no es una opción que se elija por gusto, y con un
         * solo país no hay nada que elegir: se cuenta abajo, en el bloque de
         * entrega, donde sí informa. Si el proveedor ofrece varios orígenes se
         * dejan los botones, porque entonces cambia el precio y el plazo.
         */
        if (opcion.esEnvio && opcion.values.length <= 1) return null;

        const nombre = opcion.translations.find((x) => x.locale === locale)?.name ?? opcion.key;
        const posibles = valoresPosibles.get(opcion.key) ?? new Set();
        const elegidoAhora = opcion.values.find((v) => v.value === seleccion[opcion.key]);

        return (
          <fieldset key={opcion.id}>
            <legend className="mb-2 text-sm font-medium">
              {nombre}
              {elegidoAhora && (
                <span className="ml-2 font-normal text-[var(--texto-tenue)]">
                  {etiquetaValor(elegidoAhora, locale)}
                </span>
              )}
            </legend>

            <div className="flex flex-wrap gap-2">
              {valoresPorPrecio(opcion.values, precios).map((valor) => {
                const elegido = seleccion[opcion.key] === valor.value;
                const existe = posibles.has(valor.value);
                const etiqueta = etiquetaValor(valor, locale);
                const foto = fotos.get(valor.id);

                return (
                  <button
                    key={valor.id}
                    type="button"
                    disabled={!existe}
                    onClick={() => setSeleccion((s) => ({ ...s, [opcion.key]: valor.value }))}
                    aria-pressed={elegido}
                    className={[
                      'flex items-center gap-2 rounded-[--radius-button] border text-sm transition-all',
                      // Con foto el botón se ajusta a ella; sin foto conserva el
                      // relleno de siempre.
                      foto ? 'p-1 pr-3' : 'px-3 py-2',
                      elegido
                        ? 'border-[var(--marca-primario)] ring-2 ring-[color-mix(in_srgb,var(--marca-primario)_25%,transparent)]'
                        : 'border-[var(--borde-fuerte)] hover:border-[var(--texto-tenue)]',
                      // Tachado en lugar de oculto: el cliente ve que existe
                      // esa talla, solo que no en el color elegido.
                      !existe && 'cursor-not-allowed opacity-40',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {foto ? (
                      <span className="relative h-10 w-10 flex-none overflow-hidden rounded-[calc(var(--radius-button)-0.25rem)]">
                        {/*
                         * `sizes` igual que en las miniaturas de la galería a
                         * propósito: es la misma foto y así el optimizador
                         * reutiliza la copia que ya generó en lugar de crear
                         * otra de un ancho distinto.
                         */}
                        <Image src={foto} alt="" fill sizes="64px" className="object-cover" />
                      </span>
                    ) : (
                      valor.hexColor && (
                        <span
                          className="inline-block h-3 w-3 flex-none rounded-full border border-[var(--borde)]"
                          style={{ background: valor.hexColor }}
                          aria-hidden="true"
                        />
                      )
                    )}
                    <span className={!existe ? 'line-through' : undefined}>{etiqueta}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      {/* Cuándo llega y desde dónde: encima del botón de comprar, que es donde
          se decide. */}
      <BloqueEntrega entregas={entregas} predeterminada={entregaPredeterminada} />

      {variante && (
        <p className="text-sm">
          {disponible ? (
            stockBajo ? (
              <span style={{ color: 'var(--aviso)' }}>
                {t('ultimas_unidades', { cantidad: variante.stock })}
              </span>
            ) : (
              <span style={{ color: 'var(--exito)' }}>{t('en_stock')}</span>
            )
          ) : (
            <span className="text-[var(--texto-tenue)]">{t('sin_stock')}</span>
          )}
        </p>
      )}

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="solo-lectores">{t('cantidad')}</span>
          <select
            value={cantidad}
            onChange={(e) => setCantidad(Number(e.target.value))}
            className="campo h-11 w-20"
            disabled={!disponible}
          >
            {Array.from({ length: Math.min(variante?.stock ?? 1, 10) || 1 }, (_, i) => i + 1).map(
              (n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ),
            )}
          </select>
        </label>

        <button
          type="button"
          onClick={alAnadir}
          disabled={!disponible}
          className="btn btn-primario btn-grande min-w-0 flex-1 flex-wrap"
        >
          {anadido ? t('anadido') : textoBoton || t('anadir_carrito')}
          {variante && disponible && (
            <span className="opacity-80">· {fmtPrecio(variante.priceCents * cantidad)}</span>
          )}
        </button>
      </div>

      {/*
       * El camino a la caja, en cuanto hay algo en el carrito.
       *
       * Hasta ahora, añadir al carrito solo cambiaba el texto del botón durante
       * dos segundos y medio y dejaba al cliente donde estaba, sin decirle
       * cómo terminar. El que quería comprar tenía que buscar el icono del
       * carrito en la cabecera y entender que ahí seguía el proceso; el móvil,
       * donde ese icono mide 36 px en una esquina, es donde peor sienta.
       *
       * Se queda puesto —no desaparece con el «Añadido»— porque no es un aviso
       * de que la acción salió bien: es el siguiente paso. Y lleva al carrito y
       * no directo al pago: desde el carrito se puede seguir comprando, y
       * saltárselo obliga a volver atrás a quien quería añadir una cosa más.
       */}
      {hayEnCarrito && (
        <Link
          href="/carrito"
          className="btn btn-secundario btn-grande w-full"
          data-prueba="tramitar-pedido"
        >
          {t('tramitar_pedido')}
          <Icono nombre="flecha-derecha" tamano={18} />
        </Link>
      )}

      {!variante && producto.options.length > 0 && (
        <p className="text-sm" style={{ color: 'var(--aviso)' }}>
          {t('seleccion_requerida')}
        </p>
      )}
    </div>
  );
}
