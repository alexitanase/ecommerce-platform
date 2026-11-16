import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { LOCALES } from '@ecom/shared';

const ESTADOS = [
  'DRAFT',
  'AWAITING_PAYMENT',
  'PAYMENT_CONFIRMING',
  'PAID',
  'PREPARING',
  'SENT_TO_SUPPLIER',
  'IN_TRANSIT',
  'DELIVERED',
  'PENDING_CLOSE',
  'CLOSED',
  'CANCELLED',
  'REFUNDED',
  'FAILED',
] as const;

const direccion = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  company: z.string().trim().max(150).optional(),
  taxId: z.string().trim().max(30).optional(),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(120),
  province: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().min(3).max(12),
  countryCode: z.string().trim().length(2).toUpperCase().default('ES'),
  phone: z.string().trim().max(20).optional(),
});

export const crearPedidoSchema = z.object({
  email: z.email('Email no válido').toLowerCase().trim(),
  /**
   * El teléfono es obligatorio, y no por rellenar la ficha del cliente.
   *
   * En dropshipping el paquete lo entrega un transportista que avisa por SMS o
   * por llamada, y varios proveedores rechazan el pedido sin él: sin teléfono el
   * envío se queda parado en el almacén y el cliente no se entera hasta que
   * reclama. Es también la única forma de avisar de una incidencia a quien no
   * abre el correo.
   *
   * Se pide un mínimo de 6 caracteres —el número corto más pequeño que existe—
   * en vez de una expresión regular de teléfono internacional: aquí llegan
   * números de todos los países, con prefijos, espacios y puntos, y una
   * validación estricta rechaza números buenos, que es peor que aceptar uno mal
   * escrito.
   */
  phone: z.string().trim().min(6, 'Hace falta un teléfono de contacto para la entrega').max(20),
  locale: z.enum(LOCALES).default('es'),
  cartId: z.string().min(1),
  lineas: z
    .array(z.object({ variantId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
    .min(1, 'El pedido necesita al menos una línea'),
  shippingAddress: direccion,
  /** Tarifa elegida en el checkout; su precio se recalcula en el servidor. */
  shippingRateId: z.string().min(1).optional(),
  /** Código de cupón; el descuento lo calcula el servidor. */
  couponCode: z.string().min(2).max(40).optional(),
  /**
   * Código de invitación de quien recomendó la tienda.
   *
   * No descuenta nada en este pedido: deja la invitación anotada y los cupones
   * se emiten al cobrar. Un código inválido no impide comprar.
   */
  referralCode: z.string().trim().min(4).max(20).optional(),
  /**
   * Identificador anónimo del navegador.
   *
   * Solo sirve para atribuir la venta a la variante de la prueba A/B que esa
   * persona vio. Lo genera el navegador y no se cruza con la cuenta.
   */
  visitorId: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  /**
   * De dónde vino quien compra.
   *
   * El servidor vuelve a limpiarlos: llegan de la URL, que la escribe
   * cualquiera, y acaban pintados en un informe del panel.
   */
  utmSource: z.string().trim().max(60).optional(),
  utmMedium: z.string().trim().max(60).optional(),
  utmCampaign: z.string().trim().max(60).optional(),
  /** Qué creatividad trajo el clic; lo pone el Studio en cada pieza. */
  utmContent: z.string().trim().max(60).optional(),
  billingAddress: direccion.optional(),
  customerNote: z.string().trim().max(500).optional(),
  /**
   * El cliente marca que quiere recibir ofertas.
   *
   * Va aquí, en el pedido, y no en un endpoint suelto por email: así el
   * consentimiento queda atado a una compra real de esa persona. Un endpoint
   * abierto de "suscríbeme a esta dirección" permitiría apuntar a cualquiera
   * sin que se enterara.
   */
  marketingConsent: z.boolean().default(false),
  /**
   * Segundos que ha tardado en rellenar el checkout.
   *
   * Lo mide la tienda y es una señal débil del control de riesgo: el
   * autocompletado del navegador rellena en dos segundos y eso es legítimo.
   * Se acepta que venga del cliente precisamente porque puntúa poco; las
   * señales que deciden de verdad —velocidad, historial, IP— las calcula el
   * servidor y no se pueden falsear desde fuera.
   */
  segundosEnElCheckout: z.number().int().min(0).max(86_400).optional(),
});

export const cambiarDireccionSchema = z.object({
  shippingAddress: direccion,
});

/**
 * Consulta del IVA antes de comprar.
 *
 * Solo pide el destino y las líneas: los precios y el origen de la mercancía
 * los pone el servidor. Basta el país y el código postal, sin nombre ni
 * dirección, porque esto se llama mientras el cliente todavía está rellenando
 * el formulario y pedirle más datos de los necesarios para calcular un impuesto
 * es recoger datos sin motivo.
 */
export const previsualizarIvaSchema = z.object({
  countryCode: z.string().trim().length(2).toUpperCase(),
  postalCode: z.string().trim().min(3).max(12),
  lineas: z
    .array(z.object({ variantId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(100),
});

export const cambiarEstadoSchema = z.object({
  status: z.enum(ESTADOS),
  motivo: z.string().trim().max(300).optional(),
});

export const cancelarSchema = z.object({
  motivo: z.string().trim().min(3, 'Indica el motivo de la cancelación').max(300),
});

/**
 * Marcar un pedido como pagado a mano.
 *
 * El motivo es OBLIGATORIO y con un mínimo real: es lo único que explicará en
 * seis meses por qué este pedido consta pagado sin que ninguna pasarela lo
 * confirmara. «ok» no explica nada, así que no se acepta.
 */
export const marcarPagadoSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, 'Explica por qué se marca pagado: quedará en el historial del pedido')
    .max(300),
  /**
   * Importe recibido, si no fue el total.
   *
   * Para el caso de la transferencia por otra cantidad. Si no se indica, se
   * asume el total del pedido.
   */
  importeCents: z.coerce.number().int().positive().optional(),
});

/**
 * Cerrar una incidencia diciendo que se compró a mano.
 *
 * La referencia del proveedor es obligatoria: es lo que permite seguir el
 * paquete después, y lo único que distingue «lo he comprado» de «creo que lo he
 * comprado».
 */
export const resolverIncidenciaSchema = z.object({
  referencia: z
    .string()
    .trim()
    .min(3, 'Indica el número de pedido que te ha dado el proveedor')
    .max(120),
  nota: z.string().trim().max(300).optional(),
});

/**
 * El seguimiento anotado a mano.
 *
 * Es la única vía con un proveedor sin API: nadie nos va a mandar este dato, lo
 * copia una persona de la web del proveedor. La URL es opcional porque se
 * construye a partir del transportista cuando no se da, que es lo normal.
 */
export const seguimientoManualSchema = z.object({
  transportista: z
    .string()
    .trim()
    .min(2, 'Indica quién lleva el paquete: Correos, SEUR, GLS…')
    .max(80),
  numero: z.string().trim().min(4, 'El número de seguimiento parece incompleto').max(120),
  /** Solo si el proveedor da un enlace propio que no se puede construir. */
  url: z.url().max(500).optional(),
  /**
   * Avisar al cliente por correo.
   *
   * Por defecto sí: es justo el correo que evita el «¿dónde está lo mío?». Se
   * puede desactivar para corregir un número mal copiado sin volver a escribir
   * a quien ya recibió el aviso.
   */
  avisarCliente: z.boolean().default(true),
});

export const listarPedidosSchema = z.object({
  status: z.enum(ESTADOS).optional(),
  email: z.string().trim().max(255).optional(),
  /** Número de pedido o email: lo que se escriba en el buscador del panel. */
  busqueda: z.string().trim().max(255).optional(),
  // Fechas como texto ISO, no como z.coerce.date(): un Date no se puede
  // representar en JSON Schema y rompe la generación del OpenAPI.
  desde: z.iso.datetime({ offset: true }).optional(),
  hasta: z.iso.datetime({ offset: true }).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const kanbanSchema = z.object({
  supplierId: z.string().optional(),
  soloIncidencias: z.coerce.boolean().default(false),
});

export class CrearPedidoDto extends createZodDto(crearPedidoSchema) {}
export class CambiarEstadoDto extends createZodDto(cambiarEstadoSchema) {}
export class CambiarDireccionDto extends createZodDto(cambiarDireccionSchema) {}
export class CancelarDto extends createZodDto(cancelarSchema) {}
export class MarcarPagadoDto extends createZodDto(marcarPagadoSchema) {}
export class ResolverIncidenciaDto extends createZodDto(resolverIncidenciaSchema) {}
export class SeguimientoManualDto extends createZodDto(seguimientoManualSchema) {}
export class ListarPedidosDto extends createZodDto(listarPedidosSchema) {}
export class KanbanDto extends createZodDto(kanbanSchema) {}
export class PrevisualizarIvaDto extends createZodDto(previsualizarIvaSchema) {}
