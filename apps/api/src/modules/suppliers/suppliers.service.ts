import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  crearAdaptador,
  PROVEEDORES_DISPONIBLES,
  type ClaveProveedor,
  type SupplierAdapter,
} from '@ecom/suppliers';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CryptoService } from '../../common/crypto.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { AutorizacionProveedoresService } from './autorizacion.service.js';
import { CatalogoDreamloveService } from './dreamlove/catalogo.service.js';

/**
 * Alta y gestión de proveedores.
 *
 * Las credenciales se guardan cifradas y nunca se devuelven en claro por la
 * API, ni siquiera al administrador: si un token de la interfaz se filtra por
 * un log del navegador o una captura de pantalla, el atacante tendría acceso
 * directo a la cuenta del proveedor y podría hacer pedidos a nuestra costa.
 */
@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);
  /** Adaptadores ya construidos, para no descifrar credenciales en cada uso. */
  private readonly cache = new Map<string, SupplierAdapter>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly autorizacion: AutorizacionProveedoresService,
    private readonly catalogoDreamlove: CatalogoDreamloveService,
  ) {}

  disponibles() {
    return PROVEEDORES_DISPONIBLES;
  }

  async listar() {
    const proveedores = await this.prisma.client.supplier.findMany({
      where: { deletedAt: null },
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { products: true, orders: true } },
        syncRuns: { orderBy: { startedAt: 'desc' }, take: 1 },
      },
    });

    // Si está autorizado se resuelve aquí y no en la pantalla: hay que
    // descifrar las credenciales para saberlo.
    const autorizaciones = new Map(
      await Promise.all(
        proveedores.map(async (p) => [p.id, await this.autorizacion.estado(p.id)] as const),
      ),
    );

    // Cuántos artículos tiene guardados cada uno de su catálogo. Solo importa
    // en los proveedores sin API: son los que no pueden hacer nada hasta que
    // alguien suba su fichero.
    const catalogos = new Map(
      (
        await this.prisma.client.supplierCatalogItem.groupBy({
          by: ['supplierId'],
          where: { removed: false },
          _count: { _all: true },
        })
      ).map((c) => [c.supplierId, c._count._all]),
    );

    return proveedores.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      isActive: p.isActive,
      priority: p.priority,
      paisOrigen: p.shipsFromCountry,
      // Solo se informa de si hay credenciales, no de cuáles.
      credencialesConfiguradas: p.credentials !== null,
      credencialesDesde: p.credentialsSetAt,
      /**
       * ¿Se le puede pedir algo YA?
       *
       * Lo decide la API y no la pantalla porque la respuesta depende de tres
       * cosas que solo se saben aquí: si el proveedor necesita credenciales,
       * si las tiene, y si además hace falta autorizar. El importador filtraba
       * por "tiene credenciales", y con eso el proveedor simulado —que no
       * necesita ninguna— desaparecía del desplegable: quedaba solo AliExpress
       * sin autorizar, así que no se podía importar nada de nada.
       */
      ...this.disponibilidad(p, autorizaciones.get(p.id), catalogos.get(p.id) ?? 0),
      /** Artículos del catálogo del proveedor, en los que van por fichero. */
      articulosCatalogo: catalogos.get(p.id) ?? 0,
      margenPorDefecto: Number(p.defaultMarginPct),
      margenMinimo: Number(p.minMarginPct),
      terminacionPrecio: p.priceEnding,
      repercutirEnvio: p.includeShipping,
      /*
       * Lo que el proveedor cobra de más y su API no dice.
       *
       * Se enseña en el listado y no escondido en un formulario porque es el
       * dato que faltaba cuando se vendió un producto a pérdida: la ficha
       * cotizaba 13,99 € y el cargo fue de 16,89 €.
       */
      recargoCompraPct: Number(p.purchaseSurchargePct),
      cargoFijoCents: p.importFeeCents,
      cargoFijoUmbralCents: p.importFeeThresholdCents,
      /*
       * Portes por PEDIDO, que no es lo mismo que repercutir el envío.
       *
       * Se enseñan en el listado junto a los otros cargos porque forman parte
       * de la misma pregunta —«¿cuánto cuesta de verdad comprarle a este?»— y
       * porque con un proveedor de almacén son la diferencia entre ganar y
       * perder dinero en el pedido de un solo artículo.
       */
      portesPedidoCents: p.orderShippingCents,
      portesGratisDesdeCents: p.freeShippingThresholdCents,
      productos: p._count.products,
      pedidos: p._count.orders,
      salud: p.healthStatus,
      saludRevisadaEn: p.healthCheckedAt,
      erroresConsecutivos: p.consecutiveErrors,
      ultimaSync: p.lastSyncAt,
      ultimaSyncEstado: p.lastSyncStatus,
      ultimaEjecucion: p.syncRuns[0] ?? null,
    }));
  }

  /**
   * Si el proveedor está listo para trabajar, y si no lo está, por qué.
   *
   * El motivo importa tanto como el `listo`: sin él, el importador solo puede
   * decir "no hay proveedores disponibles", que es exactamente el mensaje que
   * no ayuda a nadie a resolverlo.
   */
  private disponibilidad(
    proveedor: { key: string; isActive: boolean; credentials: string | null },
    autorizacion: { usaOauth: boolean; autorizado: boolean } | undefined,
    articulosCatalogo = 0,
  ): { listo: boolean; motivoNoListo: string | null } {
    const definicion = PROVEEDORES_DISPONIBLES.find((d) => d.key === proveedor.key);

    // Las que se escriben a mano; las que llegan por OAuth no cuentan aquí,
    // porque su ausencia se explica mejor como "falta autorizar".
    const necesitaCredenciales =
      definicion?.camposCredenciales.some((c) => c.secreto && !c.porOauth) ?? false;

    if (!proveedor.isActive) {
      return { listo: false, motivoNoListo: 'Está desactivado' };
    }

    if (necesitaCredenciales && proveedor.credentials === null) {
      return { listo: false, motivoNoListo: 'Faltan sus credenciales' };
    }

    if (autorizacion?.usaOauth && !autorizacion.autorizado) {
      return {
        listo: false,
        motivoNoListo: 'Falta autorizar la aplicación desde la cuenta del proveedor',
      };
    }

    // Un proveedor sin API no está listo por no pedir credenciales: lo está
    // cuando hay catálogo. Sin este caso, Dreamlove aparecía en el importador
    // recién dado de alta y toda búsqueda salía vacía sin explicar por qué.
    if (definicion?.catalogoPorFichero && articulosCatalogo === 0) {
      return {
        listo: false,
        motivoNoListo: 'Falta subir su catálogo: no tiene API y el suyo entra por fichero',
      };
    }

    return { listo: true, motivoNoListo: null };
  }

  async crear(
    datos: {
      key: ClaveProveedor;
      name: string;
      credentials?: Record<string, string>;
      defaultMarginPct?: number;
      minMarginPct?: number;
      priority?: number;
      shipsFromCountry?: string;
    },
    ctx: ContextoActor,
  ) {
    const conocido = PROVEEDORES_DISPONIBLES.find((p) => p.key === datos.key);
    if (!conocido) {
      throw new BadRequestException(
        `Proveedor desconocido "${datos.key}". Disponibles: ${PROVEEDORES_DISPONIBLES.map((p) => p.key).join(', ')}`,
      );
    }

    // Los campos que llegan por OAuth no se piden: todavía no existen. Se
    // consiguen autorizando, y para autorizar hace falta el proveedor dado de
    // alta. Exigirlos aquí cerraba el círculo y hacía imposible el alta.
    //
    // Los demás SÍ se exigen, sean secretos o no. Antes solo se comprobaban los
    // secretos, y el App Key de AliExpress no lo es: se podía dar de alta un
    // proveedor con el App Key en blanco, el alta respondía que todo bien, y el
    // fallo aparecía después al pulsar «Autorizar» —que devolvía un 400 sin
    // decir por qué—. Vacío o con espacios cuenta como ausente.
    const faltantes = conocido.camposCredenciales
      .filter((c) => !c.porOauth && !c.opcional && !datos.credentials?.[c.clave]?.trim())
      .map((c) => c.etiqueta);

    if (faltantes.length > 0) {
      throw new BadRequestException(`Faltan credenciales obligatorias: ${faltantes.join(', ')}`);
    }

    const id = newId();
    const proveedor = await this.prisma.client.supplier.create({
      data: {
        id,
        key: datos.key,
        name: datos.name,
        priority: datos.priority ?? 0,
        // Sin indicarlo se asume que sirve desde España, que es lo que hace que
        // la venta se trate como interior. En un proveedor de fuera de la UE
        // hay que corregirlo o se facturará IVA español a una importación.
        shipsFromCountry: datos.shipsFromCountry ?? 'ES',
        defaultMarginPct: datos.defaultMarginPct ?? 60,
        minMarginPct: datos.minMarginPct ?? 25,
        credentials: datos.credentials ? this.crypto.cifrarObjeto(datos.credentials) : null,
        credentialsSetAt: datos.credentials ? new Date() : null,
      },
    });

    await this.audit.registrar({
      action: 'supplier.create',
      resource: 'supplier',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      // Se registra QUÉ credenciales se han configurado, nunca su valor.
      after: {
        key: datos.key,
        name: datos.name,
        camposCredenciales: Object.keys(datos.credentials ?? {}),
      },
    });

    return { id: proveedor.id, key: proveedor.key, name: proveedor.name };
  }

  /**
   * Guarda credenciales SIN perder las que no vienen.
   *
   * Antes esto reemplazaba el objeto entero por lo que llegara, y el panel solo
   * manda los campos que alguien ha escrito. Dos consecuencias feas:
   *
   *  · Corregir solo el App Secret borraba el App Key.
   *  · Tocar cualquier credencial después de autorizar borraba el `accessToken`
   *    y el `refreshToken`, así que había que volver a autorizar sin que nada
   *    explicara por qué.
   *
   * Ahora se fusiona sobre lo que ya había. Un campo enviado vacío se entiende
   * como «no lo toques», no como «bórralo»: el panel manda vacíos sin querer
   * —son los recuadros que nadie ha rellenado— y borrar por omisión es
   * justamente lo que rompía la autorización.
   */
  async actualizarCredenciales(
    supplierId: string,
    credenciales: Record<string, string>,
    ctx: ContextoActor,
  ) {
    const proveedor = await this.exigirProveedor(supplierId);

    const actuales = proveedor.credentials
      ? this.crypto.descifrarObjeto<Record<string, string>>(proveedor.credentials)
      : {};

    const nuevas = { ...actuales };
    for (const [clave, valor] of Object.entries(credenciales)) {
      if (valor.trim()) nuevas[clave] = valor.trim();
    }

    await this.prisma.client.supplier.update({
      where: { id: supplierId },
      data: {
        credentials: this.crypto.cifrarObjeto(nuevas),
        credentialsSetAt: new Date(),
        healthStatus: 'UNKNOWN',
        consecutiveErrors: 0,
      },
    });

    // El adaptador cacheado usa las credenciales viejas: hay que descartarlo.
    this.cache.delete(supplierId);

    await this.audit.registrar({
      action: 'supplier.credentials_update',
      resource: 'supplier',
      resourceId: supplierId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      metadata: { campos: Object.keys(credenciales), proveedor: proveedor.name },
    });

    return this.verificar(supplierId);
  }

  async actualizar(
    supplierId: string,
    datos: {
      name?: string;
      isActive?: boolean;
      priority?: number;
      defaultMarginPct?: number;
      minMarginPct?: number;
      priceEnding?: number;
      includeShipping?: boolean;
      purchaseSurchargePct?: number;
      importFeeCents?: number;
      importFeeThresholdCents?: number;
      syncIntervalMinutes?: number;
      shipsFromCountry?: string;
    },
    ctx: ContextoActor,
  ) {
    const antes = await this.exigirProveedor(supplierId);

    if (
      datos.minMarginPct !== undefined &&
      datos.defaultMarginPct !== undefined &&
      datos.minMarginPct > datos.defaultMarginPct
    ) {
      throw new BadRequestException(
        'El margen mínimo no puede ser mayor que el margen por defecto: ningún producto pasaría el filtro.',
      );
    }

    const proveedor = await this.prisma.client.supplier.update({
      where: { id: supplierId },
      data: datos,
    });

    await this.audit.registrar({
      action: 'supplier.update',
      resource: 'supplier',
      resourceId: supplierId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: {
        isActive: antes.isActive,
        priority: antes.priority,
        margen: Number(antes.defaultMarginPct),
        paisOrigen: antes.shipsFromCountry,
        recargoCompra: Number(antes.purchaseSurchargePct),
        cargoFijoCents: antes.importFeeCents,
      },
      after: {
        isActive: proveedor.isActive,
        priority: proveedor.priority,
        margen: Number(proveedor.defaultMarginPct),
        // Queda en la auditoría porque cambia el IVA de las ventas futuras:
        // si un trimestre no cuadra, esto es lo primero que hay que mirar.
        paisOrigen: proveedor.shipsFromCountry,
      },
    });

    return proveedor;
  }

  /**
   * Comprueba que el proveedor responde y que además se le puede pedir algo.
   *
   * Son dos cosas distintas y hasta ahora se contaban como una. Con AliExpress,
   * el App Key y el App Secret bastan para consultar el árbol de categorías,
   * así que la comprobación salía en verde y el panel decía "sano" mientras
   * cualquier importación fallaba por falta de autorización. Ahora un proveedor
   * sin autorizar sale como PENDIENTE, que es lo que es.
   */
  async verificar(
    supplierId: string,
  ): Promise<{ ok: boolean; mensaje?: string; autorizado: boolean }> {
    const adaptador = await this.adaptador(supplierId);
    const resultado = await adaptador.verificarCredenciales();
    const autorizacion = await this.autorizacion.estado(supplierId);

    const salud = !resultado.ok ? 'ERROR' : autorizacion.autorizado ? 'HEALTHY' : 'PENDING_AUTH';

    await this.prisma.client.supplier.update({
      where: { id: supplierId },
      data: {
        healthStatus: salud,
        healthCheckedAt: new Date(),
        // Falta de autorización no es un fallo del proveedor: contarlo como
        // error acabaría abriendo el cortacircuitos por algo que se arregla
        // pulsando un botón.
        consecutiveErrors: resultado.ok ? 0 : { increment: 1 },
      },
    });

    return {
      ...resultado,
      autorizado: autorizacion.autorizado,
      ...(resultado.ok && !autorizacion.autorizado
        ? {
            mensaje:
              'Las credenciales son válidas, pero falta que el titular de la cuenta autorice ' +
              'la aplicación. Hasta entonces no se puede importar ni hacer pedidos.',
          }
        : {}),
    };
  }

  /**
   * Devuelve el adaptador listo para usar, con sus credenciales descifradas.
   * Se cachea por proveedor para no descifrar en cada llamada.
   */
  async adaptador(supplierId: string): Promise<SupplierAdapter> {
    // Antes de nada, el token. AliExpress caduca el suyo cada pocas horas y
    // renovarlo aquí evita que un pedido falle de madrugada por un token
    // muerto. Si se ha renovado, el adaptador cacheado lleva el anterior
    // dentro y hay que reconstruirlo.
    const { renovado } = await this.autorizacion.asegurarTokenVigente(supplierId);
    if (renovado) this.cache.delete(supplierId);

    const cacheado = this.cache.get(supplierId);
    if (cacheado) return cacheado;

    const proveedor = await this.exigirProveedor(supplierId);

    const credenciales = proveedor.credentials
      ? this.crypto.descifrarObjeto<Record<string, string>>(proveedor.credentials)
      : {};

    const adaptador = crearAdaptador(proveedor.key as ClaveProveedor, credenciales, {
      /*
       * De dónde lee su catálogo un proveedor sin API.
       *
       * Se pasa siempre y no solo cuando el proveedor es Dreamlove: la fábrica
       * lo ignora en los que hablan por HTTP, y preguntar aquí por la clave
       * volvería a repartir por el código el conocimiento de qué proveedores
       * existen, que es justo lo que el registro evita.
       */
      catalogoDreamlove: this.catalogoDreamlove.paraProveedor(supplierId),
      onLog: (nivel, mensaje) => {
        const texto = `[${proveedor.name}] ${mensaje}`;
        if (nivel === 'error') this.logger.error(texto);
        else if (nivel === 'warn') this.logger.warn(texto);
        else this.logger.log(texto);
      },
    });

    this.cache.set(supplierId, adaptador);
    return adaptador;
  }

  async eliminar(supplierId: string, ctx: ContextoActor): Promise<void> {
    const proveedor = await this.prisma.client.supplier.findUnique({
      where: { id: supplierId },
      include: { _count: { select: { orders: true } } },
    });
    if (!proveedor || proveedor.deletedAt) throw new NotFoundException('Proveedor no encontrado');

    if (proveedor._count.orders > 0) {
      // Borrarlo dejaría pedidos históricos sin saber a quién se enviaron.
      throw new BadRequestException(
        `Este proveedor tiene ${proveedor._count.orders} pedido(s) asociados. Desactívalo en lugar de eliminarlo.`,
      );
    }

    await this.prisma.client.supplier.update({
      where: { id: supplierId },
      data: { deletedAt: new Date(), isActive: false, credentials: null },
    });

    this.cache.delete(supplierId);

    await this.audit.registrar({
      action: 'supplier.delete',
      resource: 'supplier',
      resourceId: supplierId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { key: proveedor.key, name: proveedor.name },
    });
  }

  private async exigirProveedor(supplierId: string) {
    const proveedor = await this.prisma.client.supplier.findUnique({ where: { id: supplierId } });
    if (!proveedor || proveedor.deletedAt) throw new NotFoundException('Proveedor no encontrado');
    return proveedor;
  }
}
