/**
 * Generación de CSV para abrir en Excel español.
 *
 * Dos detalles que deciden si el fichero se abre bien o sale como una sola
 * columna ilegible, y que no se ven hasta que alguien lo abre de verdad:
 *
 *  1. **El separador es punto y coma.** Excel en español espera `;` porque la
 *     coma es el separador decimal. Un CSV con comas se abre con todo apelmazado
 *     en la columna A y el usuario piensa que el informe está roto.
 *  2. **El BOM de UTF-8.** Sin él, Excel interpreta el fichero como Latin-1 y
 *     los acentos salen como "MÃ³vil". Es tres bytes al principio y ahorra la
 *     mitad de los comentarios sobre informes "con caracteres raros".
 */

/** Separador que espera Excel en configuración regional española. */
const SEPARADOR = ';';

/** Marca de orden de bytes que le dice a Excel que el fichero es UTF-8. */
export const BOM = '﻿';

/**
 * Escapa un valor para CSV.
 *
 * Un texto con separador, comillas o salto de línea rompe la estructura si va
 * tal cual: una descripción de producto con un punto y coma parte la fila en
 * dos y desplaza todas las columnas siguientes.
 */
export function escapar(valor: unknown): string {
  if (valor === null || valor === undefined) return '';

  if (valor instanceof Date) return valor.toISOString().slice(0, 19).replace('T', ' ');

  // Un objeto o un array puesto tal cual sale como "[object Object]": no es un
  // error visible, es una columna entera de basura que solo se descubre al
  // abrir el fichero. Pasa con las columnas JSON, como los datos del cliente
  // congelados en la factura.
  const texto =
    typeof valor === 'string'
      ? valor
      : typeof valor === 'number' || typeof valor === 'boolean' || typeof valor === 'bigint'
        ? String(valor)
        : (JSON.stringify(valor) ?? '');

  if (texto.includes(SEPARADOR) || texto.includes('"') || /[\r\n]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }

  return texto;
}

/**
 * Importe en céntimos como número con coma decimal.
 *
 * Con punto, Excel en español lo lee como texto y no se puede sumar: el
 * informe se ve bien pero no sirve para nada.
 */
export function importe(centimos: number): string {
  return (centimos / 100).toFixed(2).replace('.', ',');
}

export interface Columna<T> {
  titulo: string;
  valor: (fila: T) => unknown;
}

/**
 * Convierte filas en un CSV listo para descargar.
 */
export function generarCsv<T>(filas: T[], columnas: Columna<T>[]): string {
  const cabecera = columnas.map((c) => escapar(c.titulo)).join(SEPARADOR);

  const cuerpo = filas.map((fila) => columnas.map((c) => escapar(c.valor(fila))).join(SEPARADOR));

  // Terminación de línea de Windows: es donde se abren estos ficheros, y con
  // solo \n algunas versiones de Excel juntan todas las filas en una.
  return BOM + [cabecera, ...cuerpo].join('\r\n') + '\r\n';
}

/**
 * Nombre de fichero con la fecha, para que no se pisen en la carpeta de
 * descargas cuando se exporta el mismo informe varias veces.
 */
export function nombreFichero(base: string, desde: Date, hasta: Date): string {
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return `${base}_${f(desde)}_${f(hasta)}.csv`;
}
