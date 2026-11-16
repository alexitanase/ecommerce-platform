import type { CoverageV8Options } from 'vitest/node';

/**
 * Declaración para `vitest.cobertura.mjs`.
 *
 * El fichero es JavaScript porque lo cargan las configuraciones de Vitest antes
 * de que haya nada compilado. Sin este `.d.mts`, los paquetes que no admiten
 * JavaScript en su `tsconfig` —la API, entre ellos— fallan al comprobar tipos
 * con "Could not find a declaration file".
 */
export declare function cobertura(opciones: {
  /** Patrones del código fuente a medir. */
  incluir: string[];
  /** Suelo mínimo; si se omite, se mide sin exigir nada. */
  umbrales?: {
    statements: number;
    branches: number;
    functions: number;
    lines: number;
  };
}): CoverageV8Options;
