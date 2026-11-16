import { describe, expect, it } from 'vitest';
import {
  MAXIMO_REPLICAS,
  MINIMO_REPLICAS,
  replicasRecomendadas,
  type EstadoCola,
} from './escalado.js';

/**
 * La política de autoescalado de los workers.
 *
 * Se prueba porque una política mal ajustada no falla: o los pedidos salen con
 * horas de retraso —y eso no lo detecta ningún test— o se levantan réplicas de
 * más y la factura aparece a fin de mes.
 *
 * Los dos casos que más importan son los extremos: que no baje a cero (el
 * primer pedido de la mañana esperaría a que arranque un contenedor) y que no
 * suba sin techo (cada réplica abre su pool de conexiones, y pasarse tira la
 * tienda entera intentando ir más rápido).
 */

const cola = (esperando: number, activos = 0): EstadoCola[] => [
  { cola: 'fulfillment', esperando, activos },
];

describe('Cuando no hay trabajo', () => {
  it('se queda en el mínimo, nunca en cero', () => {
    const r = replicasRecomendadas(cola(0), 3);

    expect(r.replicas).toBe(MINIMO_REPLICAS);
    expect(MINIMO_REPLICAS).toBeGreaterThanOrEqual(1);
  });

  it('con trabajos en curso no baja aunque no haya cola', () => {
    // Bajar mientras se procesa mataría réplicas a media faena.
    const r = replicasRecomendadas(cola(0, 12), 3);

    expect(r.replicas).toBe(3);
  });
});

describe('Cuando la cola crece', () => {
  it('sube en proporción a lo que espera', () => {
    expect(replicasRecomendadas(cola(200), 1).replicas).toBe(4);
  });

  it('sube en cuanto hace falta, sin esperar', () => {
    // Asimetría deliberada: quedarse corto retrasa pedidos de clientes;
    // quedarse largo cuesta unos céntimos.
    const r = replicasRecomendadas(cola(120), 1);

    expect(r.replicas).toBeGreaterThan(1);
    expect(r.motivo).toContain('120');
  });

  it('no pasa del techo por muy grande que sea el pico', () => {
    // El techo no está para ahorrar: cada réplica abre su pool de conexiones y
    // pasarse agota las de Postgres.
    const r = replicasRecomendadas(cola(100_000), 4);

    expect(r.replicas).toBe(MAXIMO_REPLICAS);
  });

  it('suma todas las colas, no mira solo una', () => {
    const r = replicasRecomendadas(
      [
        { cola: 'fulfillment', esperando: 40, activos: 0 },
        { cola: 'email', esperando: 40, activos: 0 },
        { cola: 'tracking', esperando: 40, activos: 0 },
      ],
      1,
    );

    expect(r.replicas).toBeGreaterThan(1);
    expect(r.pendientes).toBe(120);
  });
});

describe('Cuando la cola baja', () => {
  it('no baja mientras siga habiendo trabajo pendiente', () => {
    // Es lo que evita el sube y baja continuo: una cola que baila alrededor
    // del umbral movería réplicas cada minuto, y arrancar una tarda más que
    // procesar los trabajos que habría hecho.
    const r = replicasRecomendadas(cola(45), 4);

    expect(r.replicas).toBe(4);
    expect(r.motivo).toMatch(/adecuada/i);
  });

  it('baja solo cuando la cola está claramente tranquila', () => {
    const r = replicasRecomendadas(cola(3), 4);

    expect(r.replicas).toBeLessThan(4);
  });

  it('nunca baja por debajo del mínimo', () => {
    expect(replicasRecomendadas(cola(1), 5).replicas).toBeGreaterThanOrEqual(MINIMO_REPLICAS);
  });
});

describe('La recomendación se explica sola', () => {
  it('siempre dice por qué', () => {
    for (const pendientes of [0, 5, 60, 500, 50_000]) {
      const r = replicasRecomendadas(cola(pendientes), 2);
      expect(r.motivo.length, `pendientes=${String(pendientes)}`).toBeGreaterThan(10);
    }
  });

  it('es determinista', () => {
    const colas = cola(137, 4);
    expect(replicasRecomendadas(colas, 2)).toEqual(replicasRecomendadas(colas, 2));
  });

  it('sin colas declaradas no revienta', () => {
    expect(replicasRecomendadas([], 1).replicas).toBe(MINIMO_REPLICAS);
  });
});
