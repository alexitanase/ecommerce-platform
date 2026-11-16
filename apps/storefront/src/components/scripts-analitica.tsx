'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Script from 'next/script';
import { alCambiarConsentimiento, leerConsentimiento } from '@/lib/consentimiento';

/**
 * Carga de Google Tag Manager, GA4 y el píxel de Meta.
 *
 * Este componente es el único punto de toda la tienda por el que puede entrar
 * un script de terceros, y tiene dos cerrojos:
 *
 *  1. **Configurado en el panel.** Sin identificador no se carga nada. Los
 *     identificadores no viajan en el bundle: se piden a la API, de modo que
 *     apagar la integración desde Integraciones surte efecto de verdad y no
 *     hace falta volver a desplegar.
 *
 *  2. **Consentido por quien navega.** Y por categorías distintas: GA4 va con
 *     las analíticas y el píxel de Meta con las de marketing, porque construir
 *     audiencias publicitarias no es lo mismo que medir visitas. Aceptar
 *     estadísticas no puede arrastrar publicidad.
 *
 * Se reacciona a los cambios de consentimiento en vivo. Cargar según el estado
 * inicial y no volver a mirar es lo que hace que retirar el consentimiento no
 * sirva de nada hasta recargar, que es justo lo que la AEPD no admite.
 *
 * Una vez cargado, un script no se puede "descargar": si alguien retira el
 * permiso a mitad de sesión, se le dice a la plataforma que deje de medir
 * —`consent: denied` en GA4— y las funciones de `lib/analitica` dejan de
 * enviar eventos. Lo que sí se garantiza es que en la siguiente carga no
 * aparezca.
 */

interface Identificadores {
  ga4?: string;
  gtm?: string;
  metaPixel?: string;
}

export function ScriptsAnalitica() {
  const [ids, setIds] = useState<Identificadores>({});

  /*
   * El consentimiento se suscribe con `useSyncExternalStore` y no con un
   * `useState` dentro de un efecto.
   *
   * Vive fuera de React —en localStorage, y puede cambiarlo otra pestaña—, así
   * que es exactamente el caso para el que existe esta API. Leerlo con un
   * efecto que llama a `setState` provoca un render en cascada en cada montaje
   * y, peor, deja una ventana entre el primer pintado y el efecto en la que el
   * componente cree que no hay permiso.
   */
  const permisos = useSyncExternalStore(
    alCambiarConsentimiento,
    () => {
      const c = leerConsentimiento();
      // Se devuelve una cadena, no un objeto: `useSyncExternalStore` compara
      // por identidad y un objeto nuevo en cada lectura sería un bucle infinito.
      return `${String(c.analiticas)}|${String(c.marketing)}`;
    },
    () => 'false|false',
  );

  const [analiticas, marketing] = permisos.split('|').map((v) => v === 'true');

  useEffect(() => {
    // Solo se pregunta a la API si hay algún permiso: sin él no hay nada que
    // cargar y la petición sobra.
    if (!analiticas && !marketing) return;

    const base = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
    const controlador = new AbortController();

    fetch(`${base}/api/v1/integrations/analitica`, { signal: controlador.signal })
      .then((r) => r.json() as Promise<Identificadores>)
      .then(setIds)
      .catch(() => {
        // Sin respuesta, no se carga nada. Es el fallo seguro: quedarse sin
        // medición es molesto; cargar scripts de terceros por error, no.
      });

    return () => {
      controlador.abort();
    };
  }, [analiticas, marketing]);

  /**
   * Avisa a GA4 cuando alguien retira el permiso a mitad de sesión.
   *
   * El script ya está en la página y no se puede quitar, pero sí se le puede
   * decir que deje de medir. Sin esto, retirar el consentimiento no tendría
   * ningún efecto hasta recargar.
   */
  useEffect(() => {
    const w = window as unknown as { gtag?: (...args: unknown[]) => void };
    if (!w.gtag) return;

    w.gtag('consent', 'update', {
      analytics_storage: analiticas ? 'granted' : 'denied',
      ad_storage: marketing ? 'granted' : 'denied',
      ad_user_data: marketing ? 'granted' : 'denied',
      ad_personalization: marketing ? 'granted' : 'denied',
    });
  }, [analiticas, marketing]);

  const cargarGa4 = analiticas && Boolean(ids.ga4);
  const cargarGtm = analiticas && Boolean(ids.gtm);
  const cargarMeta = marketing && Boolean(ids.metaPixel);

  return (
    <>
      {/*
       * Google Tag Manager.
       *
       * Va con las cookies analíticas, igual que GA4, y no con las de
       * marketing: el contenedor en sí no mide nada: es el sitio desde el que
       * se enchufan otras etiquetas sin volver a desplegar la tienda.
       *
       * **El `consent default` se declara ANTES de cargar el contenedor.** Es
       * lo único que hace que las etiquetas de dentro respeten lo que decidió
       * el visitante: GTM lee el estado del consentimiento al arrancar, y todo
       * lo que se dispare después queda sujeto a él. Al revés —cargar primero y
       * avisar después— hay una ventana en la que una etiqueta de publicidad
       * puede haber escrito ya su cookie, y eso es exactamente lo que la AEPD
       * sanciona.
       *
       * Aquí no va el `<noscript>` con el iframe que sugiere Google. Sin
       * JavaScript no hay banner de cookies, así que no hay forma de recoger el
       * consentimiento: cargarlo igualmente sería medir a quien no ha podido
       * decir ni que sí ni que no.
       */}
      {cargarGtm && (
        <>
          <Script id="gtm-consentimiento" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = window.gtag || gtag;
              gtag('consent', 'default', {
                analytics_storage: 'granted',
                ad_storage: '${marketing ? 'granted' : 'denied'}',
                ad_user_data: '${marketing ? 'granted' : 'denied'}',
                ad_personalization: '${marketing ? 'granted' : 'denied'}'
              });
            `}
          </Script>
          <Script id="gtm-contenedor" strategy="afterInteractive">
            {`
              (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
              new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
              j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
              'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
              })(window,document,'script','dataLayer','${ids.gtm ?? ''}');
            `}
          </Script>
        </>
      )}

      {cargarGa4 && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ids.ga4 ?? ''}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = gtag;
              gtag('js', new Date());
              gtag('consent', 'default', {
                analytics_storage: 'granted',
                ad_storage: '${marketing ? 'granted' : 'denied'}',
                ad_user_data: '${marketing ? 'granted' : 'denied'}',
                ad_personalization: '${marketing ? 'granted' : 'denied'}'
              });
              gtag('config', '${ids.ga4 ?? ''}', { anonymize_ip: true });
            `}
          </Script>
        </>
      )}

      {cargarMeta && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
            n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
            document,'script','https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${ids.metaPixel ?? ''}');
            fbq('track', 'PageView');
          `}
        </Script>
      )}
    </>
  );
}
