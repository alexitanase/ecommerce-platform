import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '@ecom/db';
import {
  destinosManuales,
  ESTADOS_FINALES,
  ESTADOS_KANBAN,
  exigirTransicionValida,
  puedeTransicionar,
  TRANSICIONES,
} from './order-state-machine.js';

/**
 * La máquina de estados decide qué puede pasarle a un pedido. Un fallo aquí no
 * da un error visible: deja pedidos cobrados sin enviar, o enviados sin cobrar,
 * y no se detecta hasta cuadrar cuentas.
 */
describe('Máquina de estados del pedido', () => {
  describe('el dinero manda', () => {
    it('no se envía al proveedor un pedido sin pagar', () => {
      // Esta es LA regla del negocio: pedir mercancía antes de cobrar significa
      // pagar de nuestro bolsillo si el cliente nunca completa el pago.
      expect(puedeTransicionar('AWAITING_PAYMENT', 'PREPARING')).toBe(false);
      expect(puedeTransicionar('AWAITING_PAYMENT', 'SENT_TO_SUPPLIER')).toBe(false);
      expect(puedeTransicionar('PAYMENT_CONFIRMING', 'PREPARING')).toBe(false);
    });

    it('exige pago confirmado antes de preparar', () => {
      expect(puedeTransicionar('PAID', 'PREPARING')).toBe(true);
    });

    it('en cripto, ver la transacción no es cobrarla', () => {
      // AWAITING_PAYMENT → PAYMENT_CONFIRMING → PAID: no se salta el paso
      // intermedio, porque una transacción sin confirmaciones puede revertirse.
      expect(puedeTransicionar('AWAITING_PAYMENT', 'PAYMENT_CONFIRMING')).toBe(true);
      expect(puedeTransicionar('PAYMENT_CONFIRMING', 'PAID')).toBe(true);
      // Y puede volver atrás si la transacción no llega a confirmar.
      expect(puedeTransicionar('PAYMENT_CONFIRMING', 'AWAITING_PAYMENT')).toBe(true);
    });
  });

  describe('cierre manual del Kanban', () => {
    it('un pedido entregado espera confirmación antes de archivarse', () => {
      expect(puedeTransicionar('DELIVERED', 'PENDING_CLOSE')).toBe(true);
      // No se puede saltar de entregado a cerrado: el equipo debe confirmarlo.
      expect(puedeTransicionar('DELIVERED', 'CLOSED')).toBe(false);
      expect(puedeTransicionar('PENDING_CLOSE', 'CLOSED')).toBe(true);
    });

    it('un pedido cerrado puede reembolsarse pero no revivir', () => {
      // Una devolución tardía es real y hay que poder atenderla.
      expect(puedeTransicionar('CLOSED', 'REFUNDED')).toBe(true);
      expect(puedeTransicionar('CLOSED', 'IN_TRANSIT')).toBe(false);
      expect(puedeTransicionar('CLOSED', 'DELIVERED')).toBe(false);
    });
  });

  describe('transiciones que solo hace el sistema', () => {
    it('nadie puede marcar a mano un pedido como enviado al proveedor', () => {
      // Arrastrar la tarjeta en el Kanban lo sacaría de la cola de trabajo sin
      // que el proveedor lo haya recibido: el cliente esperaría un paquete
      // que nadie ha pedido.
      expect(() => exigirTransicionValida('PREPARING', 'SENT_TO_SUPPLIER', 'manual')).toThrow(
        /lo realiza el sistema/,
      );
      // El sistema sí puede, cuando el proveedor confirma.
      expect(() =>
        exigirTransicionValida('PREPARING', 'SENT_TO_SUPPLIER', 'sistema'),
      ).not.toThrow();
    });

    it('nadie puede marcar un pedido como pagado a mano', () => {
      expect(() => exigirTransicionValida('AWAITING_PAYMENT', 'PAID', 'manual')).toThrow(
        /lo realiza el sistema/,
      );
    });

    it('sí permite mover a mano lo que es decisión humana', () => {
      expect(() => exigirTransicionValida('DELIVERED', 'PENDING_CLOSE', 'manual')).not.toThrow();
      expect(() => exigirTransicionValida('PENDING_CLOSE', 'CLOSED', 'manual')).not.toThrow();
      expect(() => exigirTransicionValida('PAID', 'CANCELLED', 'manual')).not.toThrow();
    });
  });

  describe('mensajes de error', () => {
    it('explica a qué estados sí se puede ir', () => {
      expect(() => exigirTransicionValida('DELIVERED', 'PREPARING')).toThrow(/solo se puede ir a/);
    });

    it('avisa si el pedido ya está en ese estado', () => {
      expect(() => exigirTransicionValida('PAID', 'PAID')).toThrow(/ya está en estado/);
    });
  });

  describe('incidencias', () => {
    it('desde una incidencia se puede volver al flujo o cancelar', () => {
      expect(puedeTransicionar('FAILED', 'PREPARING')).toBe(true);
      expect(puedeTransicionar('FAILED', 'CANCELLED')).toBe(true);
      expect(puedeTransicionar('FAILED', 'REFUNDED')).toBe(true);
    });

    it('cualquier fase operativa puede acabar en incidencia', () => {
      for (const estado of ['PAID', 'PREPARING', 'SENT_TO_SUPPLIER', 'IN_TRANSIT'] as const) {
        expect(puedeTransicionar(estado, 'FAILED')).toBe(true);
      }
    });
  });

  describe('integridad de la tabla', () => {
    it('los estados finales no tienen salida', () => {
      for (const estado of ESTADOS_FINALES) {
        if (estado === 'CLOSED') continue; // CLOSED sí admite reembolso tardío
        expect(TRANSICIONES[estado]).toHaveLength(0);
      }
    });

    it('todo estado del Kanban es alcanzable desde otro', () => {
      const alcanzables = new Set(Object.values(TRANSICIONES).flat());
      for (const estado of ESTADOS_KANBAN) {
        if (estado === 'AWAITING_PAYMENT') continue; // es el punto de entrada
        expect(alcanzables.has(estado)).toBe(true);
      }
    });

    it('ninguna transición apunta a un estado inexistente', () => {
      const validos = new Set(Object.keys(TRANSICIONES));
      for (const [desde, destinos] of Object.entries(TRANSICIONES)) {
        for (const hasta of destinos) {
          expect(validos.has(hasta), `${desde} → ${hasta} apunta a un estado inexistente`).toBe(
            true,
          );
        }
      }
    });

    it('ningún estado transiciona a sí mismo', () => {
      for (const [desde, destinos] of Object.entries(TRANSICIONES)) {
        expect(destinos, `${desde} se transiciona a sí mismo`).not.toContain(desde);
      }
    });
  });
  /**
   * Qué se puede ofrecer como «mover a».
   *
   * Es lo que pintan el tablero y la ficha del pedido. Lo que se cuela aquí no
   * es un botón de más: es un camino que se salta lo que ese estado implica.
   */
  describe('destinos que se ofrecen a una persona', () => {
    it('no ofrece cancelar, cerrar ni reembolsar', () => {
      // Los tres tienen su propia acción, que además avisa al proveedor, anota
      // quién cerró y devuelve el dinero. Como «mover a» se saltarían todo eso:
      // un pedido marcado como reembolsado sin que nadie haya devuelto nada
      // cuadra en el panel y no cuadra en el banco.
      for (const estado of Object.keys(TRANSICIONES) as OrderStatus[]) {
        expect(destinosManuales(estado)).not.toContain('CANCELLED');
        expect(destinosManuales(estado)).not.toContain('CLOSED');
        expect(destinosManuales(estado)).not.toContain('REFUNDED');
      }
    });

    it('no ofrece lo que solo hace el sistema', () => {
      // Marcar a mano «enviado al proveedor» un pedido que el proveedor nunca
      // recibió deja al cliente esperando un paquete que no existe.
      expect(destinosManuales('PREPARING')).not.toContain('SENT_TO_SUPPLIER');
      expect(destinosManuales('AWAITING_PAYMENT')).not.toContain('PAID');
    });

    it('sí ofrece el avance normal del envío', () => {
      // Es el camino de un proveedor sin API: nadie nos va a avisar de que el
      // paquete salió ni de que llegó.
      expect(destinosManuales('SENT_TO_SUPPLIER')).toContain('IN_TRANSIT');
      expect(destinosManuales('IN_TRANSIT')).toContain('DELIVERED');
      expect(destinosManuales('DELIVERED')).toContain('PENDING_CLOSE');
    });

    it('todo lo que ofrece lo acepta la máquina de estados', () => {
      // La comprobación que evita el botón que da error al pulsarlo.
      for (const estado of Object.keys(TRANSICIONES) as OrderStatus[]) {
        for (const destino of destinosManuales(estado)) {
          expect(() => exigirTransicionValida(estado, destino, 'manual')).not.toThrow();
        }
      }
    });
  });
});
