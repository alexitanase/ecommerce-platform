import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MARGEN_RENOVACION_MS,
  firmarRest,
  interpretarRespuesta,
  tokenCaducado,
  urlDeAutorizacion,
} from './aliexpress.oauth.js';

/**
 * La autorización de AliExpress.
 *
 * Es la parte donde su documentación y su comportamiento real más se separan,
 * y donde un fallo no se manifiesta como un error claro sino como
 * "IncompleteSignature" o un token vacío que rompe la siguiente llamada.
 */

const SECRETO = 'secreto-de-prueba';

describe('URL de autorización', () => {
  it('lleva todo lo que AliExpress exige', () => {
    const url = new URL(
      urlDeAutorizacion({
        appKey: '540748',
        redirectUri: 'https://tienda.es/api/v1/suppliers/oauth/aliexpress/callback',
        state: 'proveedor-1',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://api-sg.aliexpress.com/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('540748');
    expect(url.searchParams.get('state')).toBe('proveedor-1');
  });

  it('la URL de retorno viaja sin destrozar', () => {
    // Va como parámetro dentro de otra URL: si no se codificara, AliExpress
    // recibiría media dirección y devolvería al usuario a ninguna parte.
    const url = new URL(
      urlDeAutorizacion({
        appKey: 'k',
        redirectUri: 'https://tienda.es/callback?x=1&y=2',
      }),
    );

    expect(url.searchParams.get('redirect_uri')).toBe('https://tienda.es/callback?x=1&y=2');
  });

  it('fuerza la pantalla de permisos', () => {
    // Sin esto, quien ya tenga sesión abierta autoriza sin verla, y acabar
    // conectado con la cuenta equivocada cuesta mucho de deshacer.
    const url = new URL(urlDeAutorizacion({ appKey: 'k', redirectUri: 'https://x.es/cb' }));

    expect(url.searchParams.get('force_auth')).toBe('true');
  });
});

describe('Firma de las rutas de autorización', () => {
  it('incluye la ruta delante de los parámetros', () => {
    // Es LA diferencia con las llamadas normales. Firmando sin la ruta, la
    // respuesta es "IncompleteSignature" y no dice qué falta.
    const parametros = { app_key: '540748', code: 'abc', timestamp: '1700000000000' };

    const esperada = crypto
      .createHmac('sha256', SECRETO)
      .update('/auth/token/createapp_key540748codeabctimestamp1700000000000', 'utf8')
      .digest('hex')
      .toUpperCase();

    expect(firmarRest('/auth/token/create', parametros, SECRETO)).toBe(esperada);
  });

  it('ordena los parámetros alfabéticamente', () => {
    // El orden en que se escriban en el objeto no puede influir: si influyera,
    // la firma cambiaría al reordenar una línea de código.
    const a = firmarRest('/auth/token/create', { b: '2', a: '1' }, SECRETO);
    const b = firmarRest('/auth/token/create', { a: '1', b: '2' }, SECRETO);

    expect(a).toBe(b);
  });

  it('cambiar cualquier cosa cambia la firma', () => {
    const base = { app_key: 'k', code: 'abc' };

    expect(firmarRest('/auth/token/create', base, SECRETO)).not.toBe(
      firmarRest('/auth/token/refresh', base, SECRETO),
    );
    expect(firmarRest('/auth/token/create', base, SECRETO)).not.toBe(
      firmarRest('/auth/token/create', { ...base, code: 'abd' }, SECRETO),
    );
    expect(firmarRest('/auth/token/create', base, SECRETO)).not.toBe(
      firmarRest('/auth/token/create', base, 'otro-secreto'),
    );
  });

  it('es hexadecimal en mayúsculas', () => {
    expect(firmarRest('/auth/token/create', { a: '1' }, SECRETO)).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe('Lectura de la respuesta de tokens', () => {
  const AHORA = 1_700_000_000_000;

  it('lee los tokens y calcula cuándo caducan', () => {
    const tokens = interpretarRespuesta(
      {
        access_token: 'token-de-acceso',
        refresh_token: 'token-de-refresco',
        expires_in: 86_400,
        account: 'tienda@ejemplo.es',
      },
      AHORA,
    );

    expect(tokens.accessToken).toBe('token-de-acceso');
    expect(tokens.refreshToken).toBe('token-de-refresco');
    expect(tokens.accessTokenExpiraEn).toBe(AHORA + 86_400_000);
    expect(tokens.cuenta).toBe('tienda@ejemplo.es');
  });

  it('los encuentra aunque vengan envueltos', () => {
    // AliExpress ha cambiado el envoltorio de estas respuestas más de una vez.
    // Entender solo el de hoy es romperse el día que lo cambien.
    expect(
      interpretarRespuesta({ data: { access_token: 'a', refresh_token: 'r' } }, AHORA).accessToken,
    ).toBe('a');
    expect(
      interpretarRespuesta({ result: { access_token: 'a', refresh_token: 'r' } }, AHORA)
        .accessToken,
    ).toBe('a');
  });

  it('sin token, error con el motivo del proveedor dentro', () => {
    // Es lo único que permite distinguir "el código ha caducado" de "el
    // secreto está mal copiado", y las dos cosas pasan constantemente.
    expect(() =>
      interpretarRespuesta({ code: 'InvalidCode', message: 'code is invalid' }, AHORA),
    ).toThrow(/code is invalid/);

    expect(() => interpretarRespuesta({}, AHORA)).toThrow(/AliExpress/);
  });

  it('distingue el tiempo relativo del absoluto', () => {
    // Su documentación lo dice en una columna fácil de pasar por alto:
    // `expires_in` son segundos que faltan y `expire_time` es el instante
    // exacto. Sumarlos igual convierte 1437129035362 en «caduca dentro de
    // 45.000 años», y el token no se renovaría jamás.
    const soloAbsoluto = interpretarRespuesta(
      {
        access_token: 'a',
        refresh_token: 'r',
        expire_time: AHORA + 7_200_000,
        refresh_token_valid_time: AHORA + 30 * 86_400_000,
      },
      AHORA,
    );

    expect(soloAbsoluto.accessTokenExpiraEn).toBe(AHORA + 7_200_000);
    expect(soloAbsoluto.refreshTokenExpiraEn).toBe(AHORA + 30 * 86_400_000);
  });

  it('el relativo manda cuando vienen los dos', () => {
    // No depende de que su reloj y el nuestro estén sincronizados.
    const tokens = interpretarRespuesta(
      { access_token: 'a', refresh_token: 'r', expires_in: 3600, expire_time: AHORA + 999_999_999 },
      AHORA,
    );

    expect(tokens.accessTokenExpiraEn).toBe(AHORA + 3_600_000);
  });

  it('un absoluto que ya ha pasado no se toma por bueno', () => {
    // Hay respuestas suyas donde este campo trae un número pequeño; tomarlo
    // como instante daría una caducidad en el pasado y renovaría en bucle.
    const tokens = interpretarRespuesta(
      { access_token: 'a', refresh_token: 'r', expire_time: 1500 },
      AHORA,
    );

    expect(tokens.accessTokenExpiraEn).toBe(AHORA + 86_400_000);
  });

  it('sin duración declarada supone un día', () => {
    // Suponer que no caduca dejaría la integración usando un token muerto sin
    // intentar renovarlo nunca.
    const tokens = interpretarRespuesta({ access_token: 'a', refresh_token: 'r' }, AHORA);

    expect(tokens.accessTokenExpiraEn).toBe(AHORA + 86_400_000);
  });

  it('un objeto donde se esperaba el token no se guarda como texto', () => {
    // Sin los conversores seguros, esto guardaría "[object Object]" como token
    // y la siguiente llamada fallaría con un error de credenciales imposible
    // de relacionar con su causa.
    expect(() => interpretarRespuesta({ access_token: { a: 1 } }, AHORA)).toThrow();
  });
});

describe('Cuándo hay que renovar', () => {
  const AHORA = 1_700_000_000_000;

  it('un token con margen de sobra vale', () => {
    expect(tokenCaducado(AHORA + 3_600_000, AHORA)).toBe(false);
  });

  it('se renueva ANTES de que caduque, no después', () => {
    // Renovar justo al caducar deja una ventana en la que una petición ya en
    // vuelo llega con el token muerto: un pedido al proveedor que falla sin
    // motivo aparente.
    expect(tokenCaducado(AHORA + MARGEN_RENOVACION_MS - 1000, AHORA)).toBe(true);
  });

  it('sin fecha de caducidad se considera caducado', () => {
    expect(tokenCaducado(undefined, AHORA)).toBe(true);
  });
});
