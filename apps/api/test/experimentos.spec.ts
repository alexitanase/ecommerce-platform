import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { ExperimentsService } from '../src/modules/experiments/experiments.service.js';
import { crearEntorno, vaciarBase, type EntornoPruebas } from './entorno.js';

/**
 * Pruebas A/B, de punta a punta.
 *
 * El reparto y la estadística están probados caso a caso en
 * `experimentos.spec.ts`. Lo que se comprueba aquí es lo que solo se ve con la
 * base de datos delante: que recargar la página veinte veces no cuente como
 * veinte personas —eso hincharía el denominador y ninguna prueba llegaría
 * nunca a ser concluyente— y que una venta se atribuya a la variante que esa
 * persona vio y no a otra.
 */

let entorno: EntornoPruebas;
let experimentos: ExperimentsService;

async function crearExperimento(estado = 'ACTIVO', key = 'cta-producto') {
  const id = newId();
  await entorno.prisma.client.experiment.create({
    data: {
      id,
      key,
      name: 'Texto del botón',
      status: estado,
      ...(estado === 'ACTIVO' ? { startedAt: new Date() } : {}),
      variants: [
        { clave: 'a', peso: 50, valor: 'Comprar ahora' },
        { clave: 'b', peso: 50, valor: 'Añadir al carrito' },
      ],
    },
  });
  return id;
}

beforeAll(async () => {
  entorno = await crearEntorno();
  experimentos = entorno.app.get(ExperimentsService);
});

afterAll(async () => {
  await entorno.app.close();
});

beforeEach(async () => {
  await vaciarBase(entorno);
});

describe('Qué ve quien navega', () => {
  it('recibe una variante con su valor', async () => {
    await crearExperimento();

    const asignadas = await experimentos.paraVisitante('visitante-uno');

    expect(asignadas).toHaveLength(1);
    expect(['a', 'b']).toContain(asignadas[0]?.variante);
    expect(asignadas[0]?.clave).toBe('cta-producto');
  });

  it('recargar veinte veces cuenta como una sola persona', async () => {
    // Es el fallo que arruina el experimento en silencio: si cada carga
    // contara, el denominador se hincharía y ninguna diferencia llegaría
    // nunca a ser significativa.
    const id = await crearExperimento();

    for (let i = 0; i < 20; i++) await experimentos.paraVisitante('visitante-uno');

    const anotadas = await entorno.prisma.client.experimentAssignment.count({
      where: { experimentId: id },
    });

    expect(anotadas).toBe(1);
  });

  it('la variante no cambia entre visitas', async () => {
    await crearExperimento();

    const primera = await experimentos.paraVisitante('visitante-uno');
    const segunda = await experimentos.paraVisitante('visitante-uno');

    expect(segunda[0]?.variante).toBe(primera[0]?.variante);
  });

  it('un experimento en borrador no se reparte', async () => {
    await crearExperimento('BORRADOR');

    expect(await experimentos.paraVisitante('visitante-uno')).toEqual([]);
  });

  it('un experimento parado tampoco', async () => {
    await crearExperimento('PARADO');

    expect(await experimentos.paraVisitante('visitante-uno')).toEqual([]);
  });
});

describe('Atribuir la venta', () => {
  it('la conversión va a la variante que esa persona vio', async () => {
    const id = await crearExperimento();

    const asignadas = await experimentos.paraVisitante('visitante-uno');
    const suya = asignadas[0]?.variante;

    await experimentos.registrarConversion('visitante-uno', 'pedido-1', 4999);

    const fila = await entorno.prisma.client.experimentAssignment.findFirstOrThrow({
      where: { experimentId: id, visitorId: 'visitante-uno' },
    });

    expect(fila.variant).toBe(suya);
    expect(fila.convertedAt).not.toBeNull();
    expect(fila.revenueCents).toBe(4999);
  });

  it('un segundo pedido no vuelve a contar como conversión', async () => {
    // Si contara, un cliente que repite inflaría la variante que le tocó y el
    // experimento acabaría midiendo la fidelidad en vez del cambio probado.
    const id = await crearExperimento();
    await experimentos.paraVisitante('visitante-uno');

    await experimentos.registrarConversion('visitante-uno', 'pedido-1', 4999);
    await experimentos.registrarConversion('visitante-uno', 'pedido-2', 9999);

    const fila = await entorno.prisma.client.experimentAssignment.findFirstOrThrow({
      where: { experimentId: id },
    });

    expect(fila.orderId).toBe('pedido-1');
    expect(fila.revenueCents).toBe(4999);
  });

  it('no se atribuye a un experimento ya parado', async () => {
    // Sumar una venta a una prueba cerrada mueve el resultado de algo que ya
    // se decidió.
    const id = await crearExperimento();
    await experimentos.paraVisitante('visitante-uno');

    await entorno.prisma.client.experiment.update({
      where: { id },
      data: { status: 'PARADO' },
    });
    await experimentos.registrarConversion('visitante-uno', 'pedido-1', 4999);

    const fila = await entorno.prisma.client.experimentAssignment.findFirstOrThrow({
      where: { experimentId: id },
    });

    expect(fila.convertedAt).toBeNull();
  });

  it('quien no vio ningún experimento no rompe nada al comprar', async () => {
    await expect(
      experimentos.registrarConversion('nadie', 'pedido-1', 4999),
    ).resolves.toBeUndefined();
  });
});

describe('Lo que se lee en el panel', () => {
  it('un experimento recién arrancado dice que faltan datos', async () => {
    const id = await crearExperimento();
    await experimentos.paraVisitante('visitante-uno');

    const resultado = await experimentos.conResultado(id);

    expect(resultado.lectura.ganadora).toBeNull();
    expect(resultado.lectura.motivo).toBe('DATOS_INSUFICIENTES');
    expect(resultado.lectura.visitasQueFaltan).toBeGreaterThan(0);
  });

  it('cuenta visitas y conversiones por variante', async () => {
    const id = await crearExperimento();

    for (let i = 0; i < 40; i++) await experimentos.paraVisitante(`visitante-${String(i)}`);
    for (let i = 0; i < 10; i++) {
      await experimentos.registrarConversion(`visitante-${String(i)}`, `pedido-${String(i)}`, 5000);
    }

    const resultado = await experimentos.conResultado(id);
    const total = resultado.lectura.variantes.reduce((s, v) => s + v.visitas, 0);
    const compras = resultado.lectura.variantes.reduce((s, v) => s + v.conversiones, 0);

    expect(total).toBe(40);
    expect(compras).toBe(10);
  });
});

describe('Lo que no deja hacer', () => {
  it('un experimento con una sola variante no se crea', async () => {
    await expect(
      experimentos.crear(
        {
          key: 'malo',
          name: 'Sin comparación',
          variantes: [{ clave: 'a', peso: 100, valor: 'x' }],
        },
        { actorId: 'sistema' },
      ),
    ).rejects.toThrow(/al menos dos/i);
  });

  it('dos variantes con la misma clave tampoco', async () => {
    await expect(
      experimentos.crear(
        {
          key: 'malo',
          name: 'Repetidas',
          variantes: [
            { clave: 'a', peso: 50, valor: 'x' },
            { clave: 'a', peso: 50, valor: 'y' },
          ],
        },
        { actorId: 'sistema' },
      ),
    ).rejects.toThrow(/misma clave/i);
  });

  it('un experimento arrancado no vuelve a borrador', async () => {
    // Sus cifras dejarían de ser comparables con las de después.
    const id = await crearExperimento();

    await expect(
      experimentos.cambiarEstado(id, 'BORRADOR', { actorId: 'sistema' }),
    ).rejects.toThrow(/borrador/i);
  });

  it('no se puede declarar ganadora una variante que no es suya', async () => {
    const id = await crearExperimento();

    await expect(experimentos.declararGanadora(id, 'z', { actorId: 'sistema' })).rejects.toThrow(
      /no es de este experimento/i,
    );
  });
});
