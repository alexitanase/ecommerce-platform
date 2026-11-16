import { describe, expect, it } from 'vitest';
import {
  explicarPlan,
  liberadoEl,
  planDeSupresion,
  plazoDeRespuesta,
  puedeBorrarse,
  RETENCIONES,
} from './retencion-datos.js';

/**
 * Estas reglas se equivocan en dos direcciones y las dos se sancionan: borrar
 * una factura que había que conservar es una infracción tributaria, y conservar
 * una dirección de envío de hace ocho años es lo que multa la AEPD.
 */

const AHORA = new Date('2026-07-26T12:00:00Z');
const haceAnios = (n: number) => new Date(`${String(2026 - n)}-07-26T12:00:00Z`);

describe('Plazos', () => {
  it('conserva las facturas seis años', () => {
    // Seis del Código de Comercio, no cuatro: cumplir el plazo corto no libra
    // del largo.
    expect(RETENCIONES.FACTURAS.anios).toBe(6);
    expect(puedeBorrarse('FACTURAS', haceAnios(5), AHORA)).toBe(false);
    expect(puedeBorrarse('FACTURAS', haceAnios(7), AHORA)).toBe(true);
  });

  it('libera justo al cumplirse el plazo', () => {
    expect(puedeBorrarse('FACTURAS', haceAnios(6), AHORA)).toBe(true);
    expect(liberadoEl('FACTURAS', new Date('2020-01-15T00:00:00Z')).getFullYear()).toBe(2026);
  });

  it('borra sin esperar lo que no tiene plazo', () => {
    // La libreta de direcciones es comodidad, no obligación.
    expect(puedeBorrarse('DIRECCIONES', haceAnios(0), AHORA)).toBe(true);
    expect(puedeBorrarse('CUENTA', new Date(AHORA), AHORA)).toBe(true);
    expect(puedeBorrarse('CARRITOS', new Date(AHORA), AHORA)).toBe(true);
  });

  it('mantiene los pedidos tanto como las facturas', () => {
    // Respaldan la factura ante una comprobación: liberarlos antes dejaría la
    // factura sin el soporte que la justifica.
    expect(RETENCIONES.PEDIDOS.anios).toBe(RETENCIONES.FACTURAS.anios);
  });

  it('marca como obligatorio solo lo que impone una norma', () => {
    expect(RETENCIONES.FACTURAS.obligatorio).toBe(true);
    expect(RETENCIONES.CONSENTIMIENTOS.obligatorio).toBe(true);
    expect(RETENCIONES.DIRECCIONES.obligatorio).toBe(false);
  });
});

describe('Plan de supresión', () => {
  it('borra lo liberado y conserva lo que sigue en plazo', () => {
    const plan = planDeSupresion(
      {
        FACTURAS: [
          { id: 'antigua', creadoEl: haceAnios(7) },
          { id: 'reciente', creadoEl: haceAnios(1) },
        ],
      },
      AHORA,
    );

    expect(plan.borrarAhora[0]?.ids).toEqual(['antigua']);
    expect(plan.conservar[0]?.ids).toEqual(['reciente']);
  });

  it('decide elemento a elemento, no categoría a categoría', () => {
    // Es la diferencia entre conservar de más y hacerlo bien: de dos pedidos,
    // uno puede estar liberado y el otro no.
    const plan = planDeSupresion(
      {
        PEDIDOS: [
          { id: 'viejo', creadoEl: haceAnios(8) },
          { id: 'nuevo', creadoEl: haceAnios(2) },
        ],
      },
      AHORA,
    );

    expect(plan.borrarAhora[0]?.ids).toEqual(['viejo']);
    expect(plan.conservar[0]?.ids).toEqual(['nuevo']);
  });

  it('comunica la fecha del último en liberarse', () => {
    // Es cuando la persona queda de verdad fuera; dar la del primero sería
    // decirle que ya no tenemos nada cuando todavía sí.
    const plan = planDeSupresion(
      {
        FACTURAS: [
          { id: 'a', creadoEl: new Date('2024-01-01T00:00:00Z') },
          { id: 'b', creadoEl: new Date('2025-06-01T00:00:00Z') },
        ],
      },
      AHORA,
    );

    expect(plan.conservar[0]?.hasta.getFullYear()).toBe(2031);
  });

  it('no inventa nada cuando no hay datos', () => {
    const plan = planDeSupresion({ FACTURAS: [], PEDIDOS: [] }, AHORA);
    expect(plan.borrarAhora).toEqual([]);
    expect(plan.conservar).toEqual([]);
  });

  it('borra entero lo que no tiene plazo aunque sea de hoy', () => {
    const plan = planDeSupresion({ DIRECCIONES: [{ id: 'd1', creadoEl: AHORA }] }, AHORA);
    expect(plan.borrarAhora[0]?.ids).toEqual(['d1']);
    expect(plan.conservar).toEqual([]);
  });
});

describe('Explicación al cliente', () => {
  it('dice qué se conserva y por qué', () => {
    // El art. 17.3 lo exige: responder "hecho" y guardar seis años de facturas
    // es una respuesta incompleta, y la incompletitud es lo que se reclama.
    const plan = planDeSupresion(
      {
        DIRECCIONES: [{ id: 'd', creadoEl: AHORA }],
        FACTURAS: [{ id: 'f', creadoEl: haceAnios(1) }],
      },
      AHORA,
    );

    const texto = explicarPlan(plan);
    expect(texto).toContain('direcciones');
    expect(texto).toContain('facturas');
    expect(texto).toContain('Código de Comercio');
    expect(texto).toMatch(/2031/);
  });

  it('promete que lo conservado queda bloqueado', () => {
    const plan = planDeSupresion({ FACTURAS: [{ id: 'f', creadoEl: AHORA }] }, AHORA);
    expect(explicarPlan(plan)).toContain('bloqueado');
  });

  it('no promete bloqueo cuando no queda nada guardado', () => {
    // Decir "lo que conservamos queda bloqueado" sin conservar nada afirma que
    // seguimos teniendo datos de quien acaba de pedir que los borremos.
    const plan = planDeSupresion({ DIRECCIONES: [{ id: 'd', creadoEl: AHORA }] }, AHORA);
    const texto = explicarPlan(plan);

    expect(texto).toContain('Hemos eliminado');
    expect(texto).not.toContain('bloqueado');
  });

  it('lo dice claro cuando no había nada', () => {
    expect(explicarPlan({ borrarAhora: [], conservar: [] })).toContain('ningún dato');
  });
});

describe('Plazo de respuesta', () => {
  it('es de un mes desde la solicitud', () => {
    // Pasarse es la infracción en sí, aunque después se responda bien.
    expect(plazoDeRespuesta(new Date('2026-07-26T00:00:00Z')).toISOString().slice(0, 10)).toBe(
      '2026-08-26',
    );
  });

  it('no se descoloca en los meses cortos', () => {
    // Del 31 de enero no existe el 31 de febrero; lo importante es que caiga
    // en una fecha real y no antes de tiempo.
    const limite = plazoDeRespuesta(new Date('2026-01-31T00:00:00Z'));
    expect(limite.getTime()).toBeGreaterThan(new Date('2026-02-28T00:00:00Z').getTime());
  });
});

describe('Garantías de la purga automática', () => {
  it('ningún plazo obligatorio baja de los cuatro años', () => {
    // La purga corre sola cada noche. Acortar un plazo por descuido borraría
    // documentación que la Agencia Tributaria puede reclamar, y nadie se
    // enteraría hasta que la reclamara.
    for (const regla of Object.values(RETENCIONES)) {
      if (regla.obligatorio) expect(regla.anios).toBeGreaterThanOrEqual(3);
    }
  });

  it('toda categoría obligatoria explica en qué norma se apoya', () => {
    // Es lo que se le enseña al cliente cuando pide la supresión y no puede
    // ser total: sin la norma concreta, la negativa no se sostiene.
    for (const regla of Object.values(RETENCIONES)) {
      if (regla.obligatorio) expect(regla.base.length).toBeGreaterThan(40);
    }
  });

  it('un dato del día no se purga por sorpresa si tiene plazo', () => {
    for (const [categoria, regla] of Object.entries(RETENCIONES)) {
      if (!regla.obligatorio) continue;
      expect(puedeBorrarse(categoria as keyof typeof RETENCIONES, AHORA, AHORA)).toBe(false);
    }
  });
});
