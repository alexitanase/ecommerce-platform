import { numeroOpcional, objeto, texto, textoOpcional } from '../core/coercion.js';
import { ErrorProveedor } from '../core/types.js';
import { firmarIop, GATEWAY_REST } from './iop.js';

/**
 * Autorización de AliExpress (OAuth 2.0).
 *
 * El App Key y el App Secret por sí solos no abren nada: identifican a la
 * aplicación, no dan permiso sobre una cuenta. Para llamar a las APIs de
 * dropshipping hace falta un `access_token`, y ese token solo lo puede conceder
 * el titular de la cuenta de AliExpress entrando en una página suya y diciendo
 * que sí. Es lo mismo que hace "Entrar con Google" en cualquier sitio.
 *
 * El recorrido completo es:
 *
 *   1. Se le enseña al titular la URL de `urlDeAutorizacion()`.
 *   2. Entra, inicia sesión en AliExpress y autoriza la aplicación.
 *   3. AliExpress le devuelve a nuestra URL de retorno con un `code` de un solo
 *      uso y que caduca en minutos.
 *   4. `canjearCodigo()` cambia ese código por un `access_token` y un
 *      `refresh_token`.
 *   5. El access token dura poco; `refrescarToken()` lo renueva sin volver a
 *      molestar a nadie, mientras el refresh token siga vivo.
 *
 * **Por qué esto está en un fichero aparte del adaptador**: la firma NO se
 * calcula igual. Las llamadas normales van al endpoint `/sync` y se firman
 * sobre los parámetros concatenados; las de autorización van a rutas `/rest/…`
 * y se firman incluyendo la ruta delante. Mezclarlas produce el error más
 * desconcertante de esta API: "IncompleteSignature", que no dice qué falta.
 */

const BASE_REST = GATEWAY_REST;
const BASE_AUTORIZACION = 'https://api-sg.aliexpress.com/oauth/authorize';

/** Margen con el que se considera caducado un token antes de que lo esté. */
export const MARGEN_RENOVACION_MS = 5 * 60_000;

export interface TokensAliExpress {
  accessToken: string;
  refreshToken: string;
  /** Momento en que caduca el access token, en milisegundos epoch. */
  accessTokenExpiraEn: number;
  /** Momento en que caduca el refresh token; a partir de ahí toca reautorizar. */
  refreshTokenExpiraEn?: number;
  /** Cuenta de AliExpress que ha concedido el permiso, para poder enseñarla. */
  cuenta?: string;
}

/**
 * URL a la que hay que mandar al titular de la cuenta para que autorice.
 *
 * `redirectUri` tiene que coincidir **exactamente** con la que esté dada de
 * alta en la consola de AliExpress —incluido el protocolo y la barra final— o
 * la autorización se rechaza sin explicar por qué.
 */
export function urlDeAutorizacion(parametros: {
  appKey: string;
  redirectUri: string;
  /** Valor opaco que vuelve tal cual; sirve para saber qué proveedor era. */
  state?: string;
}): string {
  const url = new URL(BASE_AUTORIZACION);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', parametros.appKey);
  url.searchParams.set('redirect_uri', parametros.redirectUri);
  // Sin esto, quien ya tenga sesión abierta pasa de largo sin ver la pantalla
  // de permisos, y autorizar con la cuenta equivocada es difícil de deshacer.
  url.searchParams.set('force_auth', 'true');
  if (parametros.state) url.searchParams.set('state', parametros.state);

  return url.toString();
}

/**
 * Firma de las rutas `/rest/…`.
 *
 * A diferencia de las llamadas normales, aquí la ruta entra en el texto que se
 * firma, delante de los parámetros ordenados.
 */
export function firmarRest(
  ruta: string,
  parametros: Record<string, string>,
  appSecret: string,
): string {
  // Una sola implementación de la firma en toda la integración, la del SDK
  // oficial. La ruta se antepone porque empieza por barra, que es exactamente
  // la regla de `IopClient::generateSign()`.
  return firmarIop(ruta, parametros, appSecret);
}

/** Cambia el código de un solo uso por los tokens. */
export async function canjearCodigo(parametros: {
  appKey: string;
  appSecret: string;
  code: string;
  /** Reloj inyectable; las pruebas necesitan un instante fijo. */
  ahora?: number;
}): Promise<TokensAliExpress> {
  return llamarAuth('/auth/token/create', { code: parametros.code }, parametros);
}

/** Renueva el access token sin intervención de nadie. */
export async function refrescarToken(parametros: {
  appKey: string;
  appSecret: string;
  refreshToken: string;
  ahora?: number;
}): Promise<TokensAliExpress> {
  return llamarAuth('/auth/token/refresh', { refresh_token: parametros.refreshToken }, parametros);
}

/** ¿Hace falta renovar ya, contando el margen de seguridad? */
export function tokenCaducado(expiraEn: number | undefined, ahora = Date.now()): boolean {
  if (!expiraEn) return true;
  return ahora >= expiraEn - MARGEN_RENOVACION_MS;
}

async function llamarAuth(
  ruta: string,
  propios: Record<string, string>,
  credenciales: { appKey: string; appSecret: string; ahora?: number },
): Promise<TokensAliExpress> {
  const ahora = credenciales.ahora ?? Date.now();

  if (!credenciales.appKey || !credenciales.appSecret) {
    throw new ErrorProveedor('CREDENCIALES', 'Faltan el App Key o el App Secret de AliExpress', {
      proveedor: 'AliExpress',
      reintentable: false,
    });
  }

  const parametros: Record<string, string> = {
    ...propios,
    app_key: credenciales.appKey,
    timestamp: String(ahora),
    sign_method: 'sha256',
  };

  parametros['sign'] = firmarRest(ruta, parametros, credenciales.appSecret);

  const respuesta = await fetch(`${BASE_REST}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(parametros).toString(),
  });

  const cuerpo = objeto(await respuesta.json().catch(() => ({})));

  return interpretarRespuesta(cuerpo, ahora);
}

/**
 * Lee la respuesta del servidor de autorización.
 *
 * Se acepta más de una forma a propósito. AliExpress ha cambiado el envoltorio
 * de estas respuestas más de una vez —a veces los tokens vienen en la raíz, a
 * veces dentro de un objeto— y una integración que solo entiende la de hoy se
 * rompe sin aviso el día que la cambien. Lo que no se acepta es una respuesta
 * sin token: eso se convierte en un error con el mensaje del proveedor dentro,
 * porque es lo único que permite saber qué ha pasado.
 */
export function interpretarRespuesta(
  cuerpo: Record<string, unknown>,
  ahora = Date.now(),
): TokensAliExpress {
  const datos = {
    ...cuerpo,
    ...objeto(cuerpo['data']),
    ...objeto(cuerpo['result']),
  };

  const accessToken = texto(datos['access_token'] ?? datos['accessToken']);
  const refreshToken = texto(datos['refresh_token'] ?? datos['refreshToken']);

  if (!accessToken) {
    const codigo = texto(datos['code'] ?? datos['error_code'] ?? datos['type'], 'SIN_CODIGO');
    const mensaje = texto(
      datos['message'] ?? datos['error_message'] ?? datos['msg'] ?? datos['error_description'],
      'AliExpress no ha devuelto ningún token',
    );

    throw new ErrorProveedor(
      // Un código o un secreto mal copiados son lo habitual aquí, y no tiene
      // sentido reintentar ninguno de los dos.
      'CREDENCIALES',
      `AliExpress rechazó la autorización: ${mensaje} (${codigo})`,
      { proveedor: 'AliExpress', reintentable: false, detalleOriginal: { codigo, mensaje } },
    );
  }

  return {
    accessToken,
    refreshToken,
    accessTokenExpiraEn: momentoDeCaducidad(
      datos['expires_in'],
      datos['expire_time'],
      ahora,
      DURACION_POR_DEFECTO_S,
    ),
    ...caducidadOpcional(datos['refresh_expires_in'], datos['refresh_token_valid_time'], ahora),
    ...(textoOpcional(datos['account'] ?? datos['user_nick'])
      ? { cuenta: texto(datos['account'] ?? datos['user_nick']) }
      : {}),
  };
}

/** Un día, que es lo que dura el token cuando no lo dicen. */
const DURACION_POR_DEFECTO_S = 86_400;

/**
 * Cuándo caduca, a partir de los dos campos que manda AliExpress.
 *
 * Manda los dos y **no significan lo mismo**, cosa que su documentación aclara
 * en una columna fácil de pasar por alto:
 *
 *  · `expires_in` / `refresh_expires_in` → segundos que faltan (tiempo relativo)
 *  · `expire_time` / `refresh_token_valid_time` → el instante exacto, en
 *    milisegundos epoch (tiempo absoluto)
 *
 * Tratarlos como intercambiables —que es lo que hacía -— convierte un
 * `expire_time` de 1437129035362 en «caduca dentro de 45.000 años»: el token
 * jamás se renovaría y la integración dejaría de funcionar sin decir por qué el
 * día que AliExpress omitiera `expires_in`.
 *
 * Se prefiere el relativo porque no depende de que su reloj y el nuestro estén
 * sincronizados.
 */
function momentoDeCaducidad(
  relativoSegundos: unknown,
  absolutoMs: unknown,
  ahora: number,
  porDefectoSegundos: number,
): number {
  const relativo = numeroOpcional(relativoSegundos);
  if (relativo !== undefined && relativo > 0) return ahora + relativo * 1000;

  // Solo se acepta como absoluto si de verdad parece un instante futuro: hay
  // respuestas suyas donde este campo trae un número pequeño, y sumarlo a la
  // hora actual daría una caducidad en el pasado.
  const absoluto = numeroOpcional(absolutoMs);
  if (absoluto !== undefined && absoluto > ahora) return absoluto;

  return ahora + porDefectoSegundos * 1000;
}

/** Igual, pero el refresco puede no venir y entonces no se inventa nada. */
function caducidadOpcional(
  relativoSegundos: unknown,
  absolutoMs: unknown,
  ahora: number,
): { refreshTokenExpiraEn?: number } {
  const relativo = numeroOpcional(relativoSegundos);
  if (relativo !== undefined && relativo > 0) {
    return { refreshTokenExpiraEn: ahora + relativo * 1000 };
  }

  const absoluto = numeroOpcional(absolutoMs);
  if (absoluto !== undefined && absoluto > ahora) return { refreshTokenExpiraEn: absoluto };

  return {};
}
