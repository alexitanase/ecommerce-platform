'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Carrito de la compra.
 *
 * Vive en el navegador (localStorage) y no en el servidor a propósito: así el
 * cliente puede navegar sin cuenta, y añadir un producto no necesita ida y
 * vuelta al servidor. Los precios se guardan solo para poder mostrar el total
 * al instante; en el checkout el servidor los recalcula desde la base de datos
 * y descarta los del cliente, porque un precio que llega del navegador se puede
 * editar.
 */

export interface LineaCarrito {
  variantId: string;
  productId: string;
  sku: string;
  nombre: string;
  variante: string | null;
  imagen: string | null;
  /** Precio unitario en céntimos, solo para mostrar. */
  precioCents: number;
  cantidad: number;
  /** Stock disponible en el momento de añadirlo, para avisar de límites. */
  stockDisponible: number;
  slug: string;
}

interface EstadoCarrito {
  /** Identificador del carrito; el servidor lo usa para reservar stock. */
  cartId: string;
  lineas: LineaCarrito[];
  abierto: boolean;

  anadir: (linea: Omit<LineaCarrito, 'cantidad'>, cantidad?: number) => void;
  cambiarCantidad: (variantId: string, cantidad: number) => void;
  eliminar: (variantId: string) => void;
  vaciar: () => void;
  abrir: () => void;
  cerrar: () => void;

  totalArticulos: () => number;
  subtotalCents: () => number;
}

/** Identificador estable del carrito, generado en el navegador. */
function nuevoCartId(): string {
  return `cart_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export const useCarrito = create<EstadoCarrito>()(
  persist(
    (set, get) => ({
      cartId: nuevoCartId(),
      lineas: [],
      abierto: false,

      anadir: (linea, cantidad = 1) => {
        const lineas = [...get().lineas];
        const existente = lineas.findIndex((l) => l.variantId === linea.variantId);

        if (existente >= 0) {
          const actual = lineas[existente];
          if (!actual) return;
          // No se permite superar el stock conocido: es mejor avisar aquí que
          // dejar que el checkout falle después de rellenar toda la dirección.
          const nueva = Math.min(actual.cantidad + cantidad, linea.stockDisponible || 99);
          lineas[existente] = { ...actual, cantidad: nueva };
        } else {
          lineas.push({ ...linea, cantidad: Math.min(cantidad, linea.stockDisponible || 99) });
        }

        set({ lineas, abierto: true });
      },

      cambiarCantidad: (variantId, cantidad) => {
        if (cantidad <= 0) {
          get().eliminar(variantId);
          return;
        }
        set({
          lineas: get().lineas.map((l) =>
            l.variantId === variantId
              ? { ...l, cantidad: Math.min(cantidad, l.stockDisponible || 99) }
              : l,
          ),
        });
      },

      eliminar: (variantId) => {
        set({ lineas: get().lineas.filter((l) => l.variantId !== variantId) });
      },

      vaciar: () => {
        // Se genera un cartId nuevo: el anterior tiene reservas de stock
        // asociadas en el servidor que deben quedar libres.
        set({ lineas: [], cartId: nuevoCartId() });
      },

      abrir: () => set({ abierto: true }),
      cerrar: () => set({ abierto: false }),

      totalArticulos: () => get().lineas.reduce((a, l) => a + l.cantidad, 0),
      subtotalCents: () => get().lineas.reduce((a, l) => a + l.precioCents * l.cantidad, 0),
    }),
    {
      name: 'carrito',
      // `abierto` no se persiste: al volver a la tienda el panel debe estar
      // cerrado, no abierto desde la sesión anterior.
      partialize: (estado) => ({ cartId: estado.cartId, lineas: estado.lineas }),
      version: 1,
    },
  ),
);
