import { getTranslations } from 'next-intl/server';
import { pasarelasActivas } from '@/lib/api';
import { metodosDeLasPasarelas, type ClaveMetodo } from '@/lib/metodos-pago';

/**
 * Las formas de pago que se aceptan, en el pie.
 *
 * Es una señal de confianza, y de las baratas: en una tienda desconocida —y más
 * con catálogo +18— ver la tarjeta de siempre ahí abajo es lo que responde a
 * «¿esto es real?» sin tener que llegar a la caja para averiguarlo.
 *
 * **Sale de lo que está encendido de verdad**, no de una lista escrita a mano:
 * se le pregunta a la API qué pasarelas están activas y con credenciales.
 * Anunciar Bizum en el pie y que en la caja no aparezca es peor que no
 * anunciarlo.
 *
 * **Las marcas van dibujadas aquí, no como imágenes.** No hay ficheros que
 * subir, ni una petición por marca, ni un CDN de terceros al que se le cuenta
 * desde qué página viene cada visitante. Y escalan sin verse borrosas en una
 * pantalla de más densidad, que es donde un PNG de 40 px se nota.
 *
 * Las que son un nombre escrito se ponen como texto en el color de la marca,
 * que es exactamente lo que es un logotipo tipográfico. Las que son una forma
 * —los dos círculos de Mastercard— se dibujan. Redibujar a mano un logotipo
 * complejo se nota, y un logotipo mal hecho da menos confianza que su nombre
 * bien escrito.
 */

/**
 * La casilla es blanca en los dos temas, y la tinta de las marcas es oscura.
 *
 * No es un descuido del tema oscuro: estas marcas están diseñadas para verse
 * sobre blanco y sus colores lo dan por hecho. Sobre el fondo oscuro de la
 * tienda, el azul de Visa (#1434CB) queda casi negro y el de PayPal
 * directamente no se lee. Es además lo que hace todo el mundo —una fila de
 * tarjetitas blancas— así que se reconoce antes.
 */
const CASILLA = 'grid h-7 min-w-12 place-items-center rounded-md border px-2';
const TINTA = '#1a1a1a';

/** Cómo se pinta cada forma de pago dentro de su casilla. */
const MARCAS: Record<ClaveMetodo, { etiqueta: string; contenido: React.ReactNode }> = {
  visa: {
    etiqueta: 'Visa',
    contenido: (
      <span className="text-[11px] font-bold italic tracking-tight" style={{ color: '#1434CB' }}>
        VISA
      </span>
    ),
  },
  mastercard: {
    etiqueta: 'Mastercard',
    contenido: (
      // Los dos círculos que se solapan: el logotipo ES esta forma, así que
      // dibujarlo es reproducirlo bien, no aproximarlo.
      <svg viewBox="0 0 36 22" width="30" height="18" aria-hidden="true" focusable="false">
        <circle cx="14" cy="11" r="9" fill="#EB001B" />
        <circle cx="22" cy="11" r="9" fill="#F79E1B" fillOpacity="0.82" />
      </svg>
    ),
  },
  amex: {
    etiqueta: 'American Express',
    contenido: (
      <span className="text-[10px] font-bold tracking-tight" style={{ color: '#1F72CD' }}>
        AMEX
      </span>
    ),
  },
  applepay: {
    etiqueta: 'Apple Pay',
    contenido: (
      <span className="text-[10px] font-semibold tracking-tight" style={{ color: TINTA }}>
        Apple&nbsp;Pay
      </span>
    ),
  },
  googlepay: {
    etiqueta: 'Google Pay',
    contenido: (
      <span className="text-[10px] font-semibold tracking-tight" style={{ color: TINTA }}>
        <span style={{ color: '#4285F4' }}>G</span>
        <span style={{ color: '#EA4335' }}>o</span>
        <span style={{ color: '#FBBC04' }}>o</span>
        <span style={{ color: '#4285F4' }}>g</span>
        <span style={{ color: '#34A853' }}>l</span>
        <span style={{ color: '#EA4335' }}>e</span>
        &nbsp;Pay
      </span>
    ),
  },
  bizum: {
    etiqueta: 'Bizum',
    contenido: (
      <span className="text-[11px] font-bold tracking-tight" style={{ color: '#00BCD4' }}>
        bizum
      </span>
    ),
  },
  revolut: {
    etiqueta: 'Revolut Pay',
    contenido: (
      <span className="text-[10px] font-semibold tracking-tight" style={{ color: TINTA }}>
        Revolut&nbsp;Pay
      </span>
    ),
  },
  paypal: {
    etiqueta: 'PayPal',
    contenido: (
      <span className="text-[10px] font-bold tracking-tight">
        <span style={{ color: '#003087' }}>Pay</span>
        <span style={{ color: '#009CDE' }}>Pal</span>
      </span>
    ),
  },
  cripto: {
    etiqueta: 'Criptomonedas',
    contenido: (
      <span className="text-[11px] font-bold tracking-tight" style={{ color: '#F7931A' }}>
        ₿ Cripto
      </span>
    ),
  },
};

export async function MetodosDePago() {
  const [t, pasarelas] = await Promise.all([getTranslations('pie'), pasarelasActivas()]);
  const metodos = metodosDeLasPasarelas(pasarelas.map((p) => p.key));

  // Sin pasarelas configuradas no se pinta la fila: un rótulo de «aceptamos»
  // encima de un hueco dice lo contrario de lo que pretende.
  if (metodos.length === 0) return null;

  return (
    <div className="mt-8 border-t border-[var(--borde)] pt-6">
      <p className="mb-3 text-xs text-[var(--texto-tenue)]">{t('pagos_aceptados')}</p>

      {/* Una lista de verdad y no un montón de `div`: para quien navega con
          lector de pantalla esto es una enumeración de lo que se acepta, y el
          nombre de cada marca tiene que oírse aunque solo se vean dos letras. */}
      <ul className="flex flex-wrap items-center gap-2">
        {metodos.map((clave) => (
          <li
            key={clave}
            title={MARCAS[clave].etiqueta}
            className={CASILLA}
            style={{ background: '#ffffff', borderColor: 'rgba(0,0,0,0.12)' }}
          >
            <span className="solo-lectores">{MARCAS[clave].etiqueta}</span>
            <span aria-hidden="true" className="flex items-center leading-none">
              {MARCAS[clave].contenido}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
