import crypto from 'node:crypto';
import {
  ErrorProveedor,
  type CapacidadesProveedor,
  type EstadoProducto,
  type EstadoPedidoProveedor,
  type InfoSeguimiento,
  type ParametrosBusqueda,
  type ProductoProveedor,
  type RespuestaPedido,
  type ResultadoBusqueda,
  type SolicitudPedido,
  type SupplierAdapter,
} from '../core/types.js';

/**
 * Proveedor simulado.
 *
 * Existe por dos motivos muy concretos:
 *
 *  1. Permite ejercitar el flujo completo de pedidos —crear, seguir, cancelar,
 *     fallar— sin depender de credenciales reales ni gastar cuota de la API.
 *
 *  2. Sirve de banco de pruebas para los casos que en producción son raros
 *     pero caros: que el proveedor se quede sin stock justo al enviar el
 *     pedido, que suba el precio, o que devuelva un error de red. Provocarlos
 *     a voluntad es la única forma de comprobar que el motor de pedidos
 *     reacciona bien antes de que ocurra con dinero de verdad.
 */

interface PedidoSimulado {
  externalOrderId: string;
  idempotencyKey: string;
  estado: EstadoPedidoProveedor;
  costeTotalCents: number;
  creadoEn: Date;
  tracking?: InfoSeguimiento;
}

export interface OpcionesSimulacion {
  /** Probabilidad (0–1) de que el producto no tenga stock al pedirlo. */
  probabilidadSinStock?: number;
  /** Probabilidad de que el precio haya subido respecto al esperado. */
  probabilidadPrecioSubido?: number;
  /** Probabilidad de fallo de red. */
  probabilidadFalloRed?: number;
  /** Retardo artificial en milisegundos, para simular latencia. */
  latenciaMs?: number;
}

/**
 * Texto comparable: sin mayúsculas y sin tildes.
 *
 * Nadie escribe "lámpara" con tilde en un buscador. Comparando en crudo, buscar
 * "lampara" no encontraba la lámpara del catálogo y la conclusión natural era
 * que el importador estaba roto.
 */
const normalizar = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const CATALOGO: ProductoProveedor[] = [
  {
    externalId: 'SIM-1001',
    title: 'Auriculares inalámbricos con cancelación de ruido',
    description: 'Bluetooth 5.3, 30 h de autonomía, estuche de carga.',
    costCents: 1450,
    currency: 'EUR',
    shippingCents: 210,
    imageUrls: ['https://example.invalid/sim/auriculares-1.jpg'],
    categoryPath: ['Electrónica', 'Audio'],
    brand: 'GenericAudio',
    stock: 340,
    leadTimeDays: { min: 12, max: 22 },
    rating: 4.6,
    ordersCount: 8421,
    variants: [
      {
        externalId: 'SIM-1001-BK',
        costCents: 1450,
        stock: 210,
        options: { color: 'negro' },
        weightGrams: 180,
      },
      {
        externalId: 'SIM-1001-WH',
        costCents: 1450,
        stock: 130,
        options: { color: 'blanco' },
        weightGrams: 180,
      },
    ],
  },
  {
    externalId: 'SIM-1002',
    title: 'Mochila impermeable para portátil 15,6"',
    description: 'Tejido resistente al agua, puerto USB, compartimento acolchado.',
    costCents: 2190,
    currency: 'EUR',
    shippingCents: 390,
    imageUrls: ['https://example.invalid/sim/mochila-1.jpg'],
    categoryPath: ['Complementos', 'Mochilas'],
    stock: 87,
    leadTimeDays: { min: 15, max: 28 },
    rating: 4.3,
    ordersCount: 1240,
    variants: [
      {
        externalId: 'SIM-1002-GR',
        costCents: 2190,
        stock: 45,
        options: { color: 'gris' },
        weightGrams: 850,
      },
      {
        externalId: 'SIM-1002-NG',
        costCents: 2290,
        stock: 42,
        options: { color: 'negro' },
        weightGrams: 850,
      },
    ],
  },
  {
    externalId: 'SIM-1003',
    title: 'Lámpara LED de escritorio regulable',
    costCents: 890,
    currency: 'EUR',
    shippingCents: 450,
    imageUrls: ['https://example.invalid/sim/lampara-1.jpg'],
    categoryPath: ['Hogar', 'Iluminación'],
    stock: 3,
    leadTimeDays: { min: 10, max: 18 },
    rating: 4.1,
    ordersCount: 320,
    variants: [
      {
        externalId: 'SIM-1003-01',
        costCents: 890,
        stock: 3,
        options: { color: 'blanco' },
        weightGrams: 420,
      },
    ],
  },
];

export class MockSupplierAdapter implements SupplierAdapter {
  readonly key = 'mock';
  readonly nombre = 'Proveedor Simulado';

  readonly capacidades: CapacidadesProveedor = {
    buscarCatalogo: true,
    importarProducto: true,
    consultarStock: true,
    crearPedido: true,
    cancelarPedido: true,
    seguimiento: true,
    devoluciones: true,
    envioSinMarca: true,
    limitePeticionesPorSegundo: 50,
  };

  /** Los pedidos viven en memoria: es un simulador, no persiste nada. */
  private readonly pedidos = new Map<string, PedidoSimulado>();
  /** Índice por clave de idempotencia, para no duplicar en los reintentos. */
  private readonly porClave = new Map<string, string>();

  constructor(private readonly simulacion: OpcionesSimulacion = {}) {}

  private async simularLatencia(): Promise<void> {
    const ms = this.simulacion.latenciaMs ?? 30;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  private quizaFallar(): void {
    if (Math.random() < (this.simulacion.probabilidadFalloRed ?? 0)) {
      throw new ErrorProveedor('RED', 'Fallo de red simulado', {
        proveedor: this.nombre,
        reintentable: true,
      });
    }
  }

  async verificarCredenciales(): Promise<{ ok: boolean; mensaje?: string }> {
    await this.simularLatencia();
    return { ok: true, mensaje: 'Proveedor simulado: no requiere credenciales' };
  }

  async buscar(parametros: ParametrosBusqueda): Promise<ResultadoBusqueda> {
    await this.simularLatencia();
    this.quizaFallar();

    const q = normalizar(parametros.q ?? '');
    let items = CATALOGO.filter(
      (p) => !q || normalizar(p.title).includes(q) || normalizar(p.description ?? '').includes(q),
    );

    if (parametros.precioMinCents !== undefined) {
      items = items.filter((p) => p.costCents >= parametros.precioMinCents!);
    }
    if (parametros.precioMaxCents !== undefined) {
      items = items.filter((p) => p.costCents <= parametros.precioMaxCents!);
    }

    const orden = parametros.orden ?? 'relevancia';
    if (orden === 'precio_asc') items = [...items].sort((a, b) => a.costCents - b.costCents);
    if (orden === 'precio_desc') items = [...items].sort((a, b) => b.costCents - a.costCents);
    if (orden === 'ventas')
      items = [...items].sort((a, b) => (b.ordersCount ?? 0) - (a.ordersCount ?? 0));

    const pagina = parametros.pagina ?? 1;
    const porPagina = parametros.porPagina ?? 20;
    const inicio = (pagina - 1) * porPagina;

    return {
      items: items.slice(inicio, inicio + porPagina),
      total: items.length,
      pagina,
      hayMas: inicio + porPagina < items.length,
    };
  }

  async obtenerProducto(externalId: string): Promise<ProductoProveedor | null> {
    await this.simularLatencia();
    this.quizaFallar();
    return CATALOGO.find((p) => p.externalId === externalId) ?? null;
  }

  async consultarEstado(externalIds: string[]): Promise<EstadoProducto[]> {
    await this.simularLatencia();
    this.quizaFallar();

    return externalIds.map((id) => {
      const producto = CATALOGO.find((p) => p.externalId === id);
      if (!producto) {
        return { externalId: id, disponible: false, costCents: 0, descatalogado: true };
      }

      // Se hace variar ligeramente el precio para ejercitar la detección de
      // cambios de coste en la sincronización.
      const variacion = Math.random() < (this.simulacion.probabilidadPrecioSubido ?? 0) ? 1.15 : 1;

      return {
        externalId: id,
        disponible: (producto.stock ?? 0) > 0,
        costCents: Math.round(producto.costCents * variacion),
        stock: producto.stock,
        descatalogado: false,
      };
    });
  }

  async crearPedido(solicitud: SolicitudPedido): Promise<RespuestaPedido> {
    await this.simularLatencia();
    this.quizaFallar();

    // Idempotencia: el mismo pedido enviado dos veces devuelve el original.
    // Es exactamente lo que debe pasar cuando un job se reintenta tras un
    // timeout en el que el proveedor sí llegó a procesar la petición.
    const existente = this.porClave.get(solicitud.idempotencyKey);
    if (existente) {
      const pedido = this.pedidos.get(existente)!;
      return {
        externalOrderId: pedido.externalOrderId,
        estado: pedido.estado,
        costeTotalCents: pedido.costeTotalCents,
        currency: 'EUR',
        metadata: { idempotente: true },
      };
    }

    for (const linea of solicitud.lineas) {
      const producto = CATALOGO.find((p) => p.externalId === linea.externalProductId);
      if (!producto) {
        throw new ErrorProveedor('NO_ENCONTRADO', `Producto ${linea.externalProductId} no existe`, {
          proveedor: this.nombre,
          reintentable: false,
        });
      }

      if (Math.random() < (this.simulacion.probabilidadSinStock ?? 0)) {
        throw new ErrorProveedor(
          'SIN_STOCK',
          `El proveedor se ha quedado sin stock de ${producto.title}`,
          { proveedor: this.nombre, reintentable: false },
        );
      }

      if (Math.random() < (this.simulacion.probabilidadPrecioSubido ?? 0)) {
        throw new ErrorProveedor(
          'PRECIO_CAMBIADO',
          `El coste de ${producto.title} ha subido de ${linea.expectedCostCents} a ${Math.round(
            linea.expectedCostCents * 1.15,
          )} céntimos`,
          { proveedor: this.nombre, reintentable: false },
        );
      }
    }

    const externalOrderId = `SIMORD-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const costeTotal = solicitud.lineas.reduce((a, l) => a + l.expectedCostCents * l.quantity, 0);

    const pedido: PedidoSimulado = {
      externalOrderId,
      idempotencyKey: solicitud.idempotencyKey,
      estado: 'PROCESANDO',
      costeTotalCents: costeTotal,
      creadoEn: new Date(),
    };

    this.pedidos.set(externalOrderId, pedido);
    this.porClave.set(solicitud.idempotencyKey, externalOrderId);

    return {
      externalOrderId,
      estado: 'PROCESANDO',
      costeTotalCents: costeTotal,
      currency: 'EUR',
    };
  }

  async consultarPedido(externalOrderId: string): Promise<RespuestaPedido | null> {
    await this.simularLatencia();
    const pedido = this.pedidos.get(externalOrderId);
    if (!pedido) return null;

    // El pedido avanza solo con el tiempo, para poder probar el seguimiento.
    const minutos = (Date.now() - pedido.creadoEn.getTime()) / 60_000;
    if (pedido.estado === 'PROCESANDO' && minutos > 1) {
      pedido.estado = 'ENVIADO';
      pedido.tracking = {
        carrier: 'SimuPost',
        trackingNumber: `SP${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
        estado: 'En tránsito',
        eventos: [
          { fecha: pedido.creadoEn, descripcion: 'Pedido recibido por el proveedor' },
          {
            fecha: new Date(),
            descripcion: 'Paquete entregado al transportista',
            ubicacion: 'Shenzhen',
          },
        ],
        entregaEstimada: new Date(Date.now() + 14 * 86_400_000),
      };
    }

    return {
      externalOrderId,
      estado: pedido.estado,
      costeTotalCents: pedido.costeTotalCents,
      currency: 'EUR',
      ...(pedido.tracking ? { tracking: pedido.tracking } : {}),
    };
  }

  async cancelarPedido(externalOrderId: string): Promise<{ ok: boolean; mensaje?: string }> {
    await this.simularLatencia();
    const pedido = this.pedidos.get(externalOrderId);

    if (!pedido) return { ok: false, mensaje: 'Pedido no encontrado' };

    // Igual que en un proveedor real: una vez enviado ya no se puede cancelar.
    if (pedido.estado === 'ENVIADO' || pedido.estado === 'ENTREGADO') {
      return { ok: false, mensaje: 'El pedido ya está enviado y no se puede cancelar' };
    }

    pedido.estado = 'CANCELADO';
    return { ok: true };
  }

  async obtenerSeguimiento(externalOrderId: string): Promise<InfoSeguimiento | null> {
    await this.consultarPedido(externalOrderId);
    return this.pedidos.get(externalOrderId)?.tracking ?? null;
  }

  /** Solo para los tests: fuerza el estado de un pedido. */
  forzarEstado(externalOrderId: string, estado: EstadoPedidoProveedor): void {
    const pedido = this.pedidos.get(externalOrderId);
    if (pedido) pedido.estado = estado;
  }
}
