/**
 * A dónde devuelve la pasarela al cliente cuando termina de pagar.
 *
 * Está en su propio módulo, y probado, porque las dos direcciones estuvieron mal
 * y el fallo no lo detectó nada: solo aparece al pagar de verdad con una pasarela
 * real, que es lo único que no se prueba en local.
 *
 *  · **El éxito apuntaba a `/pedido/{numero}/gracias`, que no existe.** La
 *    página de «gracias por tu compra» es la de seguimiento, y se busca por
 *    `publicToken`, NO por número: el número es correlativo, y aceptarlo
 *    permitiría recorrer los pedidos de la tienda leyendo nombres, direcciones y
 *    teléfonos. Por eso aquí va el token.
 *
 *  · **La cancelación volvía a la página de pago sin el `?id=`**, y esa pantalla
 *    necesita el id del pedido para poder pedir el cobro: quien volvía atrás
 *    para pagar de otra forma se encontraba una pantalla que no cobraba.
 *
 * Las dos llevan el idioma delante. Sin él, el enrutador de la tienda redirige al
 * idioma por defecto, así que quien compraba en catalán volvía a una página en
 * español justo después de pagar.
 */

export interface PedidoParaVuelta {
  id: string;
  number: string;
  publicToken: string;
  locale: string;
}

export function urlsDeVuelta(
  tienda: string,
  pedido: PedidoParaVuelta,
): { successUrl: string; cancelUrl: string } {
  // Sin barra final duplicada: `STOREFRONT_URL` la trae en algunas
  // configuraciones y una URL con `//` en medio rompe el enrutado de la tienda.
  const base = `${tienda.replace(/\/+$/, '')}/${pedido.locale}/pedido`;

  return {
    successUrl: `${base}/${encodeURIComponent(pedido.publicToken)}`,
    cancelUrl: `${base}/${encodeURIComponent(pedido.number)}/pago?id=${encodeURIComponent(pedido.id)}`,
  };
}
