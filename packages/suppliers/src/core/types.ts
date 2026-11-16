/**
 * Contrato común a todos los proveedores de dropshipping.
 *
 * Esta interfaz es la pieza central de la plataforma: mientras el resto del
 * sistema hable solo con ella, cambiar de AliExpress a BigBuy —o vender con
 * ambos a la vez— es escribir un adaptador nuevo, no reescribir los pedidos.
 *
 * Regla que no se debe romper: nada específico de un proveedor concreto puede
 * asomar por estos tipos. Si algo solo tiene sentido en AliExpress, va en
 * `metadata`, no en un campo propio.
 */

/** Importes siempre en céntimos, como en el resto de la plataforma. */
export type Cents = number;

export interface CredencialesProveedor {
  /** Credenciales cifradas en base de datos y descifradas al usarlas. */
  [clave: string]: string | undefined;
}

// ── Catálogo ────────────────────────────────────────────────

export interface ProductoProveedor {
  /** Identificador en el sistema del proveedor. */
  externalId: string;
  title: string;
  description?: string;
  /** Precio de coste para nosotros, sin envío. */
  costCents: Cents;
  /**
   * PVP que recomienda el proveedor, con IVA incluido.
   *
   * No es específico de nadie: es un dato del artículo que publican casi todos
   * los mayoristas del sector, y es el precio al que el resto de tiendas lo
   * venden. Poner ese mismo número es la forma de nacer alineado con el
   * mercado en lugar de inventarse un PVP con un margen fijo, que en un
   * catálogo de 12.913 artículos deja la mitad regalada y la otra mitad fuera
   * de precio.
   *
   * Opcional: quien no lo publique se queda con el PVP calculado por margen.
   */
  rrpCents?: Cents;
  currency: string;
  /** Coste de envío estimado al país indicado. */
  shippingCents?: Cents;
  imageUrls: string[];
  categoryPath?: string[];
  brand?: string;
  /** Unidades disponibles; undefined si el proveedor no lo expone. */
  stock?: number;
  variants: VarianteProveedor[];
  attributes?: Record<string, string | number | boolean>;
  /** Plazo de entrega estimado en días. */
  leadTimeDays?: { min: number; max: number };
  /**
   * Tipo de IVA del artículo, en porcentaje.
   *
   * No es un dato específico de ningún proveedor: es del producto, y de él
   * depende el precio que se cobra y lo que se declara. El importador asumía
   * el 21 % para todo porque los proveedores que había no lo decían. Dreamlove
   * sí: de sus 12.913 artículos, 329 van al 4 % y 197 al 10 %, y cobrarles el
   * 21 % es cobrar de más al cliente y declarar de más a Hacienda.
   *
   * Sigue siendo opcional: quien no lo publique se queda con el general.
   */
  taxRatePct?: number;
  /** Valoración del producto en el proveedor, si la publica. */
  rating?: number;
  ordersCount?: number;
  /** Datos propios del proveedor que no encajan en el contrato común. */
  metadata?: Record<string, unknown>;
}

export interface VarianteProveedor {
  externalId: string;
  sku?: string;
  costCents: Cents;
  /**
   * El PVP recomendado de ESTA variante.
   *
   * Va por variante y no solo en el producto porque dentro de una misma
   * familia los precios no tienen por qué coincidir: en el catálogo de
   * Dreamlove hay familias cuyos colores van de 18,99 € a 54,99 €. Aplicar el
   * del cabeza de familia a todas es exactamente el fallo que ya se cometió
   * una vez con el coste.
   */
  rrpCents?: Cents;
  stock?: number;
  /** Opciones de la variante: { color: "rojo", talla: "XL" } */
  options: Record<string, string>;
  imageUrl?: string;
  weightGrams?: number;
}

export interface ResultadoBusqueda {
  items: ProductoProveedor[];
  total: number;
  pagina: number;
  hayMas: boolean;
}

export interface ParametrosBusqueda {
  q?: string;
  categoryId?: string;
  precioMinCents?: Cents;
  precioMaxCents?: Cents;
  /** País de destino: cambia disponibilidad, precio de envío y plazo. */
  countryCode?: string;
  pagina?: number;
  porPagina?: number;
  orden?: 'relevancia' | 'precio_asc' | 'precio_desc' | 'ventas';
}

// ── Precio y stock ──────────────────────────────────────────

/**
 * Estado de UNA variante concreta en el proveedor.
 *
 * Existe porque el estado a nivel de producto no sirve para sincronizar: un
 * producto con ocho variantes tiene ocho precios y ocho stocks distintos, y
 * aplicar un único valor a todas dejaba el catálogo mintiendo. Visto en
 * producción: variantes reales a 29,79 €, 17,79 € y 79,99 € guardadas todas a
 * 66,39 €, y el stock de cada una sustituido por la suma de todas.
 */
export interface EstadoVariante {
  externalVariantId: string;
  costCents: Cents;
  /**
   * PVP recomendado actual de esta variante, si el proveedor lo publica.
   *
   * Viaja con el estado porque el precio de venta es **el suyo** en cuanto lo
   * da: sin esto, la sincronización nocturna solo sabía el coste y en cuanto
   * el margen se estrechaba recalculaba el PVP por su cuenta, sacando el
   * producto de la línea del proveedor sin que nadie lo hubiera pedido.
   */
  rrpCents?: Cents;
  stock?: number;
  disponible: boolean;
  /**
   * Foto de la variante en el proveedor.
   *
   * Viaja con el estado para poder recuperarla en productos que se importaron
   * antes de que se leyera: sin esto, arreglarlo obligaría a reimportar el
   * catálogo, y reimportar crea productos duplicados.
   */
  imageUrl?: string;
}

export interface EstadoProducto {
  externalId: string;
  disponible: boolean;
  costCents: Cents;
  /** PVP recomendado actual, si el proveedor lo publica. Ver `EstadoVariante`. */
  rrpCents?: Cents;
  stock?: number;
  shippingCents?: Cents;
  /** El proveedor ha retirado el producto de su catálogo. */
  descatalogado: boolean;
  /**
   * Detalle por variante, cuando el proveedor lo da.
   *
   * Opcional porque no todos los proveedores tienen variantes. Quien sincroniza
   * debe usar esto cuando exista y quedarse con los valores de producto solo
   * para los enlaces que no apuntan a ninguna variante.
   */
  variantes?: EstadoVariante[];
}

// ── Pedidos ─────────────────────────────────────────────────

export interface LineaPedidoProveedor {
  externalProductId: string;
  externalVariantId?: string;
  quantity: number;
  /** Precio que esperábamos pagar. Sirve para detectar subidas de última hora. */
  expectedCostCents: Cents;
}

export interface DireccionEnvio {
  firstName: string;
  lastName: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  province: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
  email?: string;
  /** Identificación fiscal, obligatoria para aduanas en algunos países. */
  taxId?: string;
}

export interface SolicitudPedido {
  /** Nuestro identificador de pedido, para poder conciliar. */
  referenciaInterna: string;
  /**
   * Clave de idempotencia. El adaptador DEBE garantizar que dos llamadas con
   * la misma clave no crean dos pedidos: un reintento tras un timeout no puede
   * acabar en dos paquetes enviados y cobrados.
   */
  idempotencyKey: string;
  lineas: LineaPedidoProveedor[];
  envio: DireccionEnvio;
  /** Nota para el proveedor, p. ej. "no incluir factura en el paquete". */
  nota?: string;
}

export interface RespuestaPedido {
  externalOrderId: string;
  estado: EstadoPedidoProveedor;
  costeTotalCents: Cents;
  currency: string;
  /** Ya asignado si el proveedor lo entrega en el momento. */
  tracking?: InfoSeguimiento;
  metadata?: Record<string, unknown>;
}

export type EstadoPedidoProveedor =
  | 'PENDIENTE_PAGO'
  | 'PROCESANDO'
  | 'ENVIADO'
  | 'ENTREGADO'
  | 'CANCELADO'
  | 'DEVUELTO'
  | 'DESCONOCIDO';

export interface InfoSeguimiento {
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
  estado?: string;
  eventos?: { fecha: Date; descripcion: string; ubicacion?: string }[];
  entregaEstimada?: Date;
}

// ── Capacidades ─────────────────────────────────────────────

/**
 * Qué sabe hacer cada proveedor.
 *
 * No todos ofrecen lo mismo: algunos permiten cancelar antes del envío y otros
 * no; unos dan seguimiento en tiempo real y otros solo un número al final. El
 * motor de pedidos consulta esto en lugar de asumir, y así no intenta cancelar
 * en un proveedor que no lo admite y deja el pedido colgado.
 */
export interface CapacidadesProveedor {
  buscarCatalogo: boolean;
  importarProducto: boolean;
  consultarStock: boolean;
  crearPedido: boolean;
  cancelarPedido: boolean;
  seguimiento: boolean;
  devoluciones: boolean;
  /** Admite enviar sin publicidad del proveedor dentro del paquete. */
  envioSinMarca: boolean;
  /** Peticiones por segundo permitidas antes de que empiece a limitar. */
  limitePeticionesPorSegundo: number;
}

// ── El adaptador ────────────────────────────────────────────

export interface SupplierAdapter {
  readonly key: string;
  readonly nombre: string;
  readonly capacidades: CapacidadesProveedor;

  /** Comprueba que las credenciales son válidas antes de guardarlas. */
  verificarCredenciales(): Promise<{ ok: boolean; mensaje?: string }>;

  buscar(parametros: ParametrosBusqueda): Promise<ResultadoBusqueda>;
  obtenerProducto(externalId: string, countryCode?: string): Promise<ProductoProveedor | null>;

  /** Precio y stock actuales de varios productos, para la sincronización. */
  consultarEstado(externalIds: string[], countryCode?: string): Promise<EstadoProducto[]>;

  crearPedido(solicitud: SolicitudPedido): Promise<RespuestaPedido>;
  consultarPedido(externalOrderId: string): Promise<RespuestaPedido | null>;
  cancelarPedido(
    externalOrderId: string,
    motivo?: string,
  ): Promise<{ ok: boolean; mensaje?: string }>;
  obtenerSeguimiento(externalOrderId: string): Promise<InfoSeguimiento | null>;
}

// ── Errores ─────────────────────────────────────────────────

export type TipoErrorProveedor =
  | 'CREDENCIALES'
  /**
   * Las credenciales valen, pero esa función no está disponible para nosotros.
   *
   * Es distinto de `CREDENCIALES` y conviene no confundirlos: aquí no hay nada
   * que corregir en la configuración ni sirve reintentar. O falta autorizar, o
   * el proveedor no ha habilitado esa API para la cuenta —el caso de la
   * búsqueda por texto de AliExpress mientras la aplicación está en pruebas—.
   */
  | 'SIN_PERMISO'
  | 'LIMITE_PETICIONES'
  | 'NO_ENCONTRADO'
  | 'SIN_STOCK'
  | 'PRECIO_CAMBIADO'
  | 'DIRECCION_INVALIDA'
  /**
   * La respuesta llegó bien pero dice algo que no podemos dar por bueno.
   *
   * El caso que lo motiva: precios en una divisa distinta de la pedida. Guardar
   * el número tal cual sería meter dólares en un catálogo que los lee como
   * euros, y eso no se detecta después —12,99 es creíble en las dos— sino
   * cuando llega el cargo del proveedor. Se para aquí y no se guarda nada.
   */
  | 'DATOS_INVALIDOS'
  | 'RED'
  | 'PROVEEDOR_CAIDO'
  | 'DESCONOCIDO';

/**
 * Error normalizado.
 *
 * Cada proveedor devuelve sus errores en su propio formato; traducirlos a este
 * conjunto permite que el motor de pedidos decida qué hacer sin saber con quién
 * está hablando: reintentar si es de red, avisar al equipo si es de stock.
 */
export class ErrorProveedor extends Error {
  constructor(
    readonly tipo: TipoErrorProveedor,
    mensaje: string,
    readonly opciones: {
      proveedor?: string;
      reintentable?: boolean;
      esperarMs?: number;
      detalleOriginal?: unknown;
    } = {},
  ) {
    super(mensaje);
    this.name = 'ErrorProveedor';
  }

  /** ¿Tiene sentido volver a intentarlo? */
  get reintentable(): boolean {
    if (this.opciones.reintentable !== undefined) return this.opciones.reintentable;
    return ['LIMITE_PETICIONES', 'RED', 'PROVEEDOR_CAIDO'].includes(this.tipo);
  }

  /** ¿Necesita que una persona lo mire? */
  get requiereIntervencion(): boolean {
    return ['CREDENCIALES', 'SIN_STOCK', 'PRECIO_CAMBIADO', 'DIRECCION_INVALIDA'].includes(
      this.tipo,
    );
  }
}
