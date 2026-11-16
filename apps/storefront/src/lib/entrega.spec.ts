import { describe, expect, it } from 'vitest';
import { fechasDeEntrega, nombreDePais, rangoEscrito } from './entrega';

/** Miércoles 5 de agosto de 2026, a media mañana. */
const miercoles = new Date('2026-08-05T10:00:00Z');

const dia = (f: Date) => f.toISOString().slice(0, 10);

describe('fechasDeEntrega', () => {
  it('suma los días al día de hoy', () => {
    const { desde, hasta } = fechasDeEntrega(2, 5, miercoles);
    expect(dia(desde)).toBe('2026-08-07'); // viernes
    expect(dia(hasta)).toBe('2026-08-10'); // el domingo 9 pasa al lunes 10
  });

  it('no anuncia entregas en fin de semana', () => {
    // Sábado 8 y domingo 9 de agosto de 2026.
    const { desde, hasta } = fechasDeEntrega(3, 4, miercoles);
    expect(dia(desde)).toBe('2026-08-10');
    expect(dia(hasta)).toBe('2026-08-10');
  });

  it('el rango nunca queda del revés', () => {
    const { desde, hasta } = fechasDeEntrega(9, 3, miercoles);
    expect(hasta.getTime()).toBeGreaterThanOrEqual(desde.getTime());
  });

  it('nunca promete la entrega para hoy', () => {
    const { desde } = fechasDeEntrega(0, 0, miercoles);
    expect(desde.getTime()).toBeGreaterThan(miercoles.getTime());
  });

  it('el plazo largo de China cae donde toca', () => {
    const { desde, hasta } = fechasDeEntrega(12, 22, miercoles);
    expect(dia(desde)).toBe('2026-08-17'); // 17 de agosto, lunes
    expect(dia(hasta)).toBe('2026-08-27'); // 27 de agosto, jueves
  });
});

describe('rangoEscrito', () => {
  it('en el mismo mes deja el día suelto para que la frase se lea', () => {
    const r = rangoEscrito(
      new Date('2026-08-17T10:00:00Z'),
      new Date('2026-08-27T10:00:00Z'),
      'es',
    );
    // «Llega entre el 17 y el 27 de agosto»
    expect(r).toEqual({ desde: '17', hasta: '27 de agosto', unSoloDia: false });
  });

  it('a caballo entre dos meses escribe los dos', () => {
    const r = rangoEscrito(
      new Date('2026-08-29T10:00:00Z'),
      new Date('2026-09-03T10:00:00Z'),
      'es',
    );
    expect(r).toEqual({ desde: '29 de agosto', hasta: '3 de septiembre', unSoloDia: false });
  });

  it('avisa cuando las dos fechas son la misma', () => {
    const mismo = new Date('2026-08-10T10:00:00Z');
    expect(rangoEscrito(mismo, mismo, 'es')).toEqual({
      desde: '10 de agosto',
      hasta: '10 de agosto',
      unSoloDia: true,
    });
  });

  it('en catalán la preposición del mes la pone Intl', () => {
    // «d’agost» y no «de agost»: por eso el mes no se formatea aparte del día.
    // El apóstrofo es el tipográfico (U+2019), que es el que pone ICU.
    expect(
      rangoEscrito(new Date('2026-08-29T10:00:00Z'), new Date('2026-09-03T10:00:00Z'), 'ca'),
    ).toEqual({ desde: '29 d\u2019agost', hasta: '3 de setembre', unSoloDia: false });
  });

  it('el inglés de la tienda es el británico', () => {
    const r = rangoEscrito(
      new Date('2026-08-17T10:00:00Z'),
      new Date('2026-08-27T10:00:00Z'),
      'en',
    );
    expect(r.hasta).toBe('27 August');
  });
});

describe('nombreDePais', () => {
  it('traduce el código al idioma de la tienda', () => {
    expect(nombreDePais('CN', 'es')).toBe('China');
    expect(nombreDePais('ES', 'en')).toBe('Spain');
  });

  it('sin código no hay nombre', () => {
    expect(nombreDePais(null, 'es')).toBeNull();
  });

  it('devuelve null si no sabe traducirlo, para poder caer al texto del proveedor', () => {
    expect(nombreDePais('XX', 'es')).toBeNull();
  });
});
