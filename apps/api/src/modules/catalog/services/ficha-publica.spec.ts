import { describe, expect, it } from 'vitest';
import { entregaDeVariante, esOpcionDeEnvio, fichaPublica, paisDeOrigen } from './ficha-publica.js';

/**
 * Estas pruebas existen por dos motivos distintos.
 *
 * El primero es una fuga real: la ficha pública devolvía el coste del proveedor
 * y el margen. Que no vuelva a salir no se puede comprobar leyendo el código
 * —basta con que alguien añada un campo al modelo—, así que se comprueba aquí
 * sobre el objeto ya proyectado.
 *
 * El segundo es el plazo de entrega, que es obligatorio informarlo y hoy no lo
 * declara ningún proveedor: la estimación por país es lo único que hay, y tiene
 * que ser reproducible.
 */

/**
 * Un enlace de proveedor tal y como llega, con los campos que NO deben salir.
 *
 * El tipo de entrada solo declara los tres campos del plazo, así que los demás
 * se admiten con la firma de índice. Es a propósito: si el tipo los declarara,
 * esta prueba no estaría comprobando nada que el compilador no supiera ya.
 */
const enlaceProveedor: {
  variantId: string | null;
  leadTimeMinDays: number | null;
  leadTimeMaxDays: number | null;
} & Record<string, unknown> = {
  variantId: 'var1',
  leadTimeMinDays: null,
  leadTimeMaxDays: null,
  costCents: 2839,
  margenPorcentaje: 23,
  supplierKey: 'aliexpress',
  supplierNombre: 'Aliexpress',
  externalProductId: '1005008382946674',
};

const valorColor = { id: 'v-rojo', value: 'Rojo', labels: { es: 'Rojo' }, hexColor: '#f00' };
const valorEnvioCn = { id: 'v-cn', value: 'China Mainland', labels: null, hexColor: null };
const valorEnvioEs = { id: 'v-es', value: 'España', labels: null, hexColor: null };

function ficha(cambios: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    handle: 'lampara',
    status: 'ACTIVE',
    isAdult: false,
    requiresShipping: true,
    withdrawalExemption: null,
    taxRate: '21',
    locale: 'es',
    translations: [
      {
        locale: 'es',
        name: 'Lámpara',
        slug: 'lampara',
        shortDescription: 'Corta',
        description: '<p>Larga</p>',
        metaTitle: null,
        metaDescription: null,
      },
    ],
    media: [{ id: 'm1', url: 'https://cdn/1.webp', alt: null, blurhash: null }],
    options: [
      {
        id: 'o-color',
        key: 'color',
        translations: [{ locale: 'es', name: 'Color' }],
        values: [valorColor],
      },
      {
        id: 'o-envio',
        key: 'envios_desde',
        translations: [{ locale: 'es', name: 'Envíos desde' }],
        values: [valorEnvioCn],
      },
    ],
    variants: [
      {
        id: 'var1',
        sku: 'SKU-1',
        priceCents: 3699,
        compareAtCents: 7099,
        descuentoPorcentaje: 48,
        stock: 74,
        allowBackorder: false,
        optionValues: [{ optionValue: valorColor }, { optionValue: valorEnvioCn }],
        media: [{ id: 'm1', url: 'https://cdn/1.webp' }],
      },
    ],
    category: null,
    proveedores: [enlaceProveedor],
    ...cambios,
  } as Parameters<typeof fichaPublica>[0];
}

describe('esOpcionDeEnvio', () => {
  it('reconoce la clave que genera el importador de AliExpress', () => {
    expect(esOpcionDeEnvio({ key: 'envios_desde' })).toBe(true);
  });

  it('reconoce el nombre traducido cuando la clave no dice nada', () => {
    expect(esOpcionDeEnvio({ key: 'opt_3', translations: [{ name: 'Ships From' }] })).toBe(true);
  });

  it('no confunde una opción normal', () => {
    expect(esOpcionDeEnvio({ key: 'color', translations: [{ name: 'Color' }] })).toBe(false);
    expect(esOpcionDeEnvio({ key: 'talla', translations: [{ name: 'Talla' }] })).toBe(false);
  });
});

describe('paisDeOrigen', () => {
  it('identifica las formas en las que llega China', () => {
    expect(paisDeOrigen('China Mainland')).toBe('CN');
    expect(paisDeOrigen('CHINA')).toBe('CN');
    expect(paisDeOrigen('  china  ')).toBe('CN');
  });

  it('identifica España con y sin tilde', () => {
    expect(paisDeOrigen('España')).toBe('ES');
    expect(paisDeOrigen('Espana')).toBe('ES');
    expect(paisDeOrigen('SPAIN')).toBe('ES');
  });

  it('devuelve null para lo que no conoce', () => {
    expect(paisDeOrigen('Marte')).toBeNull();
  });
});

describe('entregaDeVariante', () => {
  const opcionEnvio = { values: [{ id: 'v-cn' }, { id: 'v-es' }] };

  it('estima por el país cuando el proveedor no declara plazo', () => {
    const e = entregaDeVariante(
      { id: 'var1', optionValues: [{ optionValue: valorEnvioCn }] },
      opcionEnvio,
      [{ variantId: 'var1', leadTimeMinDays: null, leadTimeMaxDays: null }],
    );
    expect(e).toEqual({
      minDias: 12,
      maxDias: 22,
      estimado: true,
      pais: 'CN',
      origen: 'China Mainland',
    });
  });

  it('da un plazo corto si sale de España', () => {
    const e = entregaDeVariante(
      { id: 'var1', optionValues: [{ optionValue: valorEnvioEs }] },
      opcionEnvio,
      [],
    );
    expect([e?.minDias, e?.maxDias]).toEqual([2, 5]);
    expect(e?.pais).toBe('ES');
  });

  it('el plazo del proveedor manda sobre la estimación', () => {
    const e = entregaDeVariante(
      { id: 'var1', optionValues: [{ optionValue: valorEnvioCn }] },
      opcionEnvio,
      [{ variantId: 'var1', leadTimeMinDays: 6, leadTimeMaxDays: 9 }],
    );
    expect(e).toMatchObject({ minDias: 6, maxDias: 9, estimado: false });
  });

  it('deduce el mínimo cuando el proveedor solo da el máximo', () => {
    const e = entregaDeVariante({ id: 'var1' }, null, [
      { variantId: 'var1', leadTimeMinDays: null, leadTimeMaxDays: 10 },
    ]);
    expect(e).toMatchObject({ minDias: 6, maxDias: 10, estimado: false });
  });

  it('cada variante lleva su propio origen', () => {
    const enlaces: { variantId: string | null; leadTimeMinDays: null; leadTimeMaxDays: null }[] =
      [];
    const desdeEspana = entregaDeVariante(
      { id: 'a', optionValues: [{ optionValue: valorEnvioEs }, { optionValue: valorColor }] },
      opcionEnvio,
      enlaces,
    );
    const desdeChina = entregaDeVariante(
      { id: 'b', optionValues: [{ optionValue: valorEnvioCn }, { optionValue: valorColor }] },
      opcionEnvio,
      enlaces,
    );
    expect(desdeEspana?.maxDias ?? 0).toBeLessThan(desdeChina?.maxDias ?? 0);
  });

  it('sin proveedor y sin origen no hay plazo que anunciar', () => {
    // Un producto propio, metido a mano, puede estar en un almacén de aquí:
    // estimar «12 a 25 días desde el extranjero» sería inventárselo.
    expect(entregaDeVariante({ id: 'var1' }, null, [])).toBeNull();
  });

  it('con proveedor pero sin país conocido es pesimista', () => {
    const e = entregaDeVariante({ id: 'var1' }, null, [
      { variantId: null, leadTimeMinDays: null, leadTimeMaxDays: null },
    ]);
    expect(e).toEqual({ minDias: 12, maxDias: 25, estimado: true, pais: null, origen: null });
  });

  it('un plazo declarado del revés no produce un rango imposible', () => {
    const e = entregaDeVariante({ id: 'var1' }, null, [
      { variantId: 'var1', leadTimeMinDays: 30, leadTimeMaxDays: 10 },
    ]);
    expect(e?.minDias ?? 0).toBeLessThanOrEqual(e?.maxDias ?? 0);
  });
});

describe('fichaPublica', () => {
  it('no publica nada del proveedor', () => {
    const publica = fichaPublica(ficha());
    const texto = JSON.stringify(publica);

    expect(publica).not.toHaveProperty('proveedores');
    for (const secreto of [
      '2839',
      'margenPorcentaje',
      'aliexpress',
      'Aliexpress',
      '1005008382946674',
    ]) {
      expect(texto).not.toContain(secreto);
    }
  });

  it('no publica el coste de la variante', () => {
    // `costCents` está en el modelo de variante y salía tal cual: con precio
    // 36,99 y coste 28,39 se podía leer el margen de cada artículo.
    const conCoste = ficha({
      variants: [{ ...ficha().variants[0], costCents: 2839, lowStockAlert: 5, barcode: '123' }],
    });
    const v = fichaPublica(conCoste).variants[0];

    // Que la variante de partida se ha construido de verdad: sin esto, un
    // `variants[0]` vacío pasaría las tres comprobaciones de abajo sin probar
    // nada.
    expect(v?.sku).toBe('SKU-1');
    expect(v).not.toHaveProperty('costCents');
    expect(v).not.toHaveProperty('lowStockAlert');
    expect(v).not.toHaveProperty('barcode');
  });

  it('sigue trayendo lo que la tienda necesita para vender', () => {
    const p = fichaPublica(ficha());

    expect(p.translations[0]?.description).toBe('<p>Larga</p>');
    expect(p.media[0]?.url).toBe('https://cdn/1.webp');
    expect(p.variants[0]).toMatchObject({
      priceCents: 3699,
      compareAtCents: 7099,
      descuentoPorcentaje: 48,
      stock: 74,
    });
    expect(p.variants[0]?.media[0]?.url).toBe('https://cdn/1.webp');
    expect(p.variants[0]?.optionValues.map((ov) => ov.optionValue.value)).toEqual([
      'Rojo',
      'China Mainland',
    ]);
  });

  it('marca cuál de las opciones es la de envío', () => {
    const opciones = fichaPublica(ficha()).options;
    expect(opciones.map((o) => [o.key, o.esEnvio])).toEqual([
      ['color', false],
      ['envios_desde', true],
    ]);
  });

  it('cada variante trae su plazo de entrega calculado', () => {
    expect(fichaPublica(ficha()).variants[0]?.entrega).toMatchObject({
      minDias: 12,
      maxDias: 22,
      estimado: true,
      pais: 'CN',
    });
  });
});
