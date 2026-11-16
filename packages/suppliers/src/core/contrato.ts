import { expect, it } from 'vitest';
import type { SupplierAdapter } from './types.js';

/**
 * El contrato que cumple cualquier adaptador de proveedor.
 *
 * El motor de pedidos no sabe con quién habla: pide un producto, manda un
 * pedido y consulta un seguimiento, y espera siempre la misma forma de
 * respuesta. Si un adaptador devuelve el precio en euros en vez de en céntimos,
 * o un estado que no existe, nada falla al compilar: falla al vender, y se
 * descubre con un margen mal calculado o un pedido atascado en un estado que el
 * Kanban no sabe pintar.
 *
 * Esta suite se ejecuta contra TODOS los adaptadores —el simulado, AliExpress
 * con respuestas grabadas y el que venga— para que añadir uno nuevo no sea
 * también añadir una forma nueva de equivocarse.
 *
 * Se prueba la forma y las invariantes, no los valores: cada proveedor devuelve
 * sus propios productos.
 */
export function verificarContratoDeAdaptador(
  crear: () => SupplierAdapter,
  opciones: { externalIdConocido: string; soportaPedidos?: boolean } = {
    externalIdConocido: '',
  },
): void {
  it('se identifica con una clave y un nombre', () => {
    const adaptador = crear();
    expect(adaptador.key).toMatch(/^[a-z0-9_-]+$/);
    expect(adaptador.nombre.length).toBeGreaterThan(0);
  });

  it('declara sus capacidades', () => {
    // El importador y el motor de pedidos las consultan antes de intentar
    // nada: prometer una capacidad que no se tiene acaba en un pedido que no
    // se puede enviar y un cliente esperando.
    const { capacidades } = crear();

    for (const capacidad of [
      'buscarCatalogo',
      'importarProducto',
      'consultarStock',
      'crearPedido',
      'cancelarPedido',
      'seguimiento',
      'devoluciones',
      'envioSinMarca',
    ] as const) {
      expect(typeof capacidades[capacidad], capacidad).toBe('boolean');
    }

    // Sin límite declarado, el cliente HTTP no puede espaciar las llamadas y
    // el proveedor acaba bloqueando la cuenta por exceso de peticiones.
    expect(capacidades.limitePeticionesPorSegundo).toBeGreaterThan(0);
  });

  it('la verificación de credenciales responde sin lanzar', async () => {
    // Es lo que ejecuta el botón "verificar" del panel: si lanzara, la
    // pantalla se rompería en vez de decir qué pasa.
    const resultado = await crear().verificarCredenciales();

    expect(typeof resultado.ok).toBe('boolean');
    if (!resultado.ok) expect(typeof resultado.mensaje).toBe('string');
  });

  it('la búsqueda devuelve la forma esperada aunque no haya resultados', async () => {
    const resultado = await crear().buscar({ q: 'zzz-no-existe-zzz', pagina: 1, porPagina: 5 });

    expect(Array.isArray(resultado.items)).toBe(true);
    expect(typeof resultado.total).toBe('number');
    expect(typeof resultado.hayMas).toBe('boolean');
    expect(resultado.pagina).toBeGreaterThanOrEqual(1);
  });

  it('los productos vienen con importes en céntimos enteros', async () => {
    const { items } = await crear().buscar({ q: '', pagina: 1, porPagina: 5 });

    for (const producto of items) {
      // Un coste en euros aquí se convierte en un margen diez veces mayor del
      // real y en vender por debajo de coste sin que salte ningún aviso.
      expect(Number.isInteger(producto.costCents), producto.externalId).toBe(true);
      expect(producto.costCents).toBeGreaterThanOrEqual(0);
      expect(producto.currency.length).toBe(3);
      expect(producto.title.length).toBeGreaterThan(0);
      expect(Array.isArray(producto.imageUrls)).toBe(true);

      for (const variante of producto.variants) {
        expect(Number.isInteger(variante.costCents), variante.externalId).toBe(true);
        expect(typeof variante.stock).toBe('number');
      }
    }
  });

  it('un producto que no existe devuelve null, no un error', async () => {
    // El importador distingue "no está" de "ha fallado la llamada": con un
    // error genérico, un catálogo con una referencia retirada abortaría la
    // importación entera.
    const producto = await crear().obtenerProducto('id-que-no-existe-jamas-000');
    expect(producto).toBeNull();
  });

  if (opciones.externalIdConocido) {
    it('un producto conocido trae lo necesario para publicarlo', async () => {
      const producto = await crear().obtenerProducto(opciones.externalIdConocido);

      expect(producto).not.toBeNull();
      expect(producto?.externalId).toBe(opciones.externalIdConocido);
      expect(producto?.title.length).toBeGreaterThan(0);
      expect(Number.isInteger(producto?.costCents)).toBe(true);
      // Sin variantes no se puede vender: el catálogo necesita al menos una.
      expect((producto?.variants ?? []).length).toBeGreaterThan(0);
    });

    it('el estado de stock y precio llega para cada identificador pedido', async () => {
      const estados = await crear().consultarEstado([
        opciones.externalIdConocido,
        'id-que-no-existe-jamas-000',
      ]);

      // Uno por cada id, incluidos los que ya no existen: si se omitieran, la
      // sincronización no sabría que ese producto hay que retirarlo.
      expect(estados).toHaveLength(2);

      for (const estado of estados) {
        expect(typeof estado.disponible).toBe('boolean');
        expect(Number.isInteger(estado.costCents)).toBe(true);
        expect(typeof estado.descatalogado).toBe('boolean');
      }

      expect(
        estados.find((e) => e.externalId === 'id-que-no-existe-jamas-000')?.descatalogado,
      ).toBe(true);
    });
  }

  it('consultar un pedido inexistente devuelve null', async () => {
    expect(await crear().consultarPedido('pedido-inexistente-000')).toBeNull();
  });

  it('el seguimiento de un pedido inexistente devuelve null', async () => {
    expect(await crear().obtenerSeguimiento('pedido-inexistente-000')).toBeNull();
  });
}
