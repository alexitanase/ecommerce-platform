/**
 * Configuración de cobertura compartida por todos los paquetes.
 *
 * Los umbrales de aquí son un **suelo, no un objetivo**. No dicen "el código
 * está bien probado al 26 %": dicen "no bajes de donde estábamos". Sirven para
 * que un cambio grande sin pruebas no pase desapercibido en la revisión, que es
 * lo único que un porcentaje puede hacer de verdad. Un número alto tampoco
 * demostraría nada —se sube ejecutando código sin comprobar nada de él—, así
 * que se ponen justo por debajo de lo medido y se van subiendo al añadir
 * pruebas, nunca bajando para que pase el pipeline.
 *
 * La cobertura NO se activa en `pnpm test`: instrumentar cuesta segundos y esa
 * ejecución tiene que seguir siendo instantánea. Se mide con
 * `pnpm test:cobertura`, que es lo que ejecuta CI.
 */

/**
 * Lo que no cuenta como código que probar.
 *
 * La lista es corta a propósito. Excluir módulos, DTOs o barriles subiría el
 * porcentaje sin haber probado nada más, que es justo lo que hace inútil a esta
 * métrica. Solo se quitan ficheros donde no hay ninguna decisión que comprobar.
 */
const EXCLUSIONES = [
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.d.ts',
  // Arranque del proceso: se prueba levantándolo, no midiéndolo.
  '**/main.ts',
  '**/instrumentation.ts',
  // Generado por Prisma y por next-intl.
  '**/generated/**',
  '**/.next/**',
];

/**
 * El tipo va anotado a propósito. Sin él, TypeScript infiere `provider: string`
 * al leer este fichero desde un `vitest.config.ts`, y la comprobación de tipos
 * de la tienda —que revisa toda su carpeta— falla al construir.
 *
 * @param {object} opciones
 * @param {string[]} opciones.incluir Patrones del código fuente a medir.
 * @param {{statements: number, branches: number, functions: number, lines: number}} [opciones.umbrales]
 * @returns {import('vitest/node').CoverageV8Options}
 */
export function cobertura({ incluir, umbrales }) {
  return {
    provider: 'v8',
    // Sin esto solo se contarían los ficheros que algún test importa, y un
    // servicio de mil líneas sin una sola prueba no restaría: desaparecería
    // del denominador. Es la diferencia entre el 83 % que salía y el 28 % real.
    include: incluir,
    exclude: EXCLUSIONES,
    reporter: ['text-summary', 'json-summary', 'html'],
    thresholds: umbrales,
  };
}
