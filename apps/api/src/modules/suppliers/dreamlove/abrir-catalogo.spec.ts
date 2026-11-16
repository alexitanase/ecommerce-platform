import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Entry } from 'yauzl';
import { abrirCatalogo, elegirEntrada, formatoDe } from './abrir-catalogo.js';
import { crearZip } from './zip-de-prueba.js';

/**
 * Abrir el catálogo venga como venga.
 *
 * Dreamlove lo manda normalmente en un ZIP, y el resto de la importación no
 * tiene por qué enterarse: aquí se comprueba que los tres envoltorios —ZIP,
 * gzip y XML suelto— acaban en el mismo contenido, y sobre todo que dentro de
 * un ZIP se elige el fichero correcto. Equivocarse ahí no da un error claro:
 * da una importación que dice haber leído cero productos.
 */

const XML =
  '<?xml version="1.0" encoding="UTF-8"?><catalog><product><id>1</id></product></catalog>';

let carpeta: string;

/** Escribe un fichero temporal y devuelve su ruta. */
async function escribir(nombre: string, contenido: Buffer | string): Promise<string> {
  const ruta = join(carpeta, nombre);
  await writeFile(ruta, contenido);
  return ruta;
}

async function leerTodo(contenido: AsyncIterable<Buffer>): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const trozo of contenido) trozos.push(trozo);
  return Buffer.concat(trozos).toString('utf8');
}

/** Una entrada del índice del ZIP, con lo poco que mira la elección. */
const entrada = (fileName: string, uncompressedSize = 100): Entry =>
  ({ fileName, uncompressedSize }) as Entry;

beforeAll(async () => {
  carpeta = await mkdtemp(join(tmpdir(), 'catalogo-pruebas-'));
});

afterAll(async () => {
  await rm(carpeta, { recursive: true, force: true });
});

describe('reconocer el formato', () => {
  it('lo decide por el contenido y no por la extensión', async () => {
    // Renombrar un ZIP a .xml no lo convierte en XML, y es un despiste que se
    // comete al descomprimir a medias. Los primeros bytes no mienten: «PK»
    // abre todo ZIP y 1f 8b todo gzip, por definición del formato.
    const zipDisfrazado = await escribir(
      'mentira.xml',
      crearZip([{ nombre: 'a.xml', contenido: XML }]),
    );
    const gzipDisfrazado = await escribir('mentira2.xml', gzipSync(Buffer.from(XML)));
    const xml = await escribir('sincero.xml', XML);

    expect(await formatoDe(zipDisfrazado)).toBe('zip');
    expect(await formatoDe(gzipDisfrazado)).toBe('gzip');
    expect(await formatoDe(xml)).toBe('xml');
  });

  it('un fichero vacío no revienta: se trata como XML y ya fallará al leerlo', async () => {
    expect(await formatoDe(await escribir('vacio.xml', ''))).toBe('xml');
  });
});

describe('abrir el catálogo', () => {
  it('lee el XML suelto', async () => {
    const catalogo = await abrirCatalogo(await escribir('catalogo.xml', XML));

    expect(await leerTodo(catalogo.contenido)).toBe(XML);
    expect(catalogo.entrada).toBeNull();
    catalogo.cerrar();
  });

  it('descomprime el gzip al vuelo', async () => {
    const catalogo = await abrirCatalogo(
      await escribir('catalogo.xml.gz', gzipSync(Buffer.from(XML))),
    );

    expect(await leerTodo(catalogo.contenido)).toBe(XML);
    catalogo.cerrar();
  });

  it('saca el XML de dentro del ZIP, que es como lo mandan', async () => {
    const catalogo = await abrirCatalogo(
      await escribir('catalogo.zip', crearZip([{ nombre: 'dreamlove.xml', contenido: XML }])),
    );

    // Nada se ha descomprimido a disco: se lee la entrada del ZIP directamente.
    expect(await leerTodo(catalogo.contenido)).toBe(XML);
    // Y se anota QUÉ se ha leído: con varios ficheros dentro, es lo que explica
    // después un recuento que no cuadra.
    expect(catalogo.entrada).toBe('dreamlove.xml');
    catalogo.cerrar();
  });

  it('ignora la basura que mete un Mac al comprimir', async () => {
    const catalogo = await abrirCatalogo(
      await escribir(
        'mac.zip',
        crearZip([
          { nombre: '__MACOSX/._dreamlove.xml', contenido: 'metadatos' },
          { nombre: '.DS_Store', contenido: 'basura' },
          { nombre: 'dreamlove.xml', contenido: XML },
        ]),
      ),
    );

    // Cogiendo «el primero» se leerían los metadatos de macOS y la importación
    // diría que el catálogo no tiene productos.
    expect(catalogo.entrada).toBe('dreamlove.xml');
    expect(await leerTodo(catalogo.contenido)).toBe(XML);
    catalogo.cerrar();
  });

  it('acepta un XML comprimido dentro del ZIP', async () => {
    const catalogo = await abrirCatalogo(
      await escribir(
        'doble.zip',
        crearZip([{ nombre: 'dreamlove.xml.gz', contenido: gzipSync(Buffer.from(XML)) }]),
      ),
    );

    expect(await leerTodo(catalogo.contenido)).toBe(XML);
    catalogo.cerrar();
  });

  it('explica qué pasa cuando el ZIP no trae ningún catálogo', async () => {
    const ruta = await escribir(
      'documentos.zip',
      crearZip([
        { nombre: 'tarifas.pdf', contenido: 'pdf' },
        { nombre: 'condiciones.docx', contenido: 'doc' },
      ]),
    );

    // Un mensaje que diga qué había dentro ahorra volver a descargarlo para
    // mirarlo a mano.
    await expect(abrirCatalogo(ruta)).rejects.toThrow(/tarifas\.pdf/);
  });
});

describe('elegir qué fichero del ZIP es el catálogo', () => {
  it('el único que hay', () => {
    expect(elegirEntrada([entrada('dreamlove.xml')]).fileName).toBe('dreamlove.xml');
  });

  it('el XML más grande cuando hay varios', () => {
    // Los ZIP de proveedor traen a veces una muestra al lado del catálogo real.
    const elegida = elegirEntrada([
      entrada('muestra.xml', 2_000),
      entrada('catalogo-completo.xml', 900_000),
      entrada('leeme.txt', 500),
    ]);

    expect(elegida.fileName).toBe('catalogo-completo.xml');
  });

  it('descarta carpetas', () => {
    const elegida = elegirEntrada([entrada('catalogos/', 0), entrada('catalogos/dl.xml', 100)]);
    expect(elegida.fileName).toBe('catalogos/dl.xml');
  });

  it('acepta un fichero sin extensión si es el único', () => {
    // Hay proveedores que lo mandan sin extensión; con uno solo no hay duda.
    expect(elegirEntrada([entrada('catalogo')]).fileName).toBe('catalogo');
  });

  it('no adivina entre varios ficheros sin extensión', () => {
    expect(() => elegirEntrada([entrada('uno'), entrada('dos')])).toThrow(/varios ficheros/);
  });

  it('avisa si el ZIP viene vacío', () => {
    expect(() => elegirEntrada([])).toThrow(/ningún fichero/);
  });
});
