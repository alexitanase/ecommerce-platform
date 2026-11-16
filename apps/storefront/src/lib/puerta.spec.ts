import { describe, expect, it } from 'vitest';
import { rutaAbierta } from './puerta.js';

describe('rutaAbierta', () => {
  it('la portada y el catálogo llevan puerta', () => {
    expect(rutaAbierta('/es')).toBe(false);
    expect(rutaAbierta('/es/')).toBe(false);
    expect(rutaAbierta('/es/buscar')).toBe(false);
    expect(rutaAbierta('/es/producto/vibrador-doble')).toBe(false);
    expect(rutaAbierta('/es/carrito')).toBe(false);
    expect(rutaAbierta('/es/checkout')).toBe(false);
  });

  it('las páginas legales quedan abiertas', () => {
    // La LSSI obliga a que sean accesibles a cualquiera. Ponerles una puerta
    // de edad delante es exactamente lo que no se puede hacer.
    for (const legal of ['aviso-legal', 'privacidad', 'cookies', 'condiciones']) {
      expect(rutaAbierta(`/es/${legal}`), legal).toBe(true);
    }
  });

  it('el seguimiento de un pedido queda abierto, y también sus subrutas', () => {
    // El enlace del correo de confirmación tiene que funcionar sin más.
    expect(rutaAbierta('/es/pedido/tok3n')).toBe(true);
    expect(rutaAbierta('/es/pedido/tok3n/pago')).toBe(true);
  });

  it('darse de baja del correo no puede tener obstáculos', () => {
    expect(rutaAbierta('/es/preferencias')).toBe(true);
    expect(rutaAbierta('/es/preferencias/confirmar')).toBe(true);
  });

  it('la propia puerta está abierta, o no se podría verificar nunca', () => {
    expect(rutaAbierta('/es/acceso')).toBe(true);
  });

  it('vale para los tres idiomas', () => {
    expect(rutaAbierta('/ca/privacitat')).toBe(false);
    expect(rutaAbierta('/ca/privacidad')).toBe(true);
    expect(rutaAbierta('/en/privacidad')).toBe(true);
    expect(rutaAbierta('/en/buscar')).toBe(false);
  });

  it('un nombre que EMPIEZA por uno abierto no cuela', () => {
    // `/es/privacidad-falsa` no es la política de privacidad. Con `startsWith`
    // se abriría cualquier ruta que alguien nombrara con ese prefijo.
    expect(rutaAbierta('/es/privacidad-falsa')).toBe(false);
    expect(rutaAbierta('/es/pedidos')).toBe(false);
  });
});
