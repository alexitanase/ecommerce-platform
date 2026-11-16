import { describe, expect, it } from 'vitest';
import {
  CANALES,
  CANAL_DIRECTO,
  canalPorClave,
  baseComisionable,
  comisionDe,
  construirEnlace,
  marcajeQueGana,
  normalizarMarcaje,
  resumirPorCanal,
} from './canales.js';

/**
 * Canales de captación.
 *
 * Con Google Ads y Meta Ads cerrados, saber qué canal trae las ventas no es un
 * informe bonito: es lo único que evita dedicar meses al que más ruido hace en
 * vez de al que paga. Un marcaje mal normalizado o una atribución mal hecha no
 * dan ningún error, solo hacen que el informe mienta.
 */

const params = (busqueda: string) => new URLSearchParams(busqueda);

describe('El catálogo de canales', () => {
  it('dice de cada uno si admite catálogo adulto', () => {
    for (const canal of CANALES) {
      expect(['si', 'limitado', 'no'], canal.clave).toContain(canal.admiteAdulto);
    }
  });

  it('los que no admiten el catálogo explican por qué', () => {
    // Están en la lista a propósito: sin la explicación, dentro de seis meses
    // alguien volvería a investigar si Meta Ads acepta esto.
    for (const canal of CANALES.filter((c) => c.admiteAdulto === 'no')) {
      expect(canal.advertencia, canal.clave).toBeTruthy();
      expect(canal.advertencia!.length, canal.clave).toBeGreaterThan(20);
    }
  });

  it('no hay claves repetidas', () => {
    const claves = new Set(CANALES.map((c) => c.clave));

    expect(claves.size).toBe(CANALES.length);
  });

  it('una clave desconocida no explota', () => {
    expect(canalPorClave('lo-que-sea')).toBeUndefined();
  });
});

describe('Normalizar lo que llega en la URL', () => {
  it('mayúsculas y espacios no crean canales distintos', () => {
    // Es lo que rompe el informe en silencio: 'Newsletter' y 'newsletter '
    // serían dos canales y ninguno tendría datos para decidir nada.
    expect(normalizarMarcaje(params('utm_source=Newsletter'))?.fuente).toBe('newsletter');
    expect(normalizarMarcaje(params('utm_source=%20NEWSLETTER%20'))?.fuente).toBe('newsletter');
    expect(normalizarMarcaje(params('utm_source=news+letter'))?.fuente).toBe('news-letter');
  });

  it('se queda con medio y campaña si vienen', () => {
    const m = normalizarMarcaje(
      params('utm_source=reddit&utm_medium=post&utm_campaign=Lanzamiento+Junio'),
    );

    expect(m).toEqual({ fuente: 'reddit', medio: 'post', campana: 'lanzamiento-junio' });
  });

  it('sin fuente no hay marcaje', () => {
    // Una campaña sin fuente no se puede atribuir a nada.
    expect(normalizarMarcaje(params('utm_medium=email'))).toBeNull();
    expect(normalizarMarcaje(params(''))).toBeNull();
  });

  it('limpia lo que no tiene forma de marcaje', () => {
    // Llega directo de la URL, que la escribe cualquiera, y acaba pintado en
    // un informe del panel. Se queda solo con lo que puede ser una clave.
    expect(normalizarMarcaje(params('utm_source=%3Cscript%3E'))?.fuente).toBe('script');
    expect(normalizarMarcaje(params("utm_source='+OR+1=1--"))?.fuente).toBe('or-11');
  });

  it('si al limpiarlo no queda nada, no hay marcaje', () => {
    expect(normalizarMarcaje(params('utm_source=%3C%3E%21'))).toBeNull();
  });

  it('no crea canales gemelos por un guion de más', () => {
    // '-newsletter' y 'newsletter' aparecerían como dos filas distintas en el
    // informe sin que a simple vista se vea la diferencia.
    expect(normalizarMarcaje(params('utm_source=-newsletter-'))?.fuente).toBe('newsletter');
  });

  it('recorta las fuentes desmesuradas', () => {
    expect(normalizarMarcaje(params(`utm_source=${'a'.repeat(200)}`))?.fuente).toHaveLength(60);
  });
});

describe('Construir enlaces de campaña', () => {
  it('añade los parámetros sin romper los que ya había', () => {
    const enlace = construirEnlace('https://tienda.es/producto/x?ref=ABC123', {
      fuente: 'newsletter',
      medio: 'email',
      campana: 'junio',
    });

    expect(enlace).toContain('ref=ABC123');
    expect(enlace).toContain('utm_source=newsletter');
    expect(enlace).toContain('utm_medium=email');
    expect(enlace).toContain('utm_campaign=junio');
  });

  it('sin medio ni campaña solo pone la fuente', () => {
    const enlace = construirEnlace('https://tienda.es/', { fuente: 'telegram' });

    expect(enlace).toContain('utm_source=telegram');
    expect(enlace).not.toContain('utm_medium');
  });
});

describe('Quién se lleva la venta', () => {
  const newsletter = { fuente: 'newsletter' };
  const reddit = { fuente: 'reddit' };

  it('el último clic no directo', () => {
    // Si alguien llega por la newsletter, se va, y vuelve por Reddit, la venta
    // es de Reddit: es lo último que la trajo de vuelta.
    expect(marcajeQueGana(newsletter, reddit)).toEqual(reddit);
  });

  it('volver tecleando la dirección no borra el canal anterior', () => {
    // Sin esto, casi todas las ventas acabarían siendo "directo", porque la
    // gente vuelve a la tienda por su cuenta antes de comprar.
    expect(marcajeQueGana(newsletter, null)).toEqual(newsletter);
    expect(marcajeQueGana(newsletter, { fuente: CANAL_DIRECTO })).toEqual(newsletter);
  });

  it('sin nada previo, el primero que llegue', () => {
    expect(marcajeQueGana(null, reddit)).toEqual(reddit);
    expect(marcajeQueGana(null, null)).toBeNull();
  });
});

describe('El informe por canal', () => {
  it('ordena por ingreso, no por número de pedidos', () => {
    // Veinte pedidos de doce euros valen menos que cinco de noventa. Ordenar
    // por cantidad haría dedicar el esfuerzo al canal equivocado.
    const resumen = resumirPorCanal([
      ...Array.from({ length: 20 }, () => ({ fuente: 'reddit', totalCents: 1200 })),
      ...Array.from({ length: 5 }, () => ({ fuente: 'newsletter', totalCents: 9000 })),
    ]);

    expect(resumen[0]?.fuente).toBe('newsletter');
    expect(resumen[0]?.ticketMedioCents).toBe(9000);
  });

  it('los pedidos sin marcaje son tráfico directo', () => {
    // Una tienda sana tiene una parte importante ahí, y esconderlo daría una
    // imagen falsa de lo que aportan los demás canales.
    const resumen = resumirPorCanal([
      { fuente: null, totalCents: 5000 },
      { fuente: 'reddit', totalCents: 5000 },
    ]);

    expect(resumen.map((r) => r.fuente).sort()).toEqual(['directo', 'reddit']);
  });

  it('la cuota suma uno', () => {
    const resumen = resumirPorCanal([
      { fuente: 'a', totalCents: 3000 },
      { fuente: 'b', totalCents: 7000 },
    ]);

    expect(resumen.reduce((s, r) => s + r.cuota, 0)).toBeCloseTo(1);
  });

  it('sin pedidos no divide entre cero', () => {
    expect(resumirPorCanal([])).toEqual([]);
  });

  it('un canal desconocido se enseña igual, con su clave', () => {
    // Puede venir de una campaña montada por alguien con una fuente nueva. No
    // aparecer en el informe sería peor que aparecer sin nombre bonito.
    const resumen = resumirPorCanal([{ fuente: 'boletin-de-un-amigo', totalCents: 5000 }]);

    expect(resumen[0]?.nombre).toBe('boletin-de-un-amigo');
  });
});

describe('Sobre qué se comisiona', () => {
  it('las líneas sin el IVA', () => {
    // Comisionar sobre el precio con IVA es pagar por dinero que se le entrega
    // íntegro a Hacienda.
    expect(baseComisionable([{ totalCents: 12_100, taxRate: 21 }], 0)).toBe(10_000);
  });

  it('cada línea con su tipo, no uno solo para todo el pedido', () => {
    // Un libro al 4 % y unas botas al 21 % en el mismo pedido: aplicar un tipo
    // medio a la suma daría una base que no existe.
    const base = baseComisionable(
      [
        { totalCents: 12_100, taxRate: 21 },
        { totalCents: 10_400, taxRate: 4 },
      ],
      0,
    );

    expect(base).toBe(20_000);
  });

  it('el envío no entra: ya sale del margen', () => {
    // Se comprueba por ausencia — a esta función solo se le pasan líneas de
    // producto, nunca el importe del envío.
    expect(baseComisionable([{ totalCents: 12_100, taxRate: 21 }], 0)).toBe(10_000);
  });

  it('el descuento rebaja la base en proporción', () => {
    // Un cupón rebaja el precio con IVA incluido, así que rebaja también la
    // base. Sin esto, un pedido de 100 € con 50 € de cupón comisionaría por 100.
    expect(baseComisionable([{ totalCents: 12_100, taxRate: 21 }], 6050)).toBe(5000);
  });

  it('un descuento mayor que el pedido no da base negativa', () => {
    expect(baseComisionable([{ totalCents: 1210, taxRate: 21 }], 5000)).toBe(0);
  });

  it('un pedido sin líneas no divide entre cero', () => {
    expect(baseComisionable([], 0)).toBe(0);
  });
});

describe('Cuánto se comisiona', () => {
  it('el porcentaje sobre la base', () => {
    expect(comisionDe(10_000, 10)).toBe(1000);
  });

  it('redondea a céntimos enteros', () => {
    expect(comisionDe(3333, 7)).toBe(233);
  });

  it('una base negativa no genera comisión', () => {
    expect(comisionDe(-500, 10)).toBe(0);
  });
});
