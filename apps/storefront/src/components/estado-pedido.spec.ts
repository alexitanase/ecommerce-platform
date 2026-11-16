import { describe, expect, it } from 'vitest';
import { pasosCompletados, type EstadoDelPedido } from './estado-pedido';

/**
 * El recorrido que ve el cliente.
 *
 * Traduce trece estados internos a cinco pasos. Equivocarse aquí no da ningún
 * error: da una barra que dice que el paquete va en camino cuando todavía no
 * se ha comprado, o que sigue preparándose cuando ya está en casa. Las dos
 * cosas acaban en un correo preguntando qué pasa con el pedido.
 */

const pedido = (parcial: Partial<EstadoDelPedido>): EstadoDelPedido => ({
  estado: 'PAID',
  creadoEn: '2026-08-01T10:00:00Z',
  pagadoEn: '2026-08-01T10:05:00Z',
  enviadoEn: null,
  entregadoEn: null,
  envios: [],
  ...parcial,
});

describe('pasos del pedido', () => {
  it('sin pagar no ha empezado nada', () => {
    // Es lo que impide dar por hecho un pedido que todavía puede no cobrarse:
    // en cripto pasan minutos entre el intento y la confirmación.
    expect(pasosCompletados(pedido({ estado: 'AWAITING_PAYMENT' }))).toBe(0);
    expect(pasosCompletados(pedido({ estado: 'PAYMENT_CONFIRMING' }))).toBe(0);
  });

  it('agrupa los estados internos que al cliente le dan igual', () => {
    // «Enviado al proveedor» es vocabulario nuestro: para quien compra, su
    // pedido se está preparando.
    expect(pasosCompletados(pedido({ estado: 'PREPARING' }))).toBe(2);
    expect(pasosCompletados(pedido({ estado: 'SENT_TO_SUPPLIER' }))).toBe(2);

    // Y estos tres son «entregado» con distintos matices de archivo.
    expect(pasosCompletados(pedido({ estado: 'DELIVERED' }))).toBe(5);
    expect(pasosCompletados(pedido({ estado: 'PENDING_CLOSE' }))).toBe(5);
    expect(pasosCompletados(pedido({ estado: 'CLOSED' }))).toBe(5);
  });

  it('no da por hecho el reparto sin que lo diga el transportista', () => {
    // Un pedido en camino se queda en el tercer paso. Encender «en reparto»
    // por si acaso es prometer que sale hoy sin saberlo.
    expect(pasosCompletados(pedido({ estado: 'IN_TRANSIT' }))).toBe(3);

    expect(
      pasosCompletados(
        pedido({
          estado: 'IN_TRANSIT',
          envios: [{ estado: 'En tránsito', enviadoEn: null, entregadoEn: null }],
        }),
      ),
    ).toBe(3);
  });

  it('avanza al reparto cuando el transportista lo dice, en el idioma que sea', () => {
    // Cada transportista lo escribe a su manera, y los internacionales en
    // inglés. Por eso se busca por fragmentos y no por igualdad.
    for (const dice of ['En reparto', 'OUT FOR DELIVERY', 'Last mile', 'con el repartidor']) {
      expect(
        pasosCompletados(
          pedido({
            estado: 'IN_TRANSIT',
            envios: [{ estado: dice, enviadoEn: null, entregadoEn: null }],
          }),
        ),
        dice,
      ).toBe(4);
    }
  });

  it('un pedido cancelado no tiene recorrido', () => {
    // La barra no se pinta con estos estados; devolver 0 evita además que un
    // descuido los enseñe como «en curso».
    expect(pasosCompletados(pedido({ estado: 'CANCELLED' }))).toBe(0);
    expect(pasosCompletados(pedido({ estado: 'REFUNDED' }))).toBe(0);
    expect(pasosCompletados(pedido({ estado: 'FAILED' }))).toBe(0);
  });
});
