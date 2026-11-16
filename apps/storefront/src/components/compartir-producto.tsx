'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { enlacesDeCompartir, type EnlaceCompartir } from '@/lib/compartir';
import { useEsCliente } from '@/lib/use-es-cliente';
import { Icono, type NombreIcono } from './ui/icono';

/**
 * Compartir la ficha.
 *
 * En una tienda de catálogo restringido esto no es un adorno: Google Ads y Meta
 * no admiten este producto, así que el enlace que un cliente le pasa a otro por
 * WhatsApp es uno de los pocos canales que quedan. Cuanto menos cueste pasarlo,
 * más se pasa.
 *
 * **Qué destinos y por qué esos.** WhatsApp y Telegram porque es donde se
 * comparte de verdad en España, correo porque es el que funciona en el trabajo
 * y desde el escritorio, y copiar el enlace porque cubre todo lo demás —un SMS,
 * un foro, una nota— sin que haya que mantener un botón por red. Facebook y X
 * se han dejado fuera a propósito: nadie publica un artículo +18 en su muro, y
 * un botón que no se pulsa nunca solo resta sitio a los tres que sí.
 *
 * **Dos formas, no las dos a la vez.** Donde el navegador trae su propio
 * diálogo de compartir —esencialmente todos los móviles— se enseña un solo
 * botón que lo abre: ese diálogo ya lleva WhatsApp, Telegram y lo que la
 * persona tenga instalado, mejor ordenado de lo que podamos hacerlo nosotros, y
 * repetir debajo nuestra propia fila sería ofrecer dos veces lo mismo. Donde no
 * existe —el escritorio— se enseña la fila.
 *
 * El primer render, en el servidor, es siempre la fila: son enlaces normales,
 * así que funcionan sin JavaScript y son lo correcto en el escritorio, que es
 * donde no hay diálogo nativo. En el móvil se sustituyen al montar.
 */

/** Cómo se presenta cada destino. Los enlaces los monta `enlacesDeCompartir`. */
const PRESENTACION: Record<
  EnlaceCompartir['clave'],
  { etiqueta: string | null; icono: NombreIcono | null }
> = {
  // Las marcas no se traducen ni se dibujan: un logo de WhatsApp redibujado a
  // trazo dentro de un juego de iconos que no es el suyo se nota, y el nombre
  // escrito se reconoce igual de rápido.
  whatsapp: { etiqueta: 'WhatsApp', icono: null },
  telegram: { etiqueta: 'Telegram', icono: null },
  email: { etiqueta: null, icono: 'sobre' },
};

export function CompartirProducto({ url, titulo }: { url: string; titulo: string }) {
  const t = useTranslations('producto');
  const montado = useEsCliente();
  /** Qué está diciendo el botón de copiar: nada, «copiado» o que ha fallado. */
  const [copia, setCopia] = useState<'inactivo' | 'hecha' | 'fallida'>('inactivo');

  /*
   * `navigator.share` no basta con que exista: en un escritorio con Chrome
   * existe y abre un diálogo casi vacío. `canShare` responde por los datos
   * concretos y es la comprobación que distingue un móvil de verdad.
   */
  const hayDialogoNativo =
    montado &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ url, title: titulo });

  // El texto que acompaña al enlace. Sin él, un mensaje de WhatsApp llega como
  // una URL suelta, que es exactamente lo que la gente no abre.
  const mensaje = t('compartir_mensaje', { producto: titulo });

  const destinos = enlacesDeCompartir(url, mensaje).map((enlace) => {
    const { etiqueta, icono } = PRESENTACION[enlace.clave];

    return {
      ...enlace,
      etiqueta: etiqueta ?? t('compartir_email'),
      icono,
      // «WhatsApp» a secas no dice qué hace el enlace; el correo tiene su
      // propia frase porque «Compartir en Email» no se dice así.
      aria: etiqueta ? t('compartir_en', { red: etiqueta }) : t('compartir_por_email'),
    };
  });

  const compartirNativo = () => {
    // Cancelar el diálogo lanza `AbortError`, y no es un error: es alguien que
    // ha cambiado de idea. Enseñarle un aviso rojo por eso sería absurdo.
    void navigator.share({ url, title: titulo, text: mensaje }).catch(() => undefined);
  };

  const copiar = () => {
    const avisar = (resultado: 'hecha' | 'fallida') => {
      setCopia(resultado);
      setTimeout(() => {
        setCopia('inactivo');
      }, 2000);
    };

    /*
     * El fallo se dice, no se traga.
     *
     * El portapapeles se le niega a una página que no tiene el foco, y en ese
     * caso `writeText` rechaza sin más. Un botón que al pulsarlo no hace nada
     * ni dice nada se pulsa tres veces y se acaba copiando la dirección de la
     * barra a mano, convencido de que la tienda está rota.
     */
    void navigator.clipboard.writeText(url).then(
      () => {
        avisar('hecha');
      },
      () => {
        avisar('fallida');
      },
    );
  };

  const textoCopiar = {
    inactivo: t('compartir_copiar'),
    hecha: t('compartir_copiado'),
    fallida: t('compartir_no_copiado'),
  }[copia];

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <span className="mr-1 flex items-center gap-1.5 text-sm text-[var(--texto-suave)]">
        <Icono nombre="compartir" tamano={16} />
        {t('compartir')}
      </span>

      {hayDialogoNativo ? (
        <button type="button" onClick={compartirNativo} className="btn btn-secundario btn-pequeno">
          {t('compartir_opciones')}
        </button>
      ) : (
        destinos.map((destino) => (
          <a
            key={destino.clave}
            href={destino.href}
            /*
             * A la web, en otra pestaña: quien está mirando un producto no
             * debe perder el carrito de vista. Y con `noopener`, sin el cual
             * la página de destino puede manipular la nuestra.
             *
             * El correo NO lleva `target`: un `mailto:` abre el programa de
             * correo, así que la pestaña nueva se queda en blanco y hay que
             * cerrarla a mano.
             */
            {...(destino.externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="btn btn-secundario btn-pequeno"
            aria-label={destino.aria}
          >
            {destino.icono && <Icono nombre={destino.icono} tamano={16} />}
            {destino.etiqueta}
          </a>
        ))
      )}

      {/* Copiar el enlace se ofrece siempre, con diálogo nativo o sin él: es lo
          que cubre el destino que no está en la lista. */}
      <button
        type="button"
        onClick={copiar}
        className="btn btn-secundario btn-pequeno"
        // El estado se anuncia además de verse: quien usa lector de pantalla no
        // se entera de que el texto del botón ha cambiado si no se le dice.
        aria-live="polite"
      >
        <Icono
          nombre={copia === 'hecha' ? 'comprobado' : copia === 'fallida' ? 'alerta' : 'enlace'}
          tamano={16}
        />
        {textoCopiar}
      </button>
    </div>
  );
}
