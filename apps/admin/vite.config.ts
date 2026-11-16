import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwind()],
  // El .env vive en la raíz del monorepo, compartido por las tres
  // aplicaciones. Sin esto Vite solo miraría en apps/admin y las VITE_*
  // llegarían vacías al bundle sin que nada avise.
  envDir: path.resolve(import.meta.dirname, '../..'),
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    // 5173 es el puerto por defecto de Vite y suele estar ocupado por otro
    // proyecto; se fija el 5174 para que el admin arranque siempre en el mismo
    // sitio y la configuración de CORS de la API no tenga que adivinarlo.
    port: 5174,
    strictPort: true,
    // Proxy hacia la API en desarrollo: evita configurar CORS y hace que la
    // cookie del refresh token viaje como si fuera el mismo origen.
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  preview: {
    port: 5174,
    strictPort: true,
    /*
     * El mismo proxy que en desarrollo.
     *
     * `vite preview` NO hereda el de `server`, y el panel pide siempre a
     * `/api` de su propio origen —así la cookie del refresh token viaja como
     * primera parte y no hace falta CORS—. Sin esto, servir el build compilado
     * (que es como se ejecutan las pruebas del panel en CI) devuelve 404 en
     * cada llamada y la sesión no llega ni a abrirse.
     */
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    // El admin no necesita SEO ni carga instantánea: se prioriza que el
    // paquete sea manejable en lugar de partirlo en decenas de trozos.
    chunkSizeWarningLimit: 900,
  },
});
