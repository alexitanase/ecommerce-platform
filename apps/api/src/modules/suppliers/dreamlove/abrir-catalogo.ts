import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import type { Readable } from 'node:stream';
import yauzl from 'yauzl';

/**
 * Abrir el catálogo de un proveedor venga como venga.
 *
 * Dreamlove lo manda **normalmente en un ZIP** —342 MB de XML se quedan en 61
 * comprimidos—, pero alguna vez llega el XML suelto o comprimido con gzip. Los
 * tres casos acaban en lo mismo: una secuencia de trozos que el analizador va
 * leyendo. Que el fichero venga envuelto es un detalle del transporte y no
 * tiene por qué asomar en el resto de la importación.
 *
 * Nada se descomprime a disco ni a memoria: se lee el ZIP por dentro y se saca
 * la entrada como stream. Descomprimir antes significaría escribir 342 MB en el
 * disco del servidor para volver a leerlos acto seguido.
 */

/** Lo que se abre no siempre es lo que se subió: dentro de un ZIP hay más. */
export interface CatalogoAbierto {
  contenido: AsyncIterable<Buffer>;
  /** Qué se ha leído de dentro del contenedor; null si no venía en uno. */
  entrada: string | null;
  /** Cierra el fichero. Hay que llamarlo siempre, también si falla la lectura. */
  cerrar: () => void;
}

export type FormatoCatalogo = 'xml' | 'gzip' | 'zip';

/**
 * Tope de lo que se acepta descomprimir, en bytes.
 *
 * El catálogo real ocupa 342 MB, así que 3 GB deja sitio para que se triplique.
 * Existe porque un ZIP declara dentro lo que ocupa descomprimido y ese número
 * puede ser absurdo: unos megas de fichero pueden anunciar cien gigas —lo que
 * se conoce como bomba de descompresión— y llenar la base de datos y el disco
 * antes de que a nadie le dé tiempo a pararlo. Se comprueba ANTES de leer un
 * solo byte, porque para eso está escrito en el índice del ZIP.
 */
const MAXIMO_DESCOMPRIMIDO = 3 * 1024 * 1024 * 1024;

/**
 * Qué clase de fichero es, mirando dentro y no la extensión.
 *
 * La extensión es lo que alguien escribió al guardarlo, y renombrar un `.zip` a
 * `.xml` no lo convierte en XML. Los primeros bytes sí lo dicen: «PK» abre todo
 * ZIP y `1f 8b` todo gzip, por definición del formato.
 */
export async function formatoDe(ruta: string): Promise<FormatoCatalogo> {
  const fichero = await open(ruta, 'r');
  try {
    const cabecera = Buffer.alloc(4);
    const { bytesRead } = await fichero.read(cabecera, 0, 4, 0);
    if (bytesRead >= 2) {
      if (cabecera[0] === 0x50 && cabecera[1] === 0x4b) return 'zip';
      if (cabecera[0] === 0x1f && cabecera[1] === 0x8b) return 'gzip';
    }
    return 'xml';
  } finally {
    await fichero.close();
  }
}

export async function abrirCatalogo(ruta: string): Promise<CatalogoAbierto> {
  const formato = await formatoDe(ruta);

  if (formato === 'zip') return abrirZip(ruta);

  const lectura = createReadStream(ruta);
  if (formato === 'xml') {
    return { contenido: lectura, entrada: null, cerrar: () => lectura.destroy() };
  }

  const descomprimido = lectura.pipe(createGunzip());
  return {
    contenido: descomprimido,
    entrada: null,
    cerrar: () => {
      lectura.destroy();
      descomprimido.destroy();
    },
  };
}

async function abrirZip(ruta: string): Promise<CatalogoAbierto> {
  // `lazyEntries` para recorrer el índice a mano y `autoClose: false` porque el
  // fichero tiene que seguir abierto mientras se lee la entrada elegida.
  const zip = await new Promise<yauzl.ZipFile>((resolver, rechazar) => {
    yauzl.open(ruta, { lazyEntries: true, autoClose: false }, (error, abierto) => {
      if (error || !abierto) rechazar(error ?? new Error('No se ha podido abrir el ZIP'));
      else resolver(abierto);
    });
  });

  try {
    const elegida = elegirEntrada(await listarEntradas(zip));

    if (elegida.uncompressedSize > MAXIMO_DESCOMPRIMIDO) {
      throw new Error(
        `«${elegida.fileName}» dice ocupar ${Math.round(elegida.uncompressedSize / 1024 / 1024)} MB ` +
          `descomprimido, más de los ${Math.round(MAXIMO_DESCOMPRIMIDO / 1024 / 1024 / 1024)} GB ` +
          'que se aceptan. Si el catálogo ha crecido de verdad, hay que subir ese límite.',
      );
    }

    const stream = await new Promise<Readable>((resolver, rechazar) => {
      zip.openReadStream(elegida, (error, abierto) => {
        if (error || !abierto) rechazar(error ?? new Error('No se ha podido leer la entrada'));
        else resolver(abierto);
      });
    });

    // Un XML comprimido DENTRO del ZIP. No es lo normal, pero cuesta tres
    // líneas y evita que un catálogo perfectamente válido se rechace por venir
    // envuelto dos veces.
    const contenido = /\.gz$/i.test(elegida.fileName) ? stream.pipe(createGunzip()) : stream;

    return {
      contenido,
      entrada: elegida.fileName,
      cerrar: () => {
        contenido.destroy();
        zip.close();
      },
    };
  } catch (error) {
    zip.close();
    throw error;
  }
}

function listarEntradas(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolver, rechazar) => {
    const entradas: yauzl.Entry[] = [];

    zip.on('entry', (entrada: yauzl.Entry) => {
      entradas.push(entrada);
      zip.readEntry();
    });
    zip.on('end', () => resolver(entradas));
    zip.on('error', rechazar);

    zip.readEntry();
  });
}

/**
 * Cuál de los ficheros del ZIP es el catálogo.
 *
 * Casi siempre hay uno solo, pero no siempre: un ZIP hecho en un Mac trae
 * además la carpeta `__MACOSX` con un fichero de metadatos por cada entrada, y
 * a veces viene un `léeme.txt` al lado. Coger «el primero» daría con esa basura
 * y la importación fallaría diciendo que el catálogo no tiene productos, que es
 * el mensaje que más tiempo hace perder.
 */
export function elegirEntrada(entradas: yauzl.Entry[]): yauzl.Entry {
  const ficheros = entradas.filter(
    (e) =>
      // Las carpetas se anuncian con una barra al final.
      !e.fileName.endsWith('/') &&
      !e.fileName.startsWith('__MACOSX/') &&
      !nombreDe(e.fileName).startsWith('.'),
  );

  if (ficheros.length === 0) {
    throw new Error('El ZIP no contiene ningún fichero.');
  }

  const xml = ficheros.filter((e) => /\.xml(\.gz)?$/i.test(e.fileName));

  // Con varios XML dentro, el catálogo es el gordo: los otros suelen ser un
  // índice o una muestra.
  if (xml.length > 0) {
    return [...xml].sort((a, b) => b.uncompressedSize - a.uncompressedSize)[0] as yauzl.Entry;
  }

  // Sin ninguno con extensión .xml se acepta si hay UN solo fichero: hay
  // proveedores que lo mandan sin extensión. Con varios no se adivina.
  if (ficheros.length === 1) return ficheros[0] as yauzl.Entry;

  throw new Error(
    `El ZIP no trae ningún .xml y contiene varios ficheros (${ficheros
      .map((e) => e.fileName)
      .slice(0, 5)
      .join(', ')}). Descomprímelo y sube el catálogo directamente.`,
  );
}

const nombreDe = (ruta: string): string => ruta.split('/').pop() ?? ruta;
