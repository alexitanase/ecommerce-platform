import { SetMetadata } from '@nestjs/common';

export const CACHE_HTTP = 'cache_http';

export interface OpcionesCacheHttp {
  /** Segundos que un CDN o proxy puede reutilizar la respuesta. */
  compartida: number;
  /** Segundos que el navegador del cliente puede reutilizarla. */
  navegador?: number;
  /**
   * Segundos que el CDN puede seguir sirviendo la copia vieja mientras pide
   * una nueva por detrás.
   */
  mientrasRevalida?: number;
}

/**
 * Marca una respuesta como cacheable por el CDN.
 *
 * La distinción clave es entre la caché compartida (`s-maxage`, el CDN) y la
 * del navegador (`max-age`). Al navegador se le da un margen corto o ninguno:
 * si un precio cambia, el CDN se purga en segundos, pero una copia guardada en
 * el disco del cliente no hay forma de alcanzarla hasta que caduque sola.
 *
 * `stale-while-revalidate` es lo que evita el pico de latencia al caducar: el
 * CDN sigue respondiendo con la copia vieja mientras pide la nueva, así que
 * ningún cliente paga la espera del recálculo.
 */
export const CacheHttp = (opciones: OpcionesCacheHttp) => SetMetadata(CACHE_HTTP, opciones);
