import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AliExpressAdapter } from './aliexpress.adapter.js';
import { verificarContratoDeAdaptador } from '../core/contrato.js';

/**
 * Contract tests de AliExpress.
 *
 * Se interceptan las llamadas HTTP y se responden con lo que devuelve su API,
 * guardado en `respuestas-grabadas/`. Así se prueba de verdad la parte que más
 * se rompe —cómo se interpreta lo que manda el proveedor— sin depender de que
 * su servicio esté en pie ni de tener credenciales.
 *
 * Lo que estas pruebas detectan: que AliExpress cambie un nombre de campo, que
 * mueva un dato de sitio o que devuelva un estado de pedido nuevo. Todo eso
 * hoy se descubriría con un pedido real atascado.
 */

const grabadas = (nombre: string): unknown =>
  JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, 'respuestas-grabadas', nombre), 'utf8'),
  );

const PRODUCTO = grabadas('aliexpress-producto.json');
/** Respuesta REAL del servicio, grabada con las credenciales del proyecto. */
const CATEGORIAS = grabadas('aliexpress-categorias.json');

const CREDENCIALES = {
  appKey: 'app-de-prueba',
  appSecret: 'secreto-de-prueba',
  accessToken: 'token-de-prueba',
};

/**
 * Última petición enviada, para poder comprobar cómo se construye.
 *
 * Se guardan las dos mitades por separado porque el SDK oficial las separa: los
 * parámetros de sistema y la firma van en la cadena de consulta, y los de la
 * operación en el cuerpo. `todo` junta ambas para las comprobaciones a las que
 * les da igual dónde viaje cada cosa.
 */
let ultimaPeticion: {
  url: string;
  sistema: URLSearchParams;
  cuerpo: URLSearchParams;
  todo: URLSearchParams;
} | null = null;

/** Identificadores que "existen" en la API simulada. */
const EXISTENTES = new Set(['1005006789012345', '8000000123456']);

/**
 * Responde a cada método de la API con lo que se le indique.
 *
 * Imita dos comportamientos suyos que importan: responde HTTP 200 incluso en
 * error —con el detalle en el cuerpo— y devuelve "no encontrado" cuando el
 * identificador no existe. Sin lo segundo, las pruebas de "esto no existe"
 * pasarían devolviendo el producto grabado.
 */
function interceptar(porMetodo: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      // El adaptador siempre manda el cuerpo como cadena codificada; se acota
      // el tipo para no acabar interpretando un objeto como "[object Object]".
      const enviado = typeof init?.body === 'string' ? init.body : '';
      const cuerpo = new URLSearchParams(enviado);
      const sistema = new URLSearchParams(String(url).split('?')[1] ?? '');

      const todo = new URLSearchParams(sistema);
      for (const [k, v] of cuerpo) todo.set(k, v);
      ultimaPeticion = { url: String(url), sistema, cuerpo, todo };

      // La operación viaja en `method`, y va con los parámetros de sistema.
      const metodo = sistema.get('method') ?? '';
      const identificador = cuerpo.get('product_id') ?? cuerpo.get('order_id');

      const noEncontrado = {
        error_response: { code: 'ProductNotFound', msg: 'No existe' },
      };

      if (identificador && !EXISTENTES.has(identificador)) {
        return Promise.resolve(
          new Response(JSON.stringify(noEncontrado), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }

      const respuesta = porMetodo[metodo] ?? noEncontrado;

      return Promise.resolve(
        new Response(JSON.stringify(respuesta), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
}

const adaptador = () => new AliExpressAdapter(CREDENCIALES);

describe('AliExpress · contrato común', () => {
  beforeEach(() => {
    interceptar({
      'aliexpress.ds.category.get': { aliexpress_ds_category_get_response: { result: {} } },
      'aliexpress.ds.product.get': PRODUCTO,
      'aliexpress.ds.text.search': {
        aliexpress_ds_text_search_response: { data: { products: { product: [] }, total_count: 0 } },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  verificarContratoDeAdaptador(adaptador, { externalIdConocido: '1005006789012345' });
});

describe('AliExpress · cómo se firma la petición', () => {
  beforeEach(() => {
    interceptar({ 'aliexpress.ds.category.get': { aliexpress_ds_category_get_response: {} } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manda los parámetros de sistema del SDK oficial', async () => {
    await adaptador().verificarCredenciales();

    const sistema = ultimaPeticion?.sistema;
    expect(sistema?.get('app_key')).toBe(CREDENCIALES.appKey);
    expect(sistema?.get('sign_method')).toBe('sha256');
    expect(sistema?.get('format')).toBe('json');
    expect(sistema?.get('simplify')).toBe('false');
    expect(sistema?.get('partner_id')).toBeTruthy();
    expect(sistema?.get('timestamp')).toMatch(/^\d{13}$/);
    // La firma es lo que valida AliExpress: sin ella todas las llamadas
    // devuelven "InvalidSignature" y la integración entera deja de servir.
    expect(sistema?.get('sign')).toMatch(/^[0-9A-F]{64}$/);
  });

  it('el token de la cuenta viaja como `session`, no como `access_token`', async () => {
    /*
     * Es la corrección que motivó rehacer esta capa contra el SDK oficial
     * (`IopClient::execute()` → `$sysParams["session"]`). Mandándolo en
     * `access_token`, la pasarela lo ignora: las llamadas que necesitan una
     * cuenta autorizada fallaban como si nadie hubiera autorizado nunca, y el
     * error no mencionaba el token.
     */
    await adaptador().verificarCredenciales();

    expect(ultimaPeticion?.sistema.get('session')).toBe(CREDENCIALES.accessToken);
    expect(ultimaPeticion?.todo.get('access_token')).toBeNull();
    // `v` no existe en este protocolo y además entraba en la firma.
    expect(ultimaPeticion?.todo.get('v')).toBeNull();
  });

  it('los parámetros de la operación van en el cuerpo, no en la URL', async () => {
    await adaptador()
      .obtenerProducto('1005006789012345')
      .catch(() => null);

    expect(ultimaPeticion?.cuerpo.get('product_id')).toBe('1005006789012345');
    expect(ultimaPeticion?.sistema.get('product_id')).toBeNull();
  });

  it('la pasarela se puede cambiar al entorno de pruebas', async () => {
    /*
     * En el SDK oficial la pasarela es el primer argumento del cliente, y su
     * propio demo apunta al entorno de pruebas. Importa poder cambiarla porque
     * un pedido de prueba contra producción se compra de verdad.
     */
    interceptar({ 'aliexpress.ds.category.get': CATEGORIAS });
    const conPruebas = new AliExpressAdapter({
      ...CREDENCIALES,
      gateway: 'https://api-pre.aliexpress.com/sync',
    });

    await conPruebas.verificarCredenciales();

    expect(ultimaPeticion?.url).toContain('api-pre.aliexpress.com');
  });

  it('la firma cambia si cambia un parámetro', async () => {
    await adaptador().verificarCredenciales();
    const primera = ultimaPeticion?.sistema.get('sign');

    await adaptador()
      .obtenerProducto('1005006789012345')
      .catch(() => null);
    const segunda = ultimaPeticion?.sistema.get('sign');

    expect(primera).not.toBe(segunda);
  });

  it('sin appSecret falla antes de llamar, no con un error de red', async () => {
    // Es la diferencia entre "te falta una credencial" y "AliExpress no
    // responde", que llevan a buscar el problema en sitios distintos.
    const sinSecreto = new AliExpressAdapter({ appKey: 'x' });
    const resultado = await sinSecreto.verificarCredenciales();

    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toContain('appSecret');
  });
});

describe('AliExpress · ficha de producto', () => {
  beforeEach(() => {
    interceptar({ 'aliexpress.ds.product.get': PRODUCTO });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lee el identificador y el título de la respuesta real', async () => {
    // La ficha llega ANIDADA (`ae_item_base_info_dto`), no plana como los
    // resultados de búsqueda. Leerla como si fuera plana deja el producto sin
    // título y sin identificador, y se importa una ficha vacía.
    const producto = await adaptador().obtenerProducto('1005006789012345');

    expect(producto?.externalId).toBe('1005006789012345');
    expect(producto?.title).toContain('Auriculares');
  });

  it('el precio llega en céntimos enteros, sin coma flotante', async () => {
    // 12.99 € · multiplicar por 100 en coma flotante da 1298.9999999999998.
    const producto = await adaptador().obtenerProducto('1005006789012345');

    expect(producto?.costCents).toBe(1299);
    expect(Number.isInteger(producto?.costCents)).toBe(true);
  });

  it('trae las variantes con su stock y sus opciones', async () => {
    const producto = await adaptador().obtenerProducto('1005006789012345');

    expect(producto?.variants).toHaveLength(3);
    expect(producto?.variants[0]?.externalId).toBe('12000038765432');
    expect(producto?.variants[0]?.costCents).toBe(1299);
    expect(producto?.variants[0]?.options['color']).toBe('Negro');
    // La segunda está a cero: el importador tiene que poder verlo.
    expect(producto?.variants[1]?.stock).toBe(0);
  });

  it('cada variante trae SU precio, no el de la primera', async () => {
    /*
     * El fallo que motivó esta prueba, visto en producción: ocho variantes con
     * precios reales de 66,39 €, 29,79 €, 17,79 € y 79,99 € guardadas todas al
     * mismo importe. El margen que el panel calculaba encima era inventado, y la
     * comprobación de coste antes de comprar comparaba contra un número que no
     * era el de ninguna variante.
     */
    const producto = await adaptador().obtenerProducto('1005006789012345');
    const costes = producto?.variants.map((v) => v.costCents);

    expect(costes).toEqual([1299, 1999, 979]);
    // Y el precio de venta, no el de tarifa: la azul está de 24,50 € a 9,79 €.
    expect(costes?.[2]).toBe(979);
  });

  it('cada variante trae su foto', async () => {
    // La foto no viene en el SKU sino dentro de sus propiedades, y solo la que
    // distingue visualmente la lleva: «Envíos desde» no tiene ninguna. Sin esto,
    // un producto de tres colores enseñaba la misma foto tres veces.
    const producto = await adaptador().obtenerProducto('1005006789012345');

    expect(producto?.variants[0]?.imageUrl).toContain('negro.jpg');
    expect(producto?.variants[2]?.imageUrl).toContain('azul.jpg');
  });

  it('el estado que se sincroniza va desglosado por variante', async () => {
    /*
     * Es lo que arregla el aplanado: quien sincroniza necesita el precio y el
     * stock de CADA variante. Los valores de producto se conservan como resumen
     * —coste de la primera, suma de existencias— pero ya no son lo único que hay.
     */
    const [estado] = await adaptador().consultarEstado(['1005006789012345']);

    expect(estado?.variantes).toHaveLength(3);
    expect(estado?.variantes?.map((v) => v.costCents)).toEqual([1299, 1999, 979]);
    expect(estado?.variantes?.map((v) => v.stock)).toEqual([340, 0, 58]);
    // La que está a cero no está disponible aunque el producto sí lo esté.
    expect(estado?.variantes?.[1]?.disponible).toBe(false);
    expect(estado?.disponible).toBe(true);
    expect(estado?.stock).toBe(398);
  });

  it('recoge las imágenes de la ficha', async () => {
    const producto = await adaptador().obtenerProducto('1005006789012345');
    expect(producto?.imageUrls.length).toBeGreaterThan(0);
  });
});

/**
 * La divisa.
 *
 * Todas las llamadas piden `target_currency: EUR` y el catálogo guarda lo que
 * llega como euros. Si AliExpress no atendiera esa petición, entrarían dólares
 * con etiqueta de euro: un coste un 8 % por debajo del real en TODO lo que se
 * importara, y un margen que parece bueno hasta que llega el cargo.
 *
 * No se puede descubrir después —12,99 es igual de creíble en las dos— así que
 * la única defensa es mirar lo que dice la respuesta.
 */
/**
 * Respuestas de error que NO parecen error, vistas contra el servicio real
 * consultando el pedido real 3075105054287145 de la tienda.
 *
 * Las dos dejaban un pedido con el estado congelado del día que se compró: la
 * primera porque su código de error se escribe distinto al del resto de su API,
 * y la segunda porque nos faltaba un parámetro obligatorio. Ninguna se veía en
 * ningún registro; simplemente el seguimiento no avanzaba nunca.
 */
describe('AliExpress · seguimiento de pedidos', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('`rsp_code` es un error aunque se escriba sin la "e"', async () => {
    // Literal de producción. No trae `result`, ni `data`, ni `code`: sin
    // reconocer `rsp_code` esto se leía como «el pedido no existe».
    interceptar({
      'aliexpress.ds.trade.order.get': {
        aliexpress_ds_trade_order_get_response: {
          rsp_code: 401,
          rsp_msg: 'This publisher is not registered',
          request_id: '213ba8d017854574873363396',
        },
      },
    });

    await expect(adaptador().consultarPedido('8000000123456')).rejects.toThrow(
      /This publisher is not registered/,
    );
  });

  it('un `rsp_code` 200 sí trae resultado', async () => {
    interceptar({
      'aliexpress.ds.trade.order.get': {
        aliexpress_ds_trade_order_get_response: {
          rsp_code: 200,
          result: {
            order_status: 'WAIT_SELLER_SEND_GOODS',
            order_amount: { amount: '16.89', currency_code: 'EUR' },
          },
        },
      },
    });

    const pedido = await adaptador().consultarPedido('8000000123456');

    expect(pedido?.estado).toBe('PROCESANDO');
    expect(pedido?.costeTotalCents).toBe(1689);
  });

  it('el seguimiento manda `language`, que su API exige', async () => {
    // Sin él responde `MissingParameter` y no se consulta el seguimiento nunca.
    interceptar({
      'aliexpress.ds.order.tracking.get': {
        aliexpress_ds_order_tracking_get_response: { result: {} },
      },
    });

    await adaptador().obtenerSeguimiento('8000000123456');

    expect(ultimaPeticion?.cuerpo.get('language')).toBe('es_ES');
    expect(ultimaPeticion?.cuerpo.get('order_id')).toBe('8000000123456');
  });

  it('que falte un parámetro NO se cuenta como problema de permisos', async () => {
    /*
     * Estaba clasificado como error de credenciales y explicado como «falta
     * autorizar la aplicación». Con eso, el fallo real —que no mandábamos
     * `language`— quedaba oculto detrás de un mensaje que mandaba a revisar la
     * cuenta de AliExpress, donde no había nada que arreglar.
     */
    interceptar({
      'aliexpress.ds.order.tracking.get': {
        error_response: {
          type: 'ISV',
          code: 'MissingParameter',
          msg: 'The input parameter "language" that is mandatory is not supplied',
        },
      },
    });

    await expect(adaptador().obtenerSeguimiento('8000000123456')).rejects.toMatchObject({
      tipo: 'DESCONOCIDO',
      message: expect.stringContaining('fallo de la integración') as unknown as string,
    });
  });
});

describe('AliExpress · la divisa que llega', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** El producto grabado, con la divisa que se le indique en cada variante. */
  const productoEn = (divisas: (string | undefined)[]): unknown => {
    const copia = structuredClone(PRODUCTO) as {
      aliexpress_ds_product_get_response: {
        result: {
          ae_item_sku_info_dtos: { ae_item_sku_info_d_t_o: Record<string, unknown>[] };
        };
      };
    };

    const skus =
      copia.aliexpress_ds_product_get_response.result.ae_item_sku_info_dtos.ae_item_sku_info_d_t_o;

    skus.forEach((sku, i) => {
      const divisa = divisas[i];
      if (divisa === undefined) delete sku['currency_code'];
      else sku['currency_code'] = divisa;
    });

    return copia;
  };

  it('se pide EUR en cada llamada', async () => {
    interceptar({ 'aliexpress.ds.product.get': PRODUCTO });
    await adaptador().obtenerProducto('1005006789012345');

    expect(ultimaPeticion?.todo.get('target_currency')).toBe('EUR');
  });

  it('una ficha en dólares NO se importa', async () => {
    interceptar({ 'aliexpress.ds.product.get': productoEn(['USD', 'USD', 'USD']) });

    await expect(adaptador().obtenerProducto('1005006789012345')).rejects.toThrow(/USD/);
  });

  it('basta con que UNA variante venga en otra divisa', async () => {
    // Un vendedor con variantes «Envíos desde: Reino Unido» puede cotizar esa
    // en otra moneda. Importar las demás y dejar esa mal es peor que no
    // importar: quedaría un solo producto vendiéndose a pérdida.
    interceptar({ 'aliexpress.ds.product.get': productoEn(['EUR', 'GBP', 'EUR']) });

    await expect(adaptador().obtenerProducto('1005006789012345')).rejects.toThrow(/GBP/);
  });

  it('el error dice que no se ha guardado nada, no solo que falló', async () => {
    interceptar({ 'aliexpress.ds.product.get': productoEn(['USD', 'USD', 'USD']) });

    await expect(adaptador().obtenerProducto('1005006789012345')).rejects.toThrow(
      /NO se han guardado/,
    );
  });

  it('si no viene el campo se da por buena la divisa pedida', async () => {
    // Hay métodos que no repiten la divisa en cada nivel. Rechazar por eso
    // dejaría el catálogo sin poder importar nada.
    interceptar({ 'aliexpress.ds.product.get': productoEn([undefined, undefined, undefined]) });

    const producto = await adaptador().obtenerProducto('1005006789012345');
    expect(producto?.costCents).toBe(1299);
  });

  it('la sincronización de precios también la comprueba', async () => {
    // Es el camino por el que un cambio de divisa entraría sin que nadie
    // importara nada nuevo: se sincroniza sola, todas las noches.
    interceptar({ 'aliexpress.ds.product.get': productoEn(['USD', 'USD', 'USD']) });

    await expect(adaptador().consultarEstado(['1005006789012345'])).rejects.toThrow(/USD/);
  });
});

describe('AliExpress · traducción de errores', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const casos = [
    { codigo: 'IllegalAccessToken', tipo: 'CREDENCIALES' },
    { codigo: 'InvalidSignature', tipo: 'CREDENCIALES' },
    { codigo: 'InsufficientInventory', tipo: 'SIN_STOCK' },
    { codigo: 'PriceChanged', tipo: 'PRECIO_CAMBIADO' },
    { codigo: 'InvalidAddress', tipo: 'DIRECCION_INVALIDA' },
    { codigo: 'ServiceUnavailable', tipo: 'PROVEEDOR_CAIDO' },
    { codigo: 'CodigoQueNoConocemos', tipo: 'DESCONOCIDO' },
  ];

  for (const caso of casos) {
    it(`"${caso.codigo}" se traduce a ${caso.tipo}`, async () => {
      // El motor de pedidos decide qué hacer según el tipo: reintentar, avisar
      // al equipo o cancelar. Un error mal traducido reintenta lo que nunca va
      // a funcionar, o cancela lo que solo necesitaba esperar.
      interceptar({
        'aliexpress.ds.order.create': {
          error_response: { code: caso.codigo, msg: 'mensaje del proveedor' },
        },
      });

      const error = await adaptador()
        .crearPedido({
          referenciaInterna: 'ES-2026-000001',
          idempotencyKey: 'clave-1',
          lineas: [{ externalProductId: '1', quantity: 1, expectedCostCents: 1299 }],
          envio: {
            firstName: 'Ana',
            lastName: 'Ruiz',
            line1: 'Calle Mayor 1',
            city: 'Madrid',
            province: 'Madrid',
            postalCode: '28013',
            countryCode: 'ES',
          },
        })
        .catch((e: unknown) => e);

      expect((error as { tipo?: string }).tipo).toBe(caso.tipo);
    });
  }
});

describe('AliExpress · estados de pedido', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Los doce estados que devuelve su API y el nuestro que les corresponde.
   *
   * Es la tabla que decide qué ve el cliente en el seguimiento y en qué
   * columna cae el pedido en el Kanban. Un estado sin traducir sale como
   * DESCONOCIDO y se queda ahí parado sin que nadie lo mire.
   */
  const estados: Record<string, string> = {
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

  for (const [suyo, nuestro] of Object.entries(estados)) {
    it(`"${suyo}" → ${nuestro}`, async () => {
      interceptar({
        'aliexpress.ds.trade.order.get': {
          aliexpress_ds_trade_order_get_response: {
            result: {
              order_id: '8000000123456',
              order_status: suyo,
              order_amount: { amount: '12.99', currency_code: 'EUR' },
            },
          },
        },
      });

      const pedido = await adaptador().consultarPedido('8000000123456');
      expect(pedido?.estado).toBe(nuestro);
    });
  }

  it('un estado que no conocemos no revienta: sale como DESCONOCIDO', async () => {
    // Si AliExpress añade un estado, el pedido tiene que seguir siendo
    // consultable para poder mirarlo a mano.
    interceptar({
      'aliexpress.ds.trade.order.get': {
        aliexpress_ds_trade_order_get_response: {
          result: { order_id: '8000000123456', order_status: 'ESTADO_NUEVO_2027' },
        },
      },
    });

    const pedido = await adaptador().consultarPedido('8000000123456');
    expect(pedido?.estado).toBe('DESCONOCIDO');
  });
});

describe('AliExpress · el envoltorio real de las respuestas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Esto se descubrió llamando al servicio de verdad, no leyendo su
   * documentación: el resultado no viene en `<metodo>_response.result` sino
   * envuelto otra vez en `resp_result`. La diferencia no da error —da
   * `undefined`, que aquí significa "no existe ese producto"—, así que el
   * catálogo se habría importado vacío sin que fallara nada.
   */
  it('lee el resultado envuelto en resp_result', async () => {
    interceptar({ 'aliexpress.ds.category.get': CATEGORIAS });

    const resultado = await adaptador().verificarCredenciales();

    expect(resultado.ok).toBe(true);
  });

  it('un resp_code que no es 200 es un error, no una respuesta vacía', async () => {
    // La API responde HTTP 200 y sin `error_response`: el rechazo va dentro,
    // en `resp_code`. Sin mirarlo, un "no tienes permiso" pasaría por una
    // búsqueda sin resultados.
    interceptar({
      'aliexpress.ds.text.search': {
        aliexpress_ds_text_search_response: {
          resp_result: { resp_code: 4001, resp_msg: 'No autorizado para este método' },
        },
      },
    });

    await expect(adaptador().buscar({ q: 'zapatillas', pagina: 1, porPagina: 5 })).rejects.toThrow(
      /No autorizado/,
    );
  });

  it('sigue entendiendo la forma plana', async () => {
    // Los dos formatos conviven según el método, y la documentación no dice
    // cuál usa cada uno.
    interceptar({ 'aliexpress.ds.product.get': PRODUCTO });

    const producto = await adaptador().obtenerProducto('1005006789012345');

    expect(producto?.title).toContain('Auriculares');
  });
});

describe('AliExpress · errores que no parecen errores', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Respuesta REAL de `ds.text.search` con la aplicación en modo de pruebas.
   *
   * No trae `error_response`, ni `resp_result`, ni resultado: solo un `code`
   * suelto. Se leía como "cero resultados", así que el buscador del panel
   * respondía tan tranquilo que AliExpress no vende auriculares.
   */
  it('un `code` suelto en el sobre es un fallo, no una búsqueda vacía', async () => {
    interceptar({
      'aliexpress.ds.text.search': {
        aliexpress_ds_text_search_response: {
          code: 'EXCEPTION_TEXT_SEARCH_FOR_DS',
          request_id: '212a6b7f17850961961484502',
        },
      },
    });

    await expect(adaptador().buscar({ q: 'auriculares', pagina: 1, porPagina: 5 })).rejects.toThrow(
      /EXCEPTION_TEXT_SEARCH_FOR_DS/,
    );
  });

  it('el mensaje dice qué hacer, no solo el código', async () => {
    // Quien lo lee lleva la tienda, no ha escrito la integración: el nombre
    // interno del error de AliExpress no le sirve de nada.
    interceptar({
      'aliexpress.ds.text.search': {
        aliexpress_ds_text_search_response: { code: 'EXCEPTION_TEXT_SEARCH_FOR_DS' },
      },
    });

    const error = await adaptador()
      .buscar({ q: 'auriculares', pagina: 1, porPagina: 5 })
      .catch((e: unknown) => e);

    expect((error as Error).message).toContain('modo de pruebas');
    expect((error as Error).message).toContain('identificador o la URL');
    expect((error as { tipo?: string }).tipo).toBe('SIN_PERMISO');
    // Insistir contra un permiso que no se tiene solo abre el cortacircuitos.
    expect((error as { opciones?: { reintentable?: boolean } }).opciones?.reintentable).toBe(false);
  });

  it('una búsqueda de verdad sin resultados sigue siendo una lista vacía', async () => {
    // La otra mitad de la corrección: no vale con convertir todo en error.
    interceptar({
      'aliexpress.ds.text.search': {
        aliexpress_ds_text_search_response: {
          data: { products: { product: [] }, total_count: 0 },
        },
      },
    });

    const resultado = await adaptador().buscar({ q: 'zzz', pagina: 1, porPagina: 5 });

    expect(resultado.items).toEqual([]);
    expect(resultado.total).toBe(0);
  });
});

describe('AliExpress · los nombres de método son los que existen de verdad', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Esta suite existe por un fallo concreto: tres de los métodos que llamaba
   * el adaptador NO EXISTEN. `aliexpress.ds.order.get`,
   * `aliexpress.ds.order.cancel` y `aliexpress.ds.logistics.tracking.get`
   * responden "InvalidApiPath" en el servicio real. Eran nombres plausibles
   * escritos a partir de la documentación, y nada los delataba: los contract
   * tests respondían con lo que el propio adaptador pedía.
   *
   * Los de aquí están comprobados uno a uno contra la API de verdad. Si
   * alguien cambia uno, esta prueba lo caza antes de que lo haga un pedido.
   */

  /** Qué método pide cada operación, leído de la petición que sale. */
  async function metodoUsado(
    operacion: (a: AliExpressAdapter) => Promise<unknown>,
  ): Promise<string | null | undefined> {
    interceptar({});
    await operacion(adaptador()).catch(() => null);
    return ultimaPeticion?.sistema.get('method');
  }

  it('consultar un pedido usa ds.trade.order.get', async () => {
    expect(await metodoUsado((a) => a.consultarPedido('8000000123456'))).toBe(
      'aliexpress.ds.trade.order.get',
    );
  });

  it('el seguimiento usa ds.order.tracking.get', async () => {
    expect(await metodoUsado((a) => a.obtenerSeguimiento('8000000123456'))).toBe(
      'aliexpress.ds.order.tracking.get',
    );
  });

  it('la ficha de producto usa ds.product.get', async () => {
    expect(await metodoUsado((a) => a.obtenerProducto('1005006789012345'))).toBe(
      'aliexpress.ds.product.get',
    );
  });

  it('la búsqueda usa ds.text.search', async () => {
    expect(await metodoUsado((a) => a.buscar({ q: 'x', pagina: 1, porPagina: 5 }))).toBe(
      'aliexpress.ds.text.search',
    );
  });

  it('la verificación usa ds.category.get', async () => {
    expect(await metodoUsado((a) => a.verificarCredenciales())).toBe('aliexpress.ds.category.get');
  });

  it('cancelar no llama a ninguna API y explica por qué', async () => {
    // AliExpress no tiene método de cancelación: se probaron todas las
    // variantes contra el servicio y todas dan "InvalidApiPath". Lo honesto es
    // no prometerlo y decirle a quien gestiona el pedido qué tiene que hacer.
    interceptar({});
    const sinLlamadas = adaptador();
    ultimaPeticion = null;

    const resultado = await sinLlamadas.cancelarPedido('8000000123456');

    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toContain('a mano');
    expect(ultimaPeticion).toBeNull();
    expect(sinLlamadas.capacidades.cancelarPedido).toBe(false);
  });
});

/**
 * Crear el pedido.
 *
 * Aquí se perdió un pedido real: cobrado, rechazado por AliExpress y sin
 * mensaje. El motivo estaba en un solo campo, y estas pruebas lo fijan.
 */
describe('AliExpress · crear el pedido', () => {
  /** Lo que responde su API cuando el pedido entra bien. */
  const PEDIDO_OK = {
    aliexpress_ds_order_create_response: {
      result: { is_success: true, order_list: { number: ['8000000999888'] } },
    },
  };

  const SOLICITUD = {
    referenciaInterna: 'ES-2026-000001',
    idempotencyKey: 'clave-1',
    lineas: [
      {
        externalProductId: '1005006789012345',
        externalVariantId: '12000038765433',
        quantity: 1,
        expectedCostCents: 1999,
      },
    ],
    envio: {
      firstName: 'Ana',
      lastName: 'Pruebas',
      line1: 'Calle Mayor 1',
      city: 'Madrid',
      province: 'Madrid',
      postalCode: '28013',
      countryCode: 'ES',
      phone: '600123456',
    },
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manda la CADENA DE ATRIBUTOS de la variante, no su identificador', async () => {
    /*
     * El fallo que costó un pedido: AliExpress usa dos cosas distintas para la
     * misma variante —`sku_id` (12000038765433) y `sku_attr`
     * (14:200572152#Blanco;…)— y el pedido solo acepta la segunda. Mandábamos la
     * primera, y su API rechazaba el pedido entero sin decir por qué.
     */
    interceptar({
      'aliexpress.ds.product.get': PRODUCTO,
      'aliexpress.ds.order.create': PEDIDO_OK,
    });

    const respuesta = await adaptador().crearPedido(SOLICITUD);
    expect(respuesta.externalOrderId).toBe('8000000999888');

    const enviado = ultimaPeticion?.todo.get('param_place_order_request4_open_api_d_t_o') ?? '';
    expect(enviado).toContain('14:200572152#Blanco');
    // Y el identificador NO viaja en ese campo.
    expect(enviado).not.toContain('"sku_attr":"12000038765433"');
  });

  it('no compra a ciegas si la variante ya no está en la ficha', async () => {
    // El vendedor la ha retirado o ha reorganizado sus atributos. Mandar el
    // pedido igual acaba en un paquete equivocado o en un rechazo sin explicar.
    interceptar({
      'aliexpress.ds.product.get': PRODUCTO,
      'aliexpress.ds.order.create': PEDIDO_OK,
    });

    await expect(
      adaptador().crearPedido({
        ...SOLICITUD,
        lineas: [{ ...SOLICITUD.lineas[0]!, externalVariantId: '12000000000000' }],
      }),
    ).rejects.toThrow(/ya no está en la ficha/);
  });

  it('un rechazo sin mensaje dice al menos lo que vino', async () => {
    /*
     * «AliExpress ha rechazado el pedido: sin detalle» es lo que se vio en
     * producción, y con eso no se puede hacer nada: ni saber si es la dirección,
     * ni el saldo, ni el producto. Si no rellenan `error_msg`, se manda lo que sí
     * han contestado.
     */
    interceptar({
      'aliexpress.ds.product.get': PRODUCTO,
      'aliexpress.ds.order.create': {
        aliexpress_ds_order_create_response: {
          result: { is_success: false, error_code: 'B_DROPSHIPPER_DELIVERY_ADDRESS_VALIDATE_FAIL' },
        },
      },
    });

    await expect(adaptador().crearPedido(SOLICITUD)).rejects.toThrow(
      /B_DROPSHIPPER_DELIVERY_ADDRESS_VALIDATE_FAIL/,
    );
  });

  it('la clave de idempotencia viaja como referencia externa', async () => {
    // Es lo que impide que un reintento tras un timeout mande dos paquetes.
    interceptar({
      'aliexpress.ds.product.get': PRODUCTO,
      'aliexpress.ds.order.create': PEDIDO_OK,
    });

    await adaptador().crearPedido(SOLICITUD);
    expect(ultimaPeticion?.todo.get('out_order_id')).toBe('clave-1');
  });
});
