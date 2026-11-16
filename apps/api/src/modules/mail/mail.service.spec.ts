import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cómo se abre la conexión con el servidor de correo.
 *
 * Se prueba aquí y no en `cifrado-smtp.spec.ts` porque la regla puede estar
 * perfecta y no llegar al transporte: lo que hay que demostrar es que lo que se
 * le pasa a nodemailer es lo correcto. Es exactamente el hueco por el que se
 * coló el fallo —la tienda estuvo sin mandar un solo correo con toda la
 * configuración puesta— así que la comprobación va sobre la costura.
 */

/** Lo último con lo que se creó el transporte, para poder mirarlo. */
const ultimoTransporte: { opciones?: Record<string, unknown> } = {};

const transporteFalso = {
  verify: vi.fn(() => Promise.resolve(true)),
  close: vi.fn(),
};

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn((opciones: Record<string, unknown>) => {
      ultimoTransporte.opciones = opciones;
      return transporteFalso;
    }),
  },
}));

const { MailService } = await import('./mail.service.js');

/** El servicio con una configuración de SMTP dada, y nada más de por medio. */
function crearServicio(ajustes: Record<string, unknown>) {
  const integraciones = {
    configuracion: vi.fn(() =>
      Promise.resolve({
        key: 'smtp',
        activa: true,
        operativa: true,
        credenciales: { password: 'clave' },
        ajustes,
        faltan: [],
      }),
    ),
  };

  const settings = { publicos: vi.fn(() => Promise.resolve({})) };
  const env = { NODE_ENV: 'production', STOREFRONT_URL: 'https://tienda.local' };

  return new MailService(env as never, settings as never, integraciones as never);
}

beforeEach(() => {
  delete ultimoTransporte.opciones;
});

describe('Conexión SMTP', () => {
  it('el puerto 465 se conecta cifrado aunque la casilla venga sin marcar', async () => {
    /*
     * El fallo tal y como ocurrió.
     *
     * Un buzón normal —los de Arsys, Ionos, OVH y compañía— va en el 465, que
     * es TLS desde el primer byte. La casilla «Conexión cifrada» viene
     * desmarcada de fábrica y nada en el panel decía que hubiera que tocarla,
     * así que la conexión salía en claro contra un puerto que espera TLS: los
     * dos lados esperando, y a los treinta segundos «Greeting never received».
     * El mismo buzón funcionaba desde el móvil, que es lo que hace que se
     * busque el problema en la red durante horas.
     */
    const servicio = crearServicio({
      host: 'smtp.ejemplo.com',
      port: 465,
      secure: false,
      user: 'buzon@ejemplo.com',
      from: 'Tienda <buzon@ejemplo.com>',
    });

    await servicio.verificarConexion();

    expect(ultimoTransporte.opciones).toMatchObject({
      host: 'smtp.ejemplo.com',
      port: 465,
      secure: true,
    });
  });

  it('el 587 se conecta en claro aunque la casilla venga marcada', async () => {
    // El error simétrico: saludar con TLS a un puerto de STARTTLS deja la
    // conexión colgada igual, y el síntoma es idéntico.
    const servicio = crearServicio({
      host: 'smtp.ejemplo.com',
      port: 587,
      secure: true,
      user: 'api',
      from: 'Tienda <no-reply@ejemplo.com>',
    });

    await servicio.verificarConexion();

    expect(ultimoTransporte.opciones).toMatchObject({ port: 587, secure: false });
  });

  it('en producción se exige un certificado válido', async () => {
    // La excepción es solo para Mailpit en desarrollo. En producción, aceptar
    // cualquier certificado convierte el cifrado en decoración.
    const servicio = crearServicio({ host: 'smtp.ejemplo.com', port: 465, from: 'a@b.c' });

    await servicio.verificarConexion();

    expect(ultimoTransporte.opciones?.['tls']).toBeUndefined();
  });

  it('un plantón se explica con el servidor y el puerto que lo han dado', async () => {
    transporteFalso.verify.mockRejectedValueOnce(
      Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' }),
    );

    const servicio = crearServicio({ host: 'smtp.ejemplo.com', port: 465, from: 'a@b.c' });

    const resultado = await servicio.verificarConexion();

    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toContain('smtp.ejemplo.com');
    expect(resultado.mensaje).toContain('465');
  });
});
