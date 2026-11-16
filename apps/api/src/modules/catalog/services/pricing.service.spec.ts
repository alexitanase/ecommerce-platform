import { describe, expect, it } from 'vitest';
import { PricingService } from './pricing.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Lo que decide a cuánto se vende cada cosa.
 *
 * El negocio es dropshipping: se compra a un proveedor que cambia sus precios
 * cuando quiere y se revende con un margen. Si este cálculo se equivoca, no
 * salta ninguna alarma —el pedido entra, el cliente paga, la mercancía sale—
 * y solo se descubre al cerrar el mes con menos dinero del que debería.
 *
 * Todo lo que se prueba aquí es cálculo puro, sin base de datos: la única
 * consulta del servicio (`variantesBajoMargen`) es un `findMany` sin lógica
 * propia, y lo que decide de verdad —`analizarMargen`— sí se prueba.
 */

const precios = () => new PricingService(null as unknown as PrismaService);

describe('Desglose de un precio con IVA incluido', () => {
  it('separa base y cuota sin perder un céntimo', () => {
    // En España el escaparate muestra el precio final, así que la base
    // siempre se calcula hacia atrás. Si base + cuota no diera exactamente el
    // precio, la factura no cuadraría con lo cobrado.
    const d = precios().desglosar(1299, 21);

    expect(d.totalCents).toBe(1299);
    expect(d.baseCents + d.ivaCents).toBe(1299);
    expect(d.taxRate).toBe(21);
  });

  it('calcula el porcentaje de rebaja sobre el precio tachado', () => {
    const d = precios().desglosar(1999, 21, 3999);

    expect(d.compareAtCents).toBe(3999);
    expect(d.descuentoPorcentaje).toBe(50);
  });

  it('no anuncia rebaja si el precio tachado no es mayor', () => {
    // Anunciar un descuento que no existe es publicidad engañosa, y con la
    // directiva Omnibus tiene multa.
    expect(precios().desglosar(1999, 21, 1999).descuentoPorcentaje).toBeNull();
    expect(precios().desglosar(1999, 21, 999).descuentoPorcentaje).toBeNull();
    expect(precios().desglosar(1999, 21, null).descuentoPorcentaje).toBeNull();
    expect(precios().desglosar(1999, 21).descuentoPorcentaje).toBeNull();
  });

  it('con IVA cero la cuota es cero', () => {
    // Pasa de verdad: ventas exentas fuera de la UE.
    const d = precios().desglosar(1299, 0);

    expect(d.baseCents).toBe(1299);
    expect(d.ivaCents).toBe(0);
  });
});

describe('Análisis del margen', () => {
  it('calcula beneficio, porcentaje y multiplicador sobre lo que se ingresa', () => {
    // 20 € de escaparate son 16,53 € de ingreso: los 3,47 € restantes son el
    // IVA, que se cobra pero no es nuestro. La cuenta y el porqué están en
    // `margen.spec.ts`.
    const m = precios().analizarMargen(2000, 800, 21);

    expect(m.ingresoCents).toBe(1653);
    expect(m.margenBrutoCents).toBe(853);
    expect(m.margenPorcentaje).toBe(52);
    expect(m.multiplicador).toBe(2.07);
  });

  it('un margen negativo se ve como negativo', () => {
    // Es el caso que hay que detectar: el proveedor subió el precio y
    // seguimos vendiendo al mismo PVP, perdiendo en cada pedido.
    const m = precios().analizarMargen(1000, 1500, 21);

    expect(m.margenBrutoCents).toBeLessThan(0);
    expect(m.margenPorcentaje).toBeLessThan(0);
  });

  it('no divide por cero', () => {
    // Un producto regalado o sin coste registrado no puede reventar el
    // informe de márgenes entero.
    expect(precios().analizarMargen(0, 500, 21).margenPorcentaje).toBe(0);
    expect(precios().analizarMargen(1000, 0, 21).multiplicador).toBe(0);
  });
});

describe('PVP a partir del coste del proveedor', () => {
  it('aplica el margen objetivo sobre la base y le añade el IVA', () => {
    // 10 € de coste al 60 % de margen dan una base de 25 €; con el 21 % son
    // 30,25 € y el redondeo psicológico lo deja en 30,99.
    //
    // Antes salía 25,99, y de ahí 4,51 € se los llevaba Hacienda: el margen
    // real era del 26 %, no del 60. Ese es el fallo que se arregló.
    const r = precios().calcularPvp({ costeCents: 1000, margenObjetivo: 60, taxRate: 21 });

    expect(r.pvpCents).toBe(3099);
    expect(r.margenReal).toBeGreaterThanOrEqual(60);
  });

  it('el redondeo nunca baja el margen por debajo del objetivo', () => {
    // Redondear a la baja sería vender por debajo de lo que acaba de
    // calcularse. Se comprueba en un barrido, no en un caso suelto.
    for (let coste = 100; coste <= 5000; coste += 137) {
      for (const objetivo of [30, 45, 60, 75]) {
        const r = precios().calcularPvp({
          costeCents: coste,
          margenObjetivo: objetivo,
          taxRate: 21,
        });
        expect(r.margenReal, `coste ${coste} margen ${objetivo}`).toBeGreaterThanOrEqual(objetivo);
      }
    }
  });

  it('el coste de envío entra en el precio si no se cobra aparte', () => {
    const sinEnvio = precios().calcularPvp({ costeCents: 1000, margenObjetivo: 50, taxRate: 21 });
    const conEnvio = precios().calcularPvp({
      costeCents: 1000,
      margenObjetivo: 50,
      envioCents: 500,
      taxRate: 21,
    });

    expect(conEnvio.pvpCents).toBeGreaterThan(sinEnvio.pvpCents);
  });

  it('se puede pedir sin redondear', () => {
    const r = precios().calcularPvp({
      costeCents: 1000,
      margenObjetivo: 50,
      taxRate: 21,
      redondear: false,
    });

    expect(r.pvpCents).toBe(2420);
    expect(r.baseCents).toBe(2000);
  });

  it('admite otra terminación', () => {
    const r = precios().calcularPvp({
      costeCents: 1000,
      margenObjetivo: 60,
      taxRate: 21,
      terminacion: 95,
    });

    expect(r.pvpCents % 100).toBe(95);
  });

  it('avisa si el resultado no llega al margen mínimo', () => {
    // El aviso es para quien importa el catálogo: publicar sin verlo es
    // meter en la tienda productos que dan pérdidas.
    const r = precios().calcularPvp({
      costeCents: 1000,
      margenObjetivo: 20,
      taxRate: 21,
      margenMinimo: 40,
    });

    expect(r.aviso).toContain('40');
    expect(r.margenReal).toBeLessThan(40);
  });

  it('sin margen mínimo no hay aviso', () => {
    expect(
      precios().calcularPvp({ costeCents: 1000, margenObjetivo: 60, taxRate: 21 }).aviso,
    ).toBeUndefined();
  });

  it('un margen del 100 % o más es imposible y se rechaza', () => {
    // La fórmula divide por (1 - margen): al 100 % es una división por cero,
    // y por encima daría un precio NEGATIVO. Publicar eso sería regalar el
    // producto y pagar por hacerlo.
    for (const objetivo of [100, 120]) {
      const r = precios().calcularPvp({ costeCents: 1000, margenObjetivo: objetivo, taxRate: 21 });

      expect(r.aviso).toBeDefined();
      expect(r.pvpCents).toBeGreaterThan(0);
      expect(Number.isFinite(r.pvpCents)).toBe(true);
    }
  });

  it('un coste de cero no produce precios absurdos', () => {
    const r = precios().calcularPvp({ costeCents: 0, margenObjetivo: 60, taxRate: 21 });

    expect(Number.isInteger(r.pvpCents)).toBe(true);
    expect(r.pvpCents).toBeGreaterThanOrEqual(0);
  });
});

describe('Aplicar IVA a un coste sin impuestos', () => {
  it('suma el tipo indicado', () => {
    // Los costes del proveedor llegan sin IVA; el catálogo los guarda con él.
    expect(precios().aplicarIva(1000, 21)).toBe(1210);
    expect(precios().aplicarIva(1000, 0)).toBe(1000);
  });
});
