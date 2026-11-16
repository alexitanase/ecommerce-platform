import crypto from 'node:crypto';

/**
 * Protocolo IOP, el que habla la Open Platform de AliExpress.
 *
 * Esto no está deducido de la documentación: está copiado del SDK oficial en
 * PHP que hay en `ae-php-sdk/` (versión `iop-sdk-php-20220608`), en concreto de
 * `IopClient::execute()` y `IopClient::generateSign()`. Cuando la API responda
 * algo raro, el sitio donde comparar es ese fichero.
 *
 * Lo que el SDK hace y aquí se replica:
 *
 *  · **Un solo endpoint.** La operación no va en la ruta sino en el parámetro
 *    `method`; todas las llamadas de negocio van a `/sync`.
 *  · **Parámetros de sistema fijos**: `app_key`, `sign_method`, `timestamp`,
 *    `method`, `partner_id`, `simplify` y `format`. El token de la cuenta viaja
 *    como `session`, NO como `access_token`.
 *  · **La firma se calcula sobre TODOS los parámetros**, los del sistema y los
 *    de la operación juntos, ordenados por clave y concatenados sin separador.
 *  · **La ruta entra en la firma solo si el nombre de la operación la lleva.**
 *    Las de negocio son `aliexpress.ds.product.get` (sin barra) y no la
 *    incluyen; las de autorización son `/auth/token/create` (con barra) y sí.
 *    Confundir los dos casos da «IncompleteSignature», que no dice qué falta.
 */

/** Pasarela de las llamadas de negocio. `UrlConstants::$api_gateway_url_tw`. */
export const GATEWAY_SYNC = 'https://api-sg.aliexpress.com/sync';

/** Pasarela de las llamadas de autorización, que son de estilo REST. */
export const GATEWAY_REST = 'https://api-sg.aliexpress.com/rest';

/**
 * Entorno de pruebas de AliExpress.
 *
 * Es el que usa el `simpleDemo.php` del SDK. Se puede elegir desde el panel:
 * probar el alta de pedidos contra producción significa comprar de verdad.
 */
export const GATEWAY_PRUEBAS = 'https://api-pre.aliexpress.com/sync';

/**
 * Identificador del SDK que se manda en `partner_id`.
 *
 * Va con nuestro nombre y no con el del SDK de PHP: es lo que AliExpress ve en
 * sus registros para saber qué cliente está llamando, y hacernos pasar por su
 * SDK oficial solo serviría para que un problema nuestro pareciera suyo.
 */
export const PARTNER_ID = 'ecom-node-20260729';

/**
 * Firma de una petición.
 *
 * `IopClient::generateSign()`: ordena por clave, concatena `clave` + `valor`
 * sin separadores, antepone el nombre de la operación si contiene una barra, y
 * calcula HMAC-SHA256 en hexadecimal MAYÚSCULA.
 *
 * El orden alfabético no es estética: cambiarlo produce otra firma, y la API
 * responde con un error genérico que no menciona la firma.
 */
export function firmarIop(
  nombreOperacion: string,
  parametros: Record<string, string>,
  appSecret: string,
): string {
  const concatenado = Object.keys(parametros)
    .sort()
    .map((clave) => `${clave}${parametros[clave] ?? ''}`)
    .join('');

  const texto = nombreOperacion.includes('/') ? `${nombreOperacion}${concatenado}` : concatenado;

  return crypto.createHmac('sha256', appSecret).update(texto, 'utf8').digest('hex').toUpperCase();
}

/**
 * Parámetros de sistema de una llamada.
 *
 * Se corresponden uno a uno con los `$sysParams` de `IopClient::execute()`.
 * Dos diferencias con lo que había antes en este proyecto, y las dos importan:
 *
 *  · El token va en `session`. Antes se mandaba en `access_token`, que esta
 *    pasarela ignora: las llamadas que necesitan cuenta autorizada fallaban
 *    como si no hubiera token.
 *  · No existe ningún parámetro `v`. Se enviaba `v=2.0`, que además entraba en
 *    la firma.
 */
export function parametrosDeSistema(opciones: {
  appKey: string;
  operacion: string;
  accessToken?: string | undefined;
  /** Reloj inyectable: las pruebas necesitan un instante fijo. */
  ahora?: number;
}): Record<string, string> {
  return {
    app_key: opciones.appKey,
    sign_method: 'sha256',
    // En milisegundos. El SDK de PHP los calcula mal —concatena los segundos
    // con "000"— y aun así funciona porque la pasarela solo comprueba que la
    // marca esté dentro de una ventana de tiempo.
    timestamp: String(opciones.ahora ?? Date.now()),
    method: opciones.operacion,
    partner_id: PARTNER_ID,
    // `false` significa que la respuesta llega con su envoltorio completo, que
    // es lo que este código sabe leer.
    simplify: 'false',
    format: 'json',
    ...(opciones.accessToken ? { session: opciones.accessToken } : {}),
  };
}
