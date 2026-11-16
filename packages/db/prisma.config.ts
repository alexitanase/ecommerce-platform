import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// El .env vive en la raíz del monorepo, no dentro de este paquete.
loadDotenv({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),

  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
  },

  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
