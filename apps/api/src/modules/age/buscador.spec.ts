import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { esBuscadorAvisado, firmaBuscador } from './buscador.js';

const SECRETO = 'un-secreto-de-pruebas-bastante-largo';

describe('aviso de buscador verificado', () => {
  it('acepta la firma que calcula la tienda', () => {
    // La tienda la calcula por su cuenta (apps/storefront/src/lib/visitante.ts):
    // si una de las dos cambia la etiqueta, Google vuelve a recibir la puerta.
    const deLaTienda = createHmac('sha256', SECRETO).update('buscador-verificado:v1').digest('hex');

    expect(firmaBuscador(SECRETO)).toBe(deLaTienda);
    expect(esBuscadorAvisado(deLaTienda, SECRETO)).toBe(true);
  });

  it('rechaza una firma hecha con otro secreto', () => {
    expect(esBuscadorAvisado(firmaBuscador('otro-secreto-cualquiera-largo'), SECRETO)).toBe(false);
  });

  it('rechaza el secreto en claro', () => {
    expect(esBuscadorAvisado(SECRETO, SECRETO)).toBe(false);
  });

  it('rechaza valores vacíos, de otro tipo o con longitud distinta', () => {
    expect(esBuscadorAvisado(undefined, SECRETO)).toBe(false);
    expect(esBuscadorAvisado('', SECRETO)).toBe(false);
    expect(esBuscadorAvisado(['a'], SECRETO)).toBe(false);
    expect(esBuscadorAvisado('1', SECRETO)).toBe(false);
  });

  it('sin secreto configurado no abre nunca', () => {
    expect(esBuscadorAvisado(firmaBuscador(SECRETO), undefined)).toBe(false);
    expect(esBuscadorAvisado(firmaBuscador(''), '')).toBe(false);
  });
});
