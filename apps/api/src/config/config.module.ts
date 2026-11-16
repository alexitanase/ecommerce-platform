import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { loadEnv, type Env } from '@ecom/shared';
import path from 'node:path';

/**
 * Configuración de la aplicación.
 *
 * Se valida con Zod en el arranque a través de `loadEnv`. Si algo falta o es
 * inválido, Nest no llega a levantar: preferimos un fallo inmediato y legible
 * antes que descubrir a mitad de la noche que faltaba una variable.
 */

export const ENV = Symbol('ENV');

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // El .env vive en la raíz del monorepo, compartido por todas las apps.
      envFilePath: [path.resolve(process.cwd(), '../../.env'), '.env'],
      validate: (raw: Record<string, unknown>) => loadEnv(raw),
    }),
  ],
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => loadEnv(),
    },
  ],
  exports: [ENV],
})
export class AppConfigModule {}
