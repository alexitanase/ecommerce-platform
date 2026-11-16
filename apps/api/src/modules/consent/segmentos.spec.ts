import { describe, expect, it } from 'vitest';
import {
  ALTO_VALOR_CENTS,
  DIAS_PARA_DORMIDO,
  ETIQUETAS,
  perteneceA,
  segmentosDe,
  type SenalesSuscriptor,
} from './segmentos.js';

/**
 * Segmentación de la lista de correo.
 *
 * Un segmento mal calculado no da ningún error: solo hace que un envío llegue
 * a quien no tocaba. Y ahí el daño es acumulativo — la gente deja de abrir,
 * marca como spam y arrastra la reputación del dominio, hasta que dejan de
 * llegar incluso los correos de pedido.
 */

const NADIE: SenalesSuscriptor = {
  pedidosPagados: 0,
  totalGastadoCents: 0,
  diasDesdeUltimaCompra: null,
  carritoAbandonado: false,
};

const con = (cambios: Partial<SenalesSuscriptor>): SenalesSuscriptor => ({ ...NADIE, ...cambios });

describe('En qué segmento cae cada persona', () => {
  it('quien se apunta y no compra es suscriptor', () => {
    expect(segmentosDe(NADIE)).toEqual(['suscriptor']);
  });

  it('con una compra pasa a cliente', () => {
    expect(segmentosDe(con({ pedidosPagados: 1, totalGastadoCents: 4999 }))).toEqual(['cliente']);
  });

  it('a partir de dos, recurrente', () => {
    expect(segmentosDe(con({ pedidosPagados: 2, totalGastadoCents: 9998 }))).toContain(
      'recurrente',
    );
  });

  it('los tres primeros son excluyentes entre sí', () => {
    // Nadie puede ser suscriptor y cliente a la vez: el correo de bienvenida y
    // el de "gracias por tu compra" no pueden llegarle los dos.
    for (const pedidos of [0, 1, 2, 10]) {
      const s = segmentosDe(con({ pedidosPagados: pedidos }));
      const base = s.filter((x) => ['suscriptor', 'cliente', 'recurrente'].includes(x));

      expect(base, `con ${String(pedidos)} pedidos`).toHaveLength(1);
    }
  });
});

describe('Se puede estar en varios segmentos a la vez', () => {
  it('recurrente y dormido al mismo tiempo', () => {
    // Es el caso que da sentido a devolver una lista: quien compró tres veces
    // y lleva cuatro meses sin aparecer necesita las dos cosas para que exista
    // la campaña de "te echamos de menos".
    const s = segmentosDe(
      con({ pedidosPagados: 3, totalGastadoCents: 12_000, diasDesdeUltimaCompra: 120 }),
    );

    expect(s).toContain('recurrente');
    expect(s).toContain('dormido');
  });

  it('cliente de alto valor con el carrito abandonado', () => {
    const s = segmentosDe(
      con({
        pedidosPagados: 1,
        totalGastadoCents: 45_000,
        diasDesdeUltimaCompra: 10,
        carritoAbandonado: true,
      }),
    );

    expect(s).toEqual(expect.arrayContaining(['cliente', 'alto_valor', 'carrito_abandonado']));
  });
});

describe('Quién NO está dormido', () => {
  it('alguien que nunca ha comprado no está dormido, está sin estrenar', () => {
    // El correo que le toca es otro: "te echamos de menos" a quien nunca ha
    // comprado nada suena a error, y lo es.
    expect(segmentosDe(con({ diasDesdeUltimaCompra: 400 }))).not.toContain('dormido');
  });

  it('quien compró hace poco tampoco', () => {
    expect(
      segmentosDe(con({ pedidosPagados: 2, diasDesdeUltimaCompra: DIAS_PARA_DORMIDO - 1 })),
    ).not.toContain('dormido');
  });

  it('justo en el umbral, sí', () => {
    expect(
      segmentosDe(con({ pedidosPagados: 1, diasDesdeUltimaCompra: DIAS_PARA_DORMIDO })),
    ).toContain('dormido');
  });
});

describe('Alto valor', () => {
  it('por debajo del umbral no entra', () => {
    expect(
      segmentosDe(con({ pedidosPagados: 1, totalGastadoCents: ALTO_VALOR_CENTS - 1 })),
    ).not.toContain('alto_valor');
  });

  it('en el umbral, entra', () => {
    expect(segmentosDe(con({ pedidosPagados: 1, totalGastadoCents: ALTO_VALOR_CENTS }))).toContain(
      'alto_valor',
    );
  });
});

describe('Comprobar pertenencia a un segmento', () => {
  it('responde lo mismo que el listado', () => {
    const senales = con({ pedidosPagados: 4, totalGastadoCents: 50_000 });

    for (const segmento of segmentosDe(senales)) {
      expect(perteneceA(senales, segmento), segmento).toBe(true);
    }
    expect(perteneceA(senales, 'suscriptor')).toBe(false);
  });
});

describe('Cómo se presentan en el panel', () => {
  it('todos los segmentos tienen una etiqueta que se entiende', () => {
    // La lee quien decide a quién manda una campaña; "dormido" a secas no
    // dice cuánto tiempo hace falta para serlo.
    const todos = segmentosDe(
      con({
        pedidosPagados: 3,
        totalGastadoCents: 99_999,
        diasDesdeUltimaCompra: 500,
        carritoAbandonado: true,
      }),
    );

    for (const s of [...todos, 'suscriptor', 'cliente'] as const) {
      expect(ETIQUETAS[s], s).toBeTruthy();
      expect(ETIQUETAS[s].length).toBeGreaterThan(10);
    }
  });
});
