/// <reference types="vite/client" />

/**
 * Variables de entorno del panel.
 *
 * Declararlas aquí en vez de leerlas sueltas hace que un nombre mal escrito lo
 * cace TypeScript. Todas empiezan por VITE_ porque son las únicas que Vite
 * inyecta en el bundle — y hay que recordar que ese bundle es público: aquí no
 * puede ir ningún secreto.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
