import { describe, expect, it } from 'vitest';
import { BOM, escapar, generarCsv, importe, nombreFichero } from './csv.js';

/**
 * Nada de esto se ve hasta que alguien abre el fichero en Excel. Un fallo aquí
 * no da error: da un informe que parece roto y que nadie usa.
 */

describe('Formato para Excel español', () => {
  it('separa por punto y coma, no por coma', () => {
    // Con comas, Excel en español mete todo en la columna A.
    const csv = generarCsv(
      [{ a: 1, b: 2 }],
      [
        { titulo: 'A', valor: (f) => f.a },
        { titulo: 'B', valor: (f) => f.b },
      ],
    );

    expect(csv).toContain('A;B');
    expect(csv).toContain('1;2');
  });

  it('empieza por el BOM de UTF-8', () => {
    // Sin él, "Móvil" se abre como "MÃ³vil".
    const csv = generarCsv([{ n: 'Camisón' }], [{ titulo: 'Nombre', valor: (f) => f.n }]);

    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toContain('Camisón');
  });

  it('termina las líneas al estilo Windows', () => {
    const csv = generarCsv([{ a: 1 }], [{ titulo: 'A', valor: (f) => f.a }]);
    expect(csv).toContain('\r\n');
  });
});

describe('Importes', () => {
  it('usa coma decimal para que Excel pueda sumarlos', () => {
    // Con punto los lee como texto y el informe no sirve para calcular nada.
    expect(importe(4199)).toBe('41,99');
    expect(importe(100)).toBe('1,00');
  });

  it('mantiene siempre dos decimales', () => {
    expect(importe(500)).toBe('5,00');
    expect(importe(0)).toBe('0,00');
  });

  it('funciona con importes negativos, como los abonos', () => {
    expect(importe(-1550)).toBe('-15,50');
  });
});

describe('Escapado', () => {
  it('entrecomilla un texto con punto y coma', () => {
    // Sin esto, una descripción con ";" parte la fila y desplaza todas las
    // columnas siguientes sin que nada avise.
    expect(escapar('Botas negras; talla 42')).toBe('"Botas negras; talla 42"');
  });

  it('duplica las comillas internas', () => {
    expect(escapar('Camiseta "premium"')).toBe('"Camiseta ""premium"""');
  });

  it('entrecomilla los saltos de línea', () => {
    expect(escapar('Línea 1\nLínea 2')).toBe('"Línea 1\nLínea 2"');
  });

  it('deja el texto normal sin tocar', () => {
    expect(escapar('Botas de cuero')).toBe('Botas de cuero');
  });

  it('convierte null y undefined en celda vacía', () => {
    expect(escapar(null)).toBe('');
    expect(escapar(undefined)).toBe('');
  });

  it('serializa los objetos en vez de dejar "[object Object]"', () => {
    // Las columnas JSON, como los datos del cliente congelados en la factura,
    // llegan aquí como objeto. Sin esto la columna entera sale inservible y
    // nadie se entera hasta abrir el fichero.
    expect(escapar({ ciudad: 'Madrid' })).toBe('"{""ciudad"":""Madrid""}"');
    expect(escapar(['a', 'b'])).toBe('"[""a"",""b""]"');
  });

  it('formatea las fechas de forma legible', () => {
    expect(escapar(new Date('2026-07-26T14:30:00Z'))).toBe('2026-07-26 14:30:00');
  });
});

describe('Nombre del fichero', () => {
  it('lleva el rango de fechas', () => {
    // Sin fechas, exportar dos veces deja "informe(1).csv" en Descargas y no
    // hay forma de saber cuál es cuál.
    const nombre = nombreFichero(
      'ventas',
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-31T00:00:00Z'),
    );
    expect(nombre).toBe('ventas_2026-07-01_2026-07-31.csv');
  });
});

describe('Informe completo', () => {
  it('genera un CSV usable con datos reales', () => {
    const pedidos = [
      { numero: 'ES-2026-000001', cliente: 'ana@ejemplo.es', totalCents: 8999, notas: null },
      {
        numero: 'ES-2026-000002',
        cliente: 'luis@ejemplo.es',
        totalCents: 4199,
        notas: 'Urgente; regalo',
      },
    ];

    const csv = generarCsv(pedidos, [
      { titulo: 'Pedido', valor: (p) => p.numero },
      { titulo: 'Cliente', valor: (p) => p.cliente },
      { titulo: 'Total', valor: (p) => importe(p.totalCents) },
      { titulo: 'Notas', valor: (p) => p.notas },
    ]);

    const lineas = csv.replace(BOM, '').trim().split('\r\n');

    expect(lineas[0]).toBe('Pedido;Cliente;Total;Notas');
    expect(lineas[1]).toBe('ES-2026-000001;ana@ejemplo.es;89,99;');
    // La nota con punto y coma queda entrecomillada y no rompe la fila.
    expect(lineas[2]).toBe('ES-2026-000002;luis@ejemplo.es;41,99;"Urgente; regalo"');
    expect(lineas).toHaveLength(3);
  });
});
