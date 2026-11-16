import { describe, expect, it } from 'vitest';
import { traducirEstado } from './seguimiento-transportista.service.js';

/**
 * De lo que dice el transportista a lo que hace el pedido.
 *
 * Esta traducción decide dos cosas que se ven desde fuera: cuándo el cliente
 * recibe el correo de «entregado» y cuándo un envío entra en la cola de
 * revisión del equipo. Equivocarse por exceso —dar por entregado lo que no lo
 * está— cierra el pedido con el paquete todavía en un almacén; por defecto,
 * deja al cliente esperando un aviso que no llega.
 */
describe('traducir el estado del transportista', () => {
  it('entregado es entregado', () => {
    expect(traducirEstado('Delivered')).toBe('ENTREGADO');
  });

  it('todo lo que significa «va en camino» cuenta como enviado', () => {
    // Los cuatro son el paquete moviéndose. Distinguirlos en el pedido no
    // aportaría nada: nuestro estado solo tiene «en tránsito».
    expect(traducirEstado('InfoReceived')).toBe('ENVIADO');
    expect(traducirEstado('InTransit')).toBe('ENVIADO');
    expect(traducirEstado('OutForDelivery')).toBe('ENVIADO');
    expect(traducirEstado('AvailableForPickup')).toBe('ENVIADO');
  });

  it('lo que necesita a una persona entra como incidencia', () => {
    /*
     * Los tres se quedaban invisibles: el paquete se paraba en aduana o volvía
     * al almacén y el pedido seguía diciendo «en tránsito» hasta que escribía
     * el cliente. Ahora aparecen en la cola de revisión.
     */
    expect(traducirEstado('Exception')).toBe('INCIDENCIA');
    expect(traducirEstado('DeliveryFailure')).toBe('INCIDENCIA');
    expect(traducirEstado('Expired')).toBe('INCIDENCIA');
  });

  it('«no encontrado» no mueve el pedido', () => {
    /*
     * Es el caso ambiguo, y por eso no se traduce a nada.
     *
     * `NotFound` significa las dos cosas a la vez: «el transportista todavía no
     * ha escaneado el paquete» —lo normal las primeras horas— y «este número no
     * existe» —un dígito mal tecleado—. Desde aquí no se pueden distinguir, y
     * cualquiera de las dos lecturas se equivoca la mitad de las veces: marcar
     * incidencia llenaría la cola de envíos recién salidos, y darlo por bueno
     * escondería los números mal copiados.
     */
    expect(traducirEstado('NotFound')).toBe('DESCONOCIDO');
  });

  it('un estado que no conocemos no se interpreta', () => {
    // Si mañana añaden uno, el pedido se queda quieto en vez de moverse a un
    // sitio equivocado. Aparecerá en el registro y se añade aquí.
    expect(traducirEstado('AlgoNuevo')).toBe('DESCONOCIDO');
    expect(traducirEstado('')).toBe('DESCONOCIDO');
  });
});
