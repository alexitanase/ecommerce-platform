import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';

type Messages = Record<string, unknown>;

async function cargarMensajes(locale: string): Promise<Messages> {
  const modulo = (await import(`../../messages/${locale}.json`)) as { default: Messages };
  return modulo.default;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const solicitado = await requestLocale;
  const locale = hasLocale(routing.locales, solicitado) ? solicitado : routing.defaultLocale;

  return {
    locale,
    // El import dinámico se tipa explícitamente para que el resto del código
    // no herede un `any` sin darse cuenta.
    messages: await cargarMensajes(locale),
    // Zona horaria fija: sin esto, el servidor y el navegador pueden formatear
    // la misma fecha de forma distinta y React avisa de discrepancia.
    timeZone: 'Europe/Madrid',
    formats: {
      number: {
        precio: { style: 'currency', currency: 'EUR' },
      },
      dateTime: {
        corta: { day: 'numeric', month: 'short', year: 'numeric' },
        larga: { day: 'numeric', month: 'long', year: 'numeric' },
      },
    },
  };
});
