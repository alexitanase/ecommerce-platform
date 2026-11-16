import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarConsentimiento, retirarConsentimiento } from './consentimiento';
import {
  anadirAlCarrito,
  comprar,
  empezarCheckout,
  verProducto,
  type ArticuloAnalitica,
} from './analitica';

/**
 * Eventos de analítica y consentimiento.
 *
 * Lo que se prueba aquí no es que los eventos lleguen bien formados —que
 * también— sino sobre todo lo contrario: **que sin permiso no sale ni uno**.
 * Un banner de cookies que no impide de verdad el envío es peor que no tenerlo:
 * da una apariencia de cumplimiento mientras se manda todo igual, y eso es
 * exactamente lo que sanciona la AEPD.
 *
 * El otro punto delicado es el dinero. En todo el proyecto los importes son
 * céntimos enteros, y GA4 y Meta esperan euros con decimales. La conversión
 * ocurre aquí, y una equivocación de dos órdenes de magnitud en los ingresos
 * declarados no da ningún error: solo hace que las decisiones de negocio se
 * tomen con datos cien veces mayores de lo real.
 */

const ARTICULO: ArticuloAnalitica = {
  id: 'prod-1',
  nombre: 'Botas de cuero',
  precioCents: 4999,
  categoria: 'Calzado',
};

let gtag: ReturnType<typeof vi.fn>;
let fbq: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  gtag = vi.fn();
  fbq = vi.fn();
  Object.assign(window, { gtag, fbq });
});

afterEach(() => {
  retirarConsentimiento();
  vi.restoreAllMocks();
});

const aceptarTodo = () => guardarConsentimiento({ analiticas: true, marketing: true });
const soloAnaliticas = () => guardarConsentimiento({ analiticas: true, marketing: false });

describe('Sin consentimiento no sale nada', () => {
  it('nadie ha decidido todavía', () => {
    // El estado del primer visitante, antes de tocar el banner.
    verProducto(ARTICULO);
    anadirAlCarrito(ARTICULO);
    empezarCheckout([ARTICULO], 4999);
    comprar('ES-2026-000001', [ARTICULO], { totalCents: 4999 });

    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).not.toHaveBeenCalled();
  });

  it('se ha rechazado explícitamente', () => {
    guardarConsentimiento({ analiticas: false, marketing: false });

    verProducto(ARTICULO);
    comprar('ES-2026-000002', [ARTICULO], { totalCents: 4999 });

    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).not.toHaveBeenCalled();
  });

  it('se retira a mitad de sesión', () => {
    // El caso que convierte un banner en decoración: se acepta, se navega y
    // luego se retira desde preferencias. A partir de ahí no puede salir ni un
    // evento más, sin recargar nada.
    aceptarTodo();
    verProducto(ARTICULO);
    expect(gtag).toHaveBeenCalled();

    gtag.mockClear();
    fbq.mockClear();
    retirarConsentimiento();

    verProducto(ARTICULO);
    anadirAlCarrito(ARTICULO);

    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).not.toHaveBeenCalled();
  });
});

describe('Aceptar estadísticas no es aceptar publicidad', () => {
  it('con solo analíticas va a Google pero no a Meta', () => {
    // Son finalidades distintas: medir visitas no es construir audiencias
    // publicitarias. Meterlas en el mismo saco es lo que hace que un banner
    // "de cookies" no cumpla.
    soloAnaliticas();

    verProducto(ARTICULO);

    expect(gtag).toHaveBeenCalledTimes(1);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('con las dos, va a las dos', () => {
    aceptarTodo();

    anadirAlCarrito(ARTICULO);

    expect(gtag).toHaveBeenCalledTimes(1);
    expect(fbq).toHaveBeenCalledTimes(1);
  });
});

describe('Los importes van en euros, no en céntimos', () => {
  beforeEach(aceptarTodo);

  it('un producto de 49,99 € se declara como 49.99', () => {
    // Mandar 4999 multiplicaría por cien los ingresos del informe, y las
    // decisiones de negocio se tomarían con datos absurdos sin que nada falle.
    verProducto(ARTICULO);

    const [, , datos] = gtag.mock.calls[0] as [string, string, { value: number }];
    expect(datos.value).toBe(49.99);
  });

  it('la cantidad multiplica el valor', () => {
    anadirAlCarrito({ ...ARTICULO, cantidad: 3 });

    const [, , datos] = gtag.mock.calls[0] as [string, string, { value: number }];
    expect(datos.value).toBe(149.97);
  });

  it('el envío y el IVA van aparte, como espera GA4', () => {
    comprar('ES-2026-000003', [ARTICULO], {
      totalCents: 5494,
      envioCents: 495,
      ivaCents: 953,
    });

    const [, , datos] = gtag.mock.calls[0] as [
      string,
      string,
      { value: number; shipping: number; tax: number },
    ];

    expect(datos.value).toBe(54.94);
    expect(datos.shipping).toBe(4.95);
    expect(datos.tax).toBe(9.53);
  });
});

describe('La compra se puede deduplicar', () => {
  beforeEach(aceptarTodo);

  it('lleva el número de pedido como identificador', () => {
    // Si alguien recarga la página de confirmación, el pedido no puede
    // contarse dos veces: los ingresos del informe se inflarían.
    comprar('ES-2026-000004', [ARTICULO], { totalCents: 4999 });

    const [, , google] = gtag.mock.calls[0] as [string, string, { transaction_id: string }];
    const [, , meta] = fbq.mock.calls[0] as [string, string, { eventID: string }];

    expect(google.transaction_id).toBe('ES-2026-000004');
    expect(meta.eventID).toBe('ES-2026-000004');
  });
});

describe('Un fallo de la analítica no rompe la tienda', () => {
  beforeEach(aceptarTodo);

  it('si gtag revienta, la función no propaga el error', () => {
    // La analítica mide, no vende. Un bloqueador de anuncios o un script mal
    // cargado no pueden tumbar el checkout.
    gtag.mockImplementation(() => {
      throw new Error('bloqueado por una extensión');
    });

    expect(() => {
      comprar('ES-2026-000005', [ARTICULO], { totalCents: 4999 });
    }).not.toThrow();
  });

  it('sin gtag cargado tampoco falla', () => {
    Object.assign(window, { gtag: undefined, fbq: undefined });

    expect(() => {
      verProducto(ARTICULO);
    }).not.toThrow();
  });
});
