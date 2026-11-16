import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClienteHttpProveedor } from './http-client.js';
import { ErrorProveedor } from './types.js';

/**
 * Estas pruebas cubren lo que en producción sale caro: reintentar cuando no se
 * debe, machacar a un proveedor caído, o no respetar su límite de caudal y
 * acabar con la cuenta bloqueada.
 */

/**
 * Fábrica de respuestas.
 *
 * Devuelve una Response NUEVA en cada llamada a propósito: el cuerpo de una
 * Response solo se puede leer una vez, así que reutilizar el mismo objeto entre
 * llamadas produce "Body has already been read" y falsos fallos.
 */
const respuestaOk = (cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** Igual, pero para usar con mockImplementation cuando hay varias llamadas. */
const generaOk = (cuerpo: unknown) => () => respuestaOk(cuerpo);
const generaError =
  (status: number, texto = 'error') =>
  () =>
    new Response(texto, { status });

describe('ClienteHttpProveedor', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const crear = (opciones: Partial<ConstructorParameters<typeof ClienteHttpProveedor>[0]> = {}) =>
    new ClienteHttpProveedor({
      baseUrl: 'https://proveedor.invalid/api',
      proveedor: 'Prueba',
      peticionesPorSegundo: 100,
      reintentos: 2,
      ...opciones,
    });

  it('devuelve el cuerpo cuando la respuesta es correcta', async () => {
    fetchMock.mockImplementation(generaOk({ ok: true, dato: 42 }));
    const cliente = crear();

    await expect(cliente.peticion('/productos')).resolves.toEqual({ ok: true, dato: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('NO reintenta cuando las credenciales son inválidas', async () => {
    // Reintentar un 401 es inútil y, si el proveedor cuenta intentos fallidos,
    // acerca la cuenta al bloqueo.
    fetchMock.mockImplementation(generaError(401, 'no autorizado'));
    const cliente = crear();

    await expect(cliente.peticion('/productos')).rejects.toMatchObject({
      tipo: 'CREDENCIALES',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reintenta los errores 5xx y acaba devolviendo el resultado', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(respuestaOk({ recuperado: true }));

    const cliente = crear();
    const promesa = cliente.peticion('/productos');
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(promesa).resolves.toEqual({ recuperado: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('respeta la cabecera Retry-After en un 429', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('demasiadas peticiones', { status: 429, headers: { 'retry-after': '2' } }),
      )
      .mockResolvedValueOnce(respuestaOk({ ok: true }));

    const cliente = crear();
    const promesa = cliente.peticion('/productos');

    // Antes de los 2 segundos indicados no debe haber reintentado todavía.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(promesa).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('abre el cortacircuitos tras varios fallos y deja de llamar al proveedor', async () => {
    fetchMock.mockImplementation(generaError(503, 'caído'));
    const cliente = crear({ reintentos: 0 });

    // Cinco fallos consecutivos son el umbral configurado.
    for (let i = 0; i < 5; i++) {
      await cliente.peticion('/x').catch(() => undefined);
    }

    expect(cliente.estado.circuitoAbierto).toBe(true);
    const llamadasAntes = fetchMock.mock.calls.length;

    // Con el circuito abierto ni siquiera se intenta la petición.
    await expect(cliente.peticion('/x')).rejects.toMatchObject({ tipo: 'PROVEEDOR_CAIDO' });
    expect(fetchMock).toHaveBeenCalledTimes(llamadasAntes);
  });

  it('cierra el cortacircuitos tras una respuesta correcta', async () => {
    fetchMock.mockImplementation(generaError(503, 'caído'));
    const cliente = crear({ reintentos: 0 });

    for (let i = 0; i < 3; i++) await cliente.peticion('/x').catch(() => undefined);
    expect(cliente.estado.fallosConsecutivos).toBe(3);

    fetchMock.mockImplementation(generaOk({ ok: true }));
    await cliente.peticion('/x');

    expect(cliente.estado.fallosConsecutivos).toBe(0);
    expect(cliente.estado.circuitoAbierto).toBe(false);
  });

  it('limita el caudal de peticiones al valor configurado', async () => {
    fetchMock.mockImplementation(generaOk({ ok: true }));
    // Dos peticiones por segundo: la tercera tiene que esperar.
    const cliente = crear({ peticionesPorSegundo: 2 });

    await cliente.peticion('/1');
    await cliente.peticion('/2');

    const tercera = cliente.peticion('/3');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(600);
    await tercera;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('traduce un timeout a error de red reintentable', async () => {
    const timeout = new Error('The operation was aborted');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValue(timeout);

    const cliente = crear({ reintentos: 1 });

    // El manejador se adjunta ANTES de avanzar el reloj: si no, la promesa
    // rechaza mientras nadie la escucha y Node lo cuenta como fallo no capturado.
    const aserto = expect(cliente.peticion('/lento')).rejects.toMatchObject({ tipo: 'RED' });
    await vi.advanceTimersByTimeAsync(10_000);
    await aserto;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('construye la URL con los parámetros de consulta', async () => {
    fetchMock.mockImplementation(generaOk({}));
    const cliente = crear();

    await cliente.peticion('/buscar', { queryParams: { q: 'botas', pagina: 2, vacio: undefined } });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('q=botas');
    expect(url).toContain('pagina=2');
    expect(url).not.toContain('vacio');
  });
});

describe('ErrorProveedor', () => {
  it('marca como reintentables los fallos transitorios', () => {
    expect(new ErrorProveedor('RED', 'x').reintentable).toBe(true);
    expect(new ErrorProveedor('LIMITE_PETICIONES', 'x').reintentable).toBe(true);
    expect(new ErrorProveedor('PROVEEDOR_CAIDO', 'x').reintentable).toBe(true);
  });

  it('no reintenta los que requieren intervención humana', () => {
    expect(new ErrorProveedor('SIN_STOCK', 'x').reintentable).toBe(false);
    expect(new ErrorProveedor('CREDENCIALES', 'x').reintentable).toBe(false);
    expect(new ErrorProveedor('PRECIO_CAMBIADO', 'x').reintentable).toBe(false);
  });

  it('identifica los que debe revisar una persona', () => {
    expect(new ErrorProveedor('SIN_STOCK', 'x').requiereIntervencion).toBe(true);
    expect(new ErrorProveedor('DIRECCION_INVALIDA', 'x').requiereIntervencion).toBe(true);
    expect(new ErrorProveedor('RED', 'x').requiereIntervencion).toBe(false);
  });
});
