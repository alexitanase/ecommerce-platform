import { ClienteHttpProveedor } from '../core/http-client.js';
import { firmarIop, GATEWAY_SYNC, parametrosDeSistema } from './iop.js';
import {
  fecha,
  listaDeObjetos,
  listaDeTextos,
  numero,
  numeroOpcional,
  objeto,
  texto,
  textoOpcional,
} from '../core/coercion.js';
import {
  ErrorProveedor,
  type CapacidadesProveedor,
  type CredencialesProveedor,
  type EstadoProducto,
  type InfoSeguimiento,
  type ParametrosBusqueda,
  type ProductoProveedor,
  type RespuestaPedido,
  type ResultadoBusqueda,
  type SolicitudPedido,
  type SupplierAdapter,
  type EstadoPedidoProveedor,
  type TipoErrorProveedor,
} from '../core/types.js';

/**
 * Adaptador de AliExpress (Open Platform · API de dropshipping).
 *
 * Particularidades de esta API que condicionan la implementación:
 *
 *  · Todas las llamadas van al mismo endpoint; el método real se pasa como
 *    parámetro `method`, no en la ruta.
 *  · Cada petición se firma con HMAC-SHA256 sobre los parámetros ordenados
 *    alfabéticamente y concatenados. Un solo parámetro fuera de orden invalida
 *    la firma, y el error que devuelve no lo explica.
 *
 * El detalle del protocolo —qué parámetros de sistema van, cómo se firma y
 * dónde viaja cada cosa— está en `iop.ts`, copiado del SDK oficial en PHP que
 * hay en `ae-php-sdk/`. No se dedujo de la documentación.
 *  · Los precios llegan como cadena en la divisa pedida; hay que convertirlos
 *    a céntimos con cuidado, porque `parseFloat` sobre "12.99" y multiplicar
 *    por 100 da 1298.9999999999998.
 *
 * Estado: implementado contra la especificación pública, PENDIENTE DE VALIDAR
 * contra el servicio real (requiere alta de aplicación y credenciales).
 */

/**
 * Pasarela por defecto.
 *
 * Se puede cambiar desde el panel —hay un entorno de pruebas— porque probar el
 * alta de pedidos contra producción significa comprar de verdad.
 */
const ENDPOINT = GATEWAY_SYNC;

/**
 * La divisa en la que pedimos —y en la que exigimos— todos los precios.
 *
 * Se manda como `target_currency` en cada llamada y se comprueba en cada
 * respuesta. No es lo mismo pedir que recibir.
 */
const DIVISA = 'EUR';

export class AliExpressAdapter implements SupplierAdapter {
  readonly key = 'aliexpress';
  readonly nombre = 'AliExpress';

  readonly capacidades: CapacidadesProveedor = {
    buscarCatalogo: true,
    importarProducto: true,
    consultarStock: true,
    crearPedido: true,
    // No hay método de cancelación en su API: comprobado contra el servicio,
    // todas las variantes responden "InvalidApiPath". Declararlo como `true`
    // hacía que el motor de pedidos lo intentara y fallara con un error
    // incomprensible justo cuando un cliente pide anular su compra.
    cancelarPedido: false,
    seguimiento: true,
    // Las devoluciones se gestionan por su plataforma de disputas, no por API.
    devoluciones: false,
    envioSinMarca: true,
    limitePeticionesPorSegundo: 5,
  };

  private readonly http: ClienteHttpProveedor;

  /**
   * Registro del adaptador.
   *
   * Se guarda además de pasarlo al cliente HTTP porque hay cosas que solo el
   * adaptador sabe: que una respuesta llegó bien pero con una forma que no
   * sabemos leer, por ejemplo, que desde fuera es indistinguible de «no hay
   * resultados».
   */
  private readonly log: (nivel: 'info' | 'warn' | 'error', mensaje: string) => void;

  constructor(
    private readonly credenciales: CredencialesProveedor,
    opciones: { onLog?: (n: 'info' | 'warn' | 'error', m: string) => void } = {},
  ) {
    this.log = opciones.onLog ?? (() => {});
    this.http = new ClienteHttpProveedor({
      // La pasarela se puede cambiar desde el panel para apuntar al entorno de
      // pruebas. Sin elegir nada, producción.
      baseUrl: credenciales['gateway'] || ENDPOINT,
      proveedor: this.nombre,
      peticionesPorSegundo: this.capacidades.limitePeticionesPorSegundo,
      timeoutMs: 20_000,
      reintentos: 3,
      ...(opciones.onLog ? { onLog: opciones.onLog } : {}),
    });
  }

  // ── Llamadas ──────────────────────────────────────────────

  /**
   * Una llamada a la Open Platform, montada como la monta su SDK.
   *
   * Reparto de las partes, que es donde estaba el fallo anterior: los
   * parámetros de sistema y la firma viajan en la CADENA DE CONSULTA, y los de
   * la operación en el CUERPO. Antes iba todo junto en el cuerpo.
   */
  private async llamar<T>(metodo: string, parametros: Record<string, unknown>): Promise<T> {
    const appKey = this.credenciales['appKey'];
    const appSecret = this.credenciales['appSecret'];

    if (!appKey) {
      throw new ErrorProveedor('CREDENCIALES', 'Falta el appKey de AliExpress', {
        proveedor: this.nombre,
        reintentable: false,
      });
    }

    if (!appSecret) {
      throw new ErrorProveedor('CREDENCIALES', 'Falta el appSecret de AliExpress', {
        proveedor: this.nombre,
        reintentable: false,
      });
    }

    const sistema = parametrosDeSistema({
      appKey,
      operacion: metodo,
      accessToken: this.credenciales['accessToken'],
    });

    const negocio: Record<string, string> = {};
    for (const [clave, valor] of Object.entries(parametros)) {
      if (valor === undefined || valor === null) continue;
      // Los objetos van serializados (la API los espera como JSON en el
      // parámetro); el resto pasa por `texto`, que nunca produce
      // "[object Object]" si llega algo inesperado.
      negocio[clave] = typeof valor === 'object' ? JSON.stringify(valor) : texto(valor);
    }

    // La firma cubre los dos grupos juntos, aunque después viajen separados.
    const sign = firmarIop(metodo, { ...negocio, ...sistema }, appSecret);

    const respuesta = await this.http.peticion<Record<string, unknown>>('', {
      method: 'POST',
      queryParams: { ...sistema, sign },
      // El SDK manda los parámetros de la operación como `multipart/form-data`
      // porque el mismo camino le sirve para subir ficheros. Aquí no se sube
      // ninguno, así que van como formulario normal: la pasarela acepta las dos
      // codificaciones y esta se lee mucho mejor en un registro de red.
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(negocio).toString(),
    });

    // La API responde HTTP 200 incluso en error, con el detalle en el cuerpo:
    // sin esta comprobación, un fallo pasaría por respuesta correcta.
    if (respuesta['error_response']) {
      const err = respuesta['error_response'] as { code?: string; msg?: string };
      throw this.traducirError(err.code ?? '', err.msg ?? 'Error de AliExpress');
    }

    // El SDK también trata como error una respuesta con `code` distinto de "0"
    // en la raíz, que es como contesta la pasarela cuando el fallo es suyo y no
    // de la operación (firma mal, app_key desconocida, token caducado).
    const codigo = textoOpcional(respuesta['code']);
    if (codigo !== undefined && codigo !== '0') {
      throw this.traducirError(
        codigo,
        textoOpcional(respuesta['message']) ?? 'Error de AliExpress',
      );
    }

    return respuesta as T;
  }

  /**
   * Saca el contenido útil de la respuesta.
   *
   * La API envuelve el resultado en DOS capas y no siempre las mismas:
   * `<metodo>_response` → `resp_result` → `result`. Algunos métodos se saltan
   * la capa intermedia y devuelven `result` o `data` directamente.
   *
   * Comprobado contra el servicio real: `aliexpress.ds.category.get` responde
   * con `resp_result` y `aliexpress.ds.text.search` con `data`. Leer solo una
   * forma no da error: devuelve `undefined`, que aquí significa "no existe ese
   * producto" — y el catálogo entero se importaría vacío sin que nada fallara.
   *
   * `resp_result` trae además su propio código de estado. Un `resp_code` que no
   * sea 200 es un error de negocio con `error_response` ausente: sin mirarlo,
   * un rechazo del proveedor pasaría por respuesta correcta.
   *
   * Y hay una TERCERA forma de fallar, que es la peor de las tres: el sobre
   * llega con un `code` suelto y nada más dentro. Sin `error_response`, sin
   * `resp_result` y sin resultado. Es lo que responde `ds.text.search` cuando
   * la aplicación no tiene permiso para usarla, y sin detectarlo el buscador
   * del panel decía tranquilamente "sin resultados" ante un error de acceso:
   * quien lo usara concluiría que AliExpress no vende auriculares.
   */
  private desenvolver(
    respuesta: Record<string, unknown>,
    clave: string,
  ): Record<string, unknown> | undefined {
    const sobre = objeto(respuesta[clave]);

    /*
     * El código de error del SOBRE, que se escribe `rsp_code` y no `resp_code`.
     *
     * Las dos grafías conviven en su API según el método y esa letra de menos
     * costó un pedido: `ds.trade.order.get` respondía
     *
     *   { "rsp_code": 401, "rsp_msg": "This publisher is not registered" }
     *
     * sin `result`, sin `data` y sin `code`. Al no reconocerse ninguna de esas
     * claves, la respuesta se leía como «este pedido no existe» y el
     * seguimiento devolvía `null` sin más. En el panel eso es un pedido que se
     * queda con el estado del día que se compró, para siempre y en silencio,
     * mientras el paquete viaja.
     *
     * Va ANTES que nada: un sobre con error no trae resultado que interpretar.
     */
    const codigoSobre = numeroOpcional(sobre['rsp_code']);
    if (codigoSobre !== undefined && codigoSobre !== 200) {
      throw this.traducirError(
        texto(sobre['rsp_code'], 'RSP_ERROR'),
        texto(sobre['rsp_msg'], 'AliExpress ha rechazado la petición'),
      );
    }

    const interior = objeto(sobre['resp_result']);

    if (Object.keys(interior).length > 0) {
      const codigo = numeroOpcional(interior['resp_code']);
      if (codigo !== undefined && codigo !== 200) {
        throw this.traducirError(
          texto(interior['resp_code'], 'RESP_ERROR'),
          texto(interior['resp_msg'], 'AliExpress ha rechazado la petición'),
        );
      }
      const resultado = interior['result'];
      return resultado === undefined || resultado === null ? undefined : objeto(resultado);
    }

    const directo = sobre['result'] ?? sobre['data'];

    if (directo === undefined || directo === null) {
      // Un `code` sin resultado es un fallo, no una respuesta vacía. Se
      // comprueba solo en ausencia de resultado para no confundir un código
      // legítimo que viniera acompañando a los datos.
      const codigo = textoOpcional(sobre['code'] ?? sobre['error_code']);
      if (codigo) {
        throw this.traducirError(codigo, texto(sobre['msg'] ?? sobre['message'], codigo));
      }
      return undefined;
    }

    return objeto(directo);
  }

  private traducirError(codigo: string, mensaje: string): ErrorProveedor {
    const mapa: Record<string, TipoErrorProveedor> = {
      IllegalAccessToken: 'CREDENCIALES',
      // Documentados por AliExpress para el refresco de token.
      IllegalRefreshToken: 'CREDENCIALES',
      AUTH_TYPE_UNSUPPORTED: 'CREDENCIALES',
      InvalidSignature: 'CREDENCIALES',
      IncompleteSignature: 'CREDENCIALES',
      AccessTokenExpired: 'CREDENCIALES',
      /*
       * Falta un parámetro que su API exige. Es un fallo NUESTRO.
       *
       * Estaba clasificado como problema de credenciales y explicado como
       * «falta autorizar la aplicación», y eso mandó a buscar el fallo al sitio
       * equivocado: el seguimiento no funcionaba porque no le mandábamos
       * `language`, no porque faltara ningún permiso. Un error mal traducido
       * cuesta más que uno sin traducir.
       */
      MissingParameter: 'DESCONOCIDO',
      InsufficientPermission: 'SIN_PERMISO',
      // El método no existe. Es un fallo NUESTRO, no suyo: se ha escrito mal
      // el nombre o se está llamando a una API que no es la de esta familia.
      InvalidApiPath: 'DESCONOCIDO',
      ProductNotFound: 'NO_ENCONTRADO',
      InsufficientInventory: 'SIN_STOCK',
      PriceChanged: 'PRECIO_CAMBIADO',
      InvalidAddress: 'DIRECCION_INVALIDA',
      ServiceUnavailable: 'PROVEEDOR_CAIDO',
      EXCEPTION_TEXT_SEARCH_FOR_DS: 'SIN_PERMISO',
      // El que devuelve de verdad el servicio de producción cuando la
      // aplicación no tiene habilitada la búsqueda por texto. Visto en un
      // despliegue real: sin esta entrada salía el código crudo, que no dice
      // nada a quien lleva la tienda.
      NGSELECTION_SEARCH_ERROR: 'SIN_PERMISO',
    };

    /**
     * Códigos suyos que no dicen nada por sí solos.
     *
     * `EXCEPTION_TEXT_SEARCH_FOR_DS` es literalmente todo lo que responden
     * cuando la aplicación no puede usar la búsqueda por texto. Enseñar ese
     * nombre a quien lleva la tienda no le dice qué hacer; enseñar la causa
     * probable y la alternativa, sí.
     */
    const explicaciones: Record<string, string> = {
      EXCEPTION_TEXT_SEARCH_FOR_DS:
        'la búsqueda por texto no está disponible para esta aplicación. Suele ser porque sigue ' +
        'en modo de pruebas o porque falta autorizarla. Mientras tanto puedes importar por el ' +
        'identificador o la URL del producto',
      NGSELECTION_SEARCH_ERROR:
        'AliExpress no permite buscar por texto con esta aplicación. Es su restricción, no un ' +
        'fallo de configuración: la búsqueda del catálogo solo se habilita a las aplicaciones ' +
        'aprobadas para producción. Importa pegando la URL del producto, que sí funciona',
      MissingParameter:
        'la llamada va incompleta: falta un parámetro que su API exige. Es un fallo de la ' +
        'integración, no de la configuración ni de los permisos',
      IllegalRefreshToken:
        'el permiso ha caducado o se ha revocado desde AliExpress. Hay que volver a autorizar',
      InvalidApiPath:
        'se ha llamado a un método que no existe en su API. Es un fallo de la integración, no ' +
        'de la configuración',
    };

    const tipo = mapa[codigo] ?? 'DESCONOCIDO';
    const explicado = explicaciones[codigo] ?? mensaje;

    return new ErrorProveedor(tipo, `AliExpress: ${explicado} (${codigo})`, {
      proveedor: this.nombre,
      // No tiene sentido reintentar un permiso que no se tiene: el
      // cortacircuitos se abriría por algo que no se arregla esperando.
      reintentable: tipo !== 'SIN_PERMISO' && tipo !== 'CREDENCIALES',
      detalleOriginal: { codigo, mensaje },
    });
  }

  // ── Conversión de importes ────────────────────────────────

  /**
   * Convierte el precio del proveedor (cadena, p. ej. "12.99") a céntimos.
   * Se opera sobre la cadena en lugar de multiplicar el float por 100, porque
   * 12.99 * 100 en coma flotante da 1298.9999999999998.
   */
  private aCentimos(valor: string | number | undefined): number {
    if (valor === undefined || valor === null) return 0;
    const bruto = texto(valor).trim();
    const [entera = '0', decimal = ''] = bruto.split('.');
    const decimales = (decimal + '00').slice(0, 2);
    return numero(entera) * 100 + numero(decimales);
  }

  /**
   * Que lo que llega esté en la divisa que hemos pedido.
   *
   * Todas las llamadas mandan `target_currency: 'EUR'` y el catálogo guarda los
   * costes como euros sin volver a mirar. Si AliExpress ignorase esa petición
   * para algún vendedor —o cambiara el nombre del campo en una versión de su
   * API— aquí entrarían dólares con etiqueta de euro: un coste un 8 % más bajo
   * del real, aplicado a TODO el catálogo, y un margen que parece bueno hasta
   * que llega el cargo.
   *
   * Es barato de comprobar y no se puede detectar después: 12,99 es un número
   * perfectamente creíble en las dos divisas. Por eso se para aquí en vez de
   * convertir: un tipo de cambio nuestro sería otra cosa que puede quedarse
   * vieja y equivocarse en silencio, y lo que hace falta es enterarse.
   */
  private comprobarDivisa(divisa: string | undefined, contexto: string): void {
    const recibida = (divisa ?? '').trim().toUpperCase();

    // Vacío es «no lo dice»: se acepta, porque pedimos EUR y es lo que mandan
    // los métodos que no repiten el campo en cada nivel de la respuesta.
    if (recibida === '' || recibida === DIVISA) return;

    throw new ErrorProveedor(
      'DATOS_INVALIDOS',
      `AliExpress ha devuelto precios en ${recibida} y no en ${DIVISA} (${contexto}). ` +
        'Los costes NO se han guardado: en euros valdrían menos de lo que cuestan de verdad ' +
        'y el margen saldría inflado.',
      { proveedor: this.nombre, reintentable: false },
    );
  }

  /** La valoración llega como porcentaje ("92.5%"); se pasa a 0-5 estrellas. */
  private aValoracion(valor: unknown): number | undefined {
    const t = texto(valor).replace('%', '');
    const n = numeroOpcional(t);
    return n === undefined ? undefined : Math.round((n / 20) * 10) / 10;
  }

  // ── Implementación del contrato ───────────────────────────

  async verificarCredenciales(): Promise<{ ok: boolean; mensaje?: string }> {
    try {
      await this.llamar('aliexpress.ds.category.get', {});
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        mensaje: error instanceof Error ? error.message : 'No se ha podido validar',
      };
    }
  }

  async buscar(parametros: ParametrosBusqueda): Promise<ResultadoBusqueda> {
    const pagina = parametros.pagina ?? 1;
    const porPagina = Math.min(parametros.porPagina ?? 20, 50);

    const respuesta = await this.llamar<Record<string, unknown>>('aliexpress.ds.text.search', {
      keyWord: parametros.q ?? '',
      countryCode: parametros.countryCode ?? 'ES',
      currency: 'EUR',
      local: 'es_ES',
      pageIndex: pagina,
      pageSize: porPagina,
      ...(parametros.precioMinCents !== undefined
        ? { minPrice: parametros.precioMinCents / 100 }
        : {}),
      ...(parametros.precioMaxCents !== undefined
        ? { maxPrice: parametros.precioMaxCents / 100 }
        : {}),
      sortBy: this.traducirOrden(parametros.orden),
    });

    const datos = this.desenvolver(respuesta, 'aliexpress_ds_text_search_response') ?? {};
    const crudos = listaDeObjetos(objeto(datos['products'])['product']);
    const total = numero(datos['total_count'], crudos.length);

    return {
      items: crudos.map((p) => this.mapearProducto(p)),
      total,
      pagina,
      hayMas: pagina * porPagina < total,
    };
  }

  private traducirOrden(orden?: ParametrosBusqueda['orden']): string {
    const mapa: Record<string, string> = {
      precio_asc: 'priceAsc',
      precio_desc: 'priceDesc',
      ventas: 'orderDesc',
      relevancia: 'default',
    };
    return mapa[orden ?? 'relevancia'] ?? 'default';
  }

  private mapearProducto(crudo: Record<string, unknown>): ProductoProveedor {
    const imagenes = listaDeTextos(crudo['product_main_image_url']);
    const extra = listaDeTextos(crudo['product_small_image_urls']);

    this.comprobarDivisa(
      textoOpcional(crudo['target_sale_price_currency']),
      `producto ${texto(crudo['product_id'])} en resultados de búsqueda`,
    );

    return {
      externalId: texto(crudo['product_id']) || texto(crudo['productId']),
      title: texto(crudo['product_title']) || texto(crudo['subject']),
      description: textoOpcional(crudo['description']),
      costCents: this.aCentimos(
        texto(crudo['target_sale_price']) || texto(crudo['app_sale_price'], '0'),
      ),
      currency: texto(crudo['target_sale_price_currency'], 'EUR'),
      imageUrls: [...new Set([...imagenes, ...extra])],
      brand: textoOpcional(crudo['brand_name']),
      // Llega como porcentaje ("92.5%"); se pasa a escala de 5 estrellas.
      rating: this.aValoracion(crudo['evaluate_rate']),
      ordersCount: numeroOpcional(crudo['lastest_volume']),
      variants: [],
      metadata: { origen: 'aliexpress', crudo },
    };
  }

  async obtenerProducto(externalId: string, countryCode = 'ES'): Promise<ProductoProveedor | null> {
    try {
      const respuesta = await this.llamar<Record<string, unknown>>('aliexpress.ds.product.get', {
        product_id: externalId,
        ship_to_country: countryCode,
        target_currency: 'EUR',
        target_language: 'es',
      });

      const resultado = this.desenvolver(respuesta, 'aliexpress_ds_product_get_response');
      if (!resultado) {
        /*
         * Aquí no se sabe si el producto no existe o si la respuesta vino con
         * una forma que este código no entiende, y las dos cosas acaban en el
         * mismo «no encontrado» de cara a quien mira. Se anotan las claves de
         * primer nivel —los nombres, no los datos— porque es lo único que
         * permite distinguirlo después sin reproducir el caso.
         */
        this.log(
          'warn',
          `Sin ficha para ${externalId}. Claves de la respuesta: ${Object.keys(respuesta).join(', ') || '(vacía)'}`,
        );
        return null;
      }

      // La ficha completa NO tiene la misma forma que un resultado de
      // búsqueda: el título, el identificador y la descripción llegan dentro
      // de `ae_item_base_info_dto`, y las imágenes en `ae_multimedia_info_dto`.
      // Leerla como si fuera plana devolvía un producto sin título ni precio,
      // que se importaba igual y aparecía vacío en el catálogo.
      const base = objeto(resultado['ae_item_base_info_dto']);
      const multimedia = objeto(resultado['ae_multimedia_info_dto']);

      // Las variantes vienen en una estructura anidada aparte; sin ellas el
      // producto no se puede vender por tallas o colores.
      const skus = listaDeObjetos(
        objeto(resultado['ae_item_sku_info_dtos'])['ae_item_sku_info_d_t_o'],
      );

      // El precio de la ficha es el de su primera variante: la API no da un
      // precio de cabecera y con 0 el motor de precios calcularía un margen
      // del 100 % sobre coste cero.
      const primerSku = skus[0] ?? {};

      // Cada SKU trae la suya, y no tienen por qué coincidir: un vendedor con
      // variantes «Envíos desde: Reino Unido» puede cotizar en otra moneda.
      for (const sku of skus) {
        this.comprobarDivisa(
          textoOpcional(sku['currency_code']),
          `variante ${texto(sku['sku_id'])} de ${externalId}`,
        );
      }

      const producto: ProductoProveedor = {
        externalId: texto(base['product_id']) || externalId,
        title: texto(base['subject']),
        description: textoOpcional(base['detail']),
        costCents: this.aCentimos(texto(primerSku['offer_sale_price'])),
        currency: texto(primerSku['currency_code'], 'EUR'),
        // Vienen separadas por punto y coma en una sola cadena.
        imageUrls: texto(multimedia['image_urls'])
          .split(';')
          .map((u) => u.trim())
          .filter(Boolean),
        variants: [],
        metadata: { origen: 'aliexpress', crudo: resultado },
      };

      producto.variants = skus.map((sku) => {
        const propiedades = listaDeObjetos(
          objeto(sku['ae_sku_property_dtos'])['ae_sku_property_d_t_o'],
        );

        const opciones: Record<string, string> = {};
        /*
         * La imagen de la variante.
         *
         * No viene en el SKU sino dentro de sus propiedades, y solo una la
         * lleva: la que distingue visualmente —normalmente el color—. Las demás
         * (talla, «Envíos desde») no tienen foto, así que se coge la primera
         * que la traiga.
         *
         * Sin esto, un catálogo de ocho colores enseñaba la misma foto ocho
         * veces y el cliente no veía lo que estaba comprando.
         */
        let imagen: string | undefined;

        for (const p of propiedades) {
          const nombre = texto(p['sku_property_name']).toLowerCase();
          if (nombre) opciones[nombre] = texto(p['sku_property_value']);
          imagen ??= textoOpcional(p['sku_image']);
        }

        return {
          externalId: texto(sku['sku_id']),
          sku: textoOpcional(sku['sku_code']),
          /*
           * `offer_sale_price` y no `sku_price`: el primero es lo que se paga
           * hoy y el segundo el precio de tarifa. En los datos reales llegan a
           * separarse a la mitad —66,20 € de tarifa contra 29,79 € de venta— y
           * calcular el margen sobre la tarifa regalaría el producto.
           */
          costCents: this.aCentimos(texto(sku['offer_sale_price'])),
          stock: numeroOpcional(sku['sku_available_stock']),
          options: opciones,
          ...(imagen ? { imageUrl: imagen } : {}),
        };
      });

      return producto;
    } catch (error) {
      if (error instanceof ErrorProveedor && error.tipo === 'NO_ENCONTRADO') return null;
      throw error;
    }
  }

  async consultarEstado(externalIds: string[], countryCode = 'ES'): Promise<EstadoProducto[]> {
    const estados: EstadoProducto[] = [];

    // La API no admite consulta masiva de precio y stock, así que se consultan
    // uno a uno. El limitador del cliente HTTP evita superar la cuota.
    for (const id of externalIds) {
      try {
        const producto = await this.obtenerProducto(id, countryCode);
        if (!producto) {
          estados.push({
            externalId: id,
            disponible: false,
            costCents: 0,
            descatalogado: true,
          });
          continue;
        }

        const stockTotal = producto.variants.reduce((a, v) => a + (v.stock ?? 0), 0);
        estados.push({
          externalId: id,
          disponible: stockTotal > 0,
          costCents: producto.costCents,
          stock: stockTotal,
          descatalogado: false,
          /*
           * El detalle por variante, que es lo único que sirve para
           * sincronizar. Los valores de producto se quedan como estaban porque
           * los usa quien no vende por variantes, pero son un resumen: el coste
           * es el de la primera y el stock la suma de todas.
           */
          variantes: producto.variants.map((v) => ({
            externalVariantId: v.externalId,
            costCents: v.costCents,
            stock: v.stock ?? 0,
            disponible: (v.stock ?? 0) > 0,
            ...(v.imageUrl ? { imageUrl: v.imageUrl } : {}),
          })),
        });
      } catch (error) {
        // Un fallo puntual no debe abortar la sincronización de los demás.
        if (error instanceof ErrorProveedor && error.tipo === 'NO_ENCONTRADO') {
          estados.push({ externalId: id, disponible: false, costCents: 0, descatalogado: true });
        } else {
          throw error;
        }
      }
    }

    return estados;
  }

  /**
   * El identificador de variante que espera el pedido NO es el que guardamos.
   *
   * AliExpress usa dos cosas distintas para la misma variante:
   *
   *  · `sku_id`  → `12000049981449238`, que es lo que devuelve el catálogo y lo
   *    que guardamos como identificador de variante.
   *  · `sku_attr` → `14:200572152#TXZS-PU-S;200007763:201336100`, la cadena de
   *    atributos, que es lo ÚNICO que acepta el campo `sku_attr` del pedido.
   *
   * Mandábamos el primero en el campo del segundo. AliExpress no lo resuelve y
   * rechaza el pedido entero, además sin mensaje: en producción se veía
   * «AliExpress ha rechazado el pedido: sin detalle» y el pedido, cobrado, se
   * quedaba en incidencia.
   *
   * Se resuelve pidiendo la ficha en el momento de comprar, y no guardando el
   * `sku_attr` al importar, por dos razones: los enlaces que ya existen no lo
   * tienen —habría que migrarlos— y la cadena puede cambiar si el vendedor
   * reorganiza sus atributos, con lo que un valor guardado hace meses volvería
   * a fallar igual. Es una llamada más por pedido, no por producto vendido.
   */
  private async atributosDeSku(
    lineas: { externalProductId: string; externalVariantId?: string }[],
  ): Promise<Map<string, string>> {
    const atributos = new Map<string, string>();

    // Solo se piden fichas si hay algo que resolver. Un pedido de artículos sin
    // variante no necesita ninguna llamada, y hacerla igual sería gastar cuota
    // de la API —y arriesgar un fallo— para nada.
    const productos = [
      ...new Set(lineas.filter((l) => l.externalVariantId).map((l) => l.externalProductId)),
    ];

    for (const productId of productos) {
      const respuesta = await this.llamar<Record<string, unknown>>('aliexpress.ds.product.get', {
        product_id: productId,
        ship_to_country: 'ES',
        target_currency: 'EUR',
        target_language: 'es',
      });

      const resultado = this.desenvolver(respuesta, 'aliexpress_ds_product_get_response');
      const skus = listaDeObjetos(
        objeto(objeto(resultado ?? {})['ae_item_sku_info_dtos'])['ae_item_sku_info_d_t_o'],
      );

      for (const sku of skus) {
        const id = texto(sku['sku_id']);
        const attr = textoOpcional(sku['sku_attr']);
        if (id && attr) atributos.set(`${productId}:${id}`, attr);
      }
    }

    return atributos;
  }

  async crearPedido(solicitud: SolicitudPedido): Promise<RespuestaPedido> {
    const atributos = await this.atributosDeSku(solicitud.lineas);

    const items = solicitud.lineas.map((l) => {
      /*
       * Sin variante se manda el producto a secas: hay artículos de una sola
       * variante donde el campo sobra. Con variante, si no se encuentra su
       * cadena de atributos NO se compra a ciegas: el vendedor la ha retirado y
       * mandar el pedido igual acabaría en un paquete equivocado o en un rechazo
       * sin explicación.
       */
      if (!l.externalVariantId) {
        return {
          product_id: l.externalProductId,
          product_count: l.quantity,
          logistics_service_name: 'CAINIAO_STANDARD',
          order_memo: solicitud.nota ?? '',
        };
      }

      const attr = atributos.get(`${l.externalProductId}:${l.externalVariantId}`);
      if (!attr) {
        throw new ErrorProveedor(
          'NO_ENCONTRADO',
          `La variante ${l.externalVariantId} ya no está en la ficha de ${l.externalProductId}: ` +
            'el vendedor la ha retirado o la ha reorganizado.',
          { proveedor: this.nombre, reintentable: false },
        );
      }

      return {
        product_id: l.externalProductId,
        sku_attr: attr,
        product_count: l.quantity,
        logistics_service_name: 'CAINIAO_STANDARD',
        order_memo: solicitud.nota ?? '',
      };
    });

    const respuesta = await this.llamar<Record<string, unknown>>('aliexpress.ds.order.create', {
      // La clave de idempotencia viaja como referencia externa: si el proveedor
      // recibe dos veces la misma, devuelve el pedido ya creado en lugar de
      // duplicarlo. Es lo que impide enviar dos paquetes tras un timeout.
      out_order_id: solicitud.idempotencyKey,
      param_place_order_request4_open_api_d_t_o: {
        product_items: items,
        logistics_address: {
          contact_person: `${solicitud.envio.firstName} ${solicitud.envio.lastName}`,
          address: solicitud.envio.line1,
          address2: solicitud.envio.line2 ?? '',
          city: solicitud.envio.city,
          province: solicitud.envio.province,
          country: solicitud.envio.countryCode,
          zip: solicitud.envio.postalCode,
          phone_country: '+34',
          mobile_no: solicitud.envio.phone ?? '',
          // Obligatorio en España para envíos desde fuera de la UE.
          cpf: solicitud.envio.taxId ?? '',
        },
      },
    });

    const resultado = this.desenvolver(respuesta, 'aliexpress_ds_order_create_response') ?? {};

    if (resultado['is_success'] !== true) {
      /*
       * Con «sin detalle» no se puede hacer nada.
       *
       * Es lo que se vio en producción: el pedido rechazado, el cliente cobrado
       * y ni una pista de por qué. AliExpress no siempre rellena `error_msg`, así
       * que si falta se manda lo que SÍ ha venido —códigos y banderas de su
       * lado, no datos del cliente—, que es lo único que permite averiguarlo sin
       * volver a provocar el fallo.
       */
      const detalle =
        textoOpcional(resultado['error_msg']) ??
        textoOpcional(resultado['error_code']) ??
        JSON.stringify(resultado).slice(0, 300);

      throw new ErrorProveedor('DESCONOCIDO', `AliExpress ha rechazado el pedido: ${detalle}`, {
        proveedor: this.nombre,
        reintentable: false,
      });
    }

    const externalOrderId = textoOpcional(
      listaDeTextos(objeto(resultado['order_list'])['number'])[0],
    );
    if (!externalOrderId) {
      throw new ErrorProveedor('DESCONOCIDO', 'AliExpress no ha devuelto número de pedido', {
        proveedor: this.nombre,
        reintentable: false,
      });
    }

    const costeTotal = solicitud.lineas.reduce((a, l) => a + l.expectedCostCents * l.quantity, 0);

    return {
      externalOrderId,
      estado: 'PENDIENTE_PAGO',
      costeTotalCents: costeTotal,
      currency: 'EUR',
    };
  }

  async consultarPedido(externalOrderId: string): Promise<RespuestaPedido | null> {
    try {
      // `aliexpress.ds.order.get` NO existe: responde "InvalidApiPath". El
      // método real de la familia de dropshipping es este otro, comprobado
      // contra el servicio.
      const respuesta = await this.llamar<Record<string, unknown>>(
        'aliexpress.ds.trade.order.get',
        { order_id: externalOrderId },
      );

      const resultado = this.desenvolver(respuesta, 'aliexpress_ds_trade_order_get_response');
      if (!resultado) return null;

      // El importe llega como objeto: `{ amount: "12.99", currency_code: "EUR" }`.
      // Tratarlo como texto daba 0 € en todos los pedidos, y con el coste a
      // cero la conciliación de márgenes dice que todo es beneficio.
      const importe = objeto(resultado['order_amount']);

      // Aquí importa el doble: este importe es lo que se ha PAGADO de verdad y
      // con él se concilia el margen. Tomarlo por euros sin serlo daría por
      // buena una compra que costó más de lo que se cobró al cliente.
      this.comprobarDivisa(textoOpcional(importe['currency_code']), `pedido ${externalOrderId}`);

      return {
        externalOrderId,
        estado: this.traducirEstado(texto(resultado['order_status'])),
        costeTotalCents: this.aCentimos(texto(importe['amount'])),
        currency: texto(importe['currency_code'], DIVISA),
        metadata: { crudo: resultado },
      };
    } catch (error) {
      // Un pedido que no existe es `null`, no un error: es lo que devuelven el
      // resto de adaptadores y lo que espera el motor de pedidos para poder
      // distinguir "todavía no está" de "la llamada ha fallado".
      if (error instanceof ErrorProveedor && error.tipo === 'NO_ENCONTRADO') return null;
      throw error;
    }
  }

  private traducirEstado(estado: string): EstadoPedidoProveedor {
    const mapa: Record<string, EstadoPedidoProveedor> = {
      PLACE_ORDER_SUCCESS: 'PENDIENTE_PAGO',
      IN_CANCEL: 'PROCESANDO',
      WAIT_SELLER_SEND_GOODS: 'PROCESANDO',
      SELLER_PART_SEND_GOODS: 'ENVIADO',
      WAIT_BUYER_ACCEPT_GOODS: 'ENVIADO',
      FUND_PROCESSING: 'ENTREGADO',
      FINISH: 'ENTREGADO',
      IN_ISSUE: 'PROCESANDO',
      IN_FROZEN: 'PROCESANDO',
      WAIT_SELLER_EXAMINE_MONEY: 'DEVUELTO',
      RISK_CONTROL: 'PROCESANDO',
      CANCELED: 'CANCELADO',
    };
    return mapa[estado] ?? 'DESCONOCIDO';
  }

  /**
   * AliExpress no permite cancelar por API.
   *
   * Se probaron todas las variantes plausibles del método contra el servicio
   * real —`ds.order.cancel`, `ds.trade.order.cancel`, `ds.buyer.order.cancel`,
   * `ds.order.close`…— y todas responden "InvalidApiPath". La cancelación se
   * hace desde la cuenta de AliExpress, a mano.
   *
   * Devuelve `ok: false` con la instrucción en vez de lanzar: quien cancela un
   * pedido en el panel necesita saber qué le queda por hacer, no ver un error.
   */
  async cancelarPedido(externalOrderId: string): Promise<{ ok: boolean; mensaje?: string }> {
    return Promise.resolve({
      ok: false,
      mensaje:
        `AliExpress no permite cancelar por API. Entra en tu cuenta de AliExpress y cancela ` +
        `el pedido ${externalOrderId} a mano; solo se puede mientras el vendedor no lo haya enviado.`,
    });
  }

  async obtenerSeguimiento(externalOrderId: string): Promise<InfoSeguimiento | null> {
    const respuesta = await this.llamar<Record<string, unknown>>(
      // Tampoco existe `aliexpress.ds.logistics.tracking.get`.
      'aliexpress.ds.order.tracking.get',
      {
        order_id: externalOrderId,
        /*
         * `language` es OBLIGATORIO aquí, aunque su documentación no lo marque.
         *
         * Sin él responde `MissingParameter` y el seguimiento no se consulta
         * nunca: comprobado contra el servicio real. Se pide en español porque
         * las descripciones de los eventos van directas al cliente en el correo
         * de «tu pedido está en camino».
         */
        language: 'es_ES',
      },
    ).catch((error: unknown): Record<string, unknown> => {
      // Sin seguimiento todavía, la API responde "no encontrado". No es un
      // fallo: es que el vendedor aún no ha enviado el paquete.
      if (error instanceof ErrorProveedor && error.tipo === 'NO_ENCONTRADO') return {};
      throw error;
    });

    const resultado = this.desenvolver(respuesta, 'aliexpress_ds_order_tracking_get_response');
    if (!resultado || !texto(resultado['mail_no'])) return null;

    const eventos = listaDeObjetos(objeto(resultado['details'])['detail']);
    const numeroSeguimiento = texto(resultado['mail_no']);

    return {
      carrier: texto(resultado['logistics_service'], 'Desconocido'),
      trackingNumber: numeroSeguimiento,
      trackingUrl: `https://global.cainiao.com/detail.htm?mailNoList=${encodeURIComponent(numeroSeguimiento)}`,
      estado: texto(resultado['status']),
      eventos: eventos.map((e) => ({
        fecha: fecha(e['event_date']) ?? new Date(),
        descripcion: texto(e['event_desc']),
        ubicacion: textoOpcional(e['address']),
      })),
    };
  }
}
