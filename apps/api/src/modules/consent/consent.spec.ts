import { describe, expect, it } from 'vitest';
import { truncarIp } from './consent.service.js';

/**
 * Anonimización de la IP en el registro de consentimiento.
 *
 * Sería contradictorio que el registro que acredita respetar la privacidad
 * guardara el dato que identifica a la persona. La AEPD acepta poner a cero el
 * último octeto como anonimización razonable.
 */
describe('Truncado de IP', () => {
  describe('IPv4', () => {
    it('pone a cero el último octeto', () => {
      expect(truncarIp('192.168.1.37')).toBe('192.168.1.0');
      expect(truncarIp('81.32.157.204')).toBe('81.32.157.0');
    });

    it('el resultado ya no distingue entre vecinos de la misma red', () => {
      // Que es justo el objetivo: sirve para acreditar procedencia, no para
      // señalar a quién fue.
      expect(truncarIp('81.32.157.1')).toBe(truncarIp('81.32.157.254'));
    });

    it('quita el prefijo de IPv4 mapeada en IPv6', () => {
      // Detrás de un proxy las IPv4 llegan a menudo con este prefijo; sin
      // quitarlo se guardarían sin truncar.
      expect(truncarIp('::ffff:192.168.1.37')).toBe('192.168.1.0');
    });

    it('ignora espacios alrededor', () => {
      expect(truncarIp('  10.0.0.5  ')).toBe('10.0.0.0');
    });
  });

  describe('IPv6', () => {
    it('conserva solo los cuatro primeros grupos', () => {
      expect(truncarIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:0db8:85a3:0000::');
    });

    it('dos direcciones de la misma red quedan iguales', () => {
      expect(truncarIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(
        truncarIp('2001:db8:1:2:1111:2222:3333:4444'),
      );
    });
  });

  describe('entradas raras', () => {
    it('un valor que no es una IP no se guarda tal cual', () => {
      // Nunca puede acabar en la base un texto arbitrario venido de una
      // cabecera que el cliente controla.
      expect(truncarIp('no-soy-una-ip')).toBe('0.0.0.0');
      expect(truncarIp('')).toBe('0.0.0.0');
    });

    it('una IPv4 incompleta tampoco', () => {
      expect(truncarIp('192.168.1')).toBe('0.0.0.0');
    });
  });
});
