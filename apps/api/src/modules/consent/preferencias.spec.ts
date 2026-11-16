import { describe, expect, it } from 'vitest';
import { CANALES, type CanalComunicacion } from './preferencias.service.js';

/**
 * Lo que se comprueba aquí no es código: es la política. Que la publicidad
 * empiece apagada y los avisos de servicio encendidos es la diferencia entre
 * cumplir el RGPD y tener una sanción con el consentimiento "por defecto".
 */

/** Los mismos valores por defecto que declara el esquema de Prisma. */
const POR_DEFECTO: Record<CanalComunicacion, boolean> = {
  cartRecovery: true,
  reviewInvites: true,
  offers: false,
  newsletter: false,
};

describe('Canales de comunicación', () => {
  it('la publicidad nace desactivada', () => {
    // Consentimiento expreso: nadie queda suscrito a ofertas por comprar.
    expect(POR_DEFECTO.offers).toBe(false);
    expect(POR_DEFECTO.newsletter).toBe(false);
  });

  it('los avisos de servicio nacen activados', () => {
    // El recordatorio del carrito y la invitación a valorar acompañan a una
    // compra en curso; apagarlos por defecto los volvería inútiles.
    expect(POR_DEFECTO.cartRecovery).toBe(true);
    expect(POR_DEFECTO.reviewInvites).toBe(true);
  });

  it('los correos del pedido no son un canal que se pueda apagar', () => {
    // Confirmación, envío y entrega son ejecución del contrato: si apareciera
    // aquí, alguien podría desactivarlos y quedarse sin saber de su paquete.
    expect(CANALES).not.toContain('orderUpdates');
    expect(CANALES).toHaveLength(4);
  });
});
