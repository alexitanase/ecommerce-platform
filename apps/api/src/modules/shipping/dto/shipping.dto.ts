import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Destino y carrito para calcular el envío en el checkout.
 *
 * Dos formas de decir qué se envía, y la buena es `lineas`:
 *
 *  · **`lineas`** — el servidor busca los precios y los pesos en el catálogo,
 *    exactamente igual que al crear el pedido. Es la única manera de que lo que
 *    se enseña antes de pagar coincida con lo que se cobra: el navegador no
 *    conoce el peso de un producto, así que calculando con lo que él sabe una
 *    tarifa por tramos de peso sale distinta en las dos pantallas.
 *  · **`subtotalCents` + `pesoGramos`** — se mantiene para el panel y para las
 *    simulaciones, donde se quiere probar una zona sin tener un carrito.
 */
export const calcularEnvioSchema = z
  .object({
    countryCode: z.string().length(2),
    postalCode: z.string().min(3).max(12),
    /** Subtotal de los productos, sin envío, en céntimos. */
    subtotalCents: z.number().int().min(0).optional(),
    /** Peso total en gramos. 0 si ningún producto lo declara. */
    pesoGramos: z.number().int().min(0).optional(),
    /** El carrito. Con él, el importe y el peso los pone el servidor. */
    lineas: z
      .array(z.object({ variantId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
      .min(1)
      .max(100)
      .optional(),
  })
  .refine((d) => d.lineas !== undefined || d.subtotalCents !== undefined, {
    message: 'Hace falta el carrito (lineas) o el subtotal para calcular el envío',
    path: ['lineas'],
  });

export class CalcularEnvioDto extends createZodDto(calcularEnvioSchema) {}

const prefijos = z.array(z.string().min(1).max(6)).max(200);

export const zonaSchema = z.object({
  name: z.string().min(1).max(80),
  countries: z.array(z.string().length(2)).min(1).max(250),
  postalPrefixes: prefijos.default([]),
  excludedPostalPrefixes: prefijos.default([]),
  outsideVatTerritory: z.boolean().default(false),
  customsWarning: z.boolean().default(false),
  priority: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

export class CrearZonaDto extends createZodDto(zonaSchema) {}
export class ActualizarZonaDto extends createZodDto(zonaSchema.partial()) {}

const tarifaBase = z.object({
  name: z.string().min(1).max(80),
  carrier: z.string().max(80).nullable().default(null),
  type: z.enum(['FLAT', 'WEIGHT', 'ORDER_VALUE']).default('FLAT'),
  priceCents: z.number().int().min(0),
  freeFromCents: z.number().int().min(0).nullable().default(null),
  minWeightGrams: z.number().int().min(0).nullable().default(null),
  maxWeightGrams: z.number().int().min(1).nullable().default(null),
  minOrderCents: z.number().int().min(0).nullable().default(null),
  maxOrderCents: z.number().int().min(1).nullable().default(null),
  minDays: z.number().int().min(0).max(365).default(3),
  maxDays: z.number().int().min(0).max(365).default(10),
  position: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

/**
 * Coherencia de los tramos.
 *
 * Un tramo invertido (mínimo por encima del máximo) se guarda sin protestar
 * pero deja la tarifa muerta: no encaja con nada y el cliente ve "no hay
 * envíos disponibles" sin que nadie entienda por qué.
 *
 * Va como función suelta y no encadenado al objeto porque Zod 4 no deja
 * aplicar .partial() sobre un esquema que ya lleva refinamientos, y la
 * actualización necesita justamente eso: los mismos campos, todos opcionales.
 */
interface TramosTarifa {
  minWeightGrams?: number | null;
  maxWeightGrams?: number | null;
  minOrderCents?: number | null;
  maxOrderCents?: number | null;
  minDays?: number;
  maxDays?: number;
}

function comprobarTramos<T extends z.ZodType<TramosTarifa>>(esquema: T) {
  return esquema
    .refine((t) => t.maxWeightGrams == null || (t.minWeightGrams ?? 0) < t.maxWeightGrams, {
      message: 'El peso máximo debe ser mayor que el mínimo',
      path: ['maxWeightGrams'],
    })
    .refine((t) => t.maxOrderCents == null || (t.minOrderCents ?? 0) < t.maxOrderCents, {
      message: 'El importe máximo debe ser mayor que el mínimo',
      path: ['maxOrderCents'],
    })
    .refine((t) => t.maxDays === undefined || t.minDays === undefined || t.maxDays >= t.minDays, {
      message: 'El plazo máximo no puede ser menor que el mínimo',
      path: ['maxDays'],
    });
}

export const tarifaSchema = comprobarTramos(tarifaBase);
export const actualizarTarifaSchema = comprobarTramos(tarifaBase.partial());

export class CrearTarifaDto extends createZodDto(tarifaSchema) {}
export class ActualizarTarifaDto extends createZodDto(actualizarTarifaSchema) {}
