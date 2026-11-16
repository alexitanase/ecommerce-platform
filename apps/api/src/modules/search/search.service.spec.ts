import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El buscador es también el listado de la tienda.
 *
 * Por él pasan la búsqueda por texto, las páginas de categoría y todo lo que
 * lleve filtros, así que dos cosas se deciden aquí y en ningún otro sitio: que
 * lo agotado quede al final y que el filtro que llega en la URL se aplique de
 * verdad. Lo segundo no es teoría: el menú enlazaba con el slug de la
 * categoría, la API solo entendía el identificador, y entrar en una categoría
 * devolvía el catálogo entero.
 *
 * Se prueba contra un doble de Meilisearch en vez de contra el servidor real
 * porque lo que hay que verificar es QUÉ se le pide —el orden y los filtros—,
 * y eso se ve mejor leyendo la petición que el resultado.
 */

/** Lo último que se le pidió al índice, para poder mirarlo. */
const ultimaBusqueda: { termino?: string; opciones?: Record<string, unknown> } = {};
const ultimosAjustes: { valor?: Record<string, unknown> } = {};

/**
 * Cuántos documentos indexados vienen de una forma anterior, POR IDIOMA.
 *
 * Es lo único que decide si al arrancar se reconstruye el catálogo. Cero es la
 * tienda al día; también es lo que devuelve un índice vacío.
 */
let desactualizados = 0;

/** Los cerrojos que hay puestos ahora mismo en el Redis de mentira. */
const cerrojos = new Set<string>();

/** Cuántos lotes se han esperado antes de mandar el siguiente. */
let esperas = 0;

/**
 * Lo que hay guardado en el índice ahora mismo, por identificador.
 *
 * No se rellena solo al indexar: lo pone cada prueba. Lo que interesa comprobar
 * es qué pasa cuando el índice tiene documentos que la base ya no tiene, y eso
 * es precisamente un estado que no se alcanza indexando bien.
 */
let docsEnIndice: string[] = [];

/**
 * Productos que están vivos en la base pero no en la lista del reindexado.
 *
 * Es la carrera real: alguien publica un producto mientras el reindexado corre.
 * Ese producto se indexa por su cuenta, no aparece en la foto que tomó el
 * reindexado al empezar, y sin comprobarlo contra la base se borraría del índice
 * justo después de publicarse.
 */
let publicadosDespues: string[] = [];

/**
 * Lo que devuelve el cliente de Meilisearch al encolar algo.
 *
 * No es una promesa a secas: es una promesa con un `waitTask` encima, que es
 * cómo se espera a que el servidor termine la tarea. El doble tiene que
 * ofrecerlo o el código que aplica ese freno no se podría probar.
 */
const encolada = () => ({
  then: (resolver: () => void) => Promise.resolve().then(resolver),
  waitTask: () => {
    esperas += 1;
    return Promise.resolve();
  },
});

const indiceFalso = {
  addDocuments: vi.fn((_documentos: { id: string }[]) => encolada()),
  search: vi.fn((termino: string, opciones: Record<string, unknown>) => {
    // La consulta que cuenta lo desactualizado es una búsqueda más, pero no es
    // «la última búsqueda» de la que hablan las pruebas del listado.
    const filtro = typeof opciones['filter'] === 'string' ? opciones['filter'] : '';
    const esRecuentoDeEsquema = filtro.includes('esquema');
    if (!esRecuentoDeEsquema) {
      ultimaBusqueda.termino = termino;
      ultimaBusqueda.opciones = opciones;
    }

    return Promise.resolve({
      hits: [],
      estimatedTotalHits: 0,
      totalHits: esRecuentoDeEsquema ? desactualizados : 0,
      processingTimeMs: 1,
      facetDistribution: { categoryId: { cat1: 7, cat2: 3 } },
    });
  }),
  updateSettings: vi.fn((valor: Record<string, unknown>) => {
    ultimosAjustes.valor = valor;
    return Promise.resolve();
  }),
  updateSynonyms: vi.fn(() => Promise.resolve()),
  getDocuments: vi.fn(({ offset = 0, limit = 1000 }: { offset?: number; limit?: number }) =>
    Promise.resolve({
      results: docsEnIndice.slice(offset, offset + limit).map((id) => ({ id })),
      total: docsEnIndice.length,
    }),
  ),
  deleteDocuments: vi.fn((_ids: string[]) => encolada()),
  getStats: vi.fn(() => Promise.resolve({ numberOfDocuments: docsEnIndice.length })),
};

vi.mock('meilisearch', () => ({
  // Una clase y no una función flecha: el servicio lo construye con `new`.
  Meilisearch: class {
    index() {
      return indiceFalso;
    }
    createIndex() {
      return encolada();
    }
    // Los tres índices ya existen: es el caso de una tienda en marcha.
    getRawIndexes() {
      return Promise.resolve({
        results: ['productos_es', 'productos_ca', 'productos_en'].map((uid) => ({ uid })),
      });
    }
  },
}));

const { SearchService } = await import('./search.service.js');

/**
 * Las categorías que hay en la base, con su slug traducido y su foto.
 *
 * Las dos fotos son distintas a propósito: «Vibradores» tiene la que subió el
 * panel y «Lubricantes» solo la que se calcula sola del catálogo. Es lo que
 * permite comprobar cuál de las dos manda cuando están las dos.
 */
const CATEGORIAS = [
  {
    categoryId: 'cat1',
    name: 'Vibradores',
    slug: 'vibradores',
    handle: 'vibradores',
    category: { imageUrl: '/subida-a-mano.jpg', coverUrl: '/calculada.jpg' },
  },
  {
    categoryId: 'cat2',
    name: 'Lubricantes',
    slug: 'lubricantes',
    handle: 'lubricantes',
    category: { imageUrl: null, coverUrl: '/de-un-producto.jpg' },
  },
];

/** La categoría tal y como la lee el servicio, con sus traducciones dentro. */
const comoCategoria = (fila: (typeof CATEGORIAS)[number]) => ({
  id: fila.categoryId,
  handle: fila.handle,
  translations: [{ locale: 'es', name: fila.name, slug: fila.slug }],
});

/**
 * Los ids del catálogo de la prueba que toque. Vacío salvo que se llene.
 *
 * Así las pruebas que solo miran si se ha llegado a reindexar no pagan el
 * trabajo de reindexar nada.
 */
let catalogo: string[] = [];

/** Un producto con lo justo para que se le pueda armar el documento. */
const productoIndexable = (id: string) => ({
  id,
  handle: id,
  status: 'ACTIVE',
  deletedAt: null,
  isAdult: false,
  categoryId: 'cat1',
  publishedAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  translations: [
    { locale: 'es', name: `Producto ${id}`, slug: id, shortDescription: null, description: null },
  ],
  brand: null,
  category: null,
  media: [],
  variants: [{ priceCents: 1000, compareAtCents: null, stock: 5, currency: 'EUR' }],
  attributes: [],
  reviews: [],
});

interface DondeCategoria {
  id?: string;
  handle?: string;
  translations?: { some: { slug?: string } };
  OR?: { handle?: string; translations?: { some: { slug?: string } } }[];
}

function crearServicio() {
  const prisma = {
    client: {
      product: {
        /*
         * Tres consultas distintas con el mismo nombre:
         *
         *  · con `include`, el lote con todas sus relaciones para armar documentos;
         *  · con `where.id.in`, la comprobación de qué sigue vivo antes de borrar
         *    del índice —a la que un producto publicado a mitad también contesta—;
         *  · sin nada, la foto del catálogo con la que empieza el reindexado.
         */
        findMany: vi.fn((args: { include?: unknown; where?: { id?: { in: string[] } } }) => {
          const pedidos = args.where?.id?.in;
          if (args.include) return Promise.resolve((pedidos ?? []).map(productoIndexable));

          if (pedidos) {
            const vivos = new Set([...catalogo, ...publicadosDespues]);
            return Promise.resolve(pedidos.filter((id) => vivos.has(id)).map((id) => ({ id })));
          }

          return Promise.resolve(catalogo.map((id) => ({ id })));
        }),
        // Cuántos productos hay que indexar: es lo que distingue un índice vacío
        // porque se ha perdido de uno vacío porque la tienda aún no tiene nada.
        count: vi.fn(() => Promise.resolve(catalogo.length)),
      },
      category: {
        findFirst: vi.fn(({ where }: { where: DondeCategoria }) => {
          const porSlug = (slug?: string) => CATEGORIAS.find((c) => c.slug === slug);
          const porHandle = (handle?: string) => CATEGORIAS.find((c) => c.handle === handle);

          const fila =
            (where.id ? CATEGORIAS.find((c) => c.categoryId === where.id) : undefined) ??
            porSlug(where.translations?.some.slug) ??
            where.OR?.map((o) => porHandle(o.handle) ?? porSlug(o.translations?.some.slug)).find(
              Boolean,
            );

          return Promise.resolve(fila ? comoCategoria(fila) : null);
        }),
      },
      categoryTranslation: {
        findMany: vi.fn(() => Promise.resolve(CATEGORIAS)),
      },
    },
  };

  const integraciones = {
    configuracion: vi.fn(() =>
      Promise.resolve({
        key: 'meilisearch',
        activa: true,
        operativa: true,
        credenciales: { masterKey: 'clave' },
        ajustes: { host: 'http://localhost:7700' },
        faltan: [],
      }),
    ),
  };

  /*
   * Redis de mentira, pero con el cerrojo de verdad.
   *
   * `SET NX` devuelve 'OK' la primera vez y `null` mientras siga puesto: es
   * justo la semántica de la que depende que no haya dos reconstrucciones a la
   * vez, así que el doble tiene que respetarla o la prueba no valdría nada.
   */
  const redis = {
    client: {
      set: vi.fn((clave: string, _valor: string, ..._resto: unknown[]) => {
        if (cerrojos.has(clave)) return Promise.resolve(null);
        cerrojos.add(clave);
        return Promise.resolve('OK');
      }),
      del: vi.fn((clave: string) => {
        cerrojos.delete(clave);
        return Promise.resolve(1);
      }),
    },
  };

  const servicio = new SearchService(prisma as never, integraciones as never, redis as never);

  return { servicio, prisma, redis };
}

beforeEach(() => {
  delete ultimaBusqueda.opciones;
  delete ultimaBusqueda.termino;
  catalogo = [];
  docsEnIndice = [];
  publicadosDespues = [];
  esperas = 0;
  desactualizados = 0;
  cerrojos.clear();
  indiceFalso.addDocuments.mockClear();
  indiceFalso.deleteDocuments.mockClear();
});

describe('orden del listado', () => {
  it('pide siempre lo disponible primero', async () => {
    await crearServicio().servicio.buscar({ q: '', locale: 'es' });

    // Sin esto, un listado de categoría empieza por los productos que el
    // proveedor ha dejado sin stock, que son los que nadie puede comprar.
    expect(ultimaBusqueda.opciones?.['sort']).toEqual(['ordenDisponible:desc']);
  });

  it('el orden que elige el cliente ordena DENTRO de lo disponible', async () => {
    await crearServicio().servicio.buscar({ q: '', locale: 'es', orden: 'precio_asc' });

    // Primero lo barato y comprable; después lo barato y agotado. Al revés
    // —precio a secas— la primera pantalla se llenaba de productos sin stock,
    // que suelen ser los más baratos porque son los que se han vendido.
    expect(ultimaBusqueda.opciones?.['sort']).toEqual(['ordenDisponible:desc', 'priceCents:asc']);
  });

  it('«relevancia» no es «sin orden»: sigue mandando la disponibilidad', async () => {
    await crearServicio().servicio.buscar({ q: 'vibrador', locale: 'es', orden: 'relevancia' });

    expect(ultimaBusqueda.opciones?.['sort']).toEqual(['ordenDisponible:desc']);
  });

  it('la regla `sort` va la primera del ranking, que es lo que hace que mande', async () => {
    const { servicio } = crearServicio();
    await servicio.configurarIndices();

    // Con `sort` en su posición de fábrica —la quinta— la relevancia del texto
    // decide antes, y un agotado que casa mejor con lo buscado sale por
    // delante de uno disponible.
    expect((ultimosAjustes.valor?.['rankingRules'] as string[])[0]).toBe('sort');
    expect(ultimosAjustes.valor?.['sortableAttributes']).toContain('ordenDisponible');
  });

  it('reconstruye cuando lo indexado viene de una forma anterior', async () => {
    // Cambiar los ajustes del índice no reescribe los documentos ya guardados:
    // a los que les falta el campo por el que se ordena, Meilisearch los manda
    // al final, y por el que se filtra —`enOferta`— no los encuentra, así que la
    // página de ofertas sale vacía sin dar ningún error. Por eso se detecta y se
    // rehace solo, en vez de depender de que alguien se acuerde tras desplegar.
    desactualizados = 7;

    const { servicio } = crearServicio();
    // Se mira que se DECIDA reconstruir, no que se haya llegado a consultar la
    // base: la reconstrucción se lanza por detrás a propósito, y afirmar sobre
    // lo que haya hecho ya es una prueba que pasa o falla según el reloj.
    const reconstruir = vi.spyOn(servicio, 'reindexarTodo');

    await servicio.configurarIndices();

    expect(reconstruir).toHaveBeenCalled();
  });

  it('lo cuenta con un filtro exacto, no con una muestra de documentos', async () => {
    /*
     * Por qué se cuenta en vez de mirar unos cuantos documentos.
     *
     * Se probó mirando una muestra y no valía: una reconstrucción que se había
     * quedado a medias tenía los primeros documentos ya reescritos, la muestra
     * salía limpia, y el resto del catálogo se quedaba sin migrar para siempre.
     * Pasó en producción. Preguntando «cuántos quedan» la respuesta es exacta.
     */
    desactualizados = 1;

    const { servicio } = crearServicio();
    await servicio.configurarIndices();

    const recuento = indiceFalso.search.mock.calls
      .map(([, opciones]) => (typeof opciones['filter'] === 'string' ? opciones['filter'] : ''))
      .find((filtro) => filtro.includes('esquema'));

    expect(recuento).toBe('esquema NOT EXISTS OR esquema < 1');
  });

  it('no reconstruye nada cuando el índice ya está al día', async () => {
    // Arrancar la API no puede significar reindexar el catálogo entero cada
    // vez: con miles de productos sería media hora de trabajo por despliegue.
    desactualizados = 0;
    catalogo = ['p1'];
    docsEnIndice = ['p1'];

    const { servicio } = crearServicio();
    const reconstruir = vi.spyOn(servicio, 'reindexarTodo');

    await servicio.configurarIndices();

    expect(reconstruir).not.toHaveBeenCalled();
  });

  it('reconstruye si el buscador está vacío y hay catálogo que indexar', async () => {
    /*
     * El agujero que esto tapa no daba ningún error, y por eso era el peor.
     *
     * Si se pierde el volumen del buscador —o se estrena uno—, cero documentos
     * con esquema viejo son cero pendientes, así que se daba por bueno y la
     * tienda se quedaba con el catálogo VACÍO hasta que alguien se acordara de
     * lanzar `POST /search/reindex` a mano. Sin excepción, sin aviso: solo una
     * tienda sin productos que parece que no vende nada.
     */
    desactualizados = 0;
    docsEnIndice = [];
    catalogo = ['p1', 'p2'];

    const { servicio } = crearServicio();
    const reconstruir = vi.spyOn(servicio, 'reindexarTodo');

    await servicio.configurarIndices();

    expect(reconstruir).toHaveBeenCalled();
  });

  it('un buscador vacío sin catálogo detrás no reconstruye nada', async () => {
    // Es la tienda recién instalada, y es un estado normal. Sin esta distinción,
    // cada arranque lanzaría un reindexado para no escribir ni un documento.
    desactualizados = 0;
    docsEnIndice = [];
    catalogo = [];

    const { servicio } = crearServicio();
    const reconstruir = vi.spyOn(servicio, 'reindexarTodo');

    await servicio.configurarIndices();

    expect(reconstruir).not.toHaveBeenCalled();
  });

  it('solo reconstruye un proceso, aunque arranquen varios a la vez', async () => {
    /*
     * Este servicio se carga en la API y en los workers, y un despliegue
     * convive con dos réplicas de la API. Sin cerrojo, un arranque lanza tres
     * reconstrucciones simultáneas del catálogo entero contra el mismo
     * buscador: es multiplicar por tres justo la carga que ya lo tumbó una vez.
     */
    desactualizados = 7;

    const primero = crearServicio();
    const segundo = crearServicio();
    // La del primero no termina nunca: es lo que hace que los dos se solapen de
    // verdad. Dejándola acabar, el cerrojo se suelta —que es lo correcto— y el
    // segundo entraría con razón, sin haber probado nada.
    const reconstruyeElPrimero = vi
      .spyOn(primero.servicio, 'reindexarTodo')
      .mockImplementation(() => new Promise(() => undefined));
    const reconstruyeElSegundo = vi.spyOn(segundo.servicio, 'reindexarTodo');

    await primero.servicio.configurarIndices();
    await segundo.servicio.configurarIndices();

    expect(reconstruyeElPrimero).toHaveBeenCalled();
    expect(reconstruyeElSegundo).not.toHaveBeenCalled();
  });
});

describe('reindexado del catálogo', () => {
  /*
   * Esto tumbó el buscador en producción.
   *
   * El reindexado reutilizaba el camino de «un producto ha cambiado», así que
   * mandaba un documento por petición: 11.500 productos por tres idiomas son
   * unas 35.000, encoladas tan rápido como las aceptara el servidor. Cada una
   * es una tarea que Meilisearch guarda para procesar luego, la cola creció con
   * ellas, y el contenedor —con su límite de memoria— murió a mitad. Sin panic
   * ni línea de registro: solo un buscador que se reiniciaba y una página de
   * ofertas vacía.
   *
   * Se prueba contando envíos porque es justo lo que se rompió, y porque es la
   * clase de regresión que nadie ve venir: reutilizar `indexarProducto` en el
   * bucle vuelve a leerse como el código más limpio.
   */
  it('manda lotes, no un documento por petición', async () => {
    catalogo = Array.from({ length: 250 }, (_, i) => `p${i}`);

    const { servicio } = crearServicio();
    const { indexados } = await servicio.reindexarTodo();

    expect(indexados).toBe(250);

    // 250 productos × 3 idiomas = 750 documentos. En lotes de 200 productos son
    // dos lotes, y un envío por idioma en cada uno: seis peticiones.
    expect(indiceFalso.addDocuments).toHaveBeenCalledTimes(6);

    const enviados = indiceFalso.addDocuments.mock.calls.reduce((n, [docs]) => n + docs.length, 0);
    expect(enviados).toBe(750);
  });

  it('espera a que el servidor termine cada lote antes de mandar el siguiente', async () => {
    // Sin este freno da igual mandar por lotes: se le pueden encolar los seis
    // de golpe y volvemos a dejar que la cola crezca sin que nadie la mire.
    catalogo = Array.from({ length: 250 }, (_, i) => `p${i}`);

    await crearServicio().servicio.reindexarTodo();

    expect(esperas).toBe(6);
  });

  it('sin buscador configurado no reindexa nada, y no revienta', async () => {
    catalogo = ['p1'];

    const { servicio } = crearServicio();
    // La integración apagada es el estado de una tienda recién instalada.
    (servicio as unknown as { cliente: () => Promise<null> }).cliente = () => Promise.resolve(null);

    expect(await servicio.reindexarTodo()).toEqual({ indexados: 0, retirados: 0 });
    expect(indiceFalso.addDocuments).not.toHaveBeenCalled();
  });

  it('retira del índice los documentos que ya no tienen producto detrás', async () => {
    /*
     * Esto se veía desde la tienda, y es lo que motivó el arreglo.
     *
     * `addDocuments` solo añade y pisa, así que un producto borrado o creado por
     * una prueba se quedaba indexado para siempre: el listado lo enseñaba y al
     * pulsarlo salía un 404. En el entorno de desarrollo llegó a haber once
     * productos en el listado de los que nueve no existían.
     */
    catalogo = ['p1'];
    docsEnIndice = ['p1', 'fantasma-de-una-prueba'];

    const { servicio } = crearServicio();
    const { retirados } = await servicio.reindexarTodo();

    // Uno por idioma: el fantasma estaba en los tres índices.
    expect(retirados).toBe(3);
    expect(indiceFalso.deleteDocuments).toHaveBeenCalledWith(['fantasma-de-una-prueba']);
  });

  it('no borra un producto que se ha publicado mientras reindexaba', async () => {
    /*
     * El reindexado empieza tomando la foto del catálogo y tarda minutos. Un
     * producto publicado a mitad se indexa por su cuenta y no está en esa foto:
     * borrar por diferencia a secas lo quitaría del buscador justo después de
     * publicarlo, y nadie relacionaría las dos cosas.
     */
    catalogo = ['p1'];
    docsEnIndice = ['p1', 'recien-publicado'];
    publicadosDespues = ['recien-publicado'];

    const { servicio } = crearServicio();
    const { retirados } = await servicio.reindexarTodo();

    expect(retirados).toBe(0);
    expect(indiceFalso.deleteDocuments).not.toHaveBeenCalled();
  });

  it('con el índice al día no se borra nada', async () => {
    // Un borrado de más en el buscador es una venta menos, así que conviene
    // fijar que el caso normal no toca nada.
    catalogo = ['p1', 'p2'];
    docsEnIndice = ['p1', 'p2'];

    const { servicio } = crearServicio();
    const { retirados } = await servicio.reindexarTodo();

    expect(retirados).toBe(0);
    expect(indiceFalso.deleteDocuments).not.toHaveBeenCalled();
  });
});

describe('filtros del listado', () => {
  it('la categoría llega por slug y filtra por su rama entera', async () => {
    const resultado = await crearServicio().servicio.buscar({
      q: '',
      locale: 'es',
      categoria: 'vibradores',
      incluirAdulto: true,
    });

    // Por ruta y no por identificador: cada producto cuelga de su rama más
    // concreta, así que filtrar por el id exacto de una categoría con hijas
    // devuelve cero y la sección parece vacía.
    expect(ultimaBusqueda.opciones?.['filter']).toContain('categoryPath = "vibradores"');
    expect(resultado.categoria).toEqual({
      id: 'cat1',
      handle: 'vibradores',
      nombre: 'Vibradores',
      slug: 'vibradores',
    });
  });

  it('una categoría que no existe no filtra nada en vez de dejar la tienda vacía', async () => {
    await crearServicio().servicio.buscar({ q: '', locale: 'es', categoria: 'no-existe' });

    expect(ultimaBusqueda.opciones?.['filter']).not.toContain('categoryPath');
  });

  it('mantiene los filtros que ya había', async () => {
    await crearServicio().servicio.buscar({
      q: '',
      locale: 'es',
      marca: 'SATISFYER',
      precioMin: 1000,
      precioMax: 5000,
      soloDisponibles: true,
      categoryId: 'cat1',
      incluirAdulto: true,
    });

    const filtro = String(ultimaBusqueda.opciones?.['filter']);
    expect(filtro).toContain('brand = "SATISFYER"');
    expect(filtro).toContain('priceCents >= 1000');
    expect(filtro).toContain('priceCents <= 5000');
    expect(filtro).toContain('disponible = true');
  });

  it('por identificador filtra la rama igual que por slug', async () => {
    // Las dos formas de entrar en la misma categoría tienen que enseñar lo
    // mismo. `categoryId` filtraba de forma EXACTA, así que una categoría con
    // hijas —donde cuelgan todos los productos— salía vacía por un camino y
    // llena por el otro.
    await crearServicio().servicio.buscar({
      q: '',
      locale: 'es',
      categoryId: 'cat1',
      incluirAdulto: true,
    });

    const filtro = String(ultimaBusqueda.opciones?.['filter']);
    expect(filtro).toContain('categoryPath = "vibradores"');
    expect(filtro).not.toContain('categoryId =');
  });

  it('el catálogo +18 sigue fuera para quien no ha verificado la edad', async () => {
    await crearServicio().servicio.buscar({ q: '', locale: 'es' });

    expect(String(ultimaBusqueda.opciones?.['filter'])).toContain('isAdult = false');
  });

  it('una comilla en la marca no rompe la consulta', async () => {
    await crearServicio().servicio.buscar({
      q: '',
      locale: 'es',
      marca: 'D"Angelo',
      incluirAdulto: true,
    });

    // Sin escapar, la comilla cierra la cadena del filtro y Meilisearch
    // responde con un error de sintaxis: una búsqueda que devuelve 500 en
    // lugar de «no hay resultados».
    expect(String(ultimaBusqueda.opciones?.['filter'])).toContain('brand = "D\\"Angelo"');
  });

  it('devuelve las categorías con nombre y slug para poder enlazarlas', async () => {
    const resultado = await crearServicio().servicio.buscar({ q: '', locale: 'es' });

    // La barra de filtros enlaza por slug, igual que el menú. Enviando el
    // nombre visible —que es lo que hacía— la API no lo entendía y pulsar una
    // categoría cambiaba la URL sin filtrar nada.
    expect(resultado.categorias).toEqual([
      // La foto del panel gana a la calculada; sin foto del panel, vale la
      // calculada. Es lo que permite que los filtros salgan con miniatura sin
      // que nadie suba una imagen por cada categoría del proveedor.
      {
        id: 'cat1',
        slug: 'vibradores',
        nombre: 'Vibradores',
        imagen: '/subida-a-mano.jpg',
        total: 7,
      },
      {
        id: 'cat2',
        slug: 'lubricantes',
        nombre: 'Lubricantes',
        imagen: '/de-un-producto.jpg',
        total: 3,
      },
    ]);
  });
});
