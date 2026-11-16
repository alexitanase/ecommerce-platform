import { describe, expect, it } from 'vitest';
import { cambiosDePrecio, fusionarCarritos, type LineaFusion } from './fusion-carrito.js';

const linea = (variantId: string, quantity: number, precio = 1000): LineaFusion => ({
  variantId,
  quantity,
  priceWhenAddedCents: precio,
});

/** Stock de sobra para todas las variantes que aparezcan. */
const stockAmplio = (ids: string[]) => new Map(ids.map((id) => [id, 999]));

describe('Fusión de carritos al iniciar sesión', () => {
  it('conserva lo que había en la cuenta y añade lo del invitado', () => {
    // Ninguna de las dos partes puede perderse: lo guardado es lo que el
    // cliente espera encontrar, y lo recién añadido lo estaba mirando ahora.
    const cuenta = [linea('a', 1)];
    const invitado = [linea('b', 2)];

    const { lineas } = fusionarCarritos(cuenta, invitado, stockAmplio(['a', 'b']));

    expect(lineas).toHaveLength(2);
    expect(lineas.find((l) => l.variantId === 'a')?.quantity).toBe(1);
    expect(lineas.find((l) => l.variantId === 'b')?.quantity).toBe(2);
  });

  it('suma las cantidades de la misma variante', () => {
    const { lineas } = fusionarCarritos([linea('a', 2)], [linea('a', 3)], stockAmplio(['a']));

    expect(lineas).toHaveLength(1);
    expect(lineas[0]?.quantity).toBe(5);
  });

  it('recorta al stock disponible en lugar de dejar un pedido que fallará', () => {
    // 3 + 3 = 6 unidades de algo con 4 en stock. Sin recorte, el cliente
    // descubre el problema en la pantalla de pago, que es donde peor sienta.
    const stock = new Map([['a', 4]]);
    const { lineas, recortadas } = fusionarCarritos([linea('a', 3)], [linea('a', 3)], stock);

    expect(lineas[0]?.quantity).toBe(4);
    expect(recortadas).toEqual([{ variantId: 'a', pedida: 6, disponible: 4 }]);
  });

  it('descarta lo que se quedó sin stock mientras el carrito dormía', () => {
    const stock = new Map([
      ['a', 0],
      ['b', 5],
    ]);
    const { lineas, recortadas } = fusionarCarritos([linea('a', 1), linea('b', 1)], [], stock);

    expect(lineas.map((l) => l.variantId)).toEqual(['b']);
    expect(recortadas[0]).toEqual({ variantId: 'a', pedida: 1, disponible: 0 });
  });

  it('una variante que ya no existe se trata como sin stock', () => {
    const { lineas, recortadas } = fusionarCarritos([linea('fantasma', 2)], [], new Map());
    expect(lineas).toHaveLength(0);
    expect(recortadas).toHaveLength(1);
  });

  it('respeta el tope por línea aunque haya stock de sobra', () => {
    const { lineas } = fusionarCarritos([linea('a', 60)], [linea('a', 60)], stockAmplio(['a']), 99);
    expect(lineas[0]?.quantity).toBe(99);
  });

  it('conserva el precio más antiguo de los dos', () => {
    // Es el que el cliente vio primero, y sobre el que se le avisa si sube.
    const { lineas } = fusionarCarritos(
      [linea('a', 1, 1200)],
      [linea('a', 1, 900)],
      stockAmplio(['a']),
    );
    expect(lineas[0]?.priceWhenAddedCents).toBe(900);
  });

  it('fusionar con un carrito vacío no cambia nada', () => {
    const { lineas, recortadas } = fusionarCarritos([linea('a', 2)], [], stockAmplio(['a']));
    expect(lineas).toEqual([linea('a', 2)]);
    expect(recortadas).toHaveLength(0);
  });

  it('un carrito de cuenta vacío se queda con el del invitado', () => {
    const { lineas } = fusionarCarritos([], [linea('a', 2)], stockAmplio(['a']));
    expect(lineas).toEqual([linea('a', 2)]);
  });

  it('no modifica los carritos de entrada', () => {
    // Mutarlos haría que el llamante viera cantidades ya recortadas y
    // guardara datos incorrectos en el carrito de origen.
    const cuenta = [linea('a', 3)];
    const invitado = [linea('a', 3)];
    fusionarCarritos(cuenta, invitado, new Map([['a', 4]]));

    expect(cuenta[0]?.quantity).toBe(3);
    expect(invitado[0]?.quantity).toBe(3);
  });
});

describe('Avisos de cambio de precio', () => {
  it('detecta una subida', () => {
    const cambios = cambiosDePrecio(
      [{ variantId: 'a', priceWhenAddedCents: 1000 }],
      new Map([['a', 1200]]),
    );
    expect(cambios).toEqual([{ variantId: 'a', anteriorCents: 1000, actualCents: 1200 }]);
  });

  it('avisa también de las bajadas', () => {
    // Una bajada es buena noticia y conviene enseñarla; una subida oculta
    // hasta la pantalla de pago hace abandonar el carrito.
    const cambios = cambiosDePrecio(
      [{ variantId: 'a', priceWhenAddedCents: 1200 }],
      new Map([['a', 900]]),
    );
    expect(cambios[0]?.actualCents).toBe(900);
  });

  it('no avisa si el precio no ha cambiado', () => {
    expect(
      cambiosDePrecio([{ variantId: 'a', priceWhenAddedCents: 1000 }], new Map([['a', 1000]])),
    ).toHaveLength(0);
  });

  it('ignora las variantes que ya no están en el catálogo', () => {
    expect(
      cambiosDePrecio([{ variantId: 'a', priceWhenAddedCents: 1000 }], new Map()),
    ).toHaveLength(0);
  });
});
