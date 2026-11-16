import { describe, expect, it } from 'vitest';
import {
  aEntero,
  aTexto,
  calcularFifo,
  obligaModelo721,
  resumirEjercicio,
  UMBRAL_MODELO_721_CENTS,
  type EntradaCripto,
  type SalidaCripto,
} from './contabilidad-cripto.js';

/**
 * La ganancia de una conversión no aparece en ninguna factura ni en el modelo
 * 303: sale solo si alguien la calcula. Un error aquí no rompe nada — produce
 * una declaración con un número que no cuadra si la revisan.
 */

const entrada = (parcial: Partial<EntradaCripto> = {}): EntradaCripto => ({
  id: 'e1',
  fecha: new Date('2026-01-15T10:00:00Z'),
  moneda: 'BTC',
  cantidad: '0.01',
  valorEurCents: 50000,
  ...parcial,
});

const salida = (parcial: Partial<SalidaCripto> = {}): SalidaCripto => ({
  id: 's1',
  fecha: new Date('2026-06-01T10:00:00Z'),
  moneda: 'BTC',
  cantidad: '0.01',
  valorEurCents: 60000,
  ...parcial,
});

describe('Cantidades con muchos decimales', () => {
  it('conserva los dieciocho decimales', () => {
    // En coma flotante estas cantidades se redondean en silencio y el saldo
    // deja de cuadrar sin que nadie lo note.
    expect(aTexto(aEntero('0.000000000000000001'))).toBe('0.000000000000000001');
    expect(aTexto(aEntero('123.456789012345678'))).toBe('123.456789012345678');
  });

  it('no deja restos al sumar y restar', () => {
    const a = aEntero('0.1');
    const b = aEntero('0.2');
    expect(aTexto(a + b)).toBe('0.3');
    expect(aTexto(a + b - aEntero('0.3'))).toBe('0');
  });

  it('entiende enteros y negativos', () => {
    expect(aTexto(aEntero('5'))).toBe('5');
    expect(aTexto(aEntero('-1.5'))).toBe('-1.5');
    expect(aTexto(aEntero('0'))).toBe('0');
  });
});

describe('Ganancia de una conversión', () => {
  it('resta el coste de adquisición del importe obtenido', () => {
    // Recibidos 0,01 BTC valorados en 500 €; vendidos por 600 €.
    const { resultados } = calcularFifo([entrada()], [salida()]);

    expect(resultados[0]?.costeEurCents).toBe(50000);
    expect(resultados[0]?.gananciaEurCents).toBe(10000);
  });

  it('da pérdida cuando la moneda ha bajado', () => {
    const { resultados } = calcularFifo([entrada()], [salida({ valorEurCents: 42000 })]);
    expect(resultados[0]?.gananciaEurCents).toBe(-8000);
  });

  it('no inventa ganancia si el valor no se ha movido', () => {
    const { resultados } = calcularFifo([entrada()], [salida({ valorEurCents: 50000 })]);
    expect(resultados[0]?.gananciaEurCents).toBe(0);
  });
});

describe('Criterio FIFO', () => {
  it('consume primero lo recibido antes', () => {
    // Es lo que exige la Agencia Tributaria para monedas homogéneas. Con
    // precio medio saldría otro número, y es el que no cuadra si lo revisan.
    const entradas = [
      entrada({
        id: 'barata',
        fecha: new Date('2026-01-01'),
        cantidad: '0.01',
        valorEurCents: 30000,
      }),
      entrada({
        id: 'cara',
        fecha: new Date('2026-03-01'),
        cantidad: '0.01',
        valorEurCents: 60000,
      }),
    ];

    const { resultados } = calcularFifo(entradas, [
      salida({ cantidad: '0.01', valorEurCents: 70000 }),
    ]);

    // Sale la primera: coste 300 €, no el medio de 450 €.
    expect(resultados[0]?.costeEurCents).toBe(30000);
    expect(resultados[0]?.gananciaEurCents).toBe(40000);
    expect(resultados[0]?.lotes[0]?.entradaId).toBe('barata');
  });

  it('parte la venta entre varios lotes cuando hace falta', () => {
    const entradas = [
      entrada({ id: 'a', fecha: new Date('2026-01-01'), cantidad: '0.01', valorEurCents: 30000 }),
      entrada({ id: 'b', fecha: new Date('2026-03-01'), cantidad: '0.01', valorEurCents: 60000 }),
    ];

    const { resultados } = calcularFifo(entradas, [
      salida({ cantidad: '0.015', valorEurCents: 105000 }),
    ]);

    // 0,01 del primero (300 €) y 0,005 del segundo (300 €).
    expect(resultados[0]?.costeEurCents).toBe(60000);
    expect(resultados[0]?.lotes.map((l) => l.entradaId)).toEqual(['a', 'b']);
    expect(resultados[0]?.gananciaEurCents).toBe(45000);
  });

  it('ordena por fecha aunque lleguen desordenadas', () => {
    const entradas = [
      entrada({ id: 'nueva', fecha: new Date('2026-05-01'), valorEurCents: 60000 }),
      entrada({ id: 'vieja', fecha: new Date('2026-01-01'), valorEurCents: 30000 }),
    ];

    const { resultados } = calcularFifo(entradas, [salida()]);
    expect(resultados[0]?.lotes[0]?.entradaId).toBe('vieja');
  });

  it('no mezcla monedas distintas', () => {
    // Vender ethereum no puede consumir el bitcoin recibido antes.
    const entradas = [
      entrada({ id: 'btc', moneda: 'BTC', valorEurCents: 30000 }),
      entrada({ id: 'eth', moneda: 'ETH', cantidad: '1', valorEurCents: 250000 }),
    ];

    const { resultados } = calcularFifo(entradas, [
      salida({ moneda: 'ETH', cantidad: '1', valorEurCents: 300000 }),
    ]);

    expect(resultados[0]?.lotes[0]?.entradaId).toBe('eth');
    expect(resultados[0]?.costeEurCents).toBe(250000);
  });

  it('trata la moneda sin distinguir mayúsculas', () => {
    const { resultados } = calcularFifo([entrada({ moneda: 'btc' })], [salida({ moneda: 'BTC' })]);
    expect(resultados[0]?.costeEurCents).toBe(50000);
  });
});

describe('Saldo pendiente', () => {
  it('deja lo no convertido con su coste en libros', () => {
    const { saldos } = calcularFifo(
      [entrada({ cantidad: '0.02', valorEurCents: 100000 })],
      [salida({ cantidad: '0.005' })],
    );

    expect(saldos[0]?.cantidad).toBe('0.015');
    expect(saldos[0]?.costeEurCents).toBe(75000);
  });

  it('no deja saldo cuando se ha convertido todo', () => {
    const { saldos } = calcularFifo([entrada()], [salida()]);
    expect(saldos).toEqual([]);
  });

  it('lleva un saldo por cada moneda', () => {
    const { saldos } = calcularFifo(
      [
        entrada({ id: 'a', moneda: 'BTC' }),
        entrada({ id: 'b', moneda: 'USDT', cantidad: '500', valorEurCents: 46000 }),
      ],
      [],
    );

    expect(saldos.map((s) => s.moneda).sort()).toEqual(['BTC', 'USDT']);
  });
});

describe('Resumen del ejercicio', () => {
  it('separa ganancias de pérdidas', () => {
    // Van en casillas distintas de la declaración: compensarlas antes de
    // tiempo esconde el detalle que hay que declarar.
    const entradas = [
      entrada({ id: 'a', fecha: new Date('2026-01-01'), valorEurCents: 50000 }),
      entrada({ id: 'b', fecha: new Date('2026-02-01'), valorEurCents: 50000 }),
    ];
    const salidas: SalidaCripto[] = [
      salida({ id: 's1', fecha: new Date('2026-03-01'), valorEurCents: 60000 }),
      salida({ id: 's2', fecha: new Date('2026-04-01'), valorEurCents: 40000 }),
    ];

    const resumen = resumirEjercicio(entradas, salidas);

    expect(resumen.gananciasCents).toBe(10000);
    expect(resumen.perdidasCents).toBe(10000);
    expect(resumen.resultadoNetoCents).toBe(0);
  });

  it('cuenta como ingreso el valor al recibirlo', () => {
    // Es el importe de la factura: lo que se declara como venta, al margen de
    // lo que la moneda haga después.
    const resumen = resumirEjercicio([entrada({ valorEurCents: 50000 })], []);
    expect(resumen.ingresosPorVentasCents).toBe(50000);
  });
});

describe('Modelo 721', () => {
  it('obliga por encima de 50.000 €', () => {
    expect(obligaModelo721(UMBRAL_MODELO_721_CENTS + 1)).toBe(true);
    expect(obligaModelo721(UMBRAL_MODELO_721_CENTS)).toBe(false);
    expect(obligaModelo721(0)).toBe(false);
  });
});
