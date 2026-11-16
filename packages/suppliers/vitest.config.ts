import { defineConfig } from 'vitest/config';
import { cobertura } from '../../vitest.cobertura.mjs';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: cobertura({
      incluir: ['src/**/*.ts'],
      umbrales: { statements: 78, branches: 61, functions: 78, lines: 81 },
    }),
  },
});
