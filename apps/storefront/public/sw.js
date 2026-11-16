/*
 * Service worker de la tienda.
 *
 * Lo que se busca es que la tienda abra al instante en una conexión mala y que
 * enseñe algo con sentido sin conexión. Lo que NO se busca es funcionar entera
 * sin red: es una tienda, y servir un precio o un stock guardados hace tres
 * días es peor que decir "no hay conexión".
 *
 * De ahí las reglas:
 *
 *  - Los ficheros de `/_next/static/` se sirven de la caché sin preguntar. Su
 *    nombre incluye un hash del contenido, así que si cambian, cambia la URL:
 *    es imposible servir uno viejo por error.
 *  - Las imágenes, de la caché y se refrescan por detrás. Una foto de producto
 *    desactualizada no engaña a nadie.
 *  - Las páginas van SIEMPRE a la red primero. Solo si falla se sirve la copia
 *    guardada, y con ella el aviso de que se está viendo sin conexión.
 *  - La API no se cachea NUNCA: precios, stock, carrito y sesión. Un carrito
 *    servido de una caché es un pedido mal hecho.
 *
 * Cambiar la versión invalida todo lo guardado: es el interruptor para cuando
 * una regla de aquí resulte estar mal.
 */

const VERSION = 'v2';
const CACHE_ESTATICOS = `estaticos-${VERSION}`;
const CACHE_PAGINAS = `paginas-${VERSION}`;
const CACHE_IMAGENES = `imagenes-${VERSION}`;

/** Cuántas páginas e imágenes se guardan como mucho. */
const MAXIMO_PAGINAS = 30;
const MAXIMO_IMAGENES = 60;

/**
 * Páginas que no se guardan nunca, aunque se visiten.
 *
 * Llevan datos de una persona concreta —su pedido, su dirección, su correo— y
 * la caché del navegador sobrevive al cierre de sesión. En un ordenador
 * compartido, el siguiente en usarlo podría abrirlas sin conexión y verlas.
 */
const SIN_CACHE = ['/checkout', '/cuenta', '/pedido/', '/preferencias'];

self.addEventListener('install', (evento) => {
  // Sin esperar a que se cierren las pestañas viejas: una tienda no tiene
  // estado que se pierda al cambiar de versión del worker.
  self.skipWaiting();

  // La página de cortesía se guarda AHORA, con conexión. Guardarla la primera
  // vez que haga falta es imposible: para entonces ya no hay red.
  evento.waitUntil(caches.open(CACHE_PAGINAS).then((cache) => cache.add('/offline.html')));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(nombres.filter((n) => !n.endsWith(VERSION)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/** Recorta una caché a sus N entradas más recientes. */
async function recortar(nombre, maximo) {
  const cache = await caches.open(nombre);
  const claves = await cache.keys();
  if (claves.length <= maximo) return;

  // Las claves salen en orden de inserción: se borran las primeras.
  await Promise.all(claves.slice(0, claves.length - maximo).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;

  // Solo GET del mismo origen. Un POST no se cachea nunca, y las llamadas a
  // otros dominios (la API, las fotos del proveedor) las gestiona el navegador.
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  // La API queda fuera, incluso en el mismo origen: precios, stock y sesión.
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/')) {
    evento.respondWith(cacheFirst(peticion, CACHE_ESTATICOS));
    return;
  }

  if (
    url.pathname.startsWith('/_next/image') ||
    /\.(png|jpe?g|webp|avif|svg|ico)$/i.test(url.pathname)
  ) {
    evento.respondWith(imagenConRefresco(peticion));
    return;
  }

  // Navegación entre páginas.
  if (peticion.mode === 'navigate') {
    const privada = SIN_CACHE.some((ruta) => url.pathname.includes(ruta));
    evento.respondWith(redPrimero(peticion, !privada));
  }
});

/**
 * De la caché al instante y, en paralelo, se refresca para la próxima vez.
 *
 * Antes era caché a secas, dando por hecho que la URL de un estático lleva
 * hash y por tanto su contenido no cambia nunca. Es cierto en producción y
 * falso en desarrollo, donde el nombre del fichero es estable: ahí el worker
 * servía la primera versión que cacheó y ninguna edición del CSS volvía a
 * verse jamás.
 *
 * Con el refresco en segundo plano se queda igual de rápido —se responde de la
 * caché sin esperar a la red— y deja de haber una manera de quedarse clavado
 * en una versión para siempre: como mucho se ve una vez la anterior.
 */
async function cacheFirst(peticion, nombreCache) {
  const cache = await caches.open(nombreCache);
  const guardada = await cache.match(peticion);

  const enRed = fetch(peticion)
    .then(async (respuesta) => {
      if (respuesta.ok) await cache.put(peticion, respuesta.clone());
      return respuesta;
    })
    .catch(() => null);

  if (guardada) return guardada;

  const respuesta = await enRed;
  if (respuesta) return respuesta;

  return new Response('', { status: 504, statusText: 'Sin conexión' });
}

async function imagenConRefresco(peticion) {
  const cache = await caches.open(CACHE_IMAGENES);
  const guardada = await cache.match(peticion);

  const enRed = fetch(peticion)
    .then(async (respuesta) => {
      if (respuesta.ok) {
        await cache.put(peticion, respuesta.clone());
        await recortar(CACHE_IMAGENES, MAXIMO_IMAGENES);
      }
      return respuesta;
    })
    .catch(() => guardada);

  // Si hay copia, se enseña ya y la red actualiza por detrás.
  return guardada ?? enRed;
}

async function redPrimero(peticion, sePuedeGuardar) {
  const cache = await caches.open(CACHE_PAGINAS);

  try {
    const respuesta = await fetch(peticion);

    if (respuesta.ok && sePuedeGuardar) {
      await cache.put(peticion, respuesta.clone());
      await recortar(CACHE_PAGINAS, MAXIMO_PAGINAS);
    }

    return respuesta;
  } catch {
    const guardada = sePuedeGuardar ? await cache.match(peticion) : null;
    if (guardada) return guardada;

    // Ni red ni copia: la página de cortesía, que al menos explica qué pasa.
    const offline = await cache.match('/offline.html');
    return (
      offline ??
      new Response('<h1>Sin conexión</h1>', {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    );
  }
}
