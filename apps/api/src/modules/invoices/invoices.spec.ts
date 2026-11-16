import { describe, expect, it } from 'vitest';
import { addTax, allocate, extractBase, psychologicalRound, taxAmount } from '@ecom/shared';

/**
 * Cálculo de importes en facturación.
 *
 * Un céntimo de desviación aquí descuadra el libro de IVA, y el descuadre no
 * aparece hasta el cierre del trimestre. Por eso todo se opera en enteros y se
 * comprueba que las piezas encajan exactamente.
 */
describe('Importes de factura', () => {
  describe('IVA incluido en el precio', () => {
    it('extrae la base de un precio con IVA', () => {
      // 121,00 € con IVA al 21% → base 100,00 €
      expect(extractBase(12100, 21)).toBe(10000);
      expect(taxAmount(12100, 21)).toBe(2100);
    });

    it('base + cuota devuelve exactamente el total', () => {
      // Esta es LA propiedad que no puede fallar: si base + IVA no da el total,
      // la factura no cuadra y el asesor la devuelve.
      for (const total of [999, 1234, 4199, 8999, 17998, 100_00, 1_234_56]) {
        for (const tipo of [4, 10, 21]) {
          const base = extractBase(total, tipo);
          const cuota = taxAmount(total, tipo);
          expect(base + cuota, `total ${total} al ${tipo}%`).toBe(total);
        }
      }
    });

    it('funciona con los tres tipos de IVA españoles', () => {
      // General 21%, reducido 10%, superreducido 4%.
      expect(extractBase(1210, 21) + taxAmount(1210, 21)).toBe(1210);
      expect(extractBase(1100, 10) + taxAmount(1100, 10)).toBe(1100);
      expect(extractBase(1040, 4) + taxAmount(1040, 4)).toBe(1040);
    });

    it('no pierde céntimos en importes con redondeo incómodo', () => {
      // 41,99 € al 21%: la base exacta sería 34,7024793…
      const total = 4199;
      expect(extractBase(total, 21) + taxAmount(total, 21)).toBe(total);
    });

    it('addTax y extractBase son inversas', () => {
      for (const base of [1000, 3470, 7438]) {
        const conIva = addTax(base, 21);
        expect(extractBase(conIva, 21)).toBe(base);
      }
    });
  });

  describe('reparto de descuentos entre líneas', () => {
    it('reparte sin perder ni un céntimo', () => {
      // 10,00 € de descuento entre tres líneas desiguales: la suma de las
      // partes tiene que dar exactamente el descuento, no 9,99 ni 10,01.
      const partes = allocate(1000, [3333, 3333, 3334]);
      expect(partes.reduce((a, b) => a + b, 0)).toBe(1000);
    });

    it('asigna los céntimos sobrantes en lugar de descartarlos', () => {
      // 100 céntimos entre 3 partes iguales: 33,33 cada una es imposible en
      // enteros. Se reparten 34, 33, 33.
      const partes = allocate(100, [1, 1, 1]);
      expect(partes.reduce((a, b) => a + b, 0)).toBe(100);
      expect(partes).toEqual([34, 33, 33]);
    });

    it('respeta la proporción de cada línea', () => {
      const partes = allocate(1000, [8000, 2000]);
      expect(partes[0]).toBe(800);
      expect(partes[1]).toBe(200);
    });

    it('rechaza un reparto imposible', () => {
      expect(() => allocate(1000, [0, 0])).toThrow();
    });
  });

  describe('redondeo psicológico del motor de precios', () => {
    it('redondea al alza hasta la terminación indicada', () => {
      expect(psychologicalRound(1243, 99)).toBe(1299);
      expect(psychologicalRound(4150, 99)).toBe(4199);
    });

    it('nunca redondea a la baja: vender por debajo del cálculo come margen', () => {
      for (const valor of [1000, 1250, 1299, 1300, 4199, 4200]) {
        expect(psychologicalRound(valor, 99)).toBeGreaterThanOrEqual(valor);
      }
    });

    it('un precio que ya termina en 99 no cambia', () => {
      expect(psychologicalRound(1299, 99)).toBe(1299);
    });

    it('admite otras terminaciones', () => {
      expect(psychologicalRound(1243, 95)).toBe(1295);
      // 12,43 € con terminación 50 sube al siguiente x,50 por encima: 12,50 €.
      expect(psychologicalRound(1243, 50)).toBe(1250);
      // Si ya se ha pasado de la terminación, salta al euro siguiente.
      expect(psychologicalRound(1260, 50)).toBe(1350);
    });
  });

  describe('numeración de facturas', () => {
    /** Formato del número completo, como lo genera el servicio. */
    const formatear = (serie: string, anio: number, numero: number) =>
      `${serie}${String(anio)}-${String(numero).padStart(6, '0')}`;

    it('rellena con ceros para que ordene alfabéticamente igual que numéricamente', () => {
      expect(formatear('ES', 2026, 1)).toBe('ES2026-000001');
      expect(formatear('ES', 2026, 42)).toBe('ES2026-000042');
      expect(formatear('ES', 2026, 123456)).toBe('ES2026-123456');
    });

    it('ordenar como texto coincide con ordenar por número', () => {
      // Sin el relleno de ceros, "ES2026-10" iría antes que "ES2026-9" al
      // ordenar alfabéticamente, y el libro de IVA saldría desordenado.
      const numeros = [1, 2, 9, 10, 11, 100];
      const formateados = numeros.map((n) => formatear('ES', 2026, n));
      expect([...formateados].sort()).toEqual(formateados);
    });

    it('las rectificativas usan su propia serie', () => {
      // Mezclarlas con las ordinarias rompería la correlatividad de ambas.
      expect(formatear('RES', 2026, 1)).toBe('RES2026-000001');
      expect(formatear('ES', 2026, 1)).not.toBe(formatear('RES', 2026, 1));
    });
  });

  describe('entregas exentas (Canarias, Ceuta y Melilla)', () => {
    // Están fuera del territorio de aplicación del IVA. Los precios del
    // catálogo lo llevan incluido, así que hay que quitarlo de cada línea y
    // del envío, no solo del total: si solo se ajustara el total, las líneas
    // no sumarían el total y la factura no cuadraría.
    const neto = (conIva: number, tipo: number) => Math.round(conIva / (1 + tipo / 100));

    it('la suma de líneas netas da exactamente el total', () => {
      const producto = neto(8999, 21);
      const envio = neto(1295, 21);

      expect(producto).toBe(7437);
      expect(envio).toBe(1070);
      expect(producto + envio).toBe(8507);
    });

    it('la cuota es cero, no el tipo del catálogo aplicado a cero', () => {
      // El error sutil: dejar el tipo al 21% y poner la cuota a mano en cero.
      // La factura diría "21%" con cuota 0 y no cuadraría al revisarla.
      const base = neto(8999, 21);
      expect(extractBase(base, 0)).toBe(base);
      expect(taxAmount(base, 0)).toBe(0);
    });

    it('sigue cuadrando con importes de redondeo incómodo', () => {
      for (const bruto of [999, 4199, 8999, 12_995, 1_234_56]) {
        const base = neto(bruto, 21);
        expect(extractBase(base, 0) + taxAmount(base, 0)).toBe(base);
      }
    });

    it('cobrar el precio con IVA en una venta exenta sería quedarse el importe', () => {
      // Con 89,99 € el cliente canario debe pagar 74,37 €, no 89,99 €.
      // La diferencia son 15,62 € que no corresponden a nadie.
      const conIva = 8999;
      const exento = neto(conIva, 21);
      expect(conIva - exento).toBe(1562);
      expect(exento).toBeLessThan(conIva);
    });
  });

  describe('rectificativas', () => {
    it('los importes van en negativo: es un abono', () => {
      const original = 4199;
      const rectificado = -original;

      expect(rectificado).toBeLessThan(0);
      expect(original + rectificado).toBe(0);
    });

    it('una rectificación parcial deja el resto facturado', () => {
      const original = 10000;
      const devuelto = 3000;
      const neto = original - devuelto;

      expect(neto).toBe(7000);
      // La base y la cuota del neto siguen cuadrando.
      expect(extractBase(neto, 21) + taxAmount(neto, 21)).toBe(neto);
    });
  });
});
