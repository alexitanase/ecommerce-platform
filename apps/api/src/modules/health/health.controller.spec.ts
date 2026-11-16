import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { HealthController } from './health.controller.js';

/**
 * Las sondas de salud DEBEN ser públicas.
 *
 * Este test existe por una regresión real: al añadir el guard global de
 * autenticación, `/health` empezó a devolver 401. Un balanceador que recibe
 * 401 de su sonda da la instancia por caída y la saca de rotación; con varias
 * instancias, el servicio entero deja de atender aunque funcione perfectamente.
 *
 * El fallo no se ve en desarrollo (nadie consulta /health a mano) y aparece en
 * producción justo al desplegar.
 */
describe('Sondas de salud', () => {
  const reflector = new Reflector();

  it('el controlador está marcado como público', () => {
    const esPublico = reflector.get<boolean>(PUBLIC_KEY, HealthController);
    expect(
      esPublico,
      'HealthController debe llevar @Public(): sin él, el guard global de ' +
        'autenticación devuelve 401 al balanceador y saca la instancia de rotación.',
    ).toBe(true);
  });

  it('los tres endpoints heredan el acceso público', () => {
    // getAllAndOverride es lo que usa el guard: comprueba primero el método y
    // después la clase. Si la clase es pública, los métodos lo son.
    for (const metodo of ['root', 'live', 'ready'] as const) {
      // Se lee del prototipo con Reflect para no arrancar el método de su
      // objeto: pasarlo suelto cambiaría el `this` y ESLint avisa con razón.
      // El tipo es el que espera Reflector: una función, no un método ligado.
      const handler = Reflect.get(HealthController.prototype, metodo) as () => unknown;
      const heredado =
        reflector.get<boolean>(PUBLIC_KEY, handler) ??
        reflector.get<boolean>(PUBLIC_KEY, HealthController);

      expect(heredado, `El endpoint "${metodo}" debe ser accesible sin token`).toBe(true);
    }
  });
});
