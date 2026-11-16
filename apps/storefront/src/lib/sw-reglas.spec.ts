import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Reglas del service worker.
 *
 * El worker no se puede ejecutar aquí —necesita el navegador— pero sus reglas
 * sí se pueden comprobar, y son las que deciden si la tienda enseña un precio
 * de hace tres días o los datos de un pedido ajeno en un ordenador compartido.
 *
 * Se leen del fichero real en lugar de reescribirlas: una copia se
 * desincroniza, y entonces la prueba pasa mientras el worker hace otra cosa.
 */

const sw = readFileSync(path.resolve(import.meta.dirname, '../../public/sw.js'), 'utf8');
const registro = readFileSync(
  path.resolve(import.meta.dirname, '../components/registrar-sw.tsx'),
  'utf8',
);

/** Extrae un array declarado como `const NOMBRE = [...]`. */
function listaDeclarada(nombre: string): string[] {
  const bloque = new RegExp(`const ${nombre} = \\[([^\\]]*)\\]`).exec(sw);
  if (!bloque?.[1]) throw new Error(`No se encuentra la lista ${nombre} en sw.js`);

  return [...bloque[1].matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

describe('Qué se cachea', () => {
  it('la API queda fuera', () => {
    // Precios, stock, carrito y sesión. Servir esto de una caché es vender a
    // un precio que ya no existe o enseñar un carrito que no es.
    expect(sw).toContain("url.pathname.startsWith('/api/')");
  });

  it('solo el mismo origen', () => {
    expect(sw).toContain('url.origin !== self.location.origin');
  });

  it('solo peticiones GET', () => {
    // Un POST cacheado sería un pedido o un pago repetido.
    expect(sw).toContain("peticion.method !== 'GET'");
  });

  it('las páginas van a la red primero', () => {
    // Cache-first en las páginas serviría precios viejos con conexión buena.
    expect(sw).toContain('redPrimero(peticion');
    expect(sw).not.toContain('cacheFirst(peticion, CACHE_PAGINAS)');
  });

  it('los estáticos con hash sí van de la caché', () => {
    // Su URL cambia cuando cambia el contenido: es imposible servir uno viejo.
    expect(sw).toContain("url.pathname.startsWith('/_next/static/')");
    expect(sw).toContain('cacheFirst(peticion, CACHE_ESTATICOS)');
  });
});

describe('Páginas con datos personales', () => {
  const sinCache = listaDeclarada('SIN_CACHE');

  it('el checkout, la cuenta, el pedido y las preferencias no se guardan', () => {
    // La caché sobrevive al cierre de sesión: en un ordenador compartido, el
    // siguiente podría abrirlas sin conexión.
    expect(sinCache).toEqual(
      expect.arrayContaining(['/checkout', '/cuenta', '/pedido/', '/preferencias']),
    );
  });

  it('la lista no se aplica a la portada ni al catálogo', () => {
    // Serían justo las que más interesa tener disponibles sin conexión.
    const publicas = ['/es', '/es/buscar', '/es/producto/botas', '/es/carrito'];
    for (const ruta of publicas) {
      expect(sinCache.some((p) => ruta.includes(p))).toBe(false);
    }
  });
});

describe('Ciclo de vida', () => {
  it('la página de cortesía se guarda al instalar', () => {
    // Guardarla cuando haga falta es imposible: para entonces no hay red.
    expect(sw).toContain("cache.add('/offline.html')");
  });

  it('al activarse borra las cachés de versiones anteriores', () => {
    expect(sw).toContain('caches.delete');
    expect(sw).toContain('!n.endsWith(VERSION)');
  });

  it('las cachés se recortan para no crecer sin límite', () => {
    expect(sw).toContain('MAXIMO_PAGINAS');
    expect(sw).toContain('MAXIMO_IMAGENES');
  });
});

describe('Quedarse clavado en una versión vieja', () => {
  /*
   * El fallo que motiva estas tres comprobaciones no dio ningún error y costó
   * una tarde: la cabecera se veía partida en tres filas en una pantalla y
   * bien en todas las demás. El worker de una compilación de producción de
   * hacía semanas seguía instalado en ese navegador y servía de su caché el
   * CSS de entonces, sin las clases nuevas. Ninguna consola dijo nada.
   */

  it('los estáticos se refrescan por detrás, no se sirven de la caché y ya', () => {
    // Servir de la caché es correcto; no volver a mirar nunca, no. Con las
    // URLs con hash de producción da igual, pero en desarrollo el nombre del
    // fichero es estable y sin refresco la primera versión se queda para
    // siempre.
    const cuerpo = /async function cacheFirst\([\s\S]*?\n}/.exec(sw)?.[0] ?? '';

    expect(cuerpo).toContain('fetch(peticion)');
    expect(cuerpo).toContain('cache.put');
  });

  it('el worker solo se registra en producción', () => {
    expect(registro).toContain("process.env.NODE_ENV !== 'production'");
  });

  it('fuera de producción se retira el que hubiera, con sus cachés', () => {
    // Sin esto, haber levantado una vez `next start` deja el worker mandando
    // en localhost para siempre y los cambios de CSS dejan de verse.
    expect(registro).toContain('getRegistrations');
    expect(registro).toContain('unregister');
    expect(registro).toContain('caches.delete');
  });
});
