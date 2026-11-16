import { describe, expect, it } from 'vitest';
import { destinoDeFallo, destinoTrasOAuth, idiomaDelDestino } from './destino-oauth.js';

const TIENDA = 'https://chispaynoche.com';

describe('destinoTrasOAuth', () => {
  it('respeta la ruta que pidió la tienda', () => {
    expect(destinoTrasOAuth(TIENDA, '/es/carrito')).toBe('https://chispaynoche.com/es/carrito');
  });

  it('sin ruta lleva a la cuenta', () => {
    expect(destinoTrasOAuth(TIENDA, null)).toBe('https://chispaynoche.com/cuenta');
    expect(destinoTrasOAuth(TIENDA, undefined)).toBe('https://chispaynoche.com/cuenta');
    expect(destinoTrasOAuth(TIENDA, '')).toBe('https://chispaynoche.com/cuenta');
  });

  it('no salta a otro dominio', () => {
    // Este es el motivo de que exista el módulo: el salto ocurre justo después
    // de dejar la sesión abierta.
    for (const malo of [
      'https://malo.example',
      'http://malo.example',
      '//malo.example',
      '/\\malo.example',
      'javascript:alert(1)',
      'malo.example',
      '../../malo',
    ]) {
      expect(destinoTrasOAuth(TIENDA, malo), malo).toBe('https://chispaynoche.com/cuenta');
    }
  });

  it('no deja inyectar cabeceras con un salto de línea', () => {
    expect(destinoTrasOAuth(TIENDA, '/es\r\nSet-Cookie: a=b')).toBe(
      'https://chispaynoche.com/cuenta',
    );
  });

  it('no duplica la barra si la base la trae', () => {
    expect(destinoTrasOAuth('https://chispaynoche.com/', '/es/cuenta')).toBe(
      'https://chispaynoche.com/es/cuenta',
    );
  });
});

describe('idiomaDelDestino', () => {
  const idiomas = ['es', 'ca', 'en'] as const;

  it('saca el idioma de la ruta', () => {
    expect(idiomaDelDestino('/ca/cuenta', idiomas, 'es')).toBe('ca');
    expect(idiomaDelDestino('/en/carrito', idiomas, 'es')).toBe('en');
  });

  it('cae al idioma por defecto si no lo reconoce', () => {
    expect(idiomaDelDestino('/cuenta', idiomas, 'es')).toBe('es');
    expect(idiomaDelDestino(null, idiomas, 'es')).toBe('es');
    expect(idiomaDelDestino('/de/konto', idiomas, 'es')).toBe('es');
  });
});

describe('destinoDeFallo', () => {
  it('lleva a la pantalla de entrar con el motivo', () => {
    expect(destinoDeFallo(TIENDA, 'ca', 'cancelado')).toBe(
      'https://chispaynoche.com/ca/entrar?error=cancelado',
    );
  });
});
