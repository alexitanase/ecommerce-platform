import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEntorno, CONTRASENA_DE_PRUEBAS, type EntornoPruebas } from './entorno.js';

/**
 * Renovar la sesión sin echar a nadie por el camino.
 *
 * El refresh token se rota en cada uso y un token ya gastado se trata como
 * robado: se cierran TODAS las sesiones de esa persona. La regla es correcta
 * —es lo que recomienda OWASP— pero tiene un caso legítimo que se le parece
 * demasiado: dos peticiones a la vez con la misma cookie. Dos pestañas
 * abiertas, un reintento de la red al salir del metro, una pantalla que pide
 * la sesión mientras otra ya la estaba pidiendo. La segunda llega con el token
 * que la primera acaba de gastar.
 *
 * Eso pasaba de verdad: el registro de la API tiene cuatro «Reutilización de
 * refresh token detectada» de una tarde de pruebas, y cada uno era alguien
 * expulsado de su cuenta con un mensaje diciéndole que su sesión estaba
 * comprometida. Estas pruebas cubren las dos mitades: que el caso legítimo
 * pase, y que el robo de verdad siga costando todas las sesiones.
 */

let entorno: EntornoPruebas;

beforeAll(async () => {
  entorno = await crearEntorno();
}, 60_000);

afterAll(async () => {
  await entorno.app.close();
});

/** El valor de la cookie de refresco que trae una respuesta, si trae alguna. */
function cookieDe(cabeceras: Record<string, unknown>): string | null {
  const cruda = cabeceras['set-cookie'];
  const todas = Array.isArray(cruda)
    ? (cruda as string[])
    : typeof cruda === 'string'
      ? [cruda]
      : [];
  const refresco = todas.find((c) => c.startsWith('refresh_token='));
  return refresco ? (refresco.split(';')[0]?.slice('refresh_token='.length) ?? null) : null;
}

/** Entra con una cuenta nueva y devuelve su cookie de refresco. */
async function entrarConCuentaNueva(): Promise<{ cookie: string; userId: string }> {
  const persona = await entorno.personal([]);

  const respuesta = await entorno.peticion({
    metodo: 'POST',
    ruta: '/api/v1/auth/login',
    cuerpo: { email: persona.email, password: CONTRASENA_DE_PRUEBAS },
  });

  expect(respuesta.estado).toBe(200);
  const cookie = cookieDe(respuesta.cabeceras);
  expect(cookie, 'entrar debería dejar la cookie de refresco').toBeTruthy();

  return { cookie: cookie as string, userId: persona.userId };
}

const refrescar = (cookie: string) =>
  entorno.peticion<{ accessToken: string }>({
    metodo: 'POST',
    ruta: '/api/v1/auth/refresh',
    // Con cuerpo vacío, igual que el navegador: el endpoint admite el token
    // también en el cuerpo para clientes que no son web, y sin `{}` Fastify
    // rechaza la petición antes de mirar la cookie.
    cuerpo: {},
    cabeceras: { cookie: `refresh_token=${cookie}` },
  });

/**
 * ¿Sigue abierta ESTA sesión?
 *
 * Por id y no contando las del usuario: el ayudante `personal` ya deja una
 * sesión suya abierta, así que un total no distingue «no se ha cerrado nada»
 * de «se ha cerrado justo la que importa».
 */
const sesionViva = async (cookie: string): Promise<boolean> => {
  const sesion = await entorno.prisma.client.session.findUnique({
    where: { id: cookie.split('.')[0] ?? '' },
  });
  return sesion !== null && sesion.revokedAt === null;
};

/** ¿Le queda alguna sesión abierta? Es lo que se pierde cuando salta el aviso. */
const sesionesVivas = (userId: string) =>
  entorno.prisma.client.session.count({ where: { userId, revokedAt: null } });

describe('refresco de sesión', () => {
  it('renueva y rota: el token viejo deja de ser el vigente', async () => {
    const { cookie } = await entrarConCuentaNueva();

    const primera = await refrescar(cookie);
    expect(primera.estado).toBe(200);
    expect(primera.datos.accessToken).toBeTruthy();

    const nueva = cookieDe(primera.cabeceras);
    expect(nueva, 'un refresco normal sí cambia la cookie').toBeTruthy();
    expect(nueva).not.toBe(cookie);
  });

  it('el token recién gastado se acepta y NO devuelve cookie nueva', async () => {
    // El caso de las dos pestañas, reproducido en seco: primero uno rota, y
    // acto seguido llega el otro con el token de antes.
    const { cookie } = await entrarConCuentaNueva();

    const primera = await refrescar(cookie);
    const rotada = cookieDe(primera.cabeceras);

    const rezagada = await refrescar(cookie);

    expect(rezagada.estado, 'el rezagado no es un ladrón').toBe(200);
    expect(rezagada.datos.accessToken).toBeTruthy();

    /*
     * Y sobre todo: sin tocar la cookie.
     *
     * Si el rezagado devolviera una cookie nueva, la respuesta que llegara la
     * última al navegador decidiría cuál se guarda, y no tiene por qué ser la
     * vigente. Dejándola en paz, la buena es siempre la que dejó quien rotó.
     */
    expect(cookieDe(rezagada.cabeceras), 'el rezagado no debe pisar la cookie').toBeNull();

    // La sesión sigue abierta y la cookie que quedó buena sigue sirviendo.
    expect(await sesionViva(cookie), 'el rezagado no debería cerrar nada').toBe(true);
    const siguiente = await refrescar(rotada as string);
    expect(siguiente.estado).toBe(200);
  });

  it('varias a la vez con la misma cookie dejan la sesión en pie', async () => {
    // Aquí sí se cruzan de verdad. Sin la escritura condicional, dos podían
    // rotar a la vez y dejar en la base un token que el navegador no tiene:
    // el siguiente refresco parecería un robo.
    const { cookie } = await entrarConCuentaNueva();

    const respuestas = await Promise.all([
      refrescar(cookie),
      refrescar(cookie),
      refrescar(cookie),
      refrescar(cookie),
      refrescar(cookie),
    ]);

    expect(respuestas.map((r) => r.estado)).toEqual([200, 200, 200, 200, 200]);
    expect(await sesionViva(cookie), 'nadie debería haber sido expulsado').toBe(true);

    // Solo una manda cookie: la que rotó. Las demás dejan la suya en paz.
    const cookies = respuestas.map((r) => cookieDe(r.cabeceras)).filter(Boolean);
    expect(cookies).toHaveLength(1);

    // Y la que manda es la que vale para seguir.
    const siguiente = await refrescar(cookies[0] as string);
    expect(siguiente.estado).toBe(200);
  });

  it('pasada la ventana, el token viejo sí es un robo y cuesta todas las sesiones', async () => {
    const { cookie, userId } = await entrarConCuentaNueva();
    await refrescar(cookie);

    // Se envejece la rotación en lugar de esperar treinta segundos.
    await entorno.prisma.client.session.updateMany({
      where: { userId },
      data: { rotatedAt: new Date(Date.now() - 60_000) },
    });

    const robada = await refrescar(cookie);

    expect(robada.estado).toBe(401);
    expect(await sesionesVivas(userId), 'un robo cierra todo, que es el objetivo').toBe(0);
  });

  it('un token inventado no abre nada', async () => {
    const { cookie, userId } = await entrarConCuentaNueva();
    const [sessionId] = cookie.split('.');

    const falsa = await refrescar(`${sessionId ?? ''}.secreto-que-nadie-emitio`);

    expect(falsa.estado).toBe(401);
    // No coincide con el vigente ni con el anterior: es un robo, y se trata como tal.
    expect(await sesionesVivas(userId)).toBe(0);
  });
});
