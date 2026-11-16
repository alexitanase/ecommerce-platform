import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Construye un ZIP de verdad, para las pruebas.
 *
 * Node sabe comprimir con gzip y con deflate, pero no sabe montar el
 * *contenedor* ZIP —el índice con las entradas—, y las pruebas necesitan uno
 * auténtico: leerlo es justo lo que hay que comprobar. Se escribe aquí en vez
 * de añadir una dependencia que solo se usaría en pruebas, y en vez de meter un
 * `.zip` binario en el repositorio, que nadie podría revisar en un diff.
 *
 * Es el formato mínimo y estándar: una cabecera por fichero, deflate, el índice
 * central al final y sin ZIP64 (que solo hace falta por encima de 4 GB).
 */
export function crearZip(ficheros: { nombre: string; contenido: Buffer | string }[]): Buffer {
  const partes: Buffer[] = [];
  const indice: Buffer[] = [];
  let desplazamiento = 0;

  for (const fichero of ficheros) {
    const crudo = Buffer.isBuffer(fichero.contenido)
      ? fichero.contenido
      : Buffer.from(fichero.contenido, 'utf8');
    const comprimido = deflateRawSync(crudo);
    const nombre = Buffer.from(fichero.nombre, 'utf8');
    // El CRC va sobre el contenido SIN comprimir: yauzl lo verifica al leer y
    // rechaza la entrada si no cuadra.
    const suma = crc32(crudo);

    const cabecera = Buffer.alloc(30);
    cabecera.writeUInt32LE(0x04034b50, 0); // firma de cabecera local
    cabecera.writeUInt16LE(20, 4); // versión necesaria
    cabecera.writeUInt16LE(0, 6); // sin banderas: tamaños conocidos de antemano
    cabecera.writeUInt16LE(8, 8); // método: deflate
    cabecera.writeUInt16LE(0, 10); // hora
    cabecera.writeUInt16LE(0x21, 12); // fecha (1980-01-01, la mínima válida)
    cabecera.writeUInt32LE(suma, 14);
    cabecera.writeUInt32LE(comprimido.length, 18);
    cabecera.writeUInt32LE(crudo.length, 22);
    cabecera.writeUInt16LE(nombre.length, 26);
    cabecera.writeUInt16LE(0, 28); // sin campos extra

    const entradaIndice = Buffer.alloc(46);
    entradaIndice.writeUInt32LE(0x02014b50, 0); // firma de entrada del índice
    entradaIndice.writeUInt16LE(20, 4);
    entradaIndice.writeUInt16LE(20, 6);
    entradaIndice.writeUInt16LE(0, 8);
    entradaIndice.writeUInt16LE(8, 10);
    entradaIndice.writeUInt16LE(0, 12);
    entradaIndice.writeUInt16LE(0x21, 14);
    entradaIndice.writeUInt32LE(suma, 16);
    entradaIndice.writeUInt32LE(comprimido.length, 20);
    entradaIndice.writeUInt32LE(crudo.length, 24);
    entradaIndice.writeUInt16LE(nombre.length, 28);
    entradaIndice.writeUInt32LE(desplazamiento, 42); // dónde empieza su cabecera

    partes.push(cabecera, nombre, comprimido);
    indice.push(entradaIndice, nombre);
    desplazamiento += cabecera.length + nombre.length + comprimido.length;
  }

  const cuerpo = Buffer.concat(partes);
  const central = Buffer.concat(indice);

  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); // firma de fin del índice central
  fin.writeUInt16LE(ficheros.length, 8);
  fin.writeUInt16LE(ficheros.length, 10);
  fin.writeUInt32LE(central.length, 12);
  fin.writeUInt32LE(cuerpo.length, 16);

  return Buffer.concat([cuerpo, central, fin]);
}
