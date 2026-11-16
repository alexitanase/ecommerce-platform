import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * El .env vive en la raíz del monorepo, compartido por las tres aplicaciones.
 *
 * Next solo lee el .env de su propio directorio, así que hay que cargarlo aquí
 * a mano. Se hace en el fichero de configuración porque es lo primero que se
 * evalúa: las NEXT_PUBLIC_* se incrustan en el bundle leyendo process.env
 * durante el build, y si se cargaran más tarde llegarían vacías.
 */
const aqui = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(aqui, '../../.env'));
} catch {
  // En producción las variables vienen del entorno del contenedor y no hay
  // fichero que leer; no es un error.
}
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  /*
   * Salida autónoma para el contenedor de producción.
   *
   * Next copia en `.next/standalone` un servidor con SOLO los módulos que el
   * build ha demostrado que usa. La alternativa es meter en la imagen el
   * `node_modules` del monorepo entero —cerca de un gigabyte— para ejecutar
   * unos pocos megas de aplicación: cada despliegue tardaría minutos en subir
   * y el disco del servidor se llenaría de capas repetidas.
   *
   * En desarrollo no cambia nada: solo afecta a `next build`.
   */
  output: 'standalone',
  // El monorepo comparte paquetes sin compilar: Next debe transpilarlos.
  transpilePackages: ['@ecom/shared'],
  images: {
    // AVIF primero: pesa la mitad que WebP con la misma calidad percibida.
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '9000' },
      { protocol: 'https', hostname: '**' },
    ],
    /*
     * Permitir imágenes en una IP privada, SOLO en desarrollo.
     *
     * Next 16 se niega a optimizar una imagen remota cuyo dominio resuelve a una
     * IP privada, y hace bien: es la puerta clásica de un ataque SSRF —se le pide
     * al servidor que «optimice» una imagen apuntando a un servicio interno y
     * devuelve su respuesta—. El síntoma sin esto es una foto rota y un
     * `"url" parameter is not allowed` con 400, que no dice nada del motivo real.
     *
     * En local el almacenamiento de objetos vive en `localhost:9000`, así que
     * todas las fotos de producto se caían y la tienda no se podía revisar a
     * ojo. En producción está en un dominio público detrás de Cloudflare, y ahí
     * la protección se queda puesta: la condición no es decorativa.
     */
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== 'production',
  },
  // Cabeceras de seguridad: la CSP restrictiva vive aquí, no en la API.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

/**
 * Los source maps se suben a Sentry y se borran del servidor.
 *
 * Sin ellos, un error de producción aparece como `a.b is not a function` en la
 * línea 1 del bundle minificado, que no dice absolutamente nada. Publicarlos
 * junto al sitio los dejaría accesibles a cualquiera, así que se suben y se
 * eliminan del despliegue.
 */
export default withSentryConfig(withNextIntl(config), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Sin token no hay subida: el build no puede fallar por no poder hablar con
  // Sentry, o una caída suya impediría desplegar.
  silent: !process.env.CI,
  disableLogger: true,

  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  // Encamina la telemetría por nuestro dominio para que los bloqueadores de
  // anuncios no se traguen los informes de error de media clientela.
  tunnelRoute: '/monitoring',
});
