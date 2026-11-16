import { describe, expect, it } from 'vitest';
import { extraerIdentificador } from './import.service.js';

/**
 * Lo que se pega en el buscador del importador.
 *
 * En dropshipping el producto se encuentra navegando por la web del proveedor
 * y se trae copiando el enlace de la barra del navegador. Ese enlace llega con
 * el idioma del país, la cola de parámetros de seguimiento que añaden al
 * compartir y, a veces, sin `https://` porque se copió a medias.
 */

describe('Identificador a partir de lo que pegue el usuario', () => {
  it('acepta el identificador a secas', () => {
    expect(extraerIdentificador('1005006789012345')).toBe('1005006789012345');
    expect(extraerIdentificador('  1005006789012345  ')).toBe('1005006789012345');
  });

  it('acepta el formato del proveedor simulado', () => {
    expect(extraerIdentificador('SIM-1002')).toBe('SIM-1002');
  });

  it('saca el identificador de la URL del producto', () => {
    expect(extraerIdentificador('https://www.aliexpress.com/item/1005006789012345.html')).toBe(
      '1005006789012345',
    );
  });

  it('funciona con los dominios por país', () => {
    expect(extraerIdentificador('https://es.aliexpress.com/item/1005006789012345.html')).toBe(
      '1005006789012345',
    );
  });

  it('ignora la cola de parámetros de seguimiento', () => {
    // Es exactamente lo que sale al pulsar "compartir" en su web.
    expect(
      extraerIdentificador(
        'https://es.aliexpress.com/item/1005006789012345.html?spm=a2g0o.home&gatewayAdapt=glo2esp',
      ),
    ).toBe('1005006789012345');
  });

  it('no se queda con un número de la cola de parámetros', () => {
    // El de la ruta es el bueno; `spm` y compañía traen números largos que
    // importarían un producto que no es el que se quería.
    expect(
      extraerIdentificador(
        'https://www.aliexpress.com/item/1005006789012345.html?pdp=99887766554433',
      ),
    ).toBe('1005006789012345');
  });

  it('devuelve null cuando no hay nada reconocible', () => {
    expect(extraerIdentificador('')).toBeNull();
    expect(extraerIdentificador('   ')).toBeNull();
    expect(extraerIdentificador('https://www.aliexpress.com/')).toBeNull();
  });
});
