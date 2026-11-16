import { defineConfig } from 'vitest/config';
import { cobertura } from '../../vitest.cobertura.mjs';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    passWithNoTests: true,
    // Es el paquete que decide cada importe en céntimos, cada idioma y cada
    // conversión de un dato que viene de fuera: aquí el suelo sí puede ser
    // alto, porque no hay nada que dependa de una base de datos.
    coverage: cobertura({
      incluir: ['src/**/*.ts'],
      umbrales: { statements: 92, branches: 88, functions: 91, lines: 93 },
    }),
  },
});
