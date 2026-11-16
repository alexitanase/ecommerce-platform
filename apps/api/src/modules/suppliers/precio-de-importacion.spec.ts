import { describe, expect, it } from 'vitest';
import { precioDeImportacion, type ReglasDePrecio } from './precio-de-importacion.js';

/**
 * De dónde sale el precio de un producto importado.
 *
 * Es la decisión con más dinero encima de toda la importación masiva: se
 * aplica a mil productos de una vez y nadie va a repasarlos uno a uno. Un
 * error aquí no se ve —todos los precios parecen razonables— hasta que se
 * cuadran las cuentas del mes.
 */

const REGLAS: ReglasDePrecio = {
  margenObjetivo: 60,
  margenMinimo: 25,
  taxRate: 21,
  terminacion: 99,
};

describe('precio de importación', () => {
  it('con la estrategia del PVPR, el precio es EXACTAMENTE el del proveedor', () => {
    // 10,67 € de coste y 33,95 € de PVPR: la base son 28,06 €, así que quedan
    // 17,39 € por unidad. Sobra margen, y no hay ninguna razón para cobrar
    // otra cosa que lo que cobra el resto del sector.
    const precio = precioDeImportacion('pvpr', 1067, 3395, REGLAS);

    expect(precio.pvpCents).toBe(3395);
    expect(precio.origen).toBe('pvpr');
    expect(precio.margenReal).toBeGreaterThan(25);
    // Nada de redondeo psicológico: 33,95 € es el precio del proveedor, y
    // «mejorarlo» a 33,99 € es inventarse cuatro céntimos en mil productos.
    expect(precio.aviso).toBeUndefined();
  });

  it('respeta el PVPR aunque deje menos del margen mínimo', () => {
    /*
     * Un artículo de 10 € con un PVPR de 10,50 €: la base son 8,68 €, así que
     * a ese precio se pierde dinero. Aun así se publica a 10,50 €.
     *
     * Es una decisión tomada a conciencia: subirlo hasta que la cuenta cuadre
     * lo pone por encima de lo que cobra cualquier otra tienda —incluido el
     * propio proveedor— y no se vende ninguno, que es margen cero sobre cero
     * unidades. Lo que hay que hacer con un artículo así es dejar de venderlo,
     * y para eso primero hay que saber cuáles son.
     */
    const precio = precioDeImportacion('pvpr', 1000, 1050, REGLAS);

    expect(precio.pvpCents).toBe(1050);
    expect(precio.origen).toBe('pvpr');
    expect(precio.bajoMinimo).toBe(true);
    // Con las cifras dentro: margen, coste y precio, que es lo que hace falta
    // para decidir sobre ese artículo sin volver a mirar el catálogo.
    expect(precio.aviso).toContain('10.50');
    expect(precio.aviso).toContain('10.00');
  });

  it('no marca nada cuando el PVPR llega de sobra', () => {
    const precio = precioDeImportacion('pvpr', 1067, 3395, REGLAS);

    expect(precio.bajoMinimo).toBe(false);
    expect(precio.aviso).toBeUndefined();
  });

  it('sin PVPR publicado cae al cálculo por margen de siempre', () => {
    // Un cero no es un precio: es un campo que el proveedor no ha rellenado.
    const conCero = precioDeImportacion('pvpr', 1067, 0, REGLAS);
    const sinDato = precioDeImportacion('pvpr', 1067, undefined, REGLAS);
    const porMargen = precioDeImportacion('margen', 1067, 3395, REGLAS);

    expect(conCero.origen).toBe('margen');
    expect(sinDato.origen).toBe('margen');
    expect(conCero.pvpCents).toBe(porMargen.pvpCents);
    expect(conCero.margenReal).toBeGreaterThanOrEqual(60);
  });

  it('la estrategia por margen ignora el PVPR aunque venga', () => {
    const precio = precioDeImportacion('margen', 1067, 3395, REGLAS);

    expect(precio.origen).toBe('margen');
    expect(precio.pvpCents).not.toBe(3395);
  });

  it('el margen del PVPR se mide contra el coste REAL de compra', () => {
    /*
     * Con recargo y cargo fijo, el mismo PVPR deja de ser rentable.
     *
     * Es lo que pasa de verdad: el catálogo dice 10,67 €, y al pagar hay un
     * recargo de importación y una tasa fija por categoría que su fichero no
     * menciona. Medir el margen contra el precio de catálogo es exactamente el
     * fallo que dejó ocho productos vendiéndose por debajo de coste.
     *
     * El precio no cambia —sigue mandando el proveedor—, pero el artículo sale
     * marcado, que es lo que permite darse cuenta.
     */
    const conCostesOcultos = precioDeImportacion('pvpr', 1067, 2000, {
      ...REGLAS,
      recargoPct: 26,
      cargoFijoCents: 300,
    });

    expect(conCostesOcultos.costeCompraCents).toBe(Math.round(1067 * 1.26) + 300);
    expect(conCostesOcultos.pvpCents).toBe(2000);
    expect(conCostesOcultos.bajoMinimo).toBe(true);
  });
});
