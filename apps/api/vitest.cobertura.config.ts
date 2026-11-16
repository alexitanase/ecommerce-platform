import { defineConfig } from 'vitest/config';
import { cobertura } from '../../vitest.cobertura.mjs';

/**
 * El umbral de la API, sobre las dos suites juntas.
 *
 * `pnpm test:cobertura` ejecuta las unitarias y las de integración guardando
 * cada una su informe en bruto, y después las fusiona con esta configuración.
 * Es la única medida que significa algo aquí: por separado, las unitarias
 * cubren el 14 % —casi todo lo demás son servicios que necesitan base de
 * datos— y exigir sobre esa cifra llevaría a un suelo tan bajo que no
 * detectaría nada.
 */
export default defineConfig({
  test: {
    environment: 'node',
    coverage: cobertura({
      incluir: ['src/**/*.ts'],
      umbrales: { statements: 36, branches: 25, functions: 28, lines: 36 },
    }),
  },
});
