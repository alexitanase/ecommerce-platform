/**
 * Cálculo del descuento de un cupón.
 *
 * Puro y probado aparte porque cada rama es dinero que sale de la caja. Los
 * errores aquí no dan excepción: dan pedidos cobrados de menos, y solo se ven
 * al cuadrar el mes.
 */

export type TipoCupon = 'PERCENTAGE' | 'FIXED' | 'FREE_SHIPPING';

export interface Cupon {
  code: string;
  type: TipoCupon;
  value: number;
  maxDiscountCents: number | null;
  minOrderCents: number;
  maxUses: number | null;
  maxUsesPerCustomer: number;
  usedCount: number;
  validFrom: Date;
  validUntil: Date | null;
  categoryIds: string[];
  excludedProductIds: string[];
  isActive: boolean;
}

export interface LineaCarrito {
  productId: string;
  categoryId: string | null;
  totalCents: number;
}

export type MotivoRechazo =
  | 'NO_EXISTE'
  | 'INACTIVO'
  | 'AUN_NO_VALIDO'
  | 'CADUCADO'
  | 'AGOTADO'
  | 'LIMITE_CLIENTE'
  | 'MINIMO_NO_ALCANZADO'
  | 'SIN_PRODUCTOS_APLICABLES';

export interface ResultadoCupon {
  aplicable: boolean;
  motivo?: MotivoRechazo;
  /** Descuento sobre los productos. */
  descuentoCents: number;
  /** El envío pasa a ser gratis. */
  envioGratis: boolean;
  /** Importe sobre el que se calculó, para poder explicarlo. */
  baseAplicableCents: number;
}

const RECHAZO = (motivo: MotivoRechazo): ResultadoCupon => ({
  aplicable: false,
  motivo,
  descuentoCents: 0,
  envioGratis: false,
  baseAplicableCents: 0,
});

/**
 * Qué parte del carrito cubre el cupón.
 *
 * Un cupón restringido a "Calzado" no descuenta sobre el pedido entero: solo
 * sobre las líneas de esa categoría. Aplicarlo al total sería regalar
 * descuento en productos que la promoción nunca incluyó.
 */
export function baseAplicable(cupon: Cupon, lineas: LineaCarrito[]): number {
  return lineas
    .filter((l) => {
      if (cupon.excludedProductIds.includes(l.productId)) return false;
      if (cupon.categoryIds.length === 0) return true;
      return l.categoryId !== null && cupon.categoryIds.includes(l.categoryId);
    })
    .reduce((suma, l) => suma + l.totalCents, 0);
}

/**
 * Evalúa un cupón contra un carrito.
 *
 * @param usosDelCliente cuántas veces lo ha usado ya esta persona
 * @param subtotalCents total del carrito, para el mínimo de compra
 */
export function evaluarCupon(
  cupon: Cupon | null,
  lineas: LineaCarrito[],
  subtotalCents: number,
  usosDelCliente: number,
  ahora = new Date(),
): ResultadoCupon {
  if (!cupon) return RECHAZO('NO_EXISTE');
  if (!cupon.isActive) return RECHAZO('INACTIVO');

  if (ahora < cupon.validFrom) return RECHAZO('AUN_NO_VALIDO');
  if (cupon.validUntil && ahora > cupon.validUntil) return RECHAZO('CADUCADO');

  if (cupon.maxUses !== null && cupon.usedCount >= cupon.maxUses) return RECHAZO('AGOTADO');
  if (usosDelCliente >= cupon.maxUsesPerCustomer) return RECHAZO('LIMITE_CLIENTE');

  // El mínimo se compara con el subtotal del carrito, no con la base
  // aplicable: quien pide 100 € y tiene 30 € en la categoría del cupón sí
  // alcanza un mínimo de 50 €.
  if (subtotalCents < cupon.minOrderCents) return RECHAZO('MINIMO_NO_ALCANZADO');

  if (cupon.type === 'FREE_SHIPPING') {
    return {
      aplicable: true,
      descuentoCents: 0,
      envioGratis: true,
      baseAplicableCents: subtotalCents,
    };
  }

  const base = baseAplicable(cupon, lineas);

  // Restringido a categorías que no están en el carrito: no hay nada que
  // descontar y decirlo es mejor que aplicar 0 € en silencio.
  if (base === 0) return RECHAZO('SIN_PRODUCTOS_APLICABLES');

  let descuento =
    cupon.type === 'PERCENTAGE' ? Math.round((base * cupon.value) / 100) : cupon.value;

  // Tope del cupón: sin él, un 50% sobre un pedido grande regala cientos de
  // euros que la promoción no pretendía.
  if (cupon.maxDiscountCents !== null) {
    descuento = Math.min(descuento, cupon.maxDiscountCents);
  }

  // Nunca más que lo que cubre. Un cupón de 20 € sobre 15 € de producto
  // descuenta 15 €, no deja el pedido en negativo ni devuelve dinero.
  descuento = Math.min(descuento, base);

  return {
    aplicable: true,
    descuentoCents: Math.max(0, descuento),
    envioGratis: false,
    baseAplicableCents: base,
  };
}

/** Mensaje para el cliente. Explica qué falta, no solo que no vale. */
export function mensajeRechazo(motivo: MotivoRechazo, cupon?: Cupon | null): string {
  switch (motivo) {
    case 'NO_EXISTE':
      return 'Ese código no existe. Comprueba que esté bien escrito.';
    case 'INACTIVO':
      return 'Este código ya no está disponible.';
    case 'AUN_NO_VALIDO':
      return 'Este código todavía no se puede usar.';
    case 'CADUCADO':
      return 'Este código ha caducado.';
    case 'AGOTADO':
      return 'Este código ya se ha agotado.';
    case 'LIMITE_CLIENTE':
      return 'Ya has usado este código el máximo de veces permitido.';
    case 'MINIMO_NO_ALCANZADO':
      return cupon
        ? `Este código requiere una compra mínima de ${(cupon.minOrderCents / 100).toFixed(2)} €.`
        : 'No alcanzas la compra mínima para este código.';
    case 'SIN_PRODUCTOS_APLICABLES':
      return 'Este código no se aplica a ninguno de los productos de tu carrito.';
  }
}
