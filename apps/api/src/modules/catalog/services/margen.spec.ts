import { describe, expect, it } from 'vitest';
import { cargoFijoAplicable, costeDeCompra, margenDeVenta, pvpParaMargen } from './margen.js';

/**
 * El caso real que hay detrás: pedido ES-2026-000002 de chispaynoche.com.
 *
 * Coste en AliExpress 13,99 €, PVP 18,99 €, «26 % de margen» según el panel.
 * El pedido salió por 15,69 € —una importación sin IOSS va sin IVA español— y
 * el margen de verdad era 1,70 €. Con la comisión de la pasarela, pérdida.
 */
const COSTE = 1399;
const PVP_QUE_SE_PUSO = 1899;

/**
 * El cargo real de aquel pedido, tal y como lo enseña AliExpress:
 *
 *   Subtotal                        15,37 $
 *   Envío                            0,00 $
 *   Cargos de importación estimados  4,09 $
 *   Total                           19,46 $   =  16,89 €
 *
 * De los tres conceptos, la API de producto solo conoce el primero.
 */
const RECARGO_ALIEXPRESS = 26;

describe('costeDeCompra', () => {
  it('suma el recargo que el proveedor añade al pagar', () => {
    // 13,99 € cotizados → 17,63 € reales. Lo que se pagó fueron 16,89 €: el
    // recargo lo aproxima por arriba, que es el lado seguro para poner precio.
    expect(costeDeCompra({ costCents: COSTE }, RECARGO_ALIEXPRESS)).toBe(1763);
  });

  it('el recargo se aplica también sobre el porte', () => {
    // Los cargos de importación se calculan sobre el valor del envío completo,
    // no solo sobre la mercancía.
    expect(costeDeCompra({ costCents: 1000, envioCents: 500 }, 26)).toBe(1890);
  });

  it('sin recargo es la suma de siempre', () => {
    expect(costeDeCompra({ costCents: 1000, envioCents: 500 })).toBe(1500);
    expect(costeDeCompra({ costCents: 1000, envioCents: 500 }, 0)).toBe(1500);
  });

  it('el cargo fijo se suma después del porcentaje', () => {
    // El porcentaje son cargos de importación sobre el valor declarado; el
    // cargo fijo es una tasa de gestión. No se aplica el uno sobre el otro.
    expect(costeDeCompra({ costCents: 1000, cargoFijoCents: 300 }, 26)).toBe(1560);
  });

  it('el mismo cargo fijo pesa muy distinto según el precio', () => {
    // Este es el motivo de que no sea un porcentaje. Sobre un artículo barato
    // se come el margen entero; sobre uno caro casi no se nota.
    const barato = costeDeCompra({ costCents: 1400, cargoFijoCents: 300 });
    const caro = costeDeCompra({ costCents: 6000, cargoFijoCents: 300 });

    expect(Math.round(((barato - 1400) / 1400) * 100)).toBe(21);
    expect(Math.round(((caro - 6000) / 6000) * 100)).toBe(5);
  });
});

describe('cargoFijoAplicable', () => {
  const REGLAS = { importeCents: 300, umbralCents: 15_000 };

  it('se aplica por debajo del umbral de bajo valor', () => {
    expect(cargoFijoAplicable(1399, REGLAS)).toBe(300);
    expect(cargoFijoAplicable(14_999, REGLAS)).toBe(300);
  });

  it('no se aplica a partir del umbral', () => {
    // Por encima el envío entra por el régimen general: aranceles y gestión del
    // transportista, que son otra cosa. Seguir sumando 3 € ahí sería inventar.
    expect(cargoFijoAplicable(15_000, REGLAS)).toBe(0);
    expect(cargoFijoAplicable(30_000, REGLAS)).toBe(0);
  });

  it('un proveedor sin cargo configurado no paga ninguno', () => {
    expect(cargoFijoAplicable(1399, { importeCents: 0, umbralCents: 15_000 })).toBe(0);
  });
});

describe('margenDeVenta', () => {
  it('mide sobre la base imponible, no sobre el precio de escaparate', () => {
    const m = margenDeVenta(PVP_QUE_SE_PUSO, COSTE, 21);

    // 18,99 / 1,21 = 15,69. Eso es lo que se ingresa; los 3,30 restantes son de
    // Hacienda tanto si se cobran al cliente como si la venta va exenta.
    expect(m.ingresoCents).toBe(1569);
    expect(m.margenCents).toBe(170);
    expect(m.porcentaje).toBe(11);

    // Y no el 26 % que decía el panel, que es esta cuenta de aquí:
    expect(Math.round(((PVP_QUE_SE_PUSO - COSTE) / PVP_QUE_SE_PUSO) * 100)).toBe(26);
  });

  it('un precio por debajo del coste da margen negativo', () => {
    const m = margenDeVenta(1500, COSTE, 21);
    expect(m.ingresoCents).toBe(1240);
    expect(m.margenCents).toBe(-159);
    expect(m.porcentaje).toBeLessThan(0);
  });

  it('sin IVA la base es el propio precio', () => {
    // Productos a tipo cero: ahí las dos cuentas coinciden, y por eso el fallo
    // pasaba desapercibido en las pruebas que no ponían tipo.
    expect(margenDeVenta(2000, 800, 0)).toMatchObject({
      ingresoCents: 2000,
      margenCents: 1200,
      porcentaje: 60,
    });
  });

  it('el tipo reducido deja más margen que el general al mismo precio', () => {
    const general = margenDeVenta(2000, 800, 21);
    const reducido = margenDeVenta(2000, 800, 10);
    expect(reducido.porcentaje).toBeGreaterThan(general.porcentaje);
  });

  it('no divide por cero', () => {
    expect(margenDeVenta(0, 500, 21).porcentaje).toBe(0);
    expect(margenDeVenta(1000, 0, 21).multiplicador).toBe(0);
  });
});

describe('pvpParaMargen', () => {
  it('el precio que debió ponerse a aquel producto', () => {
    const r = pvpParaMargen({ costeCents: COSTE, margenObjetivo: 26, taxRate: 21 });

    // Base 18,91 → con IVA 22,88 → redondeo psicológico 22,99.
    expect(r.pvpCents).toBe(2299);
    expect(r.margenReal).toBeGreaterThanOrEqual(26);

    // Cuatro euros por encima de lo que se puso. Esa es la diferencia entre
    // ganar dinero y perderlo en cada venta.
    expect(r.pvpCents - PVP_QUE_SE_PUSO).toBe(400);
  });

  it('el margen prometido se cumple midiéndolo sobre la base', () => {
    for (const objetivo of [10, 25, 40, 60, 75]) {
      for (const coste of [199, 1399, 4550, 12000]) {
        const r = pvpParaMargen({ costeCents: coste, margenObjetivo: objetivo, taxRate: 21 });
        const comprobado = margenDeVenta(r.pvpCents, coste, 21);

        expect(comprobado.porcentaje).toBeGreaterThanOrEqual(objetivo);
        expect(r.margenReal).toBe(comprobado.porcentaje);
        // El redondeo sube, pero no puede regalar más de un euro de margen.
        expect(comprobado.ingresoCents - coste / (1 - objetivo / 100)).toBeLessThan(100);
      }
    }
  });

  it('con el recargo del proveedor, el precio de aquel producto sube otro escalón', () => {
    const sinRecargo = pvpParaMargen({ costeCents: COSTE, margenObjetivo: 26, taxRate: 21 });
    const conRecargo = pvpParaMargen({
      costeCents: COSTE,
      recargoPct: RECARGO_ALIEXPRESS,
      margenObjetivo: 26,
      taxRate: 21,
    });

    expect(sinRecargo.pvpCents).toBe(2299);
    expect(conRecargo.pvpCents).toBe(2899);
    expect(conRecargo.costeCompraCents).toBe(1763);

    // Y lo que de verdad importa: al precio nuevo se gana dinero contando el
    // cargo real de 16,89 €; al viejo —18,99 €— se perdía.
    expect(margenDeVenta(conRecargo.pvpCents, 1689, 21).margenCents).toBeGreaterThan(0);
    expect(margenDeVenta(PVP_QUE_SE_PUSO, 1689, 21).margenCents).toBeLessThan(0);
  });

  it('el precio con TODO lo que se paga de verdad', () => {
    // El coste completo de aquel producto: 13,99 € de artículo, +26 % de cargos
    // de importación y 3 € de tasa fija por categoría → 20,63 €.
    const r = pvpParaMargen({
      costeCents: COSTE,
      recargoPct: RECARGO_ALIEXPRESS,
      cargoFijoCents: 300,
      margenObjetivo: 26,
      taxRate: 21,
    });

    expect(r.costeCompraCents).toBe(2063);
    expect(r.pvpCents).toBe(3399);

    // Contra los 18,99 € que llegó a tener puestos: el producto valía 34 €.
    expect(r.pvpCents).toBeGreaterThan(PVP_QUE_SE_PUSO * 1.7);
  });

  it('el margen prometido se cumple contando el recargo', () => {
    for (const objetivo of [25, 40, 60]) {
      const r = pvpParaMargen({
        costeCents: 1399,
        recargoPct: RECARGO_ALIEXPRESS,
        margenObjetivo: objetivo,
        taxRate: 21,
      });

      expect(margenDeVenta(r.pvpCents, r.costeCompraCents, 21).porcentaje).toBeGreaterThanOrEqual(
        objetivo,
      );
    }
  });

  it('el porte del proveedor entra en el coste', () => {
    const sinEnvio = pvpParaMargen({ costeCents: 1000, margenObjetivo: 50, taxRate: 21 });
    const conEnvio = pvpParaMargen({
      costeCents: 1000,
      envioCents: 500,
      margenObjetivo: 50,
      taxRate: 21,
    });

    expect(conEnvio.pvpCents).toBeGreaterThan(sinEnvio.pvpCents);
    // Y el margen se sigue cumpliendo CONTANDO el porte, que es lo que se paga.
    expect(margenDeVenta(conEnvio.pvpCents, 1500, 21).porcentaje).toBeGreaterThanOrEqual(50);
  });

  it('avisa cuando el resultado no llega al mínimo del proveedor', () => {
    const r = pvpParaMargen({
      costeCents: 1399,
      margenObjetivo: 20,
      taxRate: 21,
      margenMinimo: 25,
    });

    expect(r.margenReal).toBeLessThan(25);
    expect(r.aviso).toContain('25%');
  });

  it('sin redondeo el precio es el exacto', () => {
    const r = pvpParaMargen({
      costeCents: 1000,
      margenObjetivo: 50,
      taxRate: 21,
      redondear: false,
    });

    // Base 20,00 → 24,20 con IVA, sin adornos.
    expect(r.pvpCents).toBe(2420);
    expect(r.baseCents).toBe(2000);
  });

  it('respeta la terminación pedida', () => {
    const r = pvpParaMargen({
      costeCents: 1000,
      margenObjetivo: 50,
      taxRate: 21,
      terminacion: 95,
    });
    expect(r.pvpCents % 100).toBe(95);
  });

  it('un margen del 100 % o más no tiene solución', () => {
    const r = pvpParaMargen({ costeCents: 1000, margenObjetivo: 100, taxRate: 21 });
    expect(r.aviso).toContain('menor que 100%');
    // Se devuelve el coste con su IVA: vender a eso no gana nada, pero tampoco
    // pierde, que es mejor que devolver un precio inventado.
    expect(r.pvpCents).toBe(1210);
    expect(r.margenReal).toBe(0);
  });

  it('el redondeo nunca baja el precio por debajo del que da el margen', () => {
    for (let coste = 100; coste <= 5000; coste += 137) {
      const r = pvpParaMargen({ costeCents: coste, margenObjetivo: 30, taxRate: 21 });
      expect(r.pvpCents).toBeGreaterThanOrEqual(Math.round((coste / 0.7) * 1.21));
    }
  });
});
