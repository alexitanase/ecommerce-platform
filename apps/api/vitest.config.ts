import { defineConfig } from 'vitest/config';
import { cobertura } from '../../vitest.cobertura.mjs';

export default defineConfig({
  test: {
    environment: 'node',
    // Solo lo que no necesita base de datos. Las de integración van en
    // `vitest.integracion.config.ts` y se lanzan con `pnpm test:integracion`,
    // para que esta ejecución siga siendo rápida y sin Docker.
    include: ['src/**/*.spec.ts'],
    passWithNoTests: true,
    // Se mide, pero aquí no se exige nada. El umbral se comprueba sobre la suma
    // de las dos suites en `vitest.cobertura.config.ts`: la mayor parte de la
    // API son servicios que hablan con la base de datos, y solo las pruebas de
    // integración los recorren. Exigirlo sobre esta sola mediría el 14 % y
    // obligaría a bajar el listón para que pasara.
    coverage: cobertura({ incluir: ['src/**/*.ts'] }),
  },
});
