import { describe, expect, it } from 'vitest';
import {
  corregirPrecioTachado,
  descuentoAnunciable,
  minimoUltimos30Dias,
  plazoEntrega,
  requiereAvisoAduanas,
  type PuntoPrecio,
} from './transparencia-precios.js';

/**
 * El truco que persigue la directiva Ómnibus: subir el precio unos días para
 * poder tacharlo después y simular un descuento que no existe.
 */

const AHORA = new Date('2026-07-26T12:00:00Z');
const haceDias = (n: number) => new Date(AHORA.getTime() - n * 86_400_000);
const punto = (precio: number, dias: number): PuntoPrecio => ({
  priceCents: precio,
  validFrom: haceDias(dias),
});

describe('Precio mínimo de referencia', () => {
  // El histórico incluye el precio vigente como última entrada: es lo que se
  // guarda en cada cambio. La referencia son los 30 días ANTERIORES a él.

  it('coge el más bajo del periodo previo a la rebaja', () => {
    const historico = [punto(5999, 40), punto(4999, 20), punto(3999, 1)];
    expect(minimoUltimos30Dias(historico, AHORA)).toBe(4999);
  });

  it('cuenta el precio que ya regía al abrirse la ventana', () => {
    // Fijado hace tres meses y rebajado ayer: los 39,99 € son la referencia
    // aunque el cambio sea anterior a la ventana. Mirar solo los registros
    // recientes daría "sin historial" y dejaría anunciar cualquier descuento.
    const historico = [punto(3999, 90), punto(2999, 1)];
    expect(minimoUltimos30Dias(historico, AHORA)).toBe(3999);
  });

  it('lo que quedó fuera de la ventana no cuenta si luego hubo otro precio', () => {
    // 19,99 € hace 90 días, 49,99 € desde hace 40, rebaja ayer: al abrirse la
    // ventana (día 31) el precio era 49,99 €, no 19,99 €.
    const historico = [punto(1999, 90), punto(4999, 40), punto(3999, 1)];
    expect(minimoUltimos30Dias(historico, AHORA)).toBe(4999);
  });

  it('el precio actual NO forma parte de su propia referencia', () => {
    // Incluirlo haría que el mínimo fuera siempre él mismo y nunca hubiera
    // descuento que anunciar.
    const historico = [punto(5999, 20), punto(3999, 1)];
    expect(minimoUltimos30Dias(historico, AHORA)).toBe(5999);
  });

  it('sin precio anterior no hay referencia', () => {
    // Un producto recién publicado no se puede anunciar como rebajado.
    expect(minimoUltimos30Dias([], AHORA)).toBeNull();
    expect(minimoUltimos30Dias([punto(4999, 2)], AHORA)).toBeNull();
  });
});

describe('Qué descuento se puede anunciar', () => {
  it('anuncia un descuento real', () => {
    // Costó 59,99 € durante el periodo y ahora vale 39,99 €: descuento legítimo.
    const historico = [punto(5999, 20), punto(3999, 1)];
    const d = descuentoAnunciable(historico, 3999, AHORA);

    expect(d.anunciable).toBe(true);
    expect(d.referenciaCents).toBe(5999);
    expect(d.porcentaje).toBe(33);
  });

  it('NO deja anunciar descuento si el precio se infló hace poco', () => {
    // El truco clásico: 39,99 € toda la vida, se sube a 59,99 € hace tres días
    // y se "rebaja" a 49,99 € para tachar los 59,99. El mínimo de los 30 días
    // es 39,99 €, y 49,99 € no está por debajo: no hay descuento.
    const historico = [punto(3999, 25), punto(5999, 3), punto(4999, 1)];
    const d = descuentoAnunciable(historico, 4999, AHORA);

    expect(d.anunciable).toBe(false);
    expect(d.referenciaCents).toBeNull();
  });

  it('sin bajada de precio no hay nada que anunciar', () => {
    const historico = [punto(4999, 20), punto(4999, 1)];
    expect(descuentoAnunciable(historico, 4999, AHORA).anunciable).toBe(false);
  });

  it('una subida tampoco es un descuento', () => {
    const historico = [punto(3999, 20), punto(4999, 1)];
    expect(descuentoAnunciable(historico, 4999, AHORA).anunciable).toBe(false);
  });

  it('calcula bien el porcentaje sobre la referencia legal', () => {
    // Sobre el mínimo del periodo (50 €), no sobre el precio más alto.
    const historico = [punto(9999, 40), punto(5000, 20), punto(2500, 1)];
    const d = descuentoAnunciable(historico, 2500, AHORA);

    expect(d.referenciaCents).toBe(5000);
    expect(d.porcentaje).toBe(50);
  });
});

describe('Precio tachado puesto a mano en el admin', () => {
  it('lo ajusta al mínimo legal si es mayor', () => {
    // "Antes 119,99 €" cuando en 30 días nunca pasó de 59,99 € es publicidad
    // engañosa. Se corrige en vez de rechazar el guardado.
    const historico = [punto(5999, 20), punto(3999, 1)];
    const r = corregirPrecioTachado(historico, 3999, 11999, AHORA);

    expect(r.corregido).toBe(true);
    expect(r.tachadoCents).toBe(5999);
    expect(r.motivo).toContain('59.99');
  });

  it('lo acepta tal cual si es correcto', () => {
    const historico = [punto(5999, 20), punto(3999, 1)];
    const r = corregirPrecioTachado(historico, 3999, 5999, AHORA);

    expect(r.corregido).toBe(false);
    expect(r.tachadoCents).toBe(5999);
  });

  it('lo quita si no hay descuento real', () => {
    const historico = [punto(3999, 25), punto(5999, 3), punto(4999, 1)];
    const r = corregirPrecioTachado(historico, 4999, 5999, AHORA);

    expect(r.tachadoCents).toBeNull();
    expect(r.motivo).toContain('no costó más que ahora');
  });

  it('lo quita si no es superior al precio actual', () => {
    const r = corregirPrecioTachado([], 4999, 4999, AHORA);
    expect(r.tachadoCents).toBeNull();
  });

  it('sin precio tachado no toca nada', () => {
    const r = corregirPrecioTachado([], 4999, null, AHORA);
    expect(r.tachadoCents).toBeNull();
    expect(r.corregido).toBe(false);
  });
});

describe('Plazo de entrega', () => {
  it('suma el plazo del proveedor y el del transporte', () => {
    // En dropshipping el plazo real es la suma, y ocultarlo es la primera
    // causa de reclamación.
    expect(plazoEntrega(3, 5, 12)).toEqual({ min: 8, max: 15 });
  });

  it('nunca promete entrega en menos de un día', () => {
    expect(plazoEntrega(0, 0, 0)).toEqual({ min: 1, max: 1 });
  });
});

describe('Aviso de aduanas', () => {
  it('avisa si el envío viene de fuera de la UE', () => {
    // Aranceles e IVA de importación los paga el destinatario: descubrirlo al
    // recibir el paquete es una omisión relevante antes de comprar.
    expect(requiereAvisoAduanas('CN', 'ES')).toBe(true);
  });

  it('no avisa dentro de la UE', () => {
    expect(requiereAvisoAduanas('ES', 'ES')).toBe(false);
    expect(requiereAvisoAduanas('DE', 'ES')).toBe(false);
  });

  it('no avisa si el destino tampoco está en la UE', () => {
    expect(requiereAvisoAduanas('CN', 'US')).toBe(false);
  });
});
