/**
 * Qué formas de pago anunciar según las pasarelas que estén encendidas.
 *
 * No es lo mismo una pasarela que una forma de pago, y en el pie hay que
 * enseñar lo segundo: al cliente no le dice nada «Stripe», le dice que puede
 * pagar con su tarjeta, con Bizum o con el móvil. Una sola pasarela trae varias
 * formas —Stripe es un agregador— y dos pasarelas distintas traen las mismas
 * tarjetas, así que la lista se compone y se quita lo repetido.
 *
 * Se calcula a partir de lo que la API dice que está **activo de verdad** —con
 * credenciales y encendido—, no de una lista escrita a mano. Anunciar Bizum en
 * el pie y que en la caja no aparezca es la clase de detalle que hace dudar de
 * si la tienda es real.
 */

export type ClaveMetodo =
  | 'visa'
  | 'mastercard'
  | 'amex'
  | 'applepay'
  | 'googlepay'
  | 'bizum'
  | 'revolut'
  | 'paypal'
  | 'cripto';

/**
 * Lo que trae cada pasarela.
 *
 * Se declara lo que de verdad se ofrece en la caja, no todo lo que el
 * proveedor tiene en su catálogo: Stripe admite dos docenas de métodos, pero
 * los que salen en un checkout español con la configuración de fábrica son
 * estos. Prometer de más en el pie es peor que no prometer.
 */
const POR_PASARELA: Record<string, ClaveMetodo[]> = {
  stripe: ['visa', 'mastercard', 'amex', 'applepay', 'googlepay', 'bizum'],
  revolut: ['visa', 'mastercard', 'revolut'],
  paypal: ['paypal'],
  nowpayments: ['cripto'],
};

/**
 * El orden en que se enseñan, y no es el de las pasarelas.
 *
 * Primero las tarjetas, que es lo que busca la vista; después los monederos del
 * móvil; después lo local; y la cripto al final, que es lo que menos gente usa
 * y lo que más extraña si va delante.
 */
const ORDEN: ClaveMetodo[] = [
  'visa',
  'mastercard',
  'amex',
  'applepay',
  'googlepay',
  'bizum',
  'revolut',
  'paypal',
  'cripto',
];

export function metodosDeLasPasarelas(pasarelas: string[]): ClaveMetodo[] {
  const encontrados = new Set(pasarelas.flatMap((p) => POR_PASARELA[p] ?? []));

  return ORDEN.filter((m) => encontrados.has(m));
}
