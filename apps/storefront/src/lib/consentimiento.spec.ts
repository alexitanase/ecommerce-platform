import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLAVE,
  VERSION_POLITICA,
  guardarConsentimiento,
  hayDecision,
  leerConsentimiento,
  permitido,
  retirarConsentimiento,
} from './consentimiento';

/**
 * Reglas de la AEPD que no pueden romperse sin que salte un test.
 *
 * La consecuencia de fallar aquí no es un error visible: es una tienda que
 * carga analítica sin permiso durante meses hasta que llega una denuncia.
 */

function guardarCrudo(valor: unknown): void {
  window.localStorage.setItem(CLAVE, JSON.stringify(valor));
}

describe('Consentimiento de cookies', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('sin decisión previa', () => {
    it('no da permiso a nada por defecto', () => {
      // Lo más importante del fichero: sin decisión explícita no se carga nada.
      expect(permitido('analiticas')).toBe(false);
      expect(permitido('marketing')).toBe(false);
    });

    it('las necesarias siempre están permitidas', () => {
      expect(leerConsentimiento().necesarias).toBe(true);
    });

    it('hay que enseñar el banner', () => {
      expect(hayDecision()).toBe(false);
    });
  });

  describe('al aceptar o rechazar', () => {
    it('guarda lo aceptado y lo recuerda', () => {
      guardarConsentimiento({ analiticas: true, marketing: false });

      expect(permitido('analiticas')).toBe(true);
      expect(permitido('marketing')).toBe(false);
      expect(hayDecision()).toBe(true);
    });

    it('rechazar todo cuenta como decisión y no vuelve a preguntar', () => {
      guardarConsentimiento({ analiticas: false, marketing: false });

      expect(hayDecision()).toBe(true);
      expect(permitido('analiticas')).toBe(false);
    });

    it('guarda la fecha, que es la prueba de cuándo se dio', () => {
      guardarConsentimiento({ analiticas: true, marketing: true });
      const fecha = leerConsentimiento().fecha;

      expect(fecha).not.toBe('');
      expect(Number.isNaN(new Date(fecha).getTime())).toBe(false);
    });

    it('deja constancia en el servidor para poder demostrarlo', () => {
      // Con solo localStorage no hay nada que enseñar en una inspección.
      guardarConsentimiento({ analiticas: true, marketing: false });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/consent'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('si el servidor falla, la elección del usuario se respeta igual', () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sin red'));

      expect(() => guardarConsentimiento({ analiticas: false, marketing: false })).not.toThrow();
      expect(hayDecision()).toBe(true);
    });
  });

  describe('caducidad', () => {
    it('un consentimiento de hace dos años ya no vale', () => {
      // La AEPD marca 24 meses como máximo; aquí se renueva a los 12.
      const hace2Anios = new Date();
      hace2Anios.setFullYear(hace2Anios.getFullYear() - 2);

      guardarCrudo({
        necesarias: true,
        analiticas: true,
        marketing: true,
        fecha: hace2Anios.toISOString(),
        version: VERSION_POLITICA,
      });

      expect(permitido('analiticas')).toBe(false);
      expect(hayDecision()).toBe(false);
    });

    it('uno de hace un mes sigue valiendo', () => {
      const haceUnMes = new Date();
      haceUnMes.setMonth(haceUnMes.getMonth() - 1);

      guardarCrudo({
        necesarias: true,
        analiticas: true,
        marketing: false,
        fecha: haceUnMes.toISOString(),
        version: VERSION_POLITICA,
      });

      expect(permitido('analiticas')).toBe(true);
    });
  });

  describe('cambio de política', () => {
    it('un consentimiento de una versión anterior obliga a volver a preguntar', () => {
      // No cubre una finalidad que no existía cuando se dio.
      guardarCrudo({
        necesarias: true,
        analiticas: true,
        marketing: true,
        fecha: new Date().toISOString(),
        version: VERSION_POLITICA - 1,
      });

      expect(permitido('analiticas')).toBe(false);
      expect(hayDecision()).toBe(false);
    });
  });

  describe('datos manipulados', () => {
    it('un valor que no es JSON se trata como sin decidir', () => {
      window.localStorage.setItem(CLAVE, 'esto no es json {{{');
      expect(permitido('analiticas')).toBe(false);
      expect(hayDecision()).toBe(false);
    });

    it('un "true" de tipo texto no cuela como permiso', () => {
      // Preguntar de más molesta; cargar de más es una infracción.
      guardarCrudo({
        analiticas: 'true',
        marketing: 1,
        fecha: new Date().toISOString(),
        version: VERSION_POLITICA,
      });
      expect(permitido('analiticas')).toBe(false);
      expect(permitido('marketing')).toBe(false);
    });

    it('sin fecha no hay consentimiento válido', () => {
      guardarCrudo({ analiticas: true, marketing: true, version: VERSION_POLITICA });
      expect(permitido('analiticas')).toBe(false);
    });
  });

  describe('retirada', () => {
    it('vuelve a dejar todo sin permiso y reabre el banner', () => {
      guardarConsentimiento({ analiticas: true, marketing: true });
      retirarConsentimiento();

      expect(permitido('analiticas')).toBe(false);
      expect(hayDecision()).toBe(false);
    });

    it('borra las cookies que ya se habían puesto', () => {
      // Dejar de crear cookies nuevas no basta: las que ya estaban siguen
      // identificando al visitante que acaba de decir que no.
      document.cookie = '_ga=GA1.2.123456789';
      guardarConsentimiento({ analiticas: true, marketing: true });

      retirarConsentimiento();

      expect(document.cookie).not.toContain('_ga=GA1.2.123456789');
    });

    it('no toca las cookies técnicas', () => {
      // Borrar la del carrito dejaría sin compra a quien solo dijo que no.
      document.cookie = 'cart_token=abc123';
      guardarConsentimiento({ analiticas: true, marketing: true });

      retirarConsentimiento();

      expect(document.cookie).toContain('cart_token=abc123');
    });
  });
});
