import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPathname, routing } from '@/i18n/routing';
import { ajustesPublicos } from '@/lib/api';
import { estadoDivisa } from '@/lib/divisas';
import { SITIO, urlAbsoluta } from '@/lib/sitio';
import { colorSeguro, textoSobre } from '@/lib/contraste';
import { ProveedorTema } from '@/components/proveedor-tema';
import { ProveedorDivisa } from '@/components/proveedor-divisa';
import { Cabecera } from '@/components/cabecera';
import { SubBarra } from '@/components/sub-barra';
import { PieDePagina } from '@/components/pie';
import { AvisoCookies } from '@/components/aviso-cookies';
import { ScriptsAnalitica } from '@/components/scripts-analitica';
import { CapturarOrigen } from '@/components/capturar-origen';
import { RegistrarSW } from '@/components/registrar-sw';
import '@/styles/globals.css';

/**
 * Genera las tres versiones de idioma en tiempo de compilación.
 * Sin esto, la primera visita a /ca esperaría a que el servidor la renderice.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const ajustes = await ajustesPublicos();
  const marca = (ajustes['brand.name'] as string) ?? 'Tienda';

  const tagline = ajustes['brand.tagline'] as Record<string, string> | undefined;

  return {
    /*
     * Sin esto, TODO lo demás sale en relativo.
     *
     * Next resuelve contra `metadataBase` el canonical, los hreflang y las
     * imágenes de Open Graph. Al no estar declarada, el HTML salía con
     * `href="/es/producto/..."`: Google ignora los hreflang relativos, así que
     * la tienda tenía tres idiomas y ninguno se lo estaba diciendo al buscador.
     */
    metadataBase: new URL(SITIO),
    title: { default: marca, template: `%s · ${marca}` },
    description: tagline?.[locale] ?? '',
    /*
     * Aquí NO va ningún `alternates`, y es a propósito.
     *
     * Next fusiona los metadatos del layout con los de la página, y la página
     * solo pisa lo que declara. Poniendo el canonical de la portada aquí, toda
     * página que no declarase el suyo —el carrito, la lista de deseos, la
     * cuenta— saldría diciendo que es una copia de la portada. El canonical lo
     * pone cada página, y quien no lo pone es porque no quiere que se indexe.
     */
    icons: {
      icon: (ajustes['brand.favicon'] as string) ?? '/icono?tamano=192',
      apple: (ajustes['brand.favicon'] as string) ?? '/icono?tamano=192',
    },
    // El manifiesto se genera con la marca del panel, así que es una ruta y no
    // un fichero estático.
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      // iOS ignora el manifiesto para esto: sin `capable`, al añadir la tienda
      // a la pantalla de inicio se abre dentro de Safari con toda su barra.
      capable: true,
      title: marca,
      statusBarStyle: 'default',
    },
    openGraph: {
      siteName: marca,
      locale: locale === 'ca' ? 'ca_ES' : locale === 'en' ? 'en_GB' : 'es_ES',
      type: 'website',
    },
    robots: { index: true, follow: true },
  };
}

/** Origen (esquema + host) de una URL, o null si no lo es. */
function origenDe(valor: unknown): string | null {
  if (typeof valor !== 'string' || !valor.startsWith('http')) return null;
  try {
    return new URL(valor).origin;
  } catch {
    return null;
  }
}

/**
 * Barra del sistema del mismo color que el fondo de la tienda.
 *
 * Se declara aquí y no en `generateMetadata` porque el color depende del tema
 * que tenga puesto el visitante, no de la marca: con un solo valor, en tema
 * oscuro queda una franja blanca encima de una página negra.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0f17' },
  ],
};

export default async function LayoutRaiz({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Habilita el renderizado estático de las páginas hijas.
  setRequestLocale(locale);

  const [ajustes, t, divisa] = await Promise.all([
    ajustesPublicos(),
    getTranslations('nav'),
    estadoDivisa(),
  ]);

  const nombreMarca = (ajustes['brand.name'] as string) ?? 'Tienda';

  // Los colores de marca se inyectan como variables CSS: cambiarlos desde el
  // admin no requiere reconstruir la aplicación.
  // Filtrados antes de inyectarlos en el `<style>`: el valor viene de un campo
  // de texto del panel, y ahí dentro cualquier cosa que no sea un color es una
  // inyección de CSS —o de JavaScript, cerrando la etiqueta.
  const colorPrimario = colorSeguro(ajustes['brand.primaryColor'], '#4f46e5');
  const colorAcento = colorSeguro(ajustes['brand.accentColor'], '#7c3aed');

  // El origen de las imágenes se deduce del logo, que sale del mismo sitio que
  // las fotos de producto. Si no hay logo configurado no se precarga nada:
  // adivinar un dominio abriría una conexión inútil en cada visita.
  const origenMedios = origenDe(ajustes['brand.logoLight']);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/*
          Las fotos del catálogo salen de otro origen (MinIO o el CDN), y la
          primera es normalmente el elemento más grande de la portada. Abrir la
          conexión mientras el navegador todavía procesa el HTML adelanta el
          TLS y el DNS, que en móvil son fácilmente 200 ms del LCP.
        */}
        {origenMedios && (
          <>
            <link rel="preconnect" href={origenMedios} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={origenMedios} />
          </>
        )}
        <style
          dangerouslySetInnerHTML={{
            // El texto del botón principal se calcula, no se fija: con una
            // marca amarilla o lima, el blanco de siempre deja el botón
            // ilegible, y el color lo elige cada tienda desde el panel.
            __html:
              `:root{--marca-primario:${colorPrimario};--marca-acento:${colorAcento};` +
              `--marca-primario-contraste:${textoSobre(colorPrimario)}}`,
          }}
        />
      </head>
      <body>
        {/*
          Quiénes somos y dónde se busca, para el buscador.

          `Organization` es lo que permite que Google asocie la marca con su
          logo y sus redes —el panel de la derecha en los resultados—, y
          `WebSite` con `SearchAction` es lo que puede sacar una caja de
          búsqueda dentro del propio resultado. Los dos van en el layout porque
          describen el sitio entero, no una página: repetirlos en cada una sería
          decir tres veces lo mismo.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [
                {
                  '@type': 'Organization',
                  '@id': `${SITIO}/#organizacion`,
                  name: nombreMarca,
                  url: SITIO,
                  ...(ajustes['brand.logoLight']
                    ? { logo: ajustes['brand.logoLight'] as string }
                    : {}),
                },
                {
                  '@type': 'WebSite',
                  '@id': `${SITIO}/#sitio`,
                  name: nombreMarca,
                  url: urlAbsoluta(`/${locale}`),
                  inLanguage: locale,
                  publisher: { '@id': `${SITIO}/#organizacion` },
                  potentialAction: {
                    '@type': 'SearchAction',
                    target: {
                      '@type': 'EntryPoint',
                      urlTemplate: `${urlAbsoluta(getPathname({ href: '/buscar', locale }))}?q={search_term_string}`,
                    },
                    'query-input': 'required name=search_term_string',
                  },
                },
              ],
            }),
          }}
        />

        <NextIntlClientProvider>
          <ProveedorTema>
            {/*
              La divisa se resuelve en el servidor y baja por contexto.

              Se lee aquí —cookie del visitante y tasas de la API— porque los
              precios los pinta el servidor: pedirlas desde el cliente dejaría
              todos los importes parpadeando de euros a libras en cada carga.
            */}
            <ProveedorDivisa estado={divisa}>
              {/* Salto al contenido: obligatorio para navegación por teclado.

                Decía "Inicio", que es el nombre de otro enlace: quien lo oye en
                un lector de pantalla entiende que va a la portada y no lo usa.
                Y mezclaba `.solo-lectores` con `focus:not-sr-only`, que anulan
                propiedades distintas, así que al enfocarlo podía no llegar a
                verse. Ahora es una sola clase que hace las dos cosas. */}
              <a href="#contenido" className="saltar-al-contenido">
                {t('saltar_contenido')}
              </a>

              <div className="flex min-h-screen flex-col">
                <Cabecera locale={locale} marca={ajustes} />
                {/* La barra de enlaces que se configura en el panel. Va aquí y no
                  dentro de la cabecera para no engordar lo que se queda fijo al
                  desplazar; el motivo, medido, está en el componente. */}
                <SubBarra locale={locale} />
                <main id="contenido" className="flex-1">
                  {children}
                </main>
                <PieDePagina locale={locale} marca={ajustes} />
              </div>

              <AvisoCookies />
              {/* Único punto por el que entra un script de terceros, y solo si
                está configurado en el panel Y consentido por quien navega. */}
              <ScriptsAnalitica />
              <RegistrarSW />
              {/* Guarda el ?ref= y los utm_* de un enlace hasta el checkout. */}
              <CapturarOrigen />
            </ProveedorDivisa>
          </ProveedorTema>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
