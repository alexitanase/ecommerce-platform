import { describe, expect, it } from 'vitest';
import {
  fotosPorValor,
  precioPorValor,
  valoresPorPrecio,
  nombreVariante,
  variantePreseleccionada,
  type OpcionLigera,
  type VarianteLigera,
} from './variantes';

const rojo = { id: 'c-rojo', value: 'Rojo', labels: { es: 'Rojo', en: 'Red' } };
const azul = { id: 'c-azul', value: 'Azul', labels: null };
const m = { id: 't-m', value: 'M', labels: null };
const l = { id: 't-l', value: 'L', labels: null };
const china = { id: 'e-cn', value: 'China Mainland', labels: null };

const color: OpcionLigera = { id: 'o-color', key: 'color', values: [rojo, azul] };
const talla: OpcionLigera = { id: 'o-talla', key: 'talla', values: [m, l] };
const envio: OpcionLigera = {
  id: 'o-envio',
  key: 'envios_desde',
  esEnvio: true,
  values: [china],
};

function variante(
  id: string,
  valores: { id: string; value: string; labels: Record<string, string> | null }[],
  foto: string | null,
  stock = 10,
): VarianteLigera {
  return {
    id,
    priceCents: 1000,
    stock,
    optionValues: valores.map((optionValue) => ({ optionValue })),
    media: foto ? [{ url: foto }] : [],
  };
}

describe('variantePreseleccionada', () => {
  it('elige la primera con stock aunque no sea la primera de la lista', () => {
    const v = variantePreseleccionada([
      { id: 'a', stock: 0 },
      { id: 'b', stock: 3 },
    ]);
    expect(v?.id).toBe('b');
  });

  it('si ninguna tiene stock elige la primera, para no dejar la ficha sin precio', () => {
    const v = variantePreseleccionada([
      { id: 'a', stock: 0 },
      { id: 'b', stock: 0 },
    ]);
    expect(v?.id).toBe('a');
  });

  it('sin variantes no devuelve nada', () => {
    expect(variantePreseleccionada([])).toBeUndefined();
  });
});

describe('nombreVariante', () => {
  it('junta los valores en el idioma del visitante', () => {
    const v = variante('v1', [rojo, m], null);
    expect(nombreVariante(v, [color, talla], 'es')).toBe('Rojo · M');
    expect(nombreVariante(v, [color, talla], 'en')).toBe('Red · M');
  });

  it('cae al valor original cuando ese idioma no está traducido', () => {
    expect(nombreVariante(variante('v1', [azul], null), [color], 'en')).toBe('Azul');
  });

  it('deja fuera el país de envío', () => {
    const v = variante('v1', [rojo, china], null);
    expect(nombreVariante(v, [color, envio], 'es')).toBe('Rojo');
  });

  it('sin opciones visibles no hay nombre que enseñar', () => {
    expect(nombreVariante(variante('v1', [china], null), [envio], 'es')).toBeNull();
    expect(nombreVariante(variante('v1', [], null), [], 'es')).toBeNull();
  });
});

describe('fotosPorValor', () => {
  it('asigna a cada color su foto', () => {
    const variantes = [
      variante('v1', [rojo, china], 'https://cdn/rojo.webp'),
      variante('v2', [azul, china], 'https://cdn/azul.webp'),
    ];

    const fotos = fotosPorValor(variantes, [color, envio]);
    expect(fotos.get('c-rojo')).toBe('https://cdn/rojo.webp');
    expect(fotos.get('c-azul')).toBe('https://cdn/azul.webp');
  });

  it('no le pone foto a la talla en un producto de color y talla', () => {
    // Este es el caso que obliga a la regla: la M existe en rojo y en azul, así
    // que cualquier foto que se le ponga es la de uno de los dos colores.
    const variantes = [
      variante('v1', [rojo, m], 'https://cdn/rojo.webp'),
      variante('v2', [rojo, l], 'https://cdn/rojo.webp'),
      variante('v3', [azul, m], 'https://cdn/azul.webp'),
      variante('v4', [azul, l], 'https://cdn/azul.webp'),
    ];

    const fotos = fotosPorValor(variantes, [color, talla]);
    expect(fotos.get('c-rojo')).toBe('https://cdn/rojo.webp');
    expect(fotos.get('t-m')).toBeUndefined();
    expect(fotos.get('t-l')).toBeUndefined();
  });

  it('no reparte fotos si todas las variantes comparten la misma', () => {
    // Sin fotos por variante, once miniaturas idénticas son ruido: mejor los
    // nombres de siempre.
    const variantes = [
      variante('v1', [rojo], 'https://cdn/una.webp'),
      variante('v2', [azul], 'https://cdn/una.webp'),
    ];
    expect(fotosPorValor(variantes, [color]).size).toBe(0);
  });

  it('nunca le pone foto a la opción de envío', () => {
    const variantes = [
      variante('v1', [china], 'https://cdn/a.webp'),
      variante('v2', [china], 'https://cdn/b.webp'),
    ];
    expect(fotosPorValor(variantes, [envio]).size).toBe(0);
  });

  it('aguanta que solo algunas variantes traigan foto', () => {
    const variantes = [
      variante('v1', [rojo], 'https://cdn/rojo.webp'),
      variante('v2', [azul], null),
    ];
    // Con una sola foto no hay nada que distinguir, así que no se enseñan
    // miniaturas a medias.
    expect(fotosPorValor(variantes, [color]).size).toBe(0);
  });
});

describe('precioPorValor', () => {
  it('a cada valor le toca el precio de su variante más barata', () => {
    // El rojo existe en dos tallas: para quien mira la ficha, cuesta la barata.
    const variantes = [
      { ...variante('v1', [rojo, m], null), priceCents: 2500 },
      { ...variante('v2', [rojo, l], null), priceCents: 1899 },
      { ...variante('v3', [azul, m], null), priceCents: 5499 },
    ];

    const precios = precioPorValor(variantes);
    expect(precios.get('c-rojo')).toBe(1899);
    expect(precios.get('c-azul')).toBe(5499);
    // Y la talla también recibe el suyo, que es el de su combinación más barata.
    expect(precios.get('t-l')).toBe(1899);
  });

  it('cuenta las agotadas: el orden no puede cambiar al acabarse una talla', () => {
    const variantes = [
      { ...variante('v1', [rojo], null, 0), priceCents: 1000 },
      { ...variante('v2', [azul], null, 5), priceCents: 2000 },
    ];

    expect(precioPorValor(variantes).get('c-rojo')).toBe(1000);
  });

  it('sin variantes no hay precios', () => {
    expect(precioPorValor([]).size).toBe(0);
  });
});

describe('valoresPorPrecio', () => {
  it('ordena de más barato a más caro', () => {
    const precios = new Map([
      ['c-rojo', 5499],
      ['c-azul', 1899],
    ]);

    expect(valoresPorPrecio([rojo, azul], precios).map((v) => v.id)).toEqual(['c-azul', 'c-rojo']);
  });

  it('con el mismo precio se quedan como venían', () => {
    /*
     * Esto es lo que salva las tallas: si 41, 42 y 43 cuestan lo mismo, se siguen
     * leyendo en ese orden. Un selector de tallas en orden arbitrario es peor que
     * uno sin ordenar por precio.
     */
    const precios = new Map([
      ['t-m', 2500],
      ['t-l', 2500],
    ]);

    expect(valoresPorPrecio([m, l], precios).map((v) => v.id)).toEqual(['t-m', 't-l']);
    expect(valoresPorPrecio([l, m], precios).map((v) => v.id)).toEqual(['t-l', 't-m']);
  });

  it('lo que no lleva a ninguna variante va al final', () => {
    const precios = new Map([['c-azul', 1899]]);

    expect(valoresPorPrecio([rojo, azul], precios).map((v) => v.id)).toEqual(['c-azul', 'c-rojo']);
  });

  it('no toca la lista que recibe', () => {
    const original = [rojo, azul];
    valoresPorPrecio(original, new Map([['c-azul', 1]]));
    expect(original.map((v) => v.id)).toEqual(['c-rojo', 'c-azul']);
  });
});
