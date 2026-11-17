import { NowPaymentsProvider } from '../providers/nowpayments.provider.js';
import { PayiadProvider } from '../providers/payiad.provider.js';
import { RevolutProvider } from '../providers/revolut.provider.js';
import { StripeProvider } from '../providers/stripe.provider.js';
import type { PaymentProvider } from './types.js';

/**
 * Fábrica de pasarelas.
 *
 * El orden de esta lista es el orden en que se ofrecen en el checkout:
 * NOWPayments primero por decisión de negocio.
 */
export type ClavePasarela = 'nowpayments' | 'revolut' | 'stripe' | 'payiad' | 'paypal';

export const PASARELAS_DISPONIBLES: {
  key: ClavePasarela;
  nombre: string;
  implementada: boolean;
  camposCredenciales: { clave: string; etiqueta: string; secreto: boolean }[];
}[] = [
  {
    key: 'nowpayments',
    nombre: 'NOWPayments (cripto)',
    implementada: true,
    camposCredenciales: [
      { clave: 'apiKey', etiqueta: 'API Key', secreto: true },
      { clave: 'ipnSecret', etiqueta: 'IPN Secret', secreto: true },
    ],
  },
  {
    key: 'revolut',
    nombre: 'Revolut (tarjeta y Revolut Pay)',
    implementada: true,
    camposCredenciales: [
      { clave: 'apiKey', etiqueta: 'API Key', secreto: true },
      { clave: 'webhookSecret', etiqueta: 'Webhook Secret', secreto: true },
    ],
  },
  {
    key: 'stripe',
    nombre: 'Stripe (tarjeta, Bizum, Apple/Google Pay)',
    implementada: true,
    camposCredenciales: [
      { clave: 'secretKey', etiqueta: 'Secret Key', secreto: true },
      { clave: 'webhookSecret', etiqueta: 'Webhook Secret', secreto: true },
    ],
  },
  {
    key: 'payiad',
    nombre: 'Payiad (tarjeta)',
    implementada: true,
    camposCredenciales: [
      { clave: 'secretKey', etiqueta: 'Secret Key', secreto: true },
      { clave: 'webhookSecret', etiqueta: 'Webhook Secret', secreto: true },
    ],
  },
  {
    key: 'paypal',
    nombre: 'PayPal',
    implementada: false,
    camposCredenciales: [
      { clave: 'clientId', etiqueta: 'Client ID', secreto: false },
      { clave: 'clientSecret', etiqueta: 'Client Secret', secreto: true },
    ],
  },
];

export function crearPasarela(
  key: ClavePasarela,
  credenciales: Record<string, string | undefined>,
  opciones: { sandbox?: boolean } = {},
): PaymentProvider {
  switch (key) {
    case 'nowpayments':
      return new NowPaymentsProvider(credenciales, opciones.sandbox ?? true);
    case 'revolut':
      return new RevolutProvider(credenciales, opciones.sandbox ?? true);
    /*
     * Stripe no lleva interruptor de pruebas: lo decide la propia clave
     * (`sk_test_…` frente a `sk_live_…`). Con dos ajustes independientes se
     * puede tener marcada la casilla de «pruebas» y puesta la clave de
     * producción, que es justo el error que mueve dinero real creyendo que no.
     */
    case 'stripe':
      return new StripeProvider(credenciales);
    // Como Stripe: el modo lo decide la clave (`sk_test_…` / `sk_live_…`).
    case 'payiad':
      return new PayiadProvider(credenciales);
    case 'paypal':
      throw new Error(
        `La pasarela "${key}" está declarada pero aún no implementada. ` +
          `Ver el roadmap: se integra después de validar las que ya están escritas.`,
      );
    default: {
      const nunca: never = key;
      throw new Error(`Pasarela desconocida: ${String(nunca)}`);
    }
  }
}
