import { describe, expect, it } from 'vitest';
import type { EstadoProducto } from '@ecom/suppliers';
import { estadoDeVariante } from './estado-de-variante.js';

/**
 * El caso real que hay detrás: un producto de AliExpress con ocho colores entre
 * 13,99 € y 39,99 €. Los campos de cabecera del producto llevan el precio de la
 * PRIMERA variante, así que quien los use para juzgar otra se equivoca siempre.
 */
const estado: EstadoProducto = {
  externalId: '1005008382946674',
  disponible: true,
  costCents: 2839,
  stock: 400,
  descatalogado: false,
  variantes: [
    { externalVariantId: 'v-vino', costCents: 1399, stock: 12, disponible: true },
    { externalVariantId: 'v-plata', costCents: 2199, stock: 0, disponible: false },
    { externalVariantId: 'v-ciruela', costCents: 3999, stock: 5, disponible: true },
  ],
};

describe('estadoDeVariante', () => {
  it('devuelve el coste de SU variante, no el del producto', () => {
    // Este es el fallo que paró un pedido real: 13,99 € contra 28,39 €, que es
    // el de otra variante, daba una subida inventada del 102 %.
    expect(estadoDeVariante({ externalVariantId: 'v-vino' }, estado).costCents).toBe(1399);
    expect(estadoDeVariante({ externalVariantId: 'v-ciruela' }, estado).costCents).toBe(3999);
  });

  it('devuelve el stock de SU variante', () => {
    expect(estadoDeVariante({ externalVariantId: 'v-vino' }, estado).stock).toBe(12);
    expect(estadoDeVariante({ externalVariantId: 'v-plata' }, estado)).toMatchObject({
      stock: 0,
      disponible: false,
    });
  });

  it('un producto disponible con la variante agotada NO está disponible', () => {
    // El producto tiene 400 unidades entre todas: comprar mirando ese número es
    // comprar algo que no existe en el color que pidió el cliente.
    expect(estadoDeVariante({ externalVariantId: 'v-plata' }, estado).disponible).toBe(false);
    expect(estado.disponible).toBe(true);
  });

  it('si la variante ya no está en el catálogo, se trata como descatalogada', () => {
    expect(estadoDeVariante({ externalVariantId: 'v-que-ya-no-existe' }, estado)).toEqual({
      costCents: 0,
      stock: 0,
      disponible: false,
      descatalogado: true,
    });
  });

  it('sin identificador de variante se usa lo del producto', () => {
    // Proveedores que no distinguen variantes: es lo único que hay.
    expect(estadoDeVariante({ externalVariantId: null }, estado)).toMatchObject({
      costCents: 2839,
      stock: 400,
      disponible: true,
    });
  });

  it('sin detalle por variante también se usa lo del producto', () => {
    const sinDetalle: EstadoProducto = { ...estado, variantes: [] };

    expect(estadoDeVariante({ externalVariantId: 'v-vino' }, sinDetalle)).toMatchObject({
      costCents: 2839,
      disponible: true,
    });
  });
});
