// Igual que en `main.ts`: al importarse arranca las instrumentaciones, que
// parchean http, pg e ioredis. Tiene que ir antes que Nest y Prisma.
import './observabilidad.js';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@ecom/shared';
import { pararObservabilidad } from './observabilidad.js';
import { AppModule } from './app.module.js';

/**
 * Proceso de workers.
 *
 * Consume las colas y no escucha en ningún puerto. Existe porque un proceso
 * que sirve HTTP y a la vez sincroniza mil productos con un proveedor reparte
 * el mismo bucle de eventos entre las dos cosas, y quien paga la latencia es
 * el cliente que está terminando su compra.
 *
 * Separarlos permite además escalar cada mitad por lo que le corresponde:
 *
 *  · La API, por peticiones por segundo.
 *  · Los workers, por **profundidad de cola** (`queue_depth`, que ya se
 *    publica en /metrics). Es la señal que se adelanta a todas: la cola crece
 *    minutos antes de que nadie note nada, mientras que la CPU solo sube
 *    cuando ya es tarde.
 *
 * En desarrollo no hace falta: con `WORKERS_ENABLED=true` —el valor por
 * defecto— la API los levanta dentro y todo corre con un solo `pnpm dev`.
 */
async function arrancar(): Promise<void> {
  const env = loadEnv();
  const logger = new Logger('Workers');

  if (!env.WORKERS_ENABLED) {
    // Arrancar este proceso con los workers desactivados deja un contenedor
    // vivo que no hace nada: es mejor decirlo y salir que fingir que trabaja.
    logger.error('WORKERS_ENABLED es false en el proceso de workers. No hay nada que hacer.');
    process.exit(1);
  }

  // Sin servidor HTTP: este proceso no atiende peticiones. Lo único que
  // necesita del contexto de Nest es la inyección de dependencias y el ciclo
  // de vida, que es lo que arranca los workers y cierra las conexiones al salir.
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });

  app.enableShutdownHooks();

  logger.log(`Workers en marcha · entorno ${env.NODE_ENV}`);

  const apagar = async (senal: string): Promise<void> => {
    logger.log(`${senal} recibido; terminando los trabajos en curso…`);
    // El cierre ordenado importa más aquí que en la API: matar un worker a
    // media ejecución deja un pedido enviado al proveedor sin registrar, o al
    // revés. BullMQ espera a que terminen los trabajos que ya empezaron.
    await app.close();
    await pararObservabilidad();
    process.exit(0);
  };

  process.on('SIGTERM', () => void apagar('SIGTERM'));
  process.on('SIGINT', () => void apagar('SIGINT'));
}

void arrancar();
