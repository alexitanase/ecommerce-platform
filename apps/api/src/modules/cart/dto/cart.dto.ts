import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const añadirSchema = z.object({
  variantId: z.string().min(1),
  cantidad: z.number().int().min(1).max(99).default(1),
});

export const cantidadSchema = z.object({
  // 0 vale y significa "quítalo": es lo que hace el botón de menos al llegar
  // a cero, y obligar a llamar a otro endpoint solo complica el frontend.
  cantidad: z.number().int().min(0).max(99),
});

export const emailCarritoSchema = z.object({
  email: z.email(),
});

/**
 * Copia del carrito del navegador.
 *
 * La tienda lleva el carrito en `localStorage` para que añadir un producto sea
 * instantáneo y funcione sin cuenta. Esta llamada lo refleja en el servidor
 * cuando el cliente ya ha dejado su email en el checkout, que es lo único que
 * permite escribirle si se va sin pagar.
 */
export const sincronizarCarritoSchema = z.object({
  email: z.email().optional(),
  locale: z.string().trim().length(2).optional(),
  lineas: z
    .array(z.object({ variantId: z.string().min(1), cantidad: z.number().int().min(1).max(99) }))
    .max(100),
});

export class AñadirAlCarritoDto extends createZodDto(añadirSchema) {}
export class SincronizarCarritoDto extends createZodDto(sincronizarCarritoSchema) {}
export class CambiarCantidadDto extends createZodDto(cantidadSchema) {}
export class EmailCarritoDto extends createZodDto(emailCarritoSchema) {}
