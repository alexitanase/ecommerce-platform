import { describe, expect, it } from 'vitest';
import {
  agruparDeclaracion,
  rangoTrimestre,
  trimestreDe,
  type VentaDeclarable,
} from './informe-oss.js';

/**
 * El modelo 369 reparte lo recaudado entre las haciendas de cada país. Una
 * línea de menos no es un descuadre: es un país al que no le llega lo suyo, y
 * se descubre cuando reclama.
 */

const venta = (parcial: Partial<VentaDeclarable> = {}): VentaDeclarable => ({
  numero: 'ES-2026-000001',
  regimen: 'OSS',
  paisRecaudador: 'FR',
  tramos: [{ tipo: 20, baseCents: 10_000, cuotaCents: 2000 }],
  necesitaRevision: false,
  ...parcial,
});

describe('Trimestres', () => {
  it('el rango llega hasta el último instante del último día', () => {
    // Con "día 30 a las 00:00" se quedarían fuera las ventas del último día,
    // que en campaña son las que más pesan.
    const { desde, hasta } = rangoTrimestre(2026, 2);
    expect(desde.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(hasta.toISOString()).toBe('2026-06-30T23:59:59.999Z');
  });

  it('reconoce el trimestre de una fecha', () => {
    expect(trimestreDe(new Date('2026-01-15T00:00:00Z'))).toEqual({ anio: 2026, trimestre: 1 });
    expect(trimestreDe(new Date('2026-12-31T23:00:00Z'))).toEqual({ anio: 2026, trimestre: 4 });
  });

  it('da de plazo hasta el final del mes siguiente', () => {
    const d = agruparDeclaracion([], 2026, 1);
    expect(d.presentarAntesDe.toISOString()).toBe('2026-04-30T23:59:59.999Z');
  });
});

describe('Agrupación de la declaración', () => {
  it('separa el régimen de la Unión del de importación', () => {
    // Son dos apartados distintos del modelo y no se suman entre sí.
    const d = agruparDeclaracion(
      [
        venta(),
        venta({
          numero: 'ES-2026-000002',
          regimen: 'IOSS',
          paisRecaudador: 'DE',
          tramos: [{ tipo: 19, baseCents: 5000, cuotaCents: 950 }],
        }),
      ],
      2026,
      1,
    );

    expect(d.regimenUnion).toHaveLength(1);
    expect(d.regimenImportacion).toHaveLength(1);
    expect(d.regimenUnion[0]?.pais).toBe('FR');
    expect(d.regimenImportacion[0]?.pais).toBe('DE');
    expect(d.cuotaTotalCents).toBe(2950);
  });

  it('agrupa por país y tipo, no por pedido', () => {
    const d = agruparDeclaracion([venta(), venta({ numero: 'ES-2026-000002' })], 2026, 1);

    expect(d.regimenUnion).toHaveLength(1);
    expect(d.regimenUnion[0]?.pedidos).toBe(2);
    expect(d.regimenUnion[0]?.cuotaCents).toBe(4000);
  });

  it('separa dos tipos del mismo país en líneas distintas', () => {
    const d = agruparDeclaracion(
      [
        venta({
          tramos: [
            { tipo: 20, baseCents: 10_000, cuotaCents: 2000 },
            { tipo: 5.5, baseCents: 1000, cuotaCents: 55 },
          ],
        }),
      ],
      2026,
      1,
    );

    expect(d.regimenUnion.map((l) => l.tipo)).toEqual([20, 5.5]);
  });

  it('deja fuera lo que no va al 369', () => {
    // Las ventas interiores van al 303, y las importaciones sin IOSS no
    // generan cuota nuestra: el cliente la paga en aduana.
    const d = agruparDeclaracion(
      [
        venta({ regimen: 'INTERIOR', paisRecaudador: 'ES' }),
        venta({ regimen: 'NACIONAL_POR_UMBRAL', paisRecaudador: 'ES' }),
        venta({
          regimen: 'IMPORTACION_SIN_IOSS',
          tramos: [{ tipo: 0, baseCents: 10_000, cuotaCents: 0 }],
        }),
      ],
      2026,
      1,
    );

    expect(d.regimenUnion).toHaveLength(0);
    expect(d.regimenImportacion).toHaveLength(0);
    expect(d.cuotaTotalCents).toBe(0);
  });

  it('no inventa líneas con los tramos al 0 %', () => {
    const d = agruparDeclaracion(
      [
        venta({
          tramos: [
            { tipo: 20, baseCents: 10_000, cuotaCents: 2000 },
            { tipo: 0, baseCents: 3000, cuotaCents: 0 },
          ],
        }),
      ],
      2026,
      1,
    );

    expect(d.regimenUnion).toHaveLength(1);
  });

  it('aparta los pedidos mixtos en vez de repartirlos a ojo', () => {
    // Un importe colocado en el país equivocado es peor que uno que alguien
    // tiene que revisar: del segundo se entera alguien.
    const d = agruparDeclaracion([venta({ regimen: 'MIXTO', paisRecaudador: '' })], 2026, 1);

    expect(d.regimenUnion).toHaveLength(0);
    expect(d.aRevisar).toHaveLength(1);
    expect(d.aRevisar[0]?.motivo).toContain('mixto');
  });

  it('declara el pedido con tipo por confirmar, pero avisa', () => {
    // No se puede dejar fuera de la declaración: la venta existe y su cuota
    // hay que ingresarla. Lo que hay es que repasar el tipo.
    const d = agruparDeclaracion([venta({ necesitaRevision: true })], 2026, 1);

    expect(d.regimenUnion).toHaveLength(1);
    expect(d.aRevisar).toHaveLength(1);
    expect(d.aRevisar[0]?.motivo).toContain('tipo reducido');
  });
});
