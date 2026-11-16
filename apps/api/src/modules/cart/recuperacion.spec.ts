import { describe, expect, it } from 'vitest';
import {
  avisoPendiente,
  ESPERA_ENTRE_AVISOS_MS,
  medirRecuperacion,
  SECUENCIA,
  VENTANA_MAXIMA_MS,
  type CarritoRecuperable,
} from './recuperacion.js';

/**
 * El fallo caro aquí no es dejar de enviar un correo: es enviar de más. Un
 * aviso a quien ya compró, o cuatro seguidos, se marcan como spam, y eso
 * arrastra también a los correos de confirmación de pedido.
 */

const HORA = 3600_000;
const AHORA = new Date('2026-07-26T12:00:00Z');
const haceHoras = (h: number) => new Date(AHORA.getTime() - h * HORA);

const carrito = (parcial: Partial<CarritoRecuperable> = {}): CarritoRecuperable => ({
  email: 'cliente@ejemplo.es',
  lineas: 2,
  lastActivityAt: haceHoras(2),
  convertedAt: null,
  recoveryStage: 0,
  lastRecoveryAt: null,
  ...parcial,
});

describe('A quién no se le escribe', () => {
  it('a quien ya compró', () => {
    // Un "te dejaste esto" a quien acaba de pagar parece un cobro duplicado.
    expect(avisoPendiente(carrito({ convertedAt: haceHoras(1) }), AHORA)).toBeNull();
  });

  it('a quien no ha dado su email', () => {
    expect(avisoPendiente(carrito({ email: null }), AHORA)).toBeNull();
  });

  it('a quien se ha dado de baja de estos avisos', () => {
    expect(avisoPendiente(carrito({ optOut: true }), AHORA)).toBeNull();
  });

  it('por un carrito vacío', () => {
    expect(avisoPendiente(carrito({ lineas: 0 }), AHORA)).toBeNull();
  });

  it('cuando ya se han enviado los tres avisos', () => {
    expect(avisoPendiente(carrito({ recoveryStage: SECUENCIA.length }), AHORA)).toBeNull();
  });

  it('cuando el carrito lleva más de una semana parado', () => {
    // A los diez días el carrito ya no se recuerda: el correo se lee como
    // publicidad no pedida, que además sin consentimiento no es legal.
    const viejo = carrito({ lastActivityAt: new Date(AHORA.getTime() - VENTANA_MAXIMA_MS - 1) });
    expect(avisoPendiente(viejo, AHORA)).toBeNull();
  });
});

describe('Cuándo se escribe', () => {
  it('no antes de la primera hora', () => {
    // Escribir a los diez minutos alcanza a quien sigue comprando.
    expect(avisoPendiente(carrito({ lastActivityAt: haceHoras(0.5) }), AHORA)).toBeNull();
  });

  it('el primer aviso a la hora, sin cupón', () => {
    const aviso = avisoPendiente(carrito({ lastActivityAt: haceHoras(1) }), AHORA);
    expect(aviso?.etapa).toBe(1);
    expect(aviso?.conCupon).toBe(false);
  });

  it('el segundo, al día siguiente y ya con descuento', () => {
    const aviso = avisoPendiente(
      carrito({
        lastActivityAt: haceHoras(25),
        recoveryStage: 1,
        lastRecoveryAt: haceHoras(24),
      }),
      AHORA,
    );

    expect(aviso?.etapa).toBe(2);
    expect(aviso?.conCupon).toBe(true);
  });

  it('nunca dos avisos seguidos, aunque toquen dos etapas a la vez', () => {
    // Un carrito parado cuatro días entra en la etapa 3 a la vez que en la 2.
    // Sin esta espera saldrían los dos correos en la misma ejecución.
    const aviso = avisoPendiente(
      carrito({
        lastActivityAt: haceHoras(96),
        recoveryStage: 1,
        lastRecoveryAt: new Date(AHORA.getTime() - ESPERA_ENTRE_AVISOS_MS + HORA),
      }),
      AHORA,
    );

    expect(aviso).toBeNull();
  });

  it('reanuda cuando ha pasado la espera', () => {
    const aviso = avisoPendiente(
      carrito({
        lastActivityAt: haceHoras(96),
        recoveryStage: 1,
        lastRecoveryAt: haceHoras(13),
      }),
      AHORA,
    );

    expect(aviso?.etapa).toBe(2);
  });
});

describe('Métricas', () => {
  it('mide sobre los avisados, no sobre todos los abandonados', () => {
    // La pregunta es "de a quienes escribimos, ¿cuántos volvieron?".
    const metricas = medirRecuperacion([
      { recoveryStage: 1, convertedAt: AHORA, totalCents: 5000 },
      { recoveryStage: 2, convertedAt: null, totalCents: 0 },
      { recoveryStage: 0, convertedAt: null, totalCents: 0 },
      { recoveryStage: 0, convertedAt: AHORA, totalCents: 9000 },
    ]);

    expect(metricas.avisados).toBe(2);
    expect(metricas.recuperados).toBe(1);
    expect(metricas.tasa).toBe(50);
    // Los 90 € del que compró sin que le escribiéramos no son mérito nuestro.
    expect(metricas.ingresosCents).toBe(5000);
  });

  it('sin avisos no divide entre cero', () => {
    expect(medirRecuperacion([]).tasa).toBe(0);
  });
});
