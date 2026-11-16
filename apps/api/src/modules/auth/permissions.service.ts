import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

const CLAVE = 'auth:perms:';
/** Red de seguridad: si fallara una invalidación, la caché se corrige sola. */
const TTL_SEGUNDOS = 300;

/**
 * Permisos efectivos de cada usuario, cacheados en Redis.
 *
 * Resolverlos en cada petición contra Postgres serían dos JOIN por request.
 * Con caché es una lectura de Redis (menos de un milisegundo) y, a diferencia
 * de meterlos dentro del JWT, quitar un permiso surte efecto inmediato: basta
 * con borrar la entrada.
 */
@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async permisosDe(userId: string): Promise<Set<string>> {
    const cacheado = await this.redis.client.get(`${CLAVE}${userId}`);
    if (cacheado !== null) {
      return new Set(cacheado === '' ? [] : cacheado.split(','));
    }

    const filas = await this.prisma.client.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });

    const permisos = new Set(filas.flatMap((f) => f.role.permissions.map((p) => p.permission.key)));

    await this.redis.client.set(`${CLAVE}${userId}`, [...permisos].join(','), 'EX', TTL_SEGUNDOS);

    return permisos;
  }

  async tiene(userId: string, requeridos: string[]): Promise<boolean> {
    if (requeridos.length === 0) return true;
    const permisos = await this.permisosDe(userId);
    return requeridos.every((p) => permisos.has(p));
  }

  /** Se llama al cambiar roles o permisos para que el cambio surta efecto ya. */
  async invalidar(userId: string): Promise<void> {
    await this.redis.client.del(`${CLAVE}${userId}`);
  }

  /** Tras editar un rol, hay que invalidar a todos sus usuarios. */
  async invalidarPorRol(roleId: string): Promise<number> {
    const usuarios = await this.prisma.client.userRole.findMany({
      where: { roleId },
      select: { userId: true },
    });
    if (usuarios.length === 0) return 0;
    await this.redis.client.del(...usuarios.map((u) => `${CLAVE}${u.userId}`));
    return usuarios.length;
  }
}
