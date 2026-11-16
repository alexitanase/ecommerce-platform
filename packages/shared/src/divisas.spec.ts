import { describe, expect, it } from 'vitest';
import {
  DIVISA_BASE,
  convertirImporte,
  esCodigoDivisa,
  nombreDivisa,
  normalizarDivisas,
  tasasUtiles,
} from './divisas.js';

describe('esCodigoDivisa', () => {
  it('acepta tres letras, en cualquier caja y con espacios de sobra', () => {
    // Lo que llega de un formulario viene como lo haya tecleado alguien.
    for (const bueno of ['EUR', 'gbp', ' Usd ']) {
      expect(esCodigoDivisa(bueno), bueno).toBe(true);
    }
  });

  it('rechaza lo que no tiene forma de código ISO 4217', () => {
    for (const malo of ['EU', 'EUROS', 'E1R', '', '   ', 42, null, undefined, ['EUR']]) {
      expect(esCodigoDivisa(malo), JSON.stringify(malo)).toBe(false);
    }
  });

  it('no comprueba que la divisa exista, solo que lo parezca', () => {
    /*
     * `LMN` está bien escrito y no es ninguna divisa. Pasa a propósito: aquí no
     * hay catálogo con el que contrastarlo, y quien decide si se puede ofrecer
     * es el proveedor de tipos de cambio —sin tasa no hay conversión posible—.
     */
    expect(esCodigoDivisa('LMN')).toBe(true);
  });
});

describe('nombreDivisa', () => {
  it('traduce al idioma que se pida', () => {
    expect(nombreDivisa('GBP', 'es')).toBe('libra esterlina');
    expect(nombreDivisa('GBP', 'en')).toBe('British Pound');
  });

  it('normaliza el código antes de buscarlo', () => {
    expect(nombreDivisa('gbp', 'es')).toBe(nombreDivisa('GBP', 'es'));
  });

  it('devuelve el código cuando no conoce la divisa', () => {
    // Es más útil ver «LMN» que un hueco: al menos se sabe qué hay guardado.
    expect(nombreDivisa('LMN')).toBe('LMN');
  });

  it('no revienta con un idioma inválido', () => {
    expect(nombreDivisa('EUR', 'no-es-un-idioma')).toBe('EUR');
  });
});

describe('convertirImporte', () => {
  it('convierte con la tasa dada', () => {
    // 24,98 € a 0,857 libras por euro → 21,41 £.
    expect(convertirImporte(2498, 0.857, 'GBP')).toBe(2141);
  });

  it('la tasa 1 no cambia nada', () => {
    expect(convertirImporte(2498, 1, DIVISA_BASE)).toBe(2498);
  });

  it('rechaza una tasa que no sirve en vez de devolver cero', () => {
    // Un cero daría un precio de 0,00 € en la tienda, que es peor que no
    // enseñar ninguna conversión.
    for (const mala of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(convertirImporte(2498, mala, 'GBP'), String(mala)).toBeNull();
    }
  });

  it('ajusta el salto de decimales entre divisas', () => {
    // El yen no tiene decimales: 10,00 € a 160 yenes por euro son 1600 yenes,
    // que se representan como 1600 y no como 160000.
    expect(convertirImporte(1000, 160, 'JPY')).toBe(1600);
  });

  it('redondea al céntimo más cercano', () => {
    expect(convertirImporte(100, 1.006, 'USD')).toBe(101);
    expect(convertirImporte(100, 1.004, 'USD')).toBe(100);
  });

  it('en el empate exacto manda la coma flotante, y se acepta', () => {
    /*
     * `100 * 1.005` da 100.49999999999999, no 100.5: el 1.005 no es
     * representable en binario. Así que redondea a la baja.
     *
     * Queda escrito porque conviene saber que existe y porque aquí no importa:
     * esto es una conversión que se ENSEÑA, aproximada por definición y con su
     * aviso al lado. El importe que se cobra es el de euros, que sí es entero y
     * exacto. Si algún día se cobrara en otra divisa, esto no serviría y habría
     * que redondear con decimales de verdad.
     */
    expect(convertirImporte(100, 1.005, 'USD')).toBe(100);
  });
});

describe('tasasUtiles', () => {
  it('se queda solo con las divisas activas', () => {
    const tasas = { GBP: 0.857, USD: 1.09, JPY: 160, PLN: 4.3 };
    expect(tasasUtiles(tasas, ['EUR', 'GBP', 'USD'])).toEqual({ GBP: 0.857, USD: 1.09 });
  });

  it('descarta el euro, que es la base y no se convierte', () => {
    expect(tasasUtiles({ EUR: 1, GBP: 0.857 }, ['EUR', 'GBP'])).toEqual({ GBP: 0.857 });
  });

  it('descarta las tasas que no sirven en vez de arrastrarlas', () => {
    const tasas = { GBP: 0, USD: -1, CHF: 'ochenta', PLN: 4.3 };
    expect(tasasUtiles(tasas, ['GBP', 'USD', 'CHF', 'PLN'])).toEqual({ PLN: 4.3 });
  });

  it('una divisa activa sin tasa simplemente no sale', () => {
    // Es lo que pasa si el proveedor deja de publicar una: mejor no ofrecerla
    // que ofrecerla con un precio inventado.
    expect(tasasUtiles({ GBP: 0.857 }, ['EUR', 'GBP', 'RON'])).toEqual({ GBP: 0.857 });
  });
});

describe('normalizarDivisas', () => {
  it('el euro entra siempre, aunque no venga en la lista', () => {
    // Desde el panel se puede desmarcar sin darse cuenta, y una tienda que cobra
    // en euros sin el euro entre sus divisas no tiene sentido.
    expect(normalizarDivisas(['GBP'])).toEqual(['EUR', 'GBP']);
    expect(normalizarDivisas([])).toEqual(['EUR']);
    expect(normalizarDivisas(null)).toEqual(['EUR']);
  });

  it('descarta lo que no tiene forma de código', () => {
    expect(normalizarDivisas(['GBP', 'EUROS', 42, null, 'usd'])).toEqual(['EUR', 'GBP', 'USD']);
  });

  it('no repite', () => {
    expect(normalizarDivisas(['EUR', 'EUR', 'GBP', 'gbp'])).toEqual(['EUR', 'GBP']);
  });

  it('deja pasar un código bien escrito que no existe', () => {
    /*
     * Quien filtra por disponibilidad es la API, que sabe qué publica el
     * proveedor. Si esto lo tirara aquí, una divisa cuya tasa el proveedor deje
     * de publicar un día desaparecería del ajuste guardado y no volvería sola
     * cuando el proveedor la recuperase.
     */
    expect(normalizarDivisas(['LMN'])).toEqual(['EUR', 'LMN']);
  });
});
