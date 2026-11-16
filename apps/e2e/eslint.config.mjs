// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * ESLint de las pruebas de extremo a extremo.
 *
 * Configuración propia y no la del monorepo porque el `tsconfig` de este
 * paquete no forma parte del proyecto principal de TypeScript: con la de la
 * raíz, las reglas con tipos no encuentran el programa y ESLint ni arranca.
 */
export default tseslint.config(
  {
    ignores: ['playwright-report/**', 'test-results/**', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
