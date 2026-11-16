import { describe, expect, it } from 'vitest';
import {
  baseImponible,
  netificarAccesorio,
  netificarAccesorioParcial,
  cuotaIncluida,
  desglosarIva,
  repartirProporcional,
  tieneVariosTipos,
  tipoPredominante,
} from './calculo-iva.js';

/**
 * Lo que se comprueba aquí no falla con una excepción: falla con una cuota
 * equivocada en una factura ya emitida. La propiedad que más se repite es que
 * **las partes sumen el todo**, porque una factura descuadrada por un céntimo
 * es una factura que hay que rectificar.
 */

describe('Extracción de la cuota', () => {
  it('saca el IVA de un precio que ya lo lleva dentro', () => {
    // 89,99 € al 21 % son 74,37 de base y 15,62 de cuota.
    expect(cuotaIncluida(8999, 21)).toBe(1562);
    expect(baseImponible(8999, 21)).toBe(7437);
  });

  it('base y cuota suman siempre el importe', () => {
    for (const importe of [1, 99, 100, 1234, 8999, 123456]) {
      for (const tipo of [21, 10, 4]) {
        expect(baseImponible(importe, tipo) + cuotaIncluida(importe, tipo)).toBe(importe);
      }
    }
  });

  it('con tipo 0 no hay cuota', () => {
    expect(cuotaIncluida(8999, 0)).toBe(0);
    expect(baseImponible(8999, 0)).toBe(8999);
  });
});

describe('Reparto proporcional', () => {
  it('reparte en proporción al peso', () => {
    expect(repartirProporcional(1000, [750, 250])).toEqual([750, 250]);
  });

  it('no pierde ni inventa céntimos al redondear', () => {
    // 10 entre tres partes iguales: 3,33 cada una y sobra un céntimo. Si se
    // perdiera, la suma de las líneas no daría el total de la factura.
    const partes = repartirProporcional(10, [100, 100, 100]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('asigna el sobrante al tramo mayor', () => {
    const partes = repartirProporcional(10, [100, 300]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(10);
    expect(partes[1]).toBeGreaterThan(partes[0] as number);
  });

  it('cuadra con importes y pesos arbitrarios', () => {
    for (const importe of [1, 7, 495, 1295, 99999]) {
      for (const pesos of [[1], [1, 1], [8999, 1299, 450], [1, 1, 1, 1, 1, 1, 1]]) {
        expect(repartirProporcional(importe, pesos).reduce((a, b) => a + b, 0)).toBe(importe);
      }
    }
  });

  it('no pierde el importe cuando todos los pesos son cero', () => {
    expect(repartirProporcional(500, [0, 0])).toEqual([500, 0]);
  });
});

describe('Desglose de un pedido', () => {
  it('separa los tramos de un carrito con dos tipos', () => {
    // Unas botas al 21 % y un libro al 4 %: es el caso que un tipo único
    // calcula mal, y no avisa.
    const desglose = desglosarIva([
      { totalCents: 8999, tipo: 21 },
      { totalCents: 1500, tipo: 4 },
    ]);

    expect(desglose.tramos.map((t) => t.tipo)).toEqual([21, 4]);
    expect(desglose.tramos[0]?.cuotaCents).toBe(cuotaIncluida(8999, 21));
    expect(desglose.tramos[1]?.cuotaCents).toBe(cuotaIncluida(1500, 4));
  });

  it('un tipo único da la misma cuota que el cálculo directo', () => {
    // Compatibilidad con lo que ya había: los pedidos de un solo tipo no
    // pueden cambiar de importe al introducir el desglose.
    const desglose = desglosarIva([{ totalCents: 8999, tipo: 21 }], 495);
    expect(desglose.cuotaCents).toBe(cuotaIncluida(8999 + 495, 21));
  });

  it('el envío sigue el tipo de lo que transporta', () => {
    // Prestación accesoria: no tiene tipo propio.
    const soloLibros = desglosarIva([{ totalCents: 1000, tipo: 4 }], 495);
    expect(soloLibros.tramos).toHaveLength(1);
    expect(soloLibros.tramos[0]?.totalCents).toBe(1495);
    expect(soloLibros.tramos[0]?.cuotaCents).toBe(cuotaIncluida(1495, 4));
  });

  it('reparte el envío entre los tipos presentes', () => {
    const desglose = desglosarIva(
      [
        { totalCents: 9000, tipo: 21 },
        { totalCents: 1000, tipo: 4 },
      ],
      500,
    );

    // Nueve décimas partes del porte van al tramo del 21 %.
    expect(desglose.tramos[0]?.totalCents).toBe(9450);
    expect(desglose.tramos[1]?.totalCents).toBe(1050);
    expect(desglose.totalCents).toBe(10500);
  });

  it('el descuento minora la base de cada tramo', () => {
    const desglose = desglosarIva(
      [
        { totalCents: 9000, tipo: 21 },
        { totalCents: 1000, tipo: 4 },
      ],
      0,
      1000,
    );

    expect(desglose.totalCents).toBe(9000);
    expect(desglose.tramos[0]?.totalCents).toBe(8100);
    expect(desglose.tramos[1]?.totalCents).toBe(900);
  });

  it('los tramos suman siempre el total cobrado', () => {
    // La propiedad que hace que la factura cuadre. Se prueba con importes
    // feos a propósito: son los que rompen el redondeo.
    const casos = [
      { lineas: [{ totalCents: 1299, tipo: 21 }], envio: 495, descuento: 0 },
      {
        lineas: [
          { totalCents: 3333, tipo: 10 },
          { totalCents: 3333, tipo: 4 },
        ],
        envio: 333,
        descuento: 111,
      },
      {
        lineas: [
          { totalCents: 1, tipo: 21 },
          { totalCents: 2, tipo: 10 },
        ],
        envio: 1,
        descuento: 1,
      },
      {
        lineas: [
          { totalCents: 8999, tipo: 21 },
          { totalCents: 1299, tipo: 10 },
          { totalCents: 450, tipo: 4 },
        ],
        envio: 795,
        descuento: 1500,
      },
    ];

    for (const caso of casos) {
      const desglose = desglosarIva(caso.lineas, caso.envio, caso.descuento);
      const esperado =
        caso.lineas.reduce((a, l) => a + l.totalCents, 0) + caso.envio - caso.descuento;

      expect(desglose.totalCents).toBe(esperado);
      expect(desglose.baseCents + desglose.cuotaCents).toBe(esperado);
      expect(desglose.tramos.reduce((a, t) => a + t.totalCents, 0)).toBe(esperado);
    }
  });

  it('en una entrega exenta no hay cuota y todo es base', () => {
    // Canarias, Ceuta y Melilla: la entrega va sin IVA español.
    const desglose = desglosarIva(
      [
        { totalCents: 7437, tipo: 21 },
        { totalCents: 1000, tipo: 4 },
      ],
      1070,
      0,
      true,
    );

    expect(desglose.cuotaCents).toBe(0);
    expect(desglose.tramos).toHaveLength(1);
    expect(desglose.tramos[0]?.tipo).toBe(0);
    expect(desglose.baseCents).toBe(9507);
  });

  it('un pedido vacío no rompe nada', () => {
    expect(desglosarIva([])).toEqual({ tramos: [], baseCents: 0, cuotaCents: 0, totalCents: 0 });
  });
});

describe('Importes accesorios en una entrega exenta', () => {
  it('quita el IVA usando el tipo de la mercancía', () => {
    const soloLibros = [{ totalCents: 1000, tipo: 4 }];
    expect(netificarAccesorio(1040, soloLibros)).toBe(baseImponible(1040, 4));
  });

  it('con varios tipos reparte antes de netificar', () => {
    // Con el tipo del primer producto aplicado a todo, el porte de un carrito
    // mezclado sale mal: en una entrega exenta eso es IVA español cobrado de
    // más, que es un cobro indebido y no solo un descuadre.
    const mezclado = [
      { totalCents: 9000, tipo: 21 },
      { totalCents: 1000, tipo: 4 },
    ];
    const conUnSoloTipo = baseImponible(500, 21);
    expect(netificarAccesorio(500, mezclado)).toBeGreaterThan(conUnSoloTipo);
    expect(netificarAccesorio(500, mezclado)).toBeLessThan(500);
  });

  it('no toca un importe de cero ni un pedido sin líneas', () => {
    expect(netificarAccesorio(0, [{ totalCents: 100, tipo: 21 }])).toBe(0);
    expect(netificarAccesorio(495, [])).toBe(495);
  });
});

describe('Importes accesorios con solo una parte exenta', () => {
  const mixto = [
    { totalCents: 5000, tipoCatalogo: 21, exenta: false },
    { totalCents: 5000, tipoCatalogo: 21, exenta: true },
  ];

  it('netifica solo la parte que acompaña a lo exento', () => {
    // Mitad y mitad: la mitad del porte pierde el IVA y la otra lo conserva.
    // Netificarlo entero rebajaría la base de lo que sí lleva IVA y se cobraría
    // de menos.
    const esperado = baseImponible(500, 21) + 500;
    expect(netificarAccesorioParcial(1000, mixto)).toBe(esperado);
  });

  it('sin nada exento devuelve el importe tal cual', () => {
    expect(
      netificarAccesorioParcial(1000, [{ totalCents: 5000, tipoCatalogo: 21, exenta: false }]),
    ).toBe(1000);
  });

  it('con todo exento se comporta como netificarAccesorio', () => {
    const lineas = [
      { totalCents: 9000, tipoCatalogo: 21, exenta: true },
      { totalCents: 1000, tipoCatalogo: 4, exenta: true },
    ];
    expect(netificarAccesorioParcial(500, lineas)).toBe(
      netificarAccesorio(500, [
        { totalCents: 9000, tipo: 21 },
        { totalCents: 1000, tipo: 4 },
      ]),
    );
  });

  it('usa el tipo del catálogo y no el aplicado', () => {
    // El tipo aplicado a una línea exenta es 0, y con él la función no quitaría
    // nada: el porte se quedaría con el 21 % español dentro. Es el fallo que
    // esta variante existe para impedir.
    const soloExenta = [{ totalCents: 10_000, tipoCatalogo: 21, exenta: true }];
    expect(netificarAccesorioParcial(1210, soloExenta)).toBe(1000);
  });
});

describe('Resumen en un solo número', () => {
  it('devuelve el tipo mayoritario por importe', () => {
    const desglose = desglosarIva([
      { totalCents: 1000, tipo: 4 },
      { totalCents: 9000, tipo: 21 },
    ]);
    expect(tipoPredominante(desglose)).toBe(21);
  });

  it('avisa de que hace falta desglose cuando hay varios tipos', () => {
    expect(tieneVariosTipos(desglosarIva([{ totalCents: 100, tipo: 21 }]))).toBe(false);
    expect(
      tieneVariosTipos(
        desglosarIva([
          { totalCents: 100, tipo: 21 },
          { totalCents: 100, tipo: 10 },
        ]),
      ),
    ).toBe(true);
  });
});
