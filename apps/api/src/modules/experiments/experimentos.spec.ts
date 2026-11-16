import { describe, expect, it } from 'vitest';
import {
  CONFIANZA_MINIMA,
  VISITAS_MINIMAS,
  asignarVariante,
  leerResultado,
  type Experimento,
  type ResultadoVariante,
} from './experimentos.js';

/**
 * Pruebas A/B.
 *
 * Un A/B mal hecho es peor que no medir: da una conclusión con aire de dato y
 * se cambia la tienda entera por una diferencia que era casualidad. Así que lo
 * que se prueba aquí es sobre todo cuándo el sistema tiene que decir **"aún no
 * se sabe"**, y que el reparto no cambie por debajo de los pies del
 * experimento.
 */

const AB: Experimento = {
  clave: 'boton-comprar',
  variantes: [
    { clave: 'a', peso: 50, valor: 'Comprar' },
    { clave: 'b', peso: 50, valor: 'Añadir al carrito' },
  ],
};

describe('A quién le toca qué', () => {
  it('el mismo visitante recibe siempre la misma variante', () => {
    // Es la propiedad que hace que el experimento mida algo. Si cambiara entre
    // visitas, lo que se estaría midiendo es el desconcierto de ver la tienda
    // distinta cada vez.
    const primera = asignarVariante('visitante-123', AB);

    for (let i = 0; i < 50; i++) {
      expect(asignarVariante('visitante-123', AB)?.clave).toBe(primera?.clave);
    }
  });

  it('reparte más o menos por igual con pesos iguales', () => {
    const cuenta = { a: 0, b: 0 };

    for (let i = 0; i < 4000; i++) {
      const v = asignarVariante(`visitante-${String(i)}`, AB);
      if (v?.clave === 'a') cuenta.a++;
      else cuenta.b++;
    }

    // Margen amplio: lo que importa es que no esté sesgado del todo, no que
    // salga exactamente la mitad.
    expect(cuenta.a).toBeGreaterThan(1700);
    expect(cuenta.a).toBeLessThan(2300);
  });

  it('respeta los pesos desiguales', () => {
    // Sirve para soltar un cambio arriesgado al 10 % antes de darlo a todos.
    const noventaDiez: Experimento = {
      clave: 'envio-gratis',
      variantes: [
        { clave: 'control', peso: 90, valor: 4000 },
        { clave: 'prueba', peso: 10, valor: 6000 },
      ],
    };

    let prueba = 0;
    for (let i = 0; i < 4000; i++) {
      if (asignarVariante(`v-${String(i)}`, noventaDiez)?.clave === 'prueba') prueba++;
    }

    expect(prueba).toBeGreaterThan(300);
    expect(prueba).toBeLessThan(500);
  });

  it('dos experimentos a la vez no reparten igual', () => {
    // Sin la clave en el hash, quien cae en la B de uno cae en la B de todos y
    // los experimentos dejan de ser independientes: cada uno mediría también
    // el efecto del otro.
    const otro: Experimento = { ...AB, clave: 'galeria-ficha' };

    let distintos = 0;
    for (let i = 0; i < 500; i++) {
      const id = `visitante-${String(i)}`;
      if (asignarVariante(id, AB)?.clave !== asignarVariante(id, otro)?.clave) distintos++;
    }

    // Si repartieran igual, este número sería 0.
    expect(distintos).toBeGreaterThan(150);
  });

  it('una variante con peso cero no le toca a nadie', () => {
    const apagada: Experimento = {
      clave: 'x',
      variantes: [
        { clave: 'a', peso: 100, valor: 1 },
        { clave: 'b', peso: 0, valor: 2 },
      ],
    };

    for (let i = 0; i < 500; i++) {
      expect(asignarVariante(`v-${String(i)}`, apagada)?.clave).toBe('a');
    }
  });

  it('un experimento sin variantes activas no asigna nada', () => {
    expect(asignarVariante('quien-sea', { clave: 'x', variantes: [] })).toBeNull();
    expect(
      asignarVariante('quien-sea', { clave: 'x', variantes: [{ clave: 'a', peso: 0, valor: 1 }] }),
    ).toBeNull();
  });
});

const resultado = (clave: string, visitas: number, conversiones: number): ResultadoVariante => ({
  clave,
  visitas,
  conversiones,
  ingresoCents: conversiones * 5000,
});

describe('Cuándo NO hay que decidir nada', () => {
  it('con pocas visitas no se declara ganadora aunque la diferencia parezca enorme', () => {
    // Es EL error clásico: 3 de 10 contra 1 de 10 parece el triple, y no es
    // nada. Decidir con esto es peor que no medir, porque además convence.
    const lectura = leerResultado([resultado('a', 10, 1), resultado('b', 10, 3)]);

    expect(lectura.ganadora).toBeNull();
    expect(lectura.motivo).toBe('DATOS_INSUFICIENTES');
  });

  it('dice cuántas visitas faltan', () => {
    // Quien mira el panel necesita saber si esperar dos días o dos meses.
    const lectura = leerResultado([resultado('a', 50, 5), resultado('b', 120, 12)]);

    expect(lectura.visitasQueFaltan).toBe(VISITAS_MINIMAS - 50);
  });

  it('la falta de datos se mide por la variante más floja', () => {
    // Miles de visitas en A no compensan tener cuarenta en B: la precisión la
    // marca la peor de las dos.
    const lectura = leerResultado([resultado('a', 10_000, 500), resultado('b', 40, 8)]);

    expect(lectura.ganadora).toBeNull();
    expect(lectura.motivo).toBe('DATOS_INSUFICIENTES');
  });

  it('con datos de sobra pero diferencia pequeña, tampoco', () => {
    // 5,0 % contra 5,2 % con mil visitas cada una: no se puede distinguir del
    // ruido, y forzar una decisión es inventarse el resultado.
    const lectura = leerResultado([resultado('a', 1000, 50), resultado('b', 1000, 52)]);

    expect(lectura.ganadora).toBeNull();
    expect(lectura.motivo).toBe('SIN_DIFERENCIA');
    expect(lectura.confianza).toBeLessThan(CONFIANZA_MINIMA);
  });

  it('sin ninguna conversión no hay nada que comparar', () => {
    const lectura = leerResultado([resultado('a', 1000, 0), resultado('b', 1000, 0)]);

    expect(lectura.ganadora).toBeNull();
    expect(lectura.confianza).toBe(0);
  });
});

describe('Cuándo sí', () => {
  it('una diferencia grande con datos suficientes se declara concluyente', () => {
    // 5 % contra 9 % con mil visitas cada una: eso ya no es casualidad.
    const lectura = leerResultado([resultado('a', 1000, 50), resultado('b', 1000, 90)]);

    expect(lectura.ganadora).toBe('b');
    expect(lectura.motivo).toBe('CONCLUYENTE');
    expect(lectura.confianza).toBeGreaterThan(CONFIANZA_MINIMA);
  });

  it('gana la variante con más conversión, no la primera de la lista', () => {
    const lectura = leerResultado([resultado('b', 1000, 90), resultado('a', 1000, 50)]);

    expect(lectura.ganadora).toBe('b');
  });
});

describe('Lo que se enseña en el panel', () => {
  it('cada variante lleva su tasa y su ingreso por visita', () => {
    // El ingreso por visita es el número que de verdad decide: una variante
    // puede convertir más y vender menos si empuja al producto barato.
    const lectura = leerResultado([
      { clave: 'a', visitas: 1000, conversiones: 50, ingresoCents: 250_000 },
      { clave: 'b', visitas: 1000, conversiones: 90, ingresoCents: 270_000 },
    ]);

    const a = lectura.variantes.find((v) => v.clave === 'a');
    const b = lectura.variantes.find((v) => v.clave === 'b');

    expect(a?.tasa).toBeCloseTo(0.05);
    expect(a?.ingresoPorVisitaCents).toBe(250);
    expect(b?.ingresoPorVisitaCents).toBe(270);
  });

  it('una variante sin visitas no divide entre cero', () => {
    const lectura = leerResultado([
      { clave: 'a', visitas: 0, conversiones: 0, ingresoCents: 0 },
      { clave: 'b', visitas: 0, conversiones: 0, ingresoCents: 0 },
    ]);

    expect(lectura.variantes[0]?.tasa).toBe(0);
    expect(lectura.variantes[0]?.ingresoPorVisitaCents).toBe(0);
  });

  it('un experimento recién creado no revienta la lectura', () => {
    const lectura = leerResultado([]);

    expect(lectura.ganadora).toBeNull();
    expect(lectura.variantes).toEqual([]);
  });
});
