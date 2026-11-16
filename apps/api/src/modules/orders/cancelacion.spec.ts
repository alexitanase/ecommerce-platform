import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '@ecom/db';
import {
  hayDineroCobrado,
  motivoNoCancelable,
  planDeCancelacion,
  puedeCambiarDireccion,
  puedeCancelar,
} from './cancelacion.js';

/**
 * Cancelar mal cuesta dinero en las dos direcciones: tarde deja un paquete que
 * nadie recoge; sin devolver el stock, unidades bloqueadas que no se venden.
 */

describe('Quién puede cancelar y cuándo', () => {
  describe('el cliente', () => {
    it('puede antes de pagar', () => {
      expect(puedeCancelar('AWAITING_PAYMENT', 'cliente')).toBe(true);
    });

    it('puede justo después de pagar', () => {
      // Todavía no ha salido al proveedor: nada que detener.
      expect(puedeCancelar('PAID', 'cliente')).toBe(true);
    });

    it('NO puede una vez enviado al proveedor', () => {
      // Podría haber un paquete en movimiento: cancelar automáticamente
      // devolvería el dinero con la mercancía ya despachada.
      expect(puedeCancelar('PREPARING', 'cliente')).toBe(false);
      expect(puedeCancelar('SENT_TO_SUPPLIER', 'cliente')).toBe(false);
    });

    it('NO puede con el paquete en camino', () => {
      expect(puedeCancelar('IN_TRANSIT', 'cliente')).toBe(false);
    });

    it('NO puede una vez entregado: eso es una devolución', () => {
      expect(puedeCancelar('DELIVERED', 'cliente')).toBe(false);
    });
  });

  describe('el equipo', () => {
    it('llega más lejos que el cliente', () => {
      // Una persona puede llamar al proveedor y comprobar si ha salido.
      expect(puedeCancelar('PREPARING', 'equipo')).toBe(true);
      expect(puedeCancelar('SENT_TO_SUPPLIER', 'equipo')).toBe(true);
    });

    it('puede rescatar un pedido con incidencia', () => {
      expect(puedeCancelar('FAILED', 'equipo')).toBe(true);
    });

    it('tampoco puede con el paquete ya en camino', () => {
      expect(puedeCancelar('IN_TRANSIT', 'equipo')).toBe(false);
      expect(puedeCancelar('DELIVERED', 'equipo')).toBe(false);
    });
  });
});

describe('Qué hay que deshacer', () => {
  it('sin pagar: ni stock ni reembolso', () => {
    const plan = planDeCancelacion('AWAITING_PAYMENT', {
      cobrado: false,
      stockDescontado: false,
    });
    expect(plan).toEqual({
      devolverStock: false,
      cancelarEnProveedor: false,
      reembolsar: false,
      requiereRevision: false,
    });
  });

  const cobrado = { cobrado: true, stockDescontado: true };
  const sinCobrar = { cobrado: false, stockDescontado: false };

  it('pagado: devolver stock y reembolsar', () => {
    const plan = planDeCancelacion('PAID', cobrado);
    expect(plan.devolverStock).toBe(true);
    expect(plan.reembolsar).toBe(true);
    // Aún no ha salido al proveedor: nada que cancelar allí.
    expect(plan.cancelarEnProveedor).toBe(false);
  });

  it('en preparación: además hay que cancelarlo en el proveedor', () => {
    const plan = planDeCancelacion('PREPARING', cobrado);
    expect(plan.cancelarEnProveedor).toBe(true);
    expect(plan.devolverStock).toBe(true);
    expect(plan.reembolsar).toBe(true);
  });

  it('aceptado por el proveedor: exige revisión humana', () => {
    // Puede haberlo despachado aunque no haya número de seguimiento todavía.
    // Cancelarlo a ciegas dejaría el dinero devuelto y el paquete en camino.
    expect(planDeCancelacion('SENT_TO_SUPPLIER', cobrado).requiereRevision).toBe(true);
    expect(planDeCancelacion('PAID', cobrado).requiereRevision).toBe(false);
  });

  it('no devuelve stock de un pedido que nunca lo descontó', () => {
    // Descontar de más al cancelar inflaría el inventario con unidades que no
    // existen, y el descuadre solo aparecería al agotarse el producto.
    for (const estado of ['DRAFT', 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMING'] as OrderStatus[]) {
      expect(planDeCancelacion(estado, sinCobrar).devolverStock).toBe(false);
    }
  });

  it('una incidencia de un pedido COBRADO se reembolsa', () => {
    /*
     * El fallo que esto arregla: `FAILED` no estaba en la lista de estados «ya
     * cobrados», así que cancelar un pedido en incidencia devolvía el pedido y
     * NO el dinero. Sin error, sin aviso, y con el cliente esperando.
     */
    const plan = planDeCancelacion('FAILED', cobrado);
    expect(plan.reembolsar).toBe(true);
    expect(plan.devolverStock).toBe(true);
    // Y se pregunta al proveedor: la incidencia puede venir de un sub-pedido ya
    // colocado, y devolver el dinero de un paquete que sale igual es perderlo.
    expect(plan.cancelarEnProveedor).toBe(true);
  });

  it('una incidencia SIN cobrar no reembolsa nada', () => {
    const plan = planDeCancelacion('FAILED', sinCobrar);
    expect(plan.reembolsar).toBe(false);
    expect(plan.devolverStock).toBe(false);
  });
});

describe('Hay dinero cobrado', () => {
  it('reconoce los estados con dinero dentro', () => {
    for (const estado of ['PAID', 'OVERPAID', 'PARTIALLY_PAID']) {
      expect(hayDineroCobrado(estado), estado).toBe(true);
    }
  });

  it('y los que no', () => {
    for (const estado of ['PENDING', 'AWAITING_CONFIRMATION', 'EXPIRED', 'FAILED', 'REFUNDED']) {
      expect(hayDineroCobrado(estado), estado).toBe(false);
    }
  });
});

describe('Mensaje cuando no se puede', () => {
  it('no da mensaje si sí se puede', () => {
    expect(motivoNoCancelable('PAID', 'cliente')).toBeNull();
  });

  it('con el paquete en camino, remite a la devolución', () => {
    // Un "no se puede" a secas acaba en un correo a soporte.
    const mensaje = motivoNoCancelable('IN_TRANSIT', 'cliente');
    expect(mensaje).toContain('14 días');
  });

  it('entregado, también', () => {
    expect(motivoNoCancelable('DELIVERED', 'cliente')).toContain('14 días');
  });

  it('en preparación, invita a escribir al equipo', () => {
    expect(motivoNoCancelable('PREPARING', 'cliente')).toContain('Escríbenos');
  });

  it('avisa si ya estaba cancelado', () => {
    expect(motivoNoCancelable('CANCELLED', 'cliente')).toContain('ya está cancelado');
  });
});

describe('Cambio de dirección', () => {
  it('se admite mientras no haya salido al proveedor', () => {
    expect(puedeCambiarDireccion('AWAITING_PAYMENT')).toBe(true);
    expect(puedeCambiarDireccion('PAID')).toBe(true);
  });

  it('no se admite una vez en el proveedor', () => {
    // Cambiarla aquí no cambia la etiqueta del paquete, y el cliente creería
    // que sí: acabaría esperando el pedido en una dirección equivocada.
    expect(puedeCambiarDireccion('SENT_TO_SUPPLIER')).toBe(false);
    expect(puedeCambiarDireccion('IN_TRANSIT')).toBe(false);
  });
});
