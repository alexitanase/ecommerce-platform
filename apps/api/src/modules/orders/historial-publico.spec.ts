import { describe, expect, it } from 'vitest';
import { clavePublica, historialPublico, TIPOS_PUBLICOS } from './historial-publico.js';

/**
 * Lo que puede leer cualquiera que tenga el enlace de un pedido.
 *
 * La página de seguimiento es pública: no pide contraseña, basta la clave que
 * va en el correo. Todo lo que salga por aquí hay que darlo por publicado.
 *
 * El fallo que arregla esto no era teórico. En la base de desarrollo había
 * eventos que decían «Enviado a Proveedor de Pruebas · referencia SIMORD-…»,
 * «El proveedor ha cobrado 12,40 € (se esperaban 9,90 €)» y «Cobro iniciado
 * con Stripe», y los tres se enseñaban tal cual: a quién le compramos, cuánto
 * ganamos y con quién cobramos.
 */

const evento = (type: string, metadata?: unknown, dia = 1) => ({
  type,
  metadata,
  createdAt: new Date(`2026-03-0${String(dia)}T10:00:00Z`),
});

describe('qué evento se le enseña al cliente', () => {
  it('traduce los hitos que sí le importan', () => {
    expect(clavePublica(evento('order.created'))).toBe('realizado');
    expect(clavePublica(evento('order.paid'))).toBe('pagado');
    expect(clavePublica(evento('order.shipped'))).toBe('en_camino');
  });

  it('un pago marcado a mano es un pago igual', () => {
    // Lo marca una persona cuando entra una transferencia. Para quien compró
    // no hay ninguna diferencia, y decir «marcado a mano» solo siembra dudas.
    expect(clavePublica(evento('order.paid_manually'))).toBe('pagado');
  });

  it('lee el estado de la metadata y no del texto', () => {
    // El texto del evento es «Pago confirmado → Enviado al proveedor». La
    // metadata dice lo mismo sin nombrar a nadie.
    expect(
      clavePublica(evento('order.status_changed', { desde: 'PAID', hasta: 'PREPARING' })),
    ).toBe('preparando');
    expect(
      clavePublica(
        evento('order.status_changed', { desde: 'PREPARING', hasta: 'SENT_TO_SUPPLIER' }),
      ),
    ).toBe('preparando');
    expect(
      clavePublica(evento('order.status_changed', { desde: 'IN_TRANSIT', hasta: 'DELIVERED' })),
    ).toBe('entregado');
  });

  it('calla los estados que son papeleo nuestro', () => {
    // «Pendiente de cerrar» y «cerrado» son archivo interno. Para quien compró,
    // el pedido terminó cuando llegó a su casa.
    for (const hasta of [
      'DRAFT',
      'AWAITING_PAYMENT',
      'PAYMENT_CONFIRMING',
      'PENDING_CLOSE',
      'CLOSED',
    ]) {
      expect(clavePublica(evento('order.status_changed', { hasta })), hasta).toBeNull();
    }
  });

  it('NO enseña nada de proveedores ni de lo que nos cuesta', () => {
    /*
     * El corazón del asunto. Estos tres eventos existen, son del sistema y se
     * escribían enteros en la página pública. Si alguien los vuelve a meter en
     * la lista, esta prueba se pone roja.
     */
    expect(clavePublica(evento('supplier_order.placed'))).toBeNull();
    expect(clavePublica(evento('supplier.status_changed'))).toBeNull();
    expect(clavePublica(evento('supplier.cost_reconciled'))).toBeNull();
    expect(clavePublica(evento('payment.created'))).toBeNull();

    expect(TIPOS_PUBLICOS).not.toContain('supplier_order.placed');
    expect(TIPOS_PUBLICOS).not.toContain('supplier.cost_reconciled');
    expect(TIPOS_PUBLICOS).not.toContain('payment.created');
  });

  it('un tipo que no conoce nace invisible', () => {
    // Es la diferencia con filtrar por actorType: lo que no está en la lista
    // no sale, así que un evento nuevo no puede filtrar nada sin que alguien
    // lo añada a mano y pase por aquí.
    expect(clavePublica(evento('order.margin_recalculated'))).toBeNull();
    expect(
      clavePublica(evento('order.status_changed', { hasta: 'ESTADO_QUE_NO_EXISTE' })),
    ).toBeNull();
    expect(clavePublica(evento('order.status_changed', undefined))).toBeNull();
    expect(clavePublica(evento('order.status_changed', 'una cadena, no un objeto'))).toBeNull();
  });
});

describe('el historial completo', () => {
  it('agrupa los hitos repetidos seguidos y se queda con el primero', () => {
    // Pagar deja dos huellas internas: el cobro y el cambio de estado. Sin
    // agrupar, el cliente lee «Pago confirmado» dos veces y entiende que le
    // han cobrado dos veces.
    const hitos = historialPublico([
      evento('order.created', undefined, 1),
      evento('order.paid', undefined, 2),
      evento('order.status_changed', { hasta: 'PAID' }, 2),
      evento('order.status_changed', { hasta: 'PREPARING' }, 3),
      evento('order.status_changed', { hasta: 'SENT_TO_SUPPLIER' }, 4),
    ]);

    expect(hitos.map((h) => h.clave)).toEqual(['realizado', 'pagado', 'preparando']);
    // El día 3, cuando empezó a prepararse de verdad, no el 4.
    expect(hitos[2]?.createdAt.toISOString()).toContain('2026-03-03');
  });

  it('no agrupa lo que pasó dos veces de verdad', () => {
    // Un paquete que se para y vuelve a salir son dos cosas, no una.
    const hitos = historialPublico([
      evento('order.status_changed', { hasta: 'IN_TRANSIT' }, 1),
      evento('order.status_changed', { hasta: 'FAILED' }, 2),
      evento('order.status_changed', { hasta: 'IN_TRANSIT' }, 3),
    ]);

    expect(hitos.map((h) => h.clave)).toEqual(['en_camino', 'incidencia', 'en_camino']);
  });

  it('un historial lleno de trapos sucios sale vacío', () => {
    const hitos = historialPublico([
      evento('supplier_order.placed'),
      evento('supplier.cost_reconciled'),
      evento('payment.created'),
      evento('order.note'),
    ]);

    expect(hitos).toEqual([]);
  });
});
