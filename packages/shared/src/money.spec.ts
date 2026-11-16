import { describe, expect, it } from 'vitest';
import {
  addTax,
  allocate,
  decimalsFor,
  extractBase,
  formatMoney,
  fromCents,
  leerImporte,
  psychologicalRound,
  taxAmount,
  toCents,
} from './money.js';

/**
 * El módulo que decide todos los importes de la tienda.
 *
 * Lo usan el catálogo, el checkout, las facturas y las declaraciones de IVA, y
 * hasta ahora no tenía ni una prueba propia: se ejercitaba de refilón desde
 * otros paquetes. Un céntimo mal repartido aquí no rompe nada visiblemente;
 * aparece semanas después como una factura que no cuadra con lo cobrado, que es
 * de lo más caro de investigar.
 */

describe('Conversión entre euros y céntimos', () => {
  it('convierte a entero sin arrastrar coma flotante', () => {
    // 12.99 * 100 en coma flotante da 1298.9999999999998. Truncar en vez de
    // redondear costaría un céntimo por línea de pedido.
    expect(toCents(12.99)).toBe(1299);
    expect(Number.isInteger(toCents(12.99))).toBe(true);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it('respeta los decimales de cada moneda', () => {
    // El yen no tiene céntimos: tratarlo como el euro multiplicaría por cien
    // el precio de todo el catálogo.
    expect(decimalsFor('JPY')).toBe(0);
    expect(toCents(1500, 'JPY')).toBe(1500);
    expect(fromCents(1500, 'JPY')).toBe(1500);
  });

  it('una moneda desconocida se trata con dos decimales', () => {
    // Es lo que hace la inmensa mayoría; equivocarse por defecto en la
    // dirección contraria sería peor.
    expect(decimalsFor('CHF')).toBe(2);
    expect(decimalsFor('eur')).toBe(2);
  });

  it('ida y vuelta no pierde nada', () => {
    for (const cents of [0, 1, 99, 100, 4999, 123456]) {
      expect(toCents(fromCents(cents))).toBe(cents);
    }
  });

  it('formatea en español con el símbolo detrás', () => {
    // El espacio es un espacio duro (U+00A0), no uno normal: comparar con un
    // espacio corriente hace fallar la prueba sin que se vea por qué.
    expect(formatMoney(1299)).toBe('12,99 €');
    expect(formatMoney(0)).toBe('0,00 €');
  });
});

describe('Reparto de descuentos y portes entre líneas', () => {
  it('no pierde ni un céntimo', () => {
    // Es la razón de ser de la función: 10 € entre tres líneas iguales no se
    // puede dividir en partes exactas, y lo que no se reparta desaparece del
    // total del pedido.
    const partes = allocate(1000, [1, 1, 1]);

    expect(partes).toEqual([334, 333, 333]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('reparte en proporción al importe de cada línea', () => {
    const partes = allocate(1000, [7000, 3000]);

    expect(partes).toEqual([700, 300]);
  });

  it('los céntimos sobrantes van a las primeras líneas', () => {
    // Tienen que ir a alguna parte y a la misma siempre: si el reparto no
    // fuera determinista, recalcular un pedido daría importes distintos.
    const partes = allocate(100, [1, 1, 1, 1, 1, 1, 1]);

    expect(partes.reduce((a, b) => a + b, 0)).toBe(100);
    expect(partes[0]).toBeGreaterThanOrEqual(partes[6] ?? 0);
  });

  it('una línea con importe cero no recibe nada', () => {
    expect(allocate(1000, [0, 1])).toEqual([0, 1000]);
  });

  it('sin nada que repartir devuelve ceros', () => {
    expect(allocate(0, [1, 2, 3])).toEqual([0, 0, 0]);
  });

  it('reparte también importes negativos sin descuadrar', () => {
    // Ocurre al revertir un descuento en una devolución parcial.
    const partes = allocate(-1000, [1, 1, 1]);

    expect(partes.reduce((a, b) => a + b, 0)).toBe(-1000);
  });

  it('se niega a repartir si los ratios no suman nada', () => {
    // Dividir por cero daría NaN en cada línea y el pedido se guardaría con
    // importes no numéricos. Mejor un error aquí.
    expect(() => allocate(1000, [])).toThrow();
    expect(() => allocate(1000, [0, 0])).toThrow();
  });

  it('todas las partes son enteras', () => {
    for (const parte of allocate(997, [3, 5, 11])) {
      expect(Number.isInteger(parte)).toBe(true);
    }
  });
});

describe('IVA sobre el precio', () => {
  it('añade el tipo a una base imponible', () => {
    expect(addTax(1000, 21)).toBe(1210);
    expect(addTax(1000, 10)).toBe(1100);
    expect(addTax(1000, 0)).toBe(1000);
  });

  it('extrae la base de un precio con el IVA dentro', () => {
    // En España los precios se muestran con IVA incluido, así que la base de
    // la factura siempre se calcula hacia atrás.
    expect(extractBase(1210, 21)).toBe(1000);
    expect(extractBase(1100, 10)).toBe(1000);
  });

  it('la base y la cuota suman exactamente el precio', () => {
    // Es la única invariante que la factura necesita. El redondeo hace que
    // volver a aplicar el tipo a la base NO devuelva siempre el precio
    // original (1299 al 21 % da 1300), y por eso la cuota se calcula restando
    // en vez de multiplicando.
    for (const precio of [1299, 999, 4550, 1, 33333]) {
      for (const tipo of [0, 4, 10, 21]) {
        expect(extractBase(precio, tipo) + taxAmount(precio, tipo)).toBe(precio);
      }
    }
  });

  it('sin IVA la cuota es cero', () => {
    expect(taxAmount(1299, 0)).toBe(0);
    expect(extractBase(1299, 0)).toBe(1299);
  });
});

describe('Redondeo psicológico', () => {
  it('sube al ,99 del mismo euro cuando cabe', () => {
    expect(psychologicalRound(1243)).toBe(1299);
    expect(psychologicalRound(1201)).toBe(1299);
  });

  it('un precio que ya termina en 99 no se mueve', () => {
    // Recalcular el precio de un producto no puede encarecerlo un euro cada
    // vez que se ejecuta el motor de precios.
    expect(psychologicalRound(1299)).toBe(1299);
  });

  it('pasa al euro siguiente si no cabe', () => {
    expect(psychologicalRound(1300)).toBe(1399);
  });

  it('nunca abarata el precio calculado', () => {
    // Redondear a la baja vendería por debajo del margen mínimo que acaba de
    // calcular el motor de precios.
    for (const cents of [1, 50, 99, 100, 101, 999, 1000, 12345]) {
      expect(psychologicalRound(cents)).toBeGreaterThanOrEqual(cents);
    }
  });

  it('admite otra terminación', () => {
    expect(psychologicalRound(1243, 95)).toBe(1295);
    expect(psychologicalRound(1296, 95)).toBe(1395);
  });
});

describe('leerImporte', () => {
  /**
   * El caso que costó dinero: en el editor de productos, un importe que el
   * parser no entendía se convertía en `null` y BORRABA el precio tachado que
   * ya estaba guardado, sin dar ningún error. Distinguir «vacío» de «no lo
   * entiendo» es todo el punto de esta función.
   */
  it('distingue el campo vacío de lo que no sabe interpretar', () => {
    expect(leerImporte('')).toEqual({ estado: 'vacio' });
    expect(leerImporte('   ')).toEqual({ estado: 'vacio' });
    expect(leerImporte('abc')).toEqual({ estado: 'invalido' });
    expect(leerImporte('-5')).toEqual({ estado: 'invalido' });
  });

  it('acepta coma y punto como decimal', () => {
    expect(leerImporte('31,23')).toEqual({ estado: 'importe', cents: 3123 });
    expect(leerImporte('31.23')).toEqual({ estado: 'importe', cents: 3123 });
  });

  it('acepta el símbolo del euro, que es lo que se teclea', () => {
    // Escribir «31,23 €» borraba el precio tachado guardado.
    expect(leerImporte('31,23 €')).toEqual({ estado: 'importe', cents: 3123 });
    expect(leerImporte('31.23€')).toEqual({ estado: 'importe', cents: 3123 });
    expect(leerImporte(' 49,99 EUR ')).toEqual({ estado: 'importe', cents: 4999 });
  });

  it('resuelve los separadores de miles por el último separador', () => {
    // `.replace(',', '.')` solo cambiaba la PRIMERA coma: «1.299,00» acababa
    // siendo «1.299.00», que no es un número.
    expect(leerImporte('1.299,00')).toEqual({ estado: 'importe', cents: 129900 });
    expect(leerImporte('1,299.00')).toEqual({ estado: 'importe', cents: 129900 });
    expect(leerImporte('1 299,00')).toEqual({ estado: 'importe', cents: 129900 });
    expect(leerImporte('1299,00')).toEqual({ estado: 'importe', cents: 129900 });
  });

  it('trata el espacio irrompible como un espacio', () => {
    // Es el que aparece al copiar un precio desde Windows o desde una web.
    expect(leerImporte('49,99\u00A0€')).toEqual({ estado: 'importe', cents: 4999 });
  });

  it('redondea en lugar de truncar', () => {
    // 12.99 * 100 en coma flotante da 1298.9999999999998.
    expect(leerImporte('12,99')).toEqual({ estado: 'importe', cents: 1299 });
    expect(leerImporte('0,005')).toEqual({ estado: 'importe', cents: 1 });
  });

  it('rechaza las erratas con varios separadores sueltos', () => {
    for (const basura of ['12.3.4.5.6', '12,,3', '1.2.3,4,5', '12-', '+12', '1e3']) {
      expect(leerImporte(basura), basura).toEqual({ estado: 'invalido' });
    }
  });

  it('acepta el cero, que es un importe legítimo', () => {
    expect(leerImporte('0')).toEqual({ estado: 'importe', cents: 0 });
    expect(leerImporte('0,00')).toEqual({ estado: 'importe', cents: 0 });
  });
});
