import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@ecom/db';
import type { Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';

/**
 * Acceso a la base de datos.
 *
 * Envuelve el cliente Prisma como servicio de Nest para que el ciclo de vida
 * (conectar al arrancar, cerrar el pool al apagar) lo gestione el framework.
 * Sin el cierre ordenado, un despliegue deja conexiones colgando en Postgres.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  readonly client: PrismaClient;

  /**
   * Cliente para lecturas que toleran ir un segundo por detrás.
   *
   * Apunta a la réplica cuando hay `DATABASE_URL_REPLICA`, y al primario
   * cuando no la hay, de modo que el código que lo usa funciona igual en
   * desarrollo sin réplica y en producción con ella.
   *
   * **No es un reemplazo general de `client`.** Una réplica va por detrás del
   * primario unos milisegundos, y eso rompe el patrón "escribo y leo lo que
   * acabo de escribir": crear un pedido y leerlo a continuación por la réplica
   * devolvería "no existe". Por eso no se enruta automáticamente todo: se usa
   * donde la antigüedad de un segundo da igual y el volumen sí importa —el
   * catálogo público, que es la mayor parte del tráfico de una tienda—.
   *
   * Regla práctica: si lo que se lee lo acaba de escribir esta misma petición,
   * va por `client`. Si lo lee un visitante que ni sabe que existes, por
   * `lectura`.
   */
  readonly lectura: PrismaClient;

  private readonly hayReplica: boolean;

  constructor(@Inject(ENV) env: Env) {
    this.client = createPrismaClient(env.DATABASE_URL);
    this.hayReplica = Boolean(env.DATABASE_URL_REPLICA);
    this.lectura = this.hayReplica ? createPrismaClient(env.DATABASE_URL_REPLICA) : this.client;
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();

    if (this.hayReplica) {
      await this.lectura.$connect();
      this.logger.log('Conectado a PostgreSQL (primario + réplica de lectura)');
    } else {
      this.logger.log('Conectado a PostgreSQL');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
    if (this.hayReplica) await this.lectura.$disconnect();
    this.logger.log('Desconectado de PostgreSQL');
  }

  /** Comprobación mínima usada por la sonda de disponibilidad. */
  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
    // La réplica también: si está caída o muy retrasada, la tienda serviría
    // catálogo obsoleto sin que nada avisara.
    if (this.hayReplica) await this.lectura.$queryRaw`SELECT 1`;
  }
}
