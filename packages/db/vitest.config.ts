import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Aún no hay tests en este paquete; que falte no debe romper el pipeline.
    passWithNoTests: true,
  },
});
