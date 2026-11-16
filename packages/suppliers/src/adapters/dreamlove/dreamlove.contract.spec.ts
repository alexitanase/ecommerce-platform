import { describe, expect, it } from 'vitest';
import { verificarContratoDeAdaptador } from '../../core/contrato.js';
import { ErrorProveedor } from '../../core/types.js';
import { CatalogoDreamloveEnMemoria } from './catalogo-en-memoria.js';
import { DreamloveAdapter } from './dreamlove.adapter.js';
import type { ArticuloDreamlove } from './tipos.js';

/** Artículo con lo mínimo relleno; cada prueba cambia lo que le interesa. */
function articulo(parcial: Partial<ArticuloDreamlove> & { externalId: string }): ArticuloDreamlove {
  return {
    codigo: `D-${parcial.externalId}`,
    grupoId: null,
    claveGrupo: parcial.externalId,
    titulo: `ARTÍCULO ${parcial.externalId}`,
    tituloGrupo: null,
    descripcion: 'Descripción corta',
    descripcionHtml: '<p>Descripción larga</p>',
    marca: 'DREAMLOVE',
    marcaJerarquia: 'DREAMLOVE',
    marcaRaiz: 'DREAMLOVE',
    costeCents: 1000,
    pvpRecomendadoCents: 2999,
    ivaPct: 21,
    moneda: 'EUR',
    portesPedidoCents: 1866,
    stock: 10,
    disponible: true,
    imagenes: [`https://store.dreamlove.es/${parcial.externalId}.jpg`],
    categoria: ['LOVETOYS'],
    categoriaEs: 'Juguetes Sexuales XXX',
    categorias: [{ ruta: ['LOVETOYS'], nombreEs: 'Juguetes Sexuales XXX' }],
    eans: [`840000000${parcial.externalId}`],
    pesoGramos: 300,
    medidasMm: { ancho: 10, alto: 20, fondo: 30 },
    opciones: {},
    minUnidades: 1,
    maxUnidades: 99,
    plazoDias: { min: 2, max: 3 },
    urlProveedor: 'https://store.dreamlove.es/algo',
    codigoArancelario: '39269097',
    enOferta: false,
    esNovedad: false,
    liquidacion: false,
    refrigerado: false,
    actualizadoEn: new Date('2026-07-30T14:09:35Z'),
    ...parcial,
  };
}

/** Una familia de tres colores como las que manda Dreamlove de verdad. */
const FAMILIA = [
  articulo({
    externalId: '46116',
    codigo: 'D-237594',
    grupoId: '0000046116',
    claveGrupo: '0000046116',
    titulo: 'SATISFYER - DOUBLE BALL-R DILDO SILICONA GRANATE',
    tituloGrupo: 'SATISFYER - DOUBLE BALL-R',
    opciones: { Color: 'GRANATE' },
    costeCents: 1067,
    stock: 0,
    disponible: false,
    imagenes: [
      'https://store.dreamlove.es/granate-1.jpg',
      'https://store.dreamlove.es/detalle.jpg',
    ],
  }),
  articulo({
    externalId: '46117',
    codigo: 'D-237595',
    grupoId: '0000046116',
    claveGrupo: '0000046116',
    titulo: 'SATISFYER - DOUBLE BALL-R DILDO SILICONA AZUL',
    tituloGrupo: 'SATISFYER - DOUBLE BALL-R',
    opciones: { Color: 'AZUL' },
    costeCents: 1067,
    stock: 7,
    imagenes: ['https://store.dreamlove.es/azul-1.jpg', 'https://store.dreamlove.es/detalle.jpg'],
  }),
  articulo({
    externalId: '46118',
    codigo: 'D-237596',
    grupoId: '0000046116',
    claveGrupo: '0000046116',
    titulo: 'SATISFYER - DOUBLE BALL-R DILDO SILICONA NEGRO',
    tituloGrupo: 'SATISFYER - DOUBLE BALL-R',
    opciones: { Color: 'NEGRO' },
    costeCents: 990,
    stock: 40,
    imagenes: ['https://store.dreamlove.es/negro-1.jpg'],
  }),
];

const SUELTO = articulo({
  externalId: '5856',
  codigo: 'D-196690',
  titulo: 'BATHMATE - HYDRO 7 HÉRCULES TRANSPARENTE',
  costeCents: 3314,
  ivaPct: 4,
  eans: ['5060140209928'],
});

const crear = (articulos = [SUELTO, ...FAMILIA]) =>
  new DreamloveAdapter(new CatalogoDreamloveEnMemoria(articulos));

describe('adaptador de Dreamlove · contrato común', () => {
  // La misma suite que cumplen el simulado y AliExpress. Un proveedor sin API
  // sigue siendo un proveedor: el importador y el motor de pedidos hablan con
  // él exactamente igual.
  verificarContratoDeAdaptador(() => crear(), { externalIdConocido: '5856' });
});

describe('adaptador de Dreamlove', () => {
  it('declara que no sabe hacer pedidos', async () => {
    const adaptador = crear();

    // Es lo que consulta el motor de fulfillment para mandarlo a la cola de
    // compras manuales en vez de intentar comprar y fallar.
    expect(adaptador.capacidades.crearPedido).toBe(false);
    expect(adaptador.capacidades.seguimiento).toBe(false);
    expect(adaptador.capacidades.buscarCatalogo).toBe(true);

    await expect(
      adaptador.crearPedido({
        referenciaInterna: 'ES-2026-000001',
        idempotencyKey: 'k',
        lineas: [],
        envio: {
          firstName: 'A',
          lastName: 'B',
          line1: 'C',
          city: 'Madrid',
          province: 'Madrid',
          postalCode: '28001',
          countryCode: 'ES',
        },
      }),
    ).rejects.toBeInstanceOf(ErrorProveedor);
  });

  it('avisa cuando no se ha subido ningún catálogo', async () => {
    // Un proveedor recién dado de alta al que nadie ha subido el fichero no
    // puede importar nada, y decirlo antes ahorra buscar el fallo en otro sitio.
    const resultado = await crear([]).verificarCredenciales();

    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toContain('XML');
  });

  it('junta los colores de una familia en un solo producto', async () => {
    const producto = await crear().obtenerProducto('0000046116');

    expect(producto?.variants).toHaveLength(3);
    // El título es el común, no el del color que encabece la lista.
    expect(producto?.title).toBe('SATISFYER - DOUBLE BALL-R');
    expect(producto?.variants.map((v) => v.options['Color']).sort()).toEqual([
      'AZUL',
      'GRANATE',
      'NEGRO',
    ]);
  });

  it('encuentra la familia por el código o el EAN de cualquiera de sus colores', async () => {
    // El operador tiene a mano el código de la ficha que estaba mirando, que
    // es el de un color concreto, no el del grupo.
    const porCodigo = await crear().obtenerProducto('D-237595');
    const porEan = await crear().obtenerProducto('84000000046118');

    expect(porCodigo?.externalId).toBe('0000046116');
    expect(porCodigo?.variants).toHaveLength(3);
    expect(porEan?.externalId).toBe('0000046116');
  });

  it('encabeza la ficha con el color disponible y con más stock', async () => {
    const producto = await crear().obtenerProducto('0000046116');

    // El granate está agotado: usarlo de cabeza dejaría la portada de la ficha
    // con la foto de lo que no se puede comprar.
    expect(producto?.imageUrls[0]).toContain('negro-1.jpg');
  });

  it('reúne una foto de cada color y no repite las compartidas', async () => {
    const producto = await crear().obtenerProducto('0000046116');

    // La de detalle está en dos artículos: descargarla dos veces es pagar dos
    // veces por el mismo fichero.
    expect(producto?.imageUrls).toEqual([
      'https://store.dreamlove.es/negro-1.jpg',
      'https://store.dreamlove.es/granate-1.jpg',
      'https://store.dreamlove.es/azul-1.jpg',
    ]);
  });

  it('no promete stock de lo que el proveedor no sirve', async () => {
    const producto = await crear().obtenerProducto('0000046116');

    // 7 del azul + 40 del negro; el granate está marcado como no disponible.
    expect(producto?.stock).toBe(47);
  });

  it('anuncia desde el precio del color más barato', async () => {
    const producto = await crear().obtenerProducto('0000046116');

    expect(producto?.costCents).toBe(990);
    // Y cada variante conserva el suyo: con un único coste para todas, el
    // margen de las demás sale inventado.
    expect(producto?.variants.map((v) => v.costCents).sort((a, b) => a - b)).toEqual([
      990, 1067, 1067,
    ]);
  });

  it('no reparte los portes del pedido entre los artículos', async () => {
    const producto = await crear().obtenerProducto('5856');

    // Los 18,66 € vienen iguales en los 12.913 productos del catálogo: son el
    // porte de un envío. Como coste de línea subirían todos los PVP.
    expect(producto?.shippingCents).toBe(0);
    expect(producto?.metadata?.['portesPedidoCents']).toBe(1866);
  });

  it('publica la marca del fabricante y no su gama de producto', async () => {
    const familia = FAMILIA.map((a) => ({
      ...a,
      marca: 'SATISFYER VIBRATOR',
      marcaRaiz: 'SATISFYER',
    }));
    const producto = await crear(familia).obtenerProducto('0000046116');

    // Con la hoja, el catálogo acabaría con 452 «marcas» en vez de 203, y
    // SATISFYER partido en seis trozos que el cliente ve como fabricantes
    // distintos.
    expect(producto?.brand).toBe('SATISFYER');
    expect(producto?.metadata?.['marcaLinea']).toBe('SATISFYER VIBRATOR');
  });

  it('traslada el IVA del artículo, que no siempre es el general', async () => {
    const producto = await crear().obtenerProducto('5856');

    expect(producto?.taxRatePct).toBe(4);
  });

  it('lleva el código de cada variante para poder pedirla a mano', async () => {
    const producto = await crear().obtenerProducto('0000046116');

    // Es lo que se teclea en la web de Dreamlove al comprar. Sin esto, quien
    // prepara el pedido tiene que buscar el color uno por uno.
    expect(producto?.variants.map((v) => v.sku)).toContain('D-237595');
    expect(producto?.metadata?.['codigosPorVariante']).toMatchObject({ '46117': 'D-237595' });
  });

  it('distingue las variantes aunque el proveedor no diga en qué se diferencian', async () => {
    // Pasa en su catálogo: familias enteras sin color ni talla rellenos. Sin
    // arreglarlo quedarían tres variantes idénticas y se vendería una pidiendo
    // otra.
    const sinOpciones = FAMILIA.map((a) => ({ ...a, opciones: {} }));
    const producto = await crear(sinOpciones).obtenerProducto('0000046116');

    const valores = producto?.variants.map((v) => v.options['Modelo']);
    expect(new Set(valores).size).toBe(3);
    expect(valores).toContain('DILDO SILICONA AZUL');
  });

  it('no inventa opciones en un artículo suelto', async () => {
    const producto = await crear().obtenerProducto('5856');

    // Una opción con un solo valor obliga al cliente a elegir entre una cosa.
    expect(producto?.variants).toHaveLength(1);
    expect(producto?.variants[0]?.options).toEqual({});
  });

  it('devuelve el estado por variante para poder sincronizar', async () => {
    const [estado] = await crear().consultarEstado(['0000046116']);

    expect(estado?.variantes).toHaveLength(3);
    // Con un único stock y un único precio para toda la familia, la
    // sincronización escribe el del primer color en los tres.
    expect(estado?.variantes?.find((v) => v.externalVariantId === '46116')?.disponible).toBe(false);
    expect(estado?.variantes?.find((v) => v.externalVariantId === '46118')?.stock).toBe(40);
  });

  it('marca como descatalogado lo que ya no está en el catálogo', async () => {
    const estados = await crear().consultarEstado(['0000046116', 'ya-no-existe']);

    expect(estados).toHaveLength(2);
    expect(estados[1]?.descatalogado).toBe(true);
    expect(estados[0]?.descatalogado).toBe(false);
  });

  it('busca sin distinguir mayúsculas ni tildes', async () => {
    const { items, total } = await crear().buscar({ q: 'hercules', pagina: 1, porPagina: 10 });

    // Nadie escribe «HÉRCULES» con tilde y en mayúsculas en un buscador.
    expect(total).toBe(1);
    expect(items[0]?.externalId).toBe('5856');
  });

  it('cuenta familias y no filas al paginar', async () => {
    const { items, total } = await crear().buscar({ pagina: 1, porPagina: 10 });

    // Cuatro artículos, dos productos: el suelto y la familia de tres colores.
    expect(total).toBe(2);
    expect(items).toHaveLength(2);
  });
});
