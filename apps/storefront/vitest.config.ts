import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { cobertura } from '../../vitest.cobertura.mjs';

/**
 * Pruebas de la lógica de la tienda.
 *
 * Entorno jsdom porque lo que se prueba aquí —consentimiento de cookies,
 * carrito— vive en el navegador y necesita localStorage, document.cookie y
 * eventos de ventana.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    // El suelo es bajo y tiene explicación: casi todo este paquete son
    // componentes de React que se prueban en el navegador con Playwright, no
    // aquí. Lo que sí cuenta es que la lógica que no pasa por la pantalla
    // —contraste, carrito, consentimiento— no deje de estar cubierta.
    coverage: cobertura({
      incluir: ['src/lib/**/*.ts', 'src/stores/**/*.ts'],
      umbrales: { statements: 36, branches: 28, functions: 22, lines: 36 },
    }),
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
});
