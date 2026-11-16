import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearEntorno, vaciarBase, type EntornoPruebas, type ErrorApi } from './entorno.js';

/** Lo que el panel necesita de cada integración; nunca el valor de un secreto. */
interface EstadoIntegracion {
  key: string;
  activa: boolean;
  operativa: boolean;
  credenciales: CredencialPublicada[];
  ajustes: { clave: string; valor: unknown }[];
}

interface CredencialPublicada {
  clave: string;
  /** Si está puesta, que es lo único que el panel necesita saber. */
  configurado: boolean;
  /**
   * Nunca debería venir. Se declara —siempre `undefined`— para que la prueba
   * pueda comprobarlo: si alguien empezara a devolver el secreto, esto es lo
   * que lo cazaría.
   */
  valor?: undefined;
}

/**
 * El panel manda, y el panel no enseña secretos.
 *
 * Aquí se comprueban las tres promesas del módulo de integraciones, que son
 * las que sostienen toda la configuración desde el admin: que hace falta
 * permiso para entrar, que una clave guardada no vuelve nunca al navegador, y
 * que no se puede encender un servicio a medio configurar.
 *
 * La tercera es la que evita el peor caso: una pasarela activa sin secreto de
 * firma acepta avisos de cobro falsos, es decir, regala pedidos.
 */

let entorno: EntornoPruebas;

/** Busca una integración en el estado y falla claro si el panel dejó de traerla. */
function integracion(estado: EstadoIntegracion[], key: string): EstadoIntegracion {
  const encontrada = estado.find((i) => i.key === key);
  if (!encontrada) throw new Error(`El panel no devuelve la integración "${key}"`);
  return encontrada;
}

const APIKEY = 'clave-secretisima-de-nowpayments';

beforeAll(async () => {
  entorno = await crearEntorno();
});

afterAll(async () => {
  await entorno.app.close();
});

beforeEach(async () => {
  await vaciarBase(entorno);
});

describe('Quién puede tocar las integraciones', () => {
  it('sin sesión no se ve nada', async () => {
    const respuesta = await entorno.peticion({ metodo: 'GET', ruta: '/api/v1/integrations' });

    expect(respuesta.estado).toBe(401);
  });

  it('con sesión pero sin el permiso, tampoco', async () => {
    // Un rol de atención al cliente entra al panel, pero la configuración de
    // pagos no es cosa suya.
    const { token } = await entorno.personal(['orders:read']);

    const respuesta = await entorno.peticion({
      metodo: 'GET',
      ruta: '/api/v1/integrations',
      token,
    });

    expect(respuesta.estado).toBe(403);
  });

  it('guardar exige el mismo permiso que leer', async () => {
    const { token } = await entorno.personal(['orders:read']);

    const respuesta = await entorno.peticion({
      metodo: 'POST',
      ruta: '/api/v1/integrations/nowpayments',
      token,
      cuerpo: { credenciales: { apiKey: APIKEY } },
    });

    expect(respuesta.estado).toBe(403);
  });
});

describe('Configurar una integración', () => {
  it('la clave guardada no vuelve nunca en la respuesta', async () => {
    const { token } = await entorno.personal(['settings:write']);

    await entorno.peticion({
      metodo: 'POST',
      ruta: '/api/v1/integrations/nowpayments',
      token,
      cuerpo: { credenciales: { apiKey: APIKEY, ipnSecret: 'secreto-ipn' } },
    });

    const estado = await entorno.peticion<EstadoIntegracion[]>({
      metodo: 'GET',
      ruta: '/api/v1/integrations',
      token,
    });

    // Ni en el campo, ni escondida en cualquier otro sitio del cuerpo: se
    // busca en el JSON entero porque el descuido típico es devolverla en un
    // objeto de depuración, no en el campo evidente.
    expect(JSON.stringify(estado.datos)).not.toContain(APIKEY);

    const nowpayments = integracion(estado.datos, 'nowpayments');
    const apiKey = nowpayments.credenciales.find((c) => c.clave === 'apiKey');

    // Lo que sí se dice: que está puesta. Es lo que necesita el panel para
    // pintar "configurado" sin enseñar el valor.
    expect(apiKey?.configurado).toBe(true);
    expect(apiKey?.valor).toBeUndefined();
  });

  it('guardar solo una credencial no borra las demás', async () => {
    // El panel no conoce los valores, así que reenvía el formulario con los
    // campos vacíos. Si eso borrara lo guardado, cambiar el modo de pruebas
    // dejaría la pasarela sin claves.
    const { token } = await entorno.personal(['settings:write']);

    await entorno.peticion({
      metodo: 'POST',
      ruta: '/api/v1/integrations/nowpayments',
      token,
      cuerpo: { credenciales: { apiKey: APIKEY, ipnSecret: 'secreto-ipn' } },
    });

    await entorno.peticion({
      metodo: 'POST',
      ruta: '/api/v1/integrations/nowpayments',
      token,
      cuerpo: { ajustes: { sandbox: false } },
    });

    const estado = await entorno.peticion<EstadoIntegracion[]>({
      metodo: 'GET',
      ruta: '/api/v1/integrations',
      token,
    });
    const nowpayments = integracion(estado.datos, 'nowpayments');

    expect(nowpayments.credenciales.every((c) => c.configurado)).toBe(true);
    expect(nowpayments.ajustes.find((a) => a.clave === 'sandbox')?.valor).toBe(false);
  });

  it('no deja activar una pasarela sin el secreto de firma', async () => {
    const { token } = await entorno.personal(['settings:write']);

    const respuesta = await entorno.peticion<ErrorApi>({
      metodo: 'POST',
      ruta: '/api/v1/integrations/nowpayments',
      token,
      cuerpo: { activa: true, credenciales: { apiKey: APIKEY } },
    });

    // Sin `ipnSecret` no se puede comprobar la firma de los avisos de cobro:
    // cualquiera podría dar un pedido por pagado.
    expect(respuesta.estado).toBe(400);
    // El mensaje nombra el campo como se ve en el panel ("Secreto IPN"), no
    // como se llama en el código: lo lee quien lleva la tienda.
    expect(respuesta.datos.message).toContain('Secreto IPN');
  });

  it('no deja activar lo que todavía no está implementado', async () => {
    const { token } = await entorno.personal(['settings:write']);

    const respuesta = await entorno.peticion<ErrorApi>({
      metodo: 'POST',
      ruta: '/api/v1/integrations/comfyui',
      token,
      cuerpo: { activa: true, ajustes: { url: 'http://localhost:8188' } },
    });

    // Tener credenciales no es tenerlo hecho: activarlo dejaría al cliente a
    // mitad de camino con una pantalla que no lleva a ninguna parte.
    expect(respuesta.estado).toBe(400);
    expect(respuesta.datos.message).toContain('implementada');
  });

  it('una integración que no existe se rechaza, no se crea', async () => {
    const { token } = await entorno.personal(['settings:write']);

    const respuesta = await entorno.peticion({
      metodo: 'POST',
      ruta: '/api/v1/integrations/pasarela-inventada',
      token,
      cuerpo: { credenciales: { apiKey: 'x' } },
    });

    expect(respuesta.estado).toBe(400);
  });

  it('activarla y apagarla se refleja en si está operativa', async () => {
    const { token } = await entorno.personal(['settings:write']);

    const encender = await entorno.peticion({
      metodo: 'POST',
      ruta: '/api/v1/integrations/nowpayments',
      token,
      cuerpo: {
        activa: true,
        credenciales: { apiKey: APIKEY, ipnSecret: 'secreto-ipn' },
      },
    });

    expect(encender.estado).toBe(200);

    const apagar = await entorno.peticion({
      metodo: 'POST',
      ruta: '/api/v1/integrations/nowpayments',
      token,
      cuerpo: { activa: false },
    });

    expect(apagar.estado).toBe(200);

    const estado = await entorno.peticion<EstadoIntegracion[]>({
      metodo: 'GET',
      ruta: '/api/v1/integrations',
      token,
    });
    const nowpayments = integracion(estado.datos, 'nowpayments');

    // Apagada pero con las credenciales puestas: volver a encenderla no
    // obliga a pedírselas otra vez a quien lleva la tienda.
    expect(nowpayments.activa).toBe(false);
    expect(nowpayments.operativa).toBe(false);
    expect(nowpayments.credenciales.every((c) => c.configurado)).toBe(true);
  });
});
