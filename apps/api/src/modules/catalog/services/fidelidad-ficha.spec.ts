import { describe, expect, it } from 'vitest';
import {
  bloqueosInsalvables,
  puedePublicarse,
  resumirProblemas,
  revisarFicha,
  type FichaProducto,
  type VarianteFicha,
} from './fidelidad-ficha.js';

/**
 * Cada comprobación de aquí corresponde a una obligación concreta antes de
 * vender. Publicar sin cumplirlas no da ningún error: da una ficha en línea que
 * incumple, y eso solo se descubre con la reclamación delante.
 */

const DESCRIPCION =
  'Botas de piel auténtica con suela de goma antideslizante, forro interior transpirable ' +
  'y costuras reforzadas. Fabricadas en España. Disponibles de la talla 39 a la 46.';

const variante = (parcial: Partial<VarianteFicha> = {}): VarianteFicha => ({
  sku: 'BOT-N-41',
  priceCents: 8999,
  compareAtCents: null,
  weightGrams: 900,
  stock: 10,
  allowBackorder: false,
  leadTimeMaxDays: 5,
  ...parcial,
});

const ficha = (parcial: Partial<FichaProducto> = {}): FichaProducto => ({
  isAdult: false,
  requiresShipping: true,
  traducciones: ['es', 'ca', 'en'].map((locale) => ({
    locale,
    name: 'Botas de cuero',
    shortDescription: null,
    description: DESCRIPCION,
  })),
  variantes: [variante()],
  imagenes: 3,
  tieneReferenciaOmnibus: false,
  ...parcial,
});

const codigos = (f: FichaProducto) => revisarFicha(f).map((p) => p.codigo);

describe('Ficha completa', () => {
  it('no pone ninguna pega a una ficha correcta', () => {
    expect(revisarFicha(ficha())).toEqual([]);
    expect(puedePublicarse(revisarFicha(ficha()))).toBe(true);
  });
});

describe('Textos en todos los idiomas', () => {
  it('bloquea si falta un idioma entero', () => {
    // Un cliente en catalán llegaría a una ficha en blanco: no es un detalle
    // estético, es información previa que falta.
    const sinCatalan = ficha({
      traducciones: ficha().traducciones.filter((t) => t.locale !== 'ca'),
    });

    expect(codigos(sinCatalan)).toContain('IDIOMA_INCOMPLETO');
    expect(puedePublicarse(revisarFicha(sinCatalan))).toBe(false);
  });

  it('bloquea si falta la descripción en un idioma', () => {
    const sinDescripcionEn = ficha({
      traducciones: ficha().traducciones.map((t) =>
        t.locale === 'en' ? { ...t, description: null, shortDescription: null } : t,
      ),
    });

    const problema = revisarFicha(sinDescripcionEn).find((p) => p.codigo === 'SIN_DESCRIPCION');
    expect(problema?.locale).toBe('en');
    expect(problema?.gravedad).toBe('BLOQUEA');
  });

  it('avisa de una descripción demasiado corta', () => {
    // El caso real: seis palabras copiadas del proveedor. No llega a
    // "características principales", pero tampoco es un vacío legal claro.
    const corta = ficha({
      traducciones: ficha().traducciones.map((t) => ({ ...t, description: 'Botas bonitas' })),
    });

    const problemas = revisarFicha(corta);
    expect(problemas.every((p) => p.gravedad === 'AVISA')).toBe(true);
    expect(puedePublicarse(problemas)).toBe(true);
  });

  it('suma la descripción corta y la larga antes de medir', () => {
    const partida = ficha({
      traducciones: ficha().traducciones.map((t) => ({
        ...t,
        shortDescription: DESCRIPCION.slice(0, 80),
        description: DESCRIPCION.slice(80),
      })),
    });

    expect(revisarFicha(partida)).toEqual([]);
  });

  it('acepta que la tienda publique en menos idiomas', () => {
    const soloEspanol = ficha({
      traducciones: [
        { locale: 'es', name: 'Botas', shortDescription: null, description: DESCRIPCION },
      ],
    });

    expect(revisarFicha(soloEspanol, ['es'])).toEqual([]);
  });
});

describe('Imagen', () => {
  it('bloquea sin ninguna imagen', () => {
    expect(codigos(ficha({ imagenes: 0 }))).toContain('SIN_IMAGEN');
  });
});

describe('Precio y peso', () => {
  it('bloquea sin variantes', () => {
    expect(codigos(ficha({ variantes: [] }))).toContain('SIN_PRECIO');
  });

  it('bloquea con precio cero', () => {
    expect(codigos(ficha({ variantes: [variante({ priceCents: 0 })] }))).toContain('SIN_PRECIO');
  });

  it('bloquea sin peso cuando hay que enviarlo', () => {
    // Sin peso el porte sale del tramo por defecto: el total que ve el cliente
    // puede no ser el que se le cobre.
    expect(codigos(ficha({ variantes: [variante({ weightGrams: null })] }))).toContain('SIN_PESO');
  });

  it('no pide peso a lo que no se envía', () => {
    const digital = ficha({
      requiresShipping: false,
      variantes: [variante({ weightGrams: null })],
    });
    expect(codigos(digital)).not.toContain('SIN_PESO');
  });
});

describe('Precio anterior tachado', () => {
  it('bloquea si no hay histórico que lo respalde', () => {
    // Inventarse un "antes" más alto es la rebaja falsa que persigue la
    // directiva Ómnibus.
    const conDescuento = ficha({
      variantes: [variante({ compareAtCents: 12999 })],
      tieneReferenciaOmnibus: false,
    });

    expect(codigos(conDescuento)).toContain('DESCUENTO_SIN_REFERENCIA');
    expect(puedePublicarse(revisarFicha(conDescuento))).toBe(false);
  });

  it('lo permite con histórico de precios', () => {
    const conHistorico = ficha({
      variantes: [variante({ compareAtCents: 12999 })],
      tieneReferenciaOmnibus: true,
    });

    expect(codigos(conHistorico)).not.toContain('DESCUENTO_SIN_REFERENCIA');
  });

  it('no se queja de un "antes" que no es más caro', () => {
    // No anuncia ninguna rebaja: no hay nada que respaldar.
    const sinRebaja = ficha({ variantes: [variante({ compareAtCents: 8999 })] });
    expect(codigos(sinRebaja)).not.toContain('DESCUENTO_SIN_REFERENCIA');
  });
});

describe('Plazo de entrega', () => {
  it('bloquea si no se conoce', () => {
    // Es lo que más se reclama en dropshipping y lo que casi nunca se indica.
    expect(codigos(ficha({ variantes: [variante({ leadTimeMaxDays: null })] }))).toContain(
      'SIN_PLAZO_ENTREGA',
    );
  });

  it('avisa de un plazo largo sin bloquear', () => {
    // Tres semanas desde Asia no es ilegal; callarlo sí.
    const lento = ficha({ variantes: [variante({ leadTimeMaxDays: 25 })] });
    const problemas = revisarFicha(lento);

    expect(problemas.map((p) => p.codigo)).toContain('PLAZO_LARGO_SIN_AVISO');
    expect(puedePublicarse(problemas)).toBe(true);
  });

  it('no se queja de un plazo normal', () => {
    expect(codigos(ficha({ variantes: [variante({ leadTimeMaxDays: 7 })] }))).toEqual([]);
  });
});

describe('Stock', () => {
  it('avisa de que saldrá agotado, sin bloquear', () => {
    const agotado = ficha({ variantes: [variante({ stock: 0, allowBackorder: false })] });
    const problemas = revisarFicha(agotado);

    expect(problemas.map((p) => p.codigo)).toContain('SIN_STOCK_NI_RESERVA');
    expect(puedePublicarse(problemas)).toBe(true);
  });

  it('no avisa si admite reserva', () => {
    expect(codigos(ficha({ variantes: [variante({ stock: 0, allowBackorder: true })] }))).toEqual(
      [],
    );
  });
});

describe('Resumen', () => {
  it('lo dice claro cuando está todo', () => {
    expect(resumirProblemas([])).toContain('completa');
  });

  it('separa bloqueos de avisos', () => {
    const problemas = revisarFicha(
      ficha({ imagenes: 0, variantes: [variante({ stock: 0, leadTimeMaxDays: 30 })] }),
    );
    const texto = resumirProblemas(problemas);

    expect(texto).toContain('obligatorio');
    expect(texto).toContain('aviso');
  });

  it('concuerda en singular', () => {
    expect(resumirProblemas(revisarFicha(ficha({ imagenes: 0 })))).toBe(
      'Falta 1 dato obligatorio para poder publicar.',
    );
  });
});

describe('Qué se puede publicar bajo la responsabilidad de quien vende', () => {
  /*
   * La comprobación dejó de ser un portero absoluto: quien lleva la tienda
   * puede publicar con la ficha a medias asumiendo la consecuencia. Lo que se
   * prueba aquí es dónde está la frontera, porque es lo único que no puede
   * moverse por descuido.
   */

  it('faltar una traducción, el peso o el plazo se puede asumir', () => {
    const problemas = revisarFicha(
      ficha({
        traducciones: [
          {
            locale: 'es',
            name: 'Botas de cuero',
            shortDescription: null,
            description: DESCRIPCION,
          },
        ],
        variantes: [variante({ weightGrams: null, leadTimeMaxDays: null })],
      }),
    );

    // Bloquean la publicación normal…
    expect(puedePublicarse(problemas)).toBe(false);
    // …pero ninguno impide asumirlo y publicar igual.
    expect(bloqueosInsalvables(problemas)).toEqual([]);
  });

  it('un precio a cero no se puede asumir: cada venta regalaría el producto', () => {
    const problemas = revisarFicha(ficha({ variantes: [variante({ priceCents: 0 })] }));

    expect(bloqueosInsalvables(problemas).map((p) => p.codigo)).toContain('SIN_PRECIO');
  });

  it('un descuento sin histórico tampoco: es una infracción, no un riesgo', () => {
    const problemas = revisarFicha(
      ficha({
        tieneReferenciaOmnibus: false,
        variantes: [variante({ priceCents: 1000, compareAtCents: 2000 })],
      }),
    );

    expect(bloqueosInsalvables(problemas).map((p) => p.codigo)).toContain(
      'DESCUENTO_SIN_REFERENCIA',
    );
  });

  it('una ficha completa no tiene nada que asumir', () => {
    expect(bloqueosInsalvables(revisarFicha(ficha()))).toEqual([]);
  });
});
