import { describe, expect, it } from 'vitest';
import { urlsDeVuelta } from './urls-vuelta.js';

const TIENDA = 'https://chispaynoche.com';

const pedido = {
  id: 'ord_abc123',
  number: 'P-2026-000123',
  publicToken: 'tok_secreto123',
  locale: 'es',
};

describe('urlsDeVuelta', () => {
  it('el éxito lleva a la página de gracias, por su token', () => {
    // Y no a `/gracias`, que no existe: una compra real acababa en un 404.
    expect(urlsDeVuelta(TIENDA, pedido).successUrl).toBe(
      'https://chispaynoche.com/es/pedido/tok_secreto123',
    );
  });

  it('el éxito NO usa el número del pedido', () => {
    /*
     * El número es correlativo. Si la página de gracias se pudiera abrir por
     * número, cualquiera recorrería los pedidos de la tienda leyendo nombres,
     * direcciones y teléfonos. La página se busca por token justamente por eso.
     */
    expect(urlsDeVuelta(TIENDA, pedido).successUrl).not.toContain(pedido.number);
  });

  it('la cancelación vuelve a poder cobrar', () => {
    // Con el `?id=`: sin él, la pantalla de pago no sabe qué pedido cobrar.
    expect(urlsDeVuelta(TIENDA, pedido).cancelUrl).toBe(
      'https://chispaynoche.com/es/pedido/P-2026-000123/pago?id=ord_abc123',
    );
  });

  it('respeta el idioma en el que se compró', () => {
    const urls = urlsDeVuelta(TIENDA, { ...pedido, locale: 'ca' });
    expect(urls.successUrl).toContain('/ca/pedido/');
    expect(urls.cancelUrl).toContain('/ca/pedido/');
  });

  it('no duplica la barra si la base la trae', () => {
    expect(urlsDeVuelta('https://chispaynoche.com/', pedido).successUrl).toBe(
      'https://chispaynoche.com/es/pedido/tok_secreto123',
    );
  });

  it('escapa lo que va en la ruta', () => {
    const urls = urlsDeVuelta(TIENDA, { ...pedido, publicToken: 'a/b?c=1' });
    expect(urls.successUrl).toBe('https://chispaynoche.com/es/pedido/a%2Fb%3Fc%3D1');
  });
});
