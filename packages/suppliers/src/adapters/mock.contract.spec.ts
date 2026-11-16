import { describe, expect, it } from 'vitest';
import { MockSupplierAdapter } from './mock.adapter.js';
import { verificarContratoDeAdaptador } from '../core/contrato.js';

/**
 * El adaptador simulado también cumple el contrato.
 *
 * No es una formalidad: es el que se usa para desarrollar y para las pruebas de
 * extremo a extremo mientras no haya credenciales de AliExpress. Si se
 * comportara distinto —devolviendo un error donde el real devuelve `null`, o
 * euros donde el otro devuelve céntimos— todo lo que se pruebe con él daría una
 * falsa sensación de que funciona, y el fallo aparecería el día del cambio a
 * producción.
 */

describe('Proveedor simulado · contrato común', () => {
  verificarContratoDeAdaptador(() => new MockSupplierAdapter({}), {
    externalIdConocido: 'SIM-1001',
  });
});

describe('Proveedor simulado · comportamiento propio', () => {
  it('crea un pedido y luego se puede consultar', async () => {
    const adaptador = new MockSupplierAdapter({});

    const pedido = await adaptador.crearPedido({
      referenciaInterna: 'ES-2026-000001',
      idempotencyKey: 'clave-1',
      lineas: [{ externalProductId: 'SIM-1001', quantity: 1, expectedCostCents: 1450 }],
      envio: {
        firstName: 'Ana',
        lastName: 'Ruiz',
        line1: 'Calle Mayor 1',
        city: 'Madrid',
        province: 'Madrid',
        postalCode: '28013',
        countryCode: 'ES',
      },
    });

    expect(pedido.externalOrderId.length).toBeGreaterThan(0);
    expect(await adaptador.consultarPedido(pedido.externalOrderId)).not.toBeNull();
  });

  it('encuentra aunque se busque sin tildes', async () => {
    // Nadie escribe "lámpara" con tilde en un buscador, y no encontrar nada
    // se interpreta como que el importador está roto, no como que falta un
    // acento.
    const adaptador = new MockSupplierAdapter({});

    const conTilde = await adaptador.buscar({ q: 'lámpara', pagina: 1, porPagina: 10 });
    const sinTilde = await adaptador.buscar({ q: 'lampara', pagina: 1, porPagina: 10 });

    expect(sinTilde.items.length).toBeGreaterThan(0);
    expect(sinTilde.items.map((p) => p.externalId)).toEqual(
      conTilde.items.map((p) => p.externalId),
    );
  });

  it('busca también en la descripción, no solo en el título', async () => {
    // "bluetooth" no está en ningún título del catálogo simulado.
    const { items } = await new MockSupplierAdapter({}).buscar({
      q: 'bluetooth',
      pagina: 1,
      porPagina: 10,
    });

    expect(items.length).toBeGreaterThan(0);
  });

  it('la misma clave de idempotencia no crea dos pedidos', async () => {
    // Es la garantía que evita comprar dos veces al proveedor cuando un
    // reintento llega después de que la primera llamada ya funcionara.
    const adaptador = new MockSupplierAdapter({});

    const solicitud = {
      referenciaInterna: 'ES-2026-000002',
      idempotencyKey: 'la-misma-clave',
      lineas: [{ externalProductId: 'SIM-1001', quantity: 1, expectedCostCents: 1450 }],
      envio: {
        firstName: 'Ana',
        lastName: 'Ruiz',
        line1: 'Calle Mayor 1',
        city: 'Madrid',
        province: 'Madrid',
        postalCode: '28013',
        countryCode: 'ES',
      },
    };

    const primero = await adaptador.crearPedido(solicitud);
    const segundo = await adaptador.crearPedido(solicitud);

    expect(segundo.externalOrderId).toBe(primero.externalOrderId);
  });
});
