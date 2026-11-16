import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import { crearEntorno, vaciarBase, type EntornoPruebas, type ErrorApi } from './entorno.js';

/**
 * Idiomas y divisas gobernados desde el panel.
 *
 * Lo que hay que cubrir no es que el ajuste se guarde —eso ya lo hacía— sino que
 * **no se pueda dejar la tienda en un estado que no se puede servir**. Los tres
 * ajustes estaban en la base de datos desde la semilla y nadie los validaba ni
 * los leía: se podían desmarcar los tres idiomas, o dejar como idioma por
 * defecto uno desactivado, y entonces la raíz de la tienda redirige a un idioma
 * que se ha decidido no servir. Eso no da un error en ninguna parte: da una
 * tienda que no abre.
 */

let entorno: EntornoPruebas;

interface Divisas {
  activas: string[];
  porDefecto: string;
  tasas: Record<string, number>;
}

/** Deja los ajustes de idioma y divisa en un punto de partida conocido. */
async function sembrarAjustes(valores: {
  supportedLocales?: unknown;
  defaultLocale?: unknown;
  currencies?: unknown;
  defaultCurrency?: unknown;
}) {
  for (const [key, value] of Object.entries(valores)) {
    await entorno.prisma.client.setting.upsert({
      where: { namespace_key: { namespace: 'shop', key } },
      update: { value: value as never },
      create: { id: newId(), namespace: 'shop', key, value: value as never, isPublic: true },
    });
  }
  // Los ajustes públicos se cachean: sin vaciar, se leería el estado anterior.
  await entorno.redis.client.del('ajustes:publicos');
}

const guardar = <T>(cambios: { key: string; value: unknown }[], token: string) =>
  entorno.peticion<T>({
    metodo: 'PATCH',
    ruta: '/api/v1/settings',
    token,
    cuerpo: { cambios: cambios.map((c) => ({ namespace: 'shop', ...c })) },
  });

beforeAll(async () => {
  entorno = await crearEntorno();
}, 60_000);

afterAll(async () => {
  await entorno.app.close();
});

beforeEach(async () => {
  await vaciarBase(entorno);
  await sembrarAjustes({
    supportedLocales: ['es', 'ca', 'en'],
    defaultLocale: 'es',
    currencies: ['EUR'],
    defaultCurrency: 'EUR',
  });
});

describe('Activar idiomas desde el panel', () => {
  it('se puede reducir la lista y elegir otro por defecto a la vez', async () => {
    const admin = await entorno.personal(['settings:write']);

    const r = await guardar(
      [
        { key: 'supportedLocales', value: ['en', 'ca'] },
        { key: 'defaultLocale', value: 'en' },
      ],
      admin.token,
    );

    expect(r.estado).toBe(200);
  });

  it('no deja quedarse sin ningún idioma', async () => {
    const admin = await entorno.personal(['settings:write']);

    const r = await guardar<ErrorApi>([{ key: 'supportedLocales', value: [] }], admin.token);

    expect(r.estado).toBe(400);
    expect(r.datos.message).toContain('al menos un idioma');
  });

  it('rechaza un idioma que no existe en la plataforma', async () => {
    // Activar «de» sin ficheros de traducción daría una tienda en blanco.
    const admin = await entorno.personal(['settings:write']);

    const r = await guardar<ErrorApi>(
      [{ key: 'supportedLocales', value: ['es', 'de'] }],
      admin.token,
    );

    expect(r.estado).toBe(400);
    expect(r.datos.message).toContain('de');
  });

  it('no deja desactivar el idioma que está puesto por defecto', async () => {
    /*
     * El caso que deja la tienda sin abrir: `defaultLocale` sigue siendo «es» y
     * se desactiva el español. La raíz redirige a un idioma que ya no se sirve.
     * La validación es cruzada, así que tiene que mirar lo GUARDADO y no solo lo
     * que llega en la petición.
     */
    const admin = await entorno.personal(['settings:write']);

    const r = await guardar<ErrorApi>(
      [{ key: 'supportedLocales', value: ['en', 'ca'] }],
      admin.token,
    );

    expect(r.estado).toBe(400);
    expect(r.datos.message).toContain('por defecto');
  });

  it('no deja poner por defecto uno que no está activo', async () => {
    const admin = await entorno.personal(['settings:write']);

    const r = await guardar<ErrorApi>([{ key: 'defaultLocale', value: 'de' }], admin.token);

    expect(r.estado).toBe(400);
  });

  it('un cambio que no toca idiomas ni divisas no pasa por la validación', async () => {
    // Si la validación se disparara siempre, cualquier ajuste de marca fallaría
    // en una tienda cuyos idiomas estuvieran mal desde antes.
    const admin = await entorno.personal(['settings:write']);
    await sembrarAjustes({ defaultLocale: 'de' });

    const r = await entorno.peticion({
      metodo: 'PATCH',
      ruta: '/api/v1/settings',
      token: admin.token,
      cuerpo: { cambios: [{ namespace: 'brand', key: 'name', value: 'Otra tienda' }] },
    });

    expect(r.estado).toBe(200);
  });
});

/**
 * Deja en la caché lo que «publica» el proveedor de tipo de cambio.
 *
 * Escribir directamente en Redis es lo que hace la propia descarga cuando le
 * responde el servicio, así que a partir de ahí el sistema se comporta igual que
 * con un proveedor de verdad, sin salir a internet en una prueba.
 */
const publicarTasas = (tasas: Record<string, number>) =>
  entorno.redis.client.set('divisas:tasas', JSON.stringify(tasas), 'EX', 3600);

describe('Activar divisas desde el panel', () => {
  it('acepta una divisa que el proveedor publica', async () => {
    const admin = await entorno.personal(['settings:write']);
    await publicarTasas({ GBP: 0.857, USD: 1.09 });

    const r = await guardar([{ key: 'currencies', value: ['EUR', 'GBP'] }], admin.token);

    expect(r.estado).toBe(200);
  });

  it('rechaza lo que no tiene forma de divisa', async () => {
    // Esto se puede saber sin hablar con nadie: un código ISO 4217 son tres
    // letras. No depende de que haya proveedor configurado.
    const admin = await entorno.personal(['settings:write']);

    const r = await guardar<ErrorApi>(
      [{ key: 'currencies', value: ['EUR', 'EUROS'] }],
      admin.token,
    );

    expect(r.estado).toBe(400);
    expect(r.datos.message).toContain('EUROS');
  });

  it('rechaza una divisa bien escrita de la que el proveedor no da tasa', async () => {
    /*
     * `LMN` no existe, pero eso aquí no se sabe: lo que se sabe es que no hay
     * tasa para convertirla, y sin tasa la divisa saldría en el selector sin
     * cambiar ningún precio. Se para al guardar, que es donde se puede explicar.
     */
    const admin = await entorno.personal(['settings:write']);
    await publicarTasas({ GBP: 0.857 });

    const r = await guardar<ErrorApi>([{ key: 'currencies', value: ['EUR', 'LMN'] }], admin.token);

    expect(r.estado).toBe(400);
    expect(r.datos.message).toContain('LMN');
  });

  it('sin proveedor configurado no se valida la disponibilidad', async () => {
    /*
     * No saber qué divisas hay no es lo mismo que saber que no hay ninguna. Si
     * esto rechazara, el proveedor caído convertiría cualquier cambio de ajustes
     * en un error que quien lo guarda no puede arreglar.
     */
    const admin = await entorno.personal(['settings:write']);

    const r = await guardar([{ key: 'currencies', value: ['EUR', 'GBP'] }], admin.token);

    expect(r.estado).toBe(200);
  });

  it('no deja poner por defecto una divisa que no está activa', async () => {
    const admin = await entorno.personal(['settings:write']);

    const r = await guardar<ErrorApi>([{ key: 'defaultCurrency', value: 'GBP' }], admin.token);

    expect(r.estado).toBe(400);
  });

  it('quitar el euro de la lista no rompe nada: siempre está', async () => {
    // Es la divisa en la que se cobra, así que se reinserta en vez de fallar.
    const admin = await entorno.personal(['settings:write']);
    await publicarTasas({ GBP: 0.857 });

    const r = await guardar([{ key: 'currencies', value: ['GBP'] }], admin.token);

    expect(r.estado).toBe(200);
  });
});

describe('Qué divisas ofrece el panel para elegir', () => {
  it('las que publica el proveedor, con el euro siempre delante', async () => {
    const admin = await entorno.personal(['settings:write']);
    await publicarTasas({ GBP: 0.857, USD: 1.09 });

    const r = await entorno.peticion<{ divisas: string[] }>({
      metodo: 'GET',
      ruta: '/api/v1/settings/divisas-disponibles',
      token: admin.token,
    });

    expect(r.estado).toBe(200);
    expect(r.datos.divisas).toEqual(['EUR', 'GBP', 'USD']);
  });

  it('descarta las tasas que no sirven', async () => {
    // Una tasa de cero daría precios de 0,00 en la tienda.
    const admin = await entorno.personal(['settings:write']);
    await publicarTasas({ GBP: 0, USD: 1.09 });

    const r = await entorno.peticion<{ divisas: string[] }>({
      metodo: 'GET',
      ruta: '/api/v1/settings/divisas-disponibles',
      token: admin.token,
    });

    expect(r.datos.divisas).toEqual(['EUR', 'USD']);
  });

  it('sin proveedor configurado, la lista viene vacía', async () => {
    // Vacío significa «no hay nada que elegir», y el panel lo explica en vez de
    // enseñar una lista de casillas que no harían nada.
    const admin = await entorno.personal(['settings:write']);

    const r = await entorno.peticion<{ divisas: string[] }>({
      metodo: 'GET',
      ruta: '/api/v1/settings/divisas-disponibles',
      token: admin.token,
    });

    expect(r.estado).toBe(200);
    expect(r.datos.divisas).toEqual([]);
  });

  it('no lo puede consultar quien no administra ajustes', async () => {
    const cualquiera = await entorno.personal([]);

    const r = await entorno.peticion({
      metodo: 'GET',
      ruta: '/api/v1/settings/divisas-disponibles',
      token: cualquiera.token,
    });

    expect(r.estado).toBe(403);
  });
});

describe('Lo que recibe la tienda', () => {
  it('sin proveedor de tipo de cambio, solo euros', async () => {
    /*
     * Es el estado de salida y tiene que ser tranquilo: sin integración activa
     * no hay tasas, así que aunque haya divisas activadas no se ofrece ninguna.
     * Una divisa en el selector que al elegirla no cambia el precio se lee como
     * que la tienda está rota.
     */
    await sembrarAjustes({ currencies: ['EUR', 'GBP'], defaultCurrency: 'EUR' });

    const r = await entorno.peticion<Divisas>({
      metodo: 'GET',
      ruta: '/api/v1/settings/public/divisas',
    });

    expect(r.estado).toBe(200);
    expect(r.datos.activas).toEqual(['EUR']);
    expect(r.datos.porDefecto).toBe('EUR');
    expect(r.datos.tasas).toEqual({});
  });

  it('no hace falta autenticación: lo pide la tienda en cada página', async () => {
    const r = await entorno.peticion<Divisas>({
      metodo: 'GET',
      ruta: '/api/v1/settings/public/divisas',
    });

    expect(r.estado).toBe(200);
  });
});
