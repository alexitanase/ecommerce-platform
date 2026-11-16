import { describe, expect, it } from 'vitest';
import { metodosDeLasPasarelas } from './metodos-pago';

describe('metodosDeLasPasarelas', () => {
  it('una pasarela agregadora trae varias formas de pago', () => {
    // Al cliente no le dice nada «Stripe»: le dice que puede pagar con su
    // tarjeta, con Bizum o con el móvil.
    expect(metodosDeLasPasarelas(['stripe'])).toEqual([
      'visa',
      'mastercard',
      'amex',
      'applepay',
      'googlepay',
      'bizum',
    ]);
  });

  it('dos pasarelas con las mismas tarjetas no las repiten', () => {
    const metodos = metodosDeLasPasarelas(['stripe', 'revolut']);

    expect(metodos.filter((m) => m === 'visa')).toHaveLength(1);
    expect(metodos).toContain('revolut');
  });

  it('el orden no depende de en qué orden vengan las pasarelas', () => {
    // Primero las tarjetas, que es lo que busca la vista, y la cripto al final.
    expect(metodosDeLasPasarelas(['nowpayments', 'stripe'])).toEqual(
      metodosDeLasPasarelas(['stripe', 'nowpayments']),
    );
    expect(metodosDeLasPasarelas(['nowpayments', 'stripe']).at(-1)).toBe('cripto');
  });

  it('una pasarela que no conocemos no rompe la fila', () => {
    // El registro de pasarelas crece; el pie no puede caerse por eso.
    expect(metodosDeLasPasarelas(['klarna', 'stripe'])).toContain('visa');
  });

  it('sin pasarelas activas no se anuncia nada', () => {
    // Es lo correcto: prometer formas de pago que en la caja no aparecen es la
    // clase de detalle que hace dudar de si la tienda es real.
    expect(metodosDeLasPasarelas([])).toEqual([]);
  });
});
