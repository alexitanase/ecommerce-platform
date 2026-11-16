import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, getPathname } from '@/i18n/routing';
import { opcionesDelVisitante } from '@/lib/visitante';
import { api, ErrorApi } from '@/lib/api';
import { alternativasDeContenido, urlAbsoluta } from '@/lib/sitio';
import { tarjetaDeEnlace } from '@/lib/tarjeta-enlace';
import { SelectorVariante } from '@/components/selector-variante';
import { GaleriaProducto } from '@/components/galeria-producto';
import { PrecioProducto } from '@/components/precio-producto';
import { ProveedorVarianteActiva } from '@/components/variante-activa';
import { fechasDeEntrega, nombreDePais, rangoEscrito } from '@/lib/entrega';
import { nombreVariante, variantePreseleccionada } from '@/lib/variantes';
import { ResenasProducto } from '@/components/resenas-producto';
import { ProductosRelacionados } from '@/components/productos-relacionados';
import { GarantiasCompra } from '@/components/garantias-compra';
import { CompartirProducto } from '@/components/compartir-producto';
import { PuertaEdad } from '@/components/puerta-edad';
import { BotonDeseo } from '@/components/boton-deseo';
import { RegistrarVisto } from '@/components/registrar-visto';
import { VistosRecientemente } from '@/components/vistos-recientemente';
import { Pagina } from '@/components/ui/pagina';

interface Traduccion {
  locale: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

interface ValorOpcion {
  id: string;
  value: string;
  labels: Record<string, string> | null;
  hexColor: string | null;
}

/**
 * Lo justo para la tarjeta de un enlace compartido.
 *
 * Viene de un extremo aparte que no comprueba la edad: la ficha completa
 * responde 403 a quien no la ha verificado, y el robot de WhatsApp no verifica
 * nada. Trae solo esto —ni precio, ni stock— porque es lo único que acaba
 * dentro de la tarjeta.
 */
interface VistaPrevia {
  name: string;
  descripcion: string | null;
  imagen: { url: string; width: number | null; height: number | null; alt: string } | null;
}

/** Plazo de entrega que calcula la API para cada variante. */
interface Entrega {
  minDias: number;
  maxDias: number;
  /** `true` si el plazo lo hemos estimado por el país, no lo da el proveedor. */
  estimado: boolean;
  pais: string | null;
  origen: string | null;
}

export interface Producto {
  id: string;
  handle: string;
  status: string;
  isAdult: boolean;
  taxRate: string;
  translations: Traduccion[];
  media: {
    id: string;
    url: string;
    alt: Record<string, string> | null;
    blurhash: string | null;
    /** Medidas reales del fichero. Las pide la vista previa del enlace. */
    width: number | null;
    height: number | null;
  }[];
  options: {
    id: string;
    key: string;
    /** La opción «Envíos desde», que la API marca para no adivinarla aquí. */
    esEnvio: boolean;
    translations: { locale: string; name: string }[];
    values: ValorOpcion[];
  }[];
  variants: {
    id: string;
    sku: string;
    priceCents: number;
    compareAtCents: number | null;
    descuentoPorcentaje: number | null;
    stock: number;
    allowBackorder: boolean;
    optionValues: { optionValue: ValorOpcion }[];
    /** Fotos propias de la variante. El proveedor asigna una a cada color. */
    media: { id: string; url: string }[];
    /** `null` si el producto no viene de proveedor y no dice de dónde sale. */
    entrega: Entrega | null;
  }[];
  category: { translations: { locale: string; name: string; slug: string }[] } | null;
  /** El fabricante. La API solo la manda si la marca está activa. */
  brand: { handle: string; name: string; logoUrl: string | null } | null;
}

/** 10 minutos: el stock cambia con la sincronización del proveedor. */
export const revalidate = 600;

type Resultado =
  { tipo: 'ok'; producto: Producto } | { tipo: 'no-existe' } | { tipo: 'edad-no-verificada' };

async function cargar(slug: string, locale: string): Promise<Resultado> {
  // Las cookies del visitante se reenvían a mano: en un componente de servidor
  // no hay navegador que las adjunte, y sin ellas la API no sabe que este
  // visitante ya verificó su edad.
  const visitante = await opcionesDelVisitante();

  try {
    const producto = await api<Producto>(`/catalog/products/by-slug/${locale}/${slug}`, {
      // Sin caché compartida cuando hay cookies: la respuesta depende de quién
      // pregunta, y una copia cacheada se le serviría a otra persona.
      ...(visitante ?? { revalidar: 600 }),
      etiquetas: ['catalogo', `producto-${slug}`],
    });
    return { tipo: 'ok', producto };
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 403) {
      return { tipo: 'edad-no-verificada' };
    }
    if (error instanceof ErrorApi && error.status === 404) return { tipo: 'no-existe' };
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const resultado = await cargar(slug, locale);

  if (resultado.tipo === 'no-existe') {
    return { title: 'No disponible', robots: { index: false, follow: false } };
  }

  /*
   * La ficha restringida sí tiene tarjeta de enlace, y no se indexa.
   *
   * Son dos cosas distintas que antes iban juntas. Un producto +18 no debe
   * salir en Google —de ahí el `noindex`, que además es lo que ya hace el
   * sitemap—, pero cuando un cliente le pasa el enlace a otro por WhatsApp, la
   * tarjeta tiene que decir qué es y enseñar la foto: eso no lo decide un
   * buscador, lo decide quien comparte. Y los robots de vista previa ignoran
   * `robots`, así que las dos cosas conviven sin contradecirse.
   *
   * Los datos salen de un extremo aparte que devuelve solo nombre, texto y foto
   * y no comprueba la edad, porque la ficha completa responde 403 a quien no la
   * ha verificado y ningún robot la verifica nunca. Si tampoco responde, se
   * cae al título genérico de antes: una tarjeta pobre es mejor que un error.
   */
  if (resultado.tipo === 'edad-no-verificada') {
    const vista = await api<VistaPrevia>(
      `/catalog/products/preview/${locale}/${encodeURIComponent(slug)}`,
      { revalidar: 3600, etiquetas: ['catalogo', `producto-${slug}`] },
    ).catch(() => null);

    if (!vista) return { title: 'No disponible', robots: { index: false, follow: false } };

    return {
      title: vista.name,
      description: vista.descripcion ?? undefined,
      robots: { index: false, follow: false },
      ...tarjetaDeEnlace({
        titulo: vista.name,
        descripcion: vista.descripcion,
        ruta: `/${locale}/producto/${slug}`,
        imagen: vista.imagen,
      }),
    };
  }

  const producto = resultado.producto;

  const t = producto.translations.find((x) => x.locale === locale) ?? producto.translations[0];
  const foto = producto.media[0];

  return {
    title: t?.metaTitle ?? t?.name,
    description: t?.metaDescription ?? t?.shortDescription ?? undefined,
    /*
     * El buscador necesita saber que esta ficha existe en tres idiomas y cuál
     * es la canónica de cada uno, o las tratará como contenido duplicado.
     *
     * En ABSOLUTO. Estaban saliendo en relativo —`/es/producto/...`— y Google
     * ignora los hreflang relativos: la ficha tenía sus tres versiones bien
     * declaradas y no le constaban a nadie.
     */
    alternates: await alternativasDeContenido(
      Object.fromEntries(
        producto.translations.map((tr) => [tr.locale, `/${tr.locale}/producto/${tr.slug}`]),
      ),
      locale,
    ),
    /*
     * La tarjeta que sale al pegar el enlace en un chat.
     *
     * Antes había un `openGraph` a medias: título, texto y la foto sin sus
     * medidas ni `og:url`. Sin las medidas, WhatsApp descarta la imagen y X la
     * enseña como una miniatura cuadrada; sin `twitter:card` no hay foto grande
     * en ningún sitio. El nombre del producto va sin la coletilla de la marca
     * —el `template` del layout la añade al `<title>`— porque la aplicación ya
     * enseña el nombre de la tienda debajo, y repetirlo se come el ancho.
     */
    ...tarjetaDeEnlace({
      titulo: t?.name ?? producto.handle,
      descripcion: t?.metaDescription ?? t?.shortDescription,
      ruta: `/${locale}/producto/${t?.slug ?? slug}`,
      imagen: foto
        ? {
            url: foto.url,
            width: foto.width,
            height: foto.height,
            alt: foto.alt?.[locale] ?? t?.name,
          }
        : null,
    }),
  };
}

export default async function PaginaProducto({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const [resultado, t] = await Promise.all([cargar(slug, locale), getTranslations('producto')]);

  if (resultado.tipo === 'no-existe') notFound();

  // La puerta se enseña porque el SERVIDOR ha dicho que hace falta verificar,
  // no porque la tienda lo haya decidido. Aquí no hay nada que saltarse: sin
  // la cookie que pone la API, el contenido del producto ni siquiera ha
  // llegado a este proceso.
  if (resultado.tipo === 'edad-no-verificada') return <PuertaEdad />;

  const producto = resultado.producto;

  const traduccion =
    producto.translations.find((x) => x.locale === locale) ?? producto.translations[0];

  const precios = producto.variants.map((v) => v.priceCents);
  const desde = precios.length > 0 ? Math.min(...precios) : 0;
  const hasta = precios.length > 0 ? Math.max(...precios) : 0;
  const stockTotal = producto.variants.reduce((a, v) => a + v.stock, 0);
  const categoria = producto.category?.translations.find((c) => c.locale === locale);

  /*
   * El resumen de valoraciones, para las estrellas de los datos estructurados.
   *
   * Es la misma llamada que hace el bloque de reseñas más abajo, y con el mismo
   * `revalidar`: Next deduplica las peticiones idénticas dentro de un render,
   * así que pedirla aquí no añade ni un viaje a la API.
   *
   * Si falla, no hay estrellas y ya está: una ficha sin `aggregateRating` sale
   * perfectamente en Google, y un `aggregateRating` inventado es motivo de
   * penalización manual.
   */
  const resumenResenas = await api<{ media: number; total: number }>(
    `/reviews/product/${producto.id}/summary`,
    { revalidar: 600 },
  ).catch(() => null);

  /*
   * La variante con la que se abre la ficha, decidida AQUÍ.
   *
   * El selector aplica la misma regla en el navegador. Si el servidor no la
   * aplicara también, el primer pintado enseñaría el precio más bajo del
   * producto y al hidratarse saltaría al de la variante preseleccionada: en este
   * catálogo, de 18,99 € a 54,99 € delante del cliente.
   */
  const inicial = variantePreseleccionada(producto.variants);
  const varianteInicial = inicial
    ? {
        id: inicial.id,
        nombre: nombreVariante(inicial, producto.options, locale),
        precioCents: inicial.priceCents,
        compareAtCents: inicial.compareAtCents,
        descuentoPorcentaje: inicial.descuentoPorcentaje,
        fotoUrl: inicial.media[0]?.url ?? null,
      }
    : null;

  /*
   * Las fechas de entrega, escritas en el servidor y una sola vez.
   *
   * Un único `ahora` para todas las variantes: con una llamada al reloj por
   * variante, una ficha abierta a las 23:59:59 podría anunciar plazos de dos
   * días distintos en la misma pantalla.
   */
  const ahora = new Date();
  const entregas = Object.fromEntries(
    producto.variants.flatMap((v) => {
      // Sin plazo no se escribe nada: la API devuelve `null` cuando no hay de
      // dónde deducirlo, y en ese caso la ficha no promete ninguna fecha.
      if (!v.entrega) return [];

      const { desde: d, hasta: h } = fechasDeEntrega(v.entrega.minDias, v.entrega.maxDias, ahora);
      return [
        [
          v.id,
          {
            ...rangoEscrito(d, h, locale),
            // El nombre traducido del país si lo conocemos y, si no, lo que dijo
            // el proveedor: «China Mainland» informa y un hueco vacío no.
            origen: nombreDePais(v.entrega.pais, locale) ?? v.entrega.origen,
            estimado: v.entrega.estimado,
            maxDias: v.entrega.maxDias,
          },
        ],
      ];
    }),
  );

  const urlFicha = urlAbsoluta(`/${locale}/producto/${traduccion?.slug ?? slug}`);

  /**
   * Datos estructurados para el buscador.
   *
   * Sin esto la ficha aparece como un resultado de texto plano; con esto Google
   * muestra precio, disponibilidad y estrellas directamente en los resultados,
   * lo que cambia mucho la tasa de clic.
   *
   * Lo que faltaba y ahora está:
   *
   *  · **`aggregateRating`.** Es lo que pinta las estrellas, que es justo lo
   *    que este comentario llevaba prometiendo desde el principio. El dato ya
   *    existía —la propia ficha lo enseña más abajo— y no llegaba aquí.
   *  · **`brand`**, que Google usa para casar la ficha con la marca.
   *  · **`url` e `itemCondition`**, que son campos recomendados y baratos.
   *  · Y las **imágenes sin repetir**: se concatenaban las del producto con las
   *    de cada variante, así que un producto de cuatro colores anunciaba nueve
   *    imágenes que eran dos.
   */
  const datosEstructurados = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${urlFicha}#producto`,
    name: traduccion?.name,
    description: traduccion?.shortDescription ?? traduccion?.description ?? undefined,
    // `Set` para no repetir: la lista salía con la misma URL nueve veces.
    image: [...new Set(producto.media.map((m) => m.url))],
    sku: producto.variants[0]?.sku,
    url: urlFicha,
    ...(producto.brand ? { brand: { '@type': 'Brand', name: producto.brand.name } } : {}),
    ...(resumenResenas && resumenResenas.total > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: resumenResenas.media,
            reviewCount: resumenResenas.total,
          },
        }
      : {}),
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'EUR',
      lowPrice: (desde / 100).toFixed(2),
      highPrice: (Math.max(...precios) / 100).toFixed(2),
      offerCount: producto.variants.length,
      availability: stockTotal > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      url: urlFicha,
    },
  };

  /**
   * Las migas, para el buscador.
   *
   * Es lo que hace que en el resultado salga «Tienda › Vibradores › Producto»
   * en lugar de la URL cruda, y lo que le dice a Google de qué categoría cuelga
   * cada ficha. Solo se declara cuando la categoría existe: una miga de un solo
   * escalón no aporta nada y Google la descarta.
   */
  const migas = categoria
    ? {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: categoria.name,
            item: urlAbsoluta(
              `${getPathname({ href: '/buscar', locale })}?categoria=${encodeURIComponent(categoria.slug)}`,
            ),
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: traduccion?.name,
            item: urlFicha,
          },
        ],
      }
    : null;

  return (
    <Pagina className="ficha-producto">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datosEstructurados) }}
      />
      {migas && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(migas) }}
        />
      )}

      {/*
       * Las migas, fuera del móvil.
       *
       * Son 40 px con su margen, justo encima de la foto y en la pantalla donde
       * menos sitio hay. En un teléfono no se navega por ellas —se vuelve con
       * el gesto de atrás— y lo que empujaban fuera de la pantalla era el
       * precio, que es la mitad de la decisión de comprar.
       */}
      {categoria && (
        <nav
          aria-label="Migas de pan"
          className="mb-5 hidden text-sm text-[var(--texto-tenue)] sm:block"
        >
          {/* Enlace, no texto suelto. Era un `<span>`: ni el cliente podía
              subir a la categoría desde la ficha, ni el rastreador tenía por
              dónde bajar de la categoría a sus productos, que es como se
              reparte la fuerza de enlazado dentro de una tienda. */}
          <Link
            href={`/buscar?categoria=${categoria.slug}` as never}
            className="underline-offset-4 hover:text-[var(--texto)] hover:underline"
          >
            {categoria.name}
          </Link>
        </nav>
      )}

      {/*
       * Galería y selector comparten la foto de la variante elegida.
       *
       * El proveedor va FUERA de la rejilla: dentro sería una celda más y las
       * dos columnas se convertirían en una. Sus hijos siguen pintándose en el
       * servidor; lo único de cliente es el contexto.
       */}
      <ProveedorVarianteActiva inicial={varianteInicial}>
        {/*
         * `grid-cols-1` explícito, que parece redundante y no lo es.
         *
         * Sin ninguna clase de columnas, la pista implícita se dimensiona por el
         * contenido; con esta, Tailwind la declara `minmax(0, 1fr)` y ya no puede
         * crecer más que el contenedor.
         *
         * Lo que lo destapó en producción: las imágenes que vienen dentro de la
         * descripción del proveedor llevan un `width` fijo de 496 px. El
         * `max-width: 100%` que tienen aplicado NO limita lo que una imagen aporta
         * al ancho mínimo —un porcentaje no se puede resolver mientras se calcula
         * ese mínimo—, así que la columna crecía a 496 px dentro de un móvil de
         * 375 y arrastraba la página entera.
         */}
        <div className="grid grid-cols-1 gap-5 sm:gap-8 lg:grid-cols-2">
          <GaleriaProducto
            imagenes={producto.media}
            nombre={traduccion?.name ?? ''}
            locale={locale}
          />

          {/*
           * `min-w-0` no es opcional aquí.
           *
           * Una celda de rejilla mide por defecto lo que su contenido más ancho, y
           * este contenido lo escribe un tercero. Con una cadena que no se puede
           * partir —un enlace largo, una palabra compuesta, o el HTML de una
           * descripción del proveedor volcado como texto— la columna crecía hasta
           * caber toda: medido en producción, 496 px dentro de un móvil de 375, y
           * la página entera se desplazaba de lado.
           *
           * Con esto la columna puede encogerse y `break-words` permite partir la
           * cadena. Los dos hacen falta: sin el primero no hay dónde encoger, sin
           * el segundo no hay por dónde partir.
           */}
          <div className="min-w-0">
            {/*
             * La marca, encima del nombre y en pequeño.
             *
             * Discreta a propósito: quien compra un SATISFYER ya sabe qué marca
             * es y lo que quiere leer es el modelo. Puesta aquí hace dos cosas
             * a la vez —da confianza y ordena la jerarquía visual— sin robarle
             * sitio a lo que decide la compra, que es el nombre y el precio.
             *
             * Solo sale si la marca tiene logotipo o nombre; una marca vacía no
             * pinta un hueco.
             */}
            {producto.brand && (
              /*
               * La marca lleva a sus productos.
               *
               * Era texto suelto. Quien reconoce la marca y quiere ver qué más
               * tiene —que en cosmética y juguetería es de lo más común— no
               * tenía por dónde: había que volver al catálogo y encontrar el
               * filtro de marca en la barra lateral. Se filtra por nombre, que
               * es lo que el buscador tiene indexado.
               */
              <Link
                href={`/buscar?marca=${encodeURIComponent(producto.brand.name)}` as never}
                className="mb-2 flex w-fit items-center gap-2 transition-opacity hover:opacity-70"
                data-prueba="marca-producto"
              >
                {producto.brand.logoUrl ? (
                  <Image
                    src={producto.brand.logoUrl}
                    alt={producto.brand.name}
                    width={72}
                    height={28}
                    // `contain` y alto fijo: los logotipos vienen con
                    // proporciones muy distintas y recortarlos los deja
                    // irreconocibles, que es peor que no ponerlos.
                    className="h-6 w-auto max-w-[96px] object-contain opacity-80"
                  />
                ) : (
                  <span className="text-xs font-medium uppercase tracking-wide text-[var(--texto-tenue)] underline-offset-4 hover:underline">
                    {producto.brand.name}
                  </span>
                )}
              </Link>
            )}

            <h1 className="text-2xl font-semibold tracking-tight text-balance break-words sm:text-3xl">
              {traduccion?.name}
            </h1>

            {/*
              El precio va inmediatamente debajo del nombre.
              La descripción corta estaba en medio y costaba 60 px —dos líneas
              más su margen—: con un título de dos líneas, en un móvil de 667
              el precio caía en el píxel 691 y no se veía sin desplazar. Es
              además el orden de cualquier tienda: qué es y cuánto cuesta
              juntos, y el detalle después.
            */}
            <div className="mt-4 flex items-start justify-between gap-4 sm:mt-6">
              {/* El precio sigue a la variante elegida, así que lo pinta un
                componente de cliente. El importe del primer render lo pone el
                servidor por el contexto. */}
              <PrecioProducto desdeCents={desde} hastaCents={hasta} locale={locale} />

              <BotonDeseo
                productId={producto.id}
                className="border"
                // Con borde aquí y sin él en las tarjetas: en la ficha va sobre
                // el fondo de la página, no sobre una foto.
              />
            </div>

            {traduccion?.shortDescription && (
              <p className="mt-4 break-words text-[var(--texto-suave)]">
                {traduccion.shortDescription}
              </p>
            )}

            {/* La selección de variante y el añadir al carrito son interactivos:
              van en un componente de cliente aparte para no convertir toda la
              ficha en cliente y perder el renderizado en servidor. */}
            <SelectorVariante
              producto={producto}
              locale={locale}
              entregas={entregas}
              entregaPredeterminada={(varianteInicial && entregas[varianteInicial.id]) ?? null}
            />

            {/* Envío, devoluciones y pago seguro. Debajo del botón porque es
                donde aparecen las dudas que frenan la compra, y hasta ahora
                había que ir a buscarlas al pie o a las condiciones de venta. */}
            <GarantiasCompra locale={locale} />

            {/* Compartir va DESPUÉS de comprar y de las garantías, no al lado
                del precio: quien acaba de llegar tiene que decidir si lo
                compra, no a quién se lo manda. Se le ofrece cuando ya ha
                pasado por el botón. La URL es la canónica que calcula el
                servidor, no la de la barra: así lo que se comparte no lleva
                dentro los parámetros de la campaña por la que llegó. */}
            <CompartirProducto url={urlFicha} titulo={traduccion?.name ?? producto.handle} />

            {traduccion?.description && (
              <section className="mt-10">
                <h2 className="titulo-ficha">{t('descripcion')}</h2>
                {/*
                 * La descripción se pinta como HTML porque lo es: del proveedor
                 * llegan listas de características y tablas de medidas, y como
                 * texto plano se leían las etiquetas —«<p>Auriculares…»— en medio
                 * de la ficha.
                 *
                 * El HTML viene YA SANEADO de la base de datos: la API lo limpia al
                 * guardarlo, tanto al importar del proveedor como al editarlo en el
                 * panel, con una lista corta de etiquetas permitidas. Es la razón
                 * por la que aquí se puede inyectar sin volver a mirarlo; si algún
                 * día se guardara sin sanear, esta línea sería un XSS.
                 */}
                <div
                  className="contenido-ficha"
                  dangerouslySetInnerHTML={{ __html: traduccion.description }}
                />
              </section>
            )}
          </div>
        </div>
      </ProveedorVarianteActiva>

      {/* Después de la descripción y antes de las valoraciones: quien ha
          llegado al final del texto o ya ha decidido comprar, o ha decidido
          que este no es. En el segundo caso, la alternativa es lo único que
          evita que cierre la pestaña. */}
      <ProductosRelacionados productId={producto.id} locale={locale} />

      <ResenasProducto productId={producto.id} locale={locale} />

      {/* Se anota que ha visto esta ficha, en su navegador y en ningún sitio
          más, y se le enseña por dónde iba comparando. */}
      <RegistrarVisto
        producto={{
          id: producto.id,
          slug: traduccion?.slug ?? producto.handle,
          nombre: traduccion?.name ?? producto.handle,
          imagen: producto.media[0]?.url ?? null,
          precioCents: desde,
        }}
      />
      <VistosRecientemente locale={locale} excluir={producto.id} />
    </Pagina>
  );
}
