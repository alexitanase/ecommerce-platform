import { defineConfig } from 'vitest/config';

/**
 * Pruebas de integración: la API de verdad contra una base de datos de verdad.
 *
 * Van en una configuración aparte para que `pnpm test` siga siendo rápido y no
 * necesite Docker: quien solo toca lógica de dominio no debería tener que
 * levantar Postgres para ver si ha roto algo.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    /*
     * Índices propios en el buscador.
     *
     * Va aquí y no en `entorno.ts` porque `test/entorno.ts` importa `AppModule`
     * en su cabecera: cuando se ejecuta la primera línea de `crearEntorno`, el
     * servicio de búsqueda ya está cargado. Vitest aplica esto antes de importar
     * nada, que es el único momento que sirve.
     *
     * Sin ello, las pruebas escriben en los mismos índices que el entorno de
     * desarrollo —Postgres y Redis sí van aparte, el buscador no iba— y la
     * tienda acaba listando productos de prueba que al abrirlos dan 404.
     */
    env: { MEILI_PREFIJO_INDICE: 'pruebas_' },
    // Un fichero cada vez: todos comparten la misma base y el mismo Redis, así
    // que ejecutarlos a la vez haría que uno vaciara los datos del otro a mitad
    // de una prueba. Es más lento y es lo correcto.
    fileParallelism: false,
    // Levantar la aplicación entera y migrar tarda más que un test unitario.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
