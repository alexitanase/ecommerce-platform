import { defineConfig } from 'vitest/config';
import { cobertura } from '../../vitest.cobertura.mjs';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    passWithNoTests: true,
    // Lo cubierto son NOWPayments, Revolut y Stripe, las tres pasarelas
    // implementadas; PayPal sigue siendo un esqueleto. Al implementarla, este
    // suelo sube con ella.
    coverage: cobertura({
      incluir: ['src/**/*.ts'],
      umbrales: { statements: 73, branches: 57, functions: 85, lines: 74 },
    }),
  },
});
