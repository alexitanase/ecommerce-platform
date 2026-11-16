/**
 * Qué proveedor sirve cada línea.
 *
 * Lo deciden dos momentos distintos —el cálculo del IVA al crear el pedido y el
 * envío al proveedor al cobrarlo— y tienen que coincidir: si el IVA se calcula
 * contando con que la mercancía sale de España y luego el pedido se le manda a
 * un proveedor chino, la factura ya emitida dice una cosa y el paquete hace
 * otra. Por eso la elección vive aquí y no duplicada en cada sitio.
 */

export interface EnlaceProveedor {
  variantId: string | null;
  stock: number;
  costCents: number;
  shippingCents: number;
  supplier: { priority: number };
}

/**
 * Proveedor que sirve una línea, o `undefined` si ninguno tiene stock.
 *
 * Gana el de mayor prioridad y, a igualdad, el más barato contando el porte.
 * Ir siempre al más barato sin más sería un error: un proveedor fiable que
 * tarda 12 días vale más que uno tres euros más barato que tarda 40 y falla la
 * mitad de las veces.
 */
export function elegirEnlace<T extends EnlaceProveedor>(
  enlaces: T[],
  variantId: string,
  cantidad: number,
): T | undefined {
  return enlaces
    .filter((e) => e.variantId === variantId && e.stock >= cantidad)
    .sort(
      (a, b) =>
        b.supplier.priority - a.supplier.priority ||
        a.costCents + a.shippingCents - (b.costCents + b.shippingCents),
    )[0];
}
