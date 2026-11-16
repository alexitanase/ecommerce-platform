import { describe, expect, it } from 'vitest';
import {
  UMBRAL_RECHAZAR,
  UMBRAL_REVISAR,
  esEmailDesechable,
  evaluarRiesgo,
  type SenalesPedido,
} from './riesgo.js';

/**
 * El motor de riesgo del checkout.
 *
 * Lo que se prueba aquí no es que sume bien: es que **no rechace a clientes
 * buenos**. Un motor de riesgo mal calibrado no da errores ni salta en ningún
 * log; da ventas perdidas que nadie cuenta y clientes que no vuelven. Por eso
 * la mitad de estas pruebas son de pedidos legítimos que tienen que pasar.
 *
 * La otra mitad son los patrones que en dropshipping cuestan el doble: no se
 * pierde solo la venta, se pierde la mercancía ya comprada al proveedor.
 */

/** Un pedido normal y corriente: cliente español, importe medio, sin prisas. */
const NORMAL: SenalesPedido = {
  totalCents: 4999,
  pedidosDelEmailUltimaHora: 1,
  pedidosDeLaIpUltimaHora: 1,
  pedidosPagadosDelEmail: 0,
  paisEnvio: 'ES',
  emailDesechable: false,
  cuentaRecienCreada: false,
  invitado: true,
  segundosEnElCheckout: 95,
  pagosFallidosDelEmail: 0,
};

const con = (cambios: Partial<SenalesPedido>): SenalesPedido => ({ ...NORMAL, ...cambios });

describe('Pedidos que tienen que pasar sin más', () => {
  it('un cliente español comprando por 50 €', () => {
    const r = evaluarRiesgo(NORMAL);

    expect(r.decision).toBe('ACEPTAR');
    expect(r.puntuacion).toBe(0);
  });

  it('alguien que se equivoca y hace el pedido dos veces', () => {
    // Pasa constantemente: el botón parece que no responde y se pulsa otra vez.
    expect(evaluarRiesgo(con({ pedidosDelEmailUltimaHora: 2 })).decision).toBe('ACEPTAR');
  });

  it('una oficina entera comprando desde la misma salida a internet', () => {
    // Con el CGNAT de las operadoras móviles españolas esto es lo normal, no
    // la excepción: cientos de clientes comparten IP pública.
    expect(evaluarRiesgo(con({ pedidosDeLaIpUltimaHora: 4 })).decision).toBe('ACEPTAR');
  });

  it('un cliente habitual haciendo un pedido grande', () => {
    // Es exactamente el cliente que NO hay que molestar. Sin la resta por
    // historial, un pedido de 400 € de quien ya ha comprado cinco veces
    // acabaría retenido.
    const r = evaluarRiesgo(con({ totalCents: 45_000, pedidosPagadosDelEmail: 5 }));

    expect(r.decision).toBe('ACEPTAR');
  });

  it('un envío a Portugal o Francia', () => {
    for (const pais of ['PT', 'FR', 'IT', 'DE']) {
      expect(evaluarRiesgo(con({ paisEnvio: pais })).decision, pais).toBe('ACEPTAR');
    }
  });

  it('alguien que rellena el formulario con el autocompletado del navegador', () => {
    // Diez segundos es rapidísimo para escribir una dirección entera, y aun así
    // es lo que tarda cualquiera con los datos guardados en el navegador.
    expect(evaluarRiesgo(con({ segundosEnElCheckout: 10 })).decision).toBe('ACEPTAR');
  });
});

describe('Lo que hay que mirar antes de comprar al proveedor', () => {
  it('tres pedidos del mismo email en una hora', () => {
    const r = evaluarRiesgo(con({ pedidosDelEmailUltimaHora: 3 }));

    expect(r.decision).toBe('ACEPTAR');
    expect(r.puntuacion).toBeGreaterThan(0);
  });

  it('un correo temporal con un pedido caro', () => {
    // Quien piensa reclamar una garantía o recibir el aviso de envío no usa un
    // buzón que caduca en diez minutos.
    const r = evaluarRiesgo(con({ emailDesechable: true, totalCents: 35_000 }));

    expect(r.decision).toBe('REVISAR');
    expect(r.motivos.map((m) => m.codigo)).toContain('EMAIL_DESECHABLE');
  });

  it('factura en un país y envía a otro', () => {
    // Muchas veces es legítimo —un regalo, alguien que vive fuera— pero es
    // también el patrón exacto de una tarjeta robada.
    const r = evaluarRiesgo(con({ paisEnvio: 'RO', paisFacturacion: 'ES', totalCents: 32_000 }));

    expect(r.decision).toBe('REVISAR');
  });

  it('varios pagos fallidos previos', () => {
    const r = evaluarRiesgo(con({ pagosFallidosDelEmail: 4 }));

    expect(r.decision).toBe('REVISAR');
    expect(r.motivos.map((m) => m.codigo)).toContain('PAGOS_FALLIDOS');
  });
});

describe('Lo que no se deja ni crear', () => {
  it('cinco pedidos en una hora desde el mismo email y la misma IP', () => {
    // Esto no es un cliente indeciso: es un script probando tarjetas robadas,
    // una detrás de otra, hasta que alguna pase.
    const r = evaluarRiesgo(
      con({
        pedidosDelEmailUltimaHora: 6,
        pedidosDeLaIpUltimaHora: 9,
        emailDesechable: true,
      }),
    );

    expect(r.decision).toBe('RECHAZAR');
    expect(r.puntuacion).toBeGreaterThanOrEqual(UMBRAL_RECHAZAR);
  });

  it('el bombardeo de tarjetas completo', () => {
    const r = evaluarRiesgo(
      con({
        pedidosDelEmailUltimaHora: 8,
        pedidosDeLaIpUltimaHora: 12,
        pagosFallidosDelEmail: 7,
        emailDesechable: true,
        segundosEnElCheckout: 1,
      }),
    );

    expect(r.decision).toBe('RECHAZAR');
  });
});

describe('Cómo se comporta la puntuación', () => {
  it('nunca baja de cero', () => {
    // Un cliente excelente no acumula margen negativo con el que luego se le
    // colaría algo grave sin llegar al umbral.
    const r = evaluarRiesgo(con({ pedidosPagadosDelEmail: 20 }));

    expect(r.puntuacion).toBe(0);
    expect(r.decision).toBe('ACEPTAR');
  });

  it('el historial resta de verdad', () => {
    const sinHistorial = evaluarRiesgo(con({ emailDesechable: true, totalCents: 35_000 }));
    const conHistorial = evaluarRiesgo(
      con({ emailDesechable: true, totalCents: 35_000, pedidosPagadosDelEmail: 4 }),
    );

    expect(conHistorial.puntuacion).toBeLessThan(sinHistorial.puntuacion);
  });

  it('cada motivo explica por qué suma', () => {
    // La lista la lee una persona decidiendo si suelta un pedido de 300 €. Un
    // código a secas —"VELOCIDAD_EMAIL: 25"— no le dice nada.
    const r = evaluarRiesgo(con({ pedidosDelEmailUltimaHora: 4, emailDesechable: true }));

    for (const motivo of r.motivos) {
      expect(motivo.codigo).toMatch(/^[A-Z_]+$/);
      expect(motivo.detalle.length).toBeGreaterThan(10);
    }
  });

  it('los umbrales están en el orden que se espera', () => {
    expect(UMBRAL_REVISAR).toBeLessThan(UMBRAL_RECHAZAR);
  });

  it('es determinista: las mismas señales dan lo mismo', () => {
    // Se audita y se explica a un cliente cabreado; no puede depender de nada
    // que cambie entre dos ejecuciones.
    const senales = con({ pedidosDelEmailUltimaHora: 3, totalCents: 31_000 });

    expect(evaluarRiesgo(senales)).toEqual(evaluarRiesgo(senales));
  });
});

describe('Correos de usar y tirar', () => {
  it('reconoce los más habituales', () => {
    expect(esEmailDesechable('quienquiera@mailinator.com')).toBe(true);
    expect(esEmailDesechable('QuienQuiera@YOPMAIL.com')).toBe(true);
    expect(esEmailDesechable('  x@guerrillamail.com  ')).toBe(true);
  });

  it('no marca los de siempre', () => {
    for (const email of ['ana@gmail.com', 'ana@empresa.es', 'ana@hotmail.com']) {
      expect(esEmailDesechable(email), email).toBe(false);
    }
  });

  it('un email sin arroba no revienta', () => {
    // Llega de un formulario: puede venir cualquier cosa.
    expect(esEmailDesechable('esto-no-es-un-email')).toBe(false);
    expect(esEmailDesechable('')).toBe(false);
  });
});
