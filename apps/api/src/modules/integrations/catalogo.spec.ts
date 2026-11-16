import { describe, expect, it } from 'vitest';
import { camposQueFaltan, definicionDe, INTEGRACIONES } from './catalogo.js';

/**
 * El catálogo decide qué se puede activar y qué se ofrece al cliente.
 *
 * Un error aquí no da excepción: da una pasarela que aparece en el checkout sin
 * estar lista, o un secreto declarado como ajuste normal que acaba guardado en
 * claro. Las dos cosas se descubren tarde.
 */

describe('Catálogo de integraciones', () => {
  it('no hay dos integraciones con la misma clave', () => {
    // La clave es única en la base de datos: un duplicado haría que la segunda
    // pisara la configuración de la primera.
    const claves = INTEGRACIONES.map((i) => i.key);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('toda credencial de una pasarela es secreta', () => {
    // Con `secreto: false` se guardaría en claro y se devolvería al panel: una
    // clave de pasarela en la respuesta de una API es una clave filtrada.
    for (const integracion of INTEGRACIONES.filter((i) => i.familia === 'pago')) {
      for (const campo of integracion.credenciales) {
        expect(campo.secreto, `${integracion.key}.${campo.clave}`).toBe(true);
      }
    }
  });

  it('las variables de entorno declaradas apuntan a campos que existen', () => {
    // Si no, la importación de la configuración antigua se perdería en
    // silencio y la tienda se quedaría sin pasarela tras el despliegue.
    for (const integracion of INTEGRACIONES) {
      const campos = [
        ...integracion.credenciales.map((c) => c.clave),
        ...integracion.ajustes.map((a) => a.clave),
      ];

      for (const campo of Object.keys(integracion.desdeEntorno ?? {})) {
        expect(campos, `${integracion.key}.${campo}`).toContain(campo);
      }
    }
  });

  it('cada familia tiene al menos una integración implementada', () => {
    for (const familia of ['pago', 'correo', 'traduccion', 'acceso'] as const) {
      const implementadas = INTEGRACIONES.filter((i) => i.familia === familia && i.implementada);
      expect(implementadas.length, familia).toBeGreaterThan(0);
    }
  });
});

describe('Qué falta para poder usar una integración', () => {
  const nowpayments = definicionDe('nowpayments');

  it('con todo puesto, no falta nada', () => {
    expect(camposQueFaltan(nowpayments!, { apiKey: 'k', ipnSecret: 's' }, {})).toEqual([]);
  });

  it('dice qué campo concreto falta, no "faltan credenciales"', () => {
    // Con el mensaje genérico, quien configura la tienda tiene que adivinar
    // cuál de los dos se dejó a medias.
    expect(camposQueFaltan(nowpayments!, { apiKey: 'k' }, {})).toEqual(['Secreto IPN']);
  });

  it('una cadena vacía cuenta como no puesta', () => {
    // Es lo que manda un formulario del que se ha borrado el contenido.
    expect(camposQueFaltan(nowpayments!, { apiKey: '', ipnSecret: 's' }, {})).toEqual([
      'Clave de API',
    ]);
  });

  it('los campos opcionales no bloquean', () => {
    // El SMTP de desarrollo (Mailpit) no lleva contraseña y tiene que poder
    // activarse igual.
    const smtp = definicionDe('smtp');
    expect(
      camposQueFaltan(smtp!, {}, { host: 'localhost', port: 1025, from: 'Tienda <a@b.c>' }),
    ).toEqual([]);
  });
});
