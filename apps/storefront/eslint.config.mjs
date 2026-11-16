// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from '@next/eslint-plugin-next';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * ESLint del storefront.
 *
 * Configuración propia y no la del monorepo porque necesita los plugins de
 * React y Next: sin ellos, las reglas que se desactivan con comentarios en el
 * código (`react/no-danger`, `@next/next/no-img-element`) no existen y ESLint
 * falla al no encontrar su definición.
 */
export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        localStorage: 'readonly',
        AbortController: 'readonly',
        CustomEvent: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
    plugins: {
      '@next/next': next,
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // En React 19 no hace falta importar React para usar JSX.
      'react/react-in-jsx-scope': 'off',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
);
