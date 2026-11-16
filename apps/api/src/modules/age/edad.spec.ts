import { describe, expect, it } from 'vitest';
import {
  EDAD_MINIMA,
  caducidadVerificacion,
  edadMinimaSegunAnio,
  esMayorDeEdad,
  rangoAniosValido,
  verificacionVigente,
} from './edad.js';

/**
 * Equivocarse por un año aquí es dejar entrar a un menor en un catálogo para
 * adultos. No hay error visible que lo delate: simplemente pasa.
 */

const AHORA = new Date('2026-07-26T12:00:00Z');

describe('Mayoría de edad', () => {
  it('acepta a quien cumple 18 este año', () => {
    expect(esMayorDeEdad(2008, AHORA)).toBe(true);
  });

  it('rechaza a quien cumple 17', () => {
    expect(esMayorDeEdad(2009, AHORA)).toBe(false);
  });

  it('acepta a alguien claramente mayor', () => {
    expect(esMayorDeEdad(1980, AHORA)).toBe(true);
  });

  it('el umbral está donde dice la constante', () => {
    // Si algún día cambia la edad mínima, este test lo sigue.
    expect(esMayorDeEdad(AHORA.getFullYear() - EDAD_MINIMA, AHORA)).toBe(true);
    expect(esMayorDeEdad(AHORA.getFullYear() - EDAD_MINIMA + 1, AHORA)).toBe(false);
  });

  describe('intentos de saltarse la comprobación', () => {
    it('rechaza un año futuro', () => {
      expect(esMayorDeEdad(2030, AHORA)).toBe(false);
    });

    it('rechaza el año en curso', () => {
      expect(esMayorDeEdad(2026, AHORA)).toBe(false);
    });

    it('rechaza una edad imposible', () => {
      expect(esMayorDeEdad(1800, AHORA)).toBe(false);
    });

    it('rechaza valores que no son enteros', () => {
      expect(esMayorDeEdad(1990.5, AHORA)).toBe(false);
      expect(esMayorDeEdad(Number.NaN, AHORA)).toBe(false);
      expect(esMayorDeEdad(Number.POSITIVE_INFINITY, AHORA)).toBe(false);
    });

    it('rechaza el cero y los negativos', () => {
      expect(esMayorDeEdad(0, AHORA)).toBe(false);
      expect(esMayorDeEdad(-1990, AHORA)).toBe(false);
    });
  });

  it('la edad garantizada es conservadora', () => {
    // Nacido en 2000: en 2026 tiene 25 o 26 según el mes. Se afirma 25, que es
    // lo único que el año permite garantizar.
    expect(edadMinimaSegunAnio(2000, AHORA)).toBe(25);
  });
});

describe('Vigencia de la verificación', () => {
  it('caduca a los 30 días', () => {
    const limite = caducidadVerificacion(AHORA);
    expect(limite.toISOString().slice(0, 10)).toBe('2026-08-25');
  });

  it('una verificación reciente vale', () => {
    expect(verificacionVigente(new Date('2026-08-01T00:00:00Z'), AHORA)).toBe(true);
  });

  it('una caducada no vale', () => {
    // Un ordenador familiar no puede quedar verificado para siempre.
    expect(verificacionVigente(new Date('2026-07-01T00:00:00Z'), AHORA)).toBe(false);
  });

  it('sin verificación, no hay acceso', () => {
    expect(verificacionVigente(null, AHORA)).toBe(false);
  });
});

describe('Rango aceptado en el formulario', () => {
  it('no admite años futuros', () => {
    expect(rangoAniosValido(AHORA).max).toBe(2026);
  });

  it('acota por abajo en 120 años', () => {
    expect(rangoAniosValido(AHORA).min).toBe(1906);
  });
});
