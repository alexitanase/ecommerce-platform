/**
 * Opciones de Fastify que comparten el servidor y las pruebas.
 *
 * Están aquí porque no coincidían. `main.ts` configuraba el adaptador y el
 * entorno de pruebas lo creaba vacío —`new FastifyAdapter()`—, así que las
 * pruebas recorrían un servidor parecido pero no el mismo. Es la clase de
 * diferencia que no se nota hasta que un fallo de producción no lo reproduce
 * ninguna prueba, que es exactamente lo que pasó con el límite de abajo.
 */

/**
 * Longitud máxima de un parámetro de ruta.
 *
 * Fastify trae 100 por defecto y eso dejaba caída la ficha de cualquier
 * producto importado: los slugs de AliExpress salen del título del vendedor y se
 * van largos —«plug-anal-largo-dildos-de-caballo-estimulacion-de-prostata-…»,
 * 136 caracteres—. La API respondía **414** al pedir la ficha por su slug y la
 * tienda devolvía un 500 a quien abría el producto. Con un catálogo de un solo
 * producto publicado, eso era la tienda entera.
 *
 * 512 y no ilimitado: el límite existe para que una URL absurdamente larga no
 * llegue al enrutador, y sigue cumpliendo ese papel con margen de sobra para un
 * slug real.
 */
export const MAX_LONGITUD_PARAMETRO = 512;

/** 10 MB: lo que ocupa una foto de producto sin recomprimir. */
export const LIMITE_CUERPO = 10 * 1024 * 1024;

/**
 * Lo que no depende del entorno, para que no pueda divergir entre los dos.
 *
 * `maxParamLength` va dentro de `routerOptions` y no en la raíz: en la raíz
 * sigue funcionando pero Fastify 5 avisa de que está obsoleto y lo quita en la 6.
 */
export const OPCIONES_FASTIFY = {
  bodyLimit: LIMITE_CUERPO,
  routerOptions: { maxParamLength: MAX_LONGITUD_PARAMETRO },
} as const;
