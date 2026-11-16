import { describe, expect, it } from 'vitest';
import {
  ANIOS_GARANTIA,
  cargaDeLaPruebaDelVendedor,
  enPlazo,
  fechaLimite,
  quienPagaPortes,
  reglasDe,
  resolucionValida,
  vuelveAStock,
} from './reglas-devolucion.js';

/**
 * El error más caro del postventa: tratar un producto defectuoso como un
 * desistimiento. Recorta de tres años a catorce días un derecho que no se puede
 * recortar y le cobra al cliente unos portes que no le tocan.
 */

const dia = (iso: string) => new Date(iso);
const ENTREGA = dia('2026-03-01T12:00:00Z');

describe('Plazos según el motivo', () => {
  it('un producto defectuoso tiene 3 años de garantía', () => {
    // Ley 7/2021: subió de dos a tres años para lo comprado desde 2022.
    const limite = fechaLimite('DEFECTIVE', ENTREGA);
    expect(limite?.getFullYear()).toBe(2029);
  });

  it('el desistimiento son 14 días', () => {
    expect(fechaLimite('WITHDRAWAL', ENTREGA)?.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('a los seis meses un defectuoso SÍ está en plazo', () => {
    // Con las reglas del desistimiento estaría fuera hace tiempo. Es
    // exactamente la confusión que hay que evitar.
    expect(enPlazo('DEFECTIVE', ENTREGA, dia('2026-09-01T12:00:00Z'))).toBe(true);
    expect(enPlazo('WITHDRAWAL', ENTREGA, dia('2026-09-01T12:00:00Z'))).toBe(false);
  });

  it('pasados los 3 años ya no', () => {
    expect(enPlazo('DEFECTIVE', ENTREGA, dia('2029-06-01T12:00:00Z'))).toBe(false);
  });

  it('el daño en transporte hay que comunicarlo pronto', () => {
    // Pasado un tiempo no hay forma de distinguir un golpe del transportista
    // de uno del uso, y el propio transportista tiene sus plazos para reclamar.
    expect(enPlazo('DAMAGED_IN_TRANSIT', ENTREGA, dia('2026-03-10T12:00:00Z'))).toBe(true);
    expect(enPlazo('DAMAGED_IN_TRANSIT', ENTREGA, dia('2026-04-10T12:00:00Z'))).toBe(false);
  });

  it('sin entrega registrada el plazo no ha empezado', () => {
    // Si el paquete no ha llegado, mal puede haber vencido el plazo.
    expect(enPlazo('DEFECTIVE', null)).toBe(true);
    expect(fechaLimite('WITHDRAWAL', null)).toBeNull();
  });

  it('la garantía usa la constante, no un número suelto', () => {
    const limite = fechaLimite('DEFECTIVE', ENTREGA)!;
    expect(limite.getFullYear() - ENTREGA.getFullYear()).toBe(ANIOS_GARANTIA);
  });
});

describe('Quién paga el envío de vuelta', () => {
  it('en un desistimiento, el cliente', () => {
    expect(quienPagaPortes('WITHDRAWAL')).toBe('cliente');
  });

  it('pero solo si se le informó antes de comprar', () => {
    // Art. 108.1: sin esa información previa, los portes son nuestros.
    expect(quienPagaPortes('WITHDRAWAL', false)).toBe('vendedor');
  });

  it('en un producto defectuoso, el vendedor', () => {
    // La puesta en conformidad es gratuita: cobrarle el porte es cobrarle por
    // un fallo nuestro.
    expect(quienPagaPortes('DEFECTIVE')).toBe('vendedor');
  });

  it('si nos equivocamos de artículo, el vendedor', () => {
    expect(quienPagaPortes('WRONG_ITEM')).toBe('vendedor');
  });

  it('si llegó dañado, el vendedor', () => {
    expect(quienPagaPortes('DAMAGED_IN_TRANSIT')).toBe('vendedor');
  });

  it('informar o no de los portes solo afecta al desistimiento', () => {
    expect(quienPagaPortes('DEFECTIVE', false)).toBe('vendedor');
  });
});

describe('Qué puede exigir el cliente', () => {
  it('en garantía puede pedir reparación o sustitución', () => {
    expect(resolucionValida('DEFECTIVE', 'REPAIR')).toBe(true);
    expect(resolucionValida('DEFECTIVE', 'REPLACE')).toBe(true);
    expect(resolucionValida('DEFECTIVE', 'PRICE_REDUCTION')).toBe(true);
  });

  it('en un desistimiento solo cabe el reembolso', () => {
    // Ofrecerle una reparación a quien desiste es negarle su dinero.
    expect(resolucionValida('WITHDRAWAL', 'REFUND')).toBe(true);
    expect(resolucionValida('WITHDRAWAL', 'REPAIR')).toBe(false);
    expect(resolucionValida('WITHDRAWAL', 'PRICE_REDUCTION')).toBe(false);
  });

  it('un artículo equivocado no se arregla con una rebaja', () => {
    expect(resolucionValida('WRONG_ITEM', 'PRICE_REDUCTION')).toBe(false);
    expect(resolucionValida('WRONG_ITEM', 'REPLACE')).toBe(true);
  });

  it('rechazar siempre es posible, aunque haya que motivarlo', () => {
    expect(resolucionValida('WITHDRAWAL', 'REJECTED')).toBe(true);
  });
});

describe('Carga de la prueba', () => {
  it('los dos primeros años la tiene el vendedor', () => {
    // Art. 121: se presume que el defecto ya existía en la entrega.
    expect(cargaDeLaPruebaDelVendedor(ENTREGA, dia('2027-06-01T12:00:00Z'))).toBe(true);
  });

  it('a partir del tercero, el consumidor', () => {
    expect(cargaDeLaPruebaDelVendedor(ENTREGA, dia('2028-06-01T12:00:00Z'))).toBe(false);
  });

  it('justo en el límite todavía la tiene el vendedor', () => {
    expect(cargaDeLaPruebaDelVendedor(ENTREGA, dia('2028-02-28T12:00:00Z'))).toBe(true);
  });
});

describe('Qué vuelve al stock', () => {
  it('un producto defectuoso NUNCA vuelve', () => {
    // Revenderlo sabiendo que falla es entregar a sabiendas algo no conforme:
    // traslada el problema al siguiente cliente y multiplica la reclamación.
    expect(vuelveAStock('DEFECTIVE', 'nuevo')).toBe(false);
    expect(vuelveAStock('DEFECTIVE', 'perfecto')).toBe(false);
  });

  it('un desistimiento en perfecto estado sí vuelve', () => {
    expect(vuelveAStock('WITHDRAWAL', 'nuevo')).toBe(true);
  });

  it('pero no si llegó usado o dañado', () => {
    expect(vuelveAStock('WITHDRAWAL', 'usado')).toBe(false);
    expect(vuelveAStock('WITHDRAWAL', 'dañado')).toBe(false);
  });

  it('sin revisar todavía, no vuelve', () => {
    // Reponer antes de mirar qué ha llegado pone a la venta lo que sea.
    expect(vuelveAStock('WITHDRAWAL', null)).toBe(false);
  });

  it('lo que llegó dañado en transporte tampoco vuelve', () => {
    expect(vuelveAStock('DAMAGED_IN_TRANSIT', 'nuevo')).toBe(false);
  });

  it('una ficha mal descrita sí: el producto está bien', () => {
    expect(vuelveAStock('NOT_AS_DESCRIBED', 'nuevo')).toBe(true);
  });
});

describe('Coherencia de la tabla de reglas', () => {
  it('todo motivo tiene al menos un remedio', () => {
    const motivos = [
      'DEFECTIVE',
      'NOT_AS_DESCRIBED',
      'DAMAGED_IN_TRANSIT',
      'WRONG_ITEM',
      'MISSING_ITEM',
      'WITHDRAWAL',
    ] as const;

    for (const motivo of motivos) {
      expect(reglasDe(motivo).remedios.length, motivo).toBeGreaterThan(0);
      expect(reglasDe(motivo).diasPlazo, motivo).toBeGreaterThan(0);
    }
  });

  it('todo motivo que no sea desistimiento lo paga el vendedor', () => {
    // Si algún día se añade un motivo nuevo y se olvida esto, el cliente
    // acabaría pagando el porte de un fallo nuestro.
    const porFallo = ['DEFECTIVE', 'NOT_AS_DESCRIBED', 'WRONG_ITEM', 'MISSING_ITEM'] as const;
    for (const motivo of porFallo) {
      expect(quienPagaPortes(motivo), motivo).toBe('vendedor');
    }
  });
});
