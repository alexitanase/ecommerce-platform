import { createId, isCuid } from '@paralleldrive/cuid2';

/**
 * Identificadores del sistema.
 *
 * Usamos cuid2 en lugar de enteros autoincrementales por dos motivos:
 * no filtran cuántos pedidos llevamos (un competidor no puede contar nuestras
 * ventas mirando el ID de su pedido), y se pueden generar en la aplicación
 * antes de tocar la base de datos, que es justo lo que necesita el patrón
 * outbox para crear entidad y evento en la misma transacción.
 */

export const newId = (): string => createId();
export const isValidId = (id: string): boolean => isCuid(id);

/** Prefijos legibles por tipo de entidad, útiles al depurar logs. */
export const ID_PREFIX = {
  user: 'usr',
  order: 'ord',
  product: 'prd',
  variant: 'var',
  payment: 'pay',
  supplier: 'sup',
  supplierOrder: 'sord',
  refund: 'ref',
  image: 'img',
} as const;

export type EntityKind = keyof typeof ID_PREFIX;

/** `prefixedId('order')` → "ord_x1y2z3…" */
export const prefixedId = (kind: EntityKind): string => `${ID_PREFIX[kind]}_${createId()}`;

/**
 * Número de pedido visible para el cliente: ES-2026-000123.
 * Es distinto del ID interno: corto, legible por teléfono y con año para
 * que atención al cliente sepa de qué ejercicio hablamos.
 */
export function formatOrderNumber(sequence: number, year: number, prefix = 'ES'): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Clave de idempotencia estable: la misma operación lógica produce siempre
 * la misma clave, de modo que un reintento no duplica el pedido al proveedor
 * ni el cobro al cliente.
 */
export function idempotencyKey(...parts: (string | number)[]): string {
  return parts.map((p) => String(p).replace(/[^a-zA-Z0-9_-]/g, '')).join(':');
}
