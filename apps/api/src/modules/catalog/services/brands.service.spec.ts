import { describe, expect, it } from 'vitest';
import { identificadorDeMarca } from './brands.service.js';

/**
 * El identificador de una marca.
 *
 * Es también la clave con la que se decide si dos nombres son la MISMA marca:
 * lo usa el importador cada vez que llega un artículo. Si aplana de menos, el
 * catálogo acaba con «SATISFYER» y «Satisfyer» como dos fabricantes distintos,
 * cada uno con la mitad de los productos.
 */
describe('identificador de marca', () => {
  it('aplana lo que en la práctica varía', () => {
    // Los tres son la misma marca escrita por tres personas distintas.
    expect(identificadorDeMarca('SATISFYER')).toBe('satisfyer');
    expect(identificadorDeMarca('Satisfyer')).toBe('satisfyer');
    // Con el espacio de sobra que trae el fichero del proveedor.
    expect(identificadorDeMarca('SATISFYER ')).toBe('satisfyer');
  });

  it('quita tildes y signos', () => {
    expect(identificadorDeMarca('Óhmama')).toBe('ohmama');
    expect(identificadorDeMarca('PDX PLUS+')).toBe('pdx-plus');
    expect(identificadorDeMarca('L&B')).toBe('l-b');
  });

  it('junta con un solo guion y no deja guiones sueltos en los bordes', () => {
    expect(identificadorDeMarca('  Fun   Factory  ')).toBe('fun-factory');
    expect(identificadorDeMarca('-Baile-')).toBe('baile');
  });

  it('devuelve vacío cuando no queda nada aprovechable', () => {
    // Es lo que permite al importador ignorar una marca que no lo es en vez de
    // crear una fila con el identificador en blanco.
    expect(identificadorDeMarca('   ')).toBe('');
    expect(identificadorDeMarca('+++')).toBe('');
  });
});
