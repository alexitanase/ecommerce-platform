import { Injectable, Logger } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '@ecom/db';

export interface EntradaAuditoria {
  action: string;
  resource: string;
  resourceId?: string | undefined;
  actorId?: string | undefined;
  actorIp?: string | undefined;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown> | undefined;
}

/** Campos que nunca deben acabar escritos en el registro de auditoría. */
const CAMPOS_SENSIBLES = new Set([
  'password',
  'passwordHash',
  'totpSecret',
  'recoveryCodes',
  'tokenHash',
  'refreshToken',
  'accessToken',
  'apiKey',
  'secret',
  'clientSecret',
  'ipnSecret',
]);

/**
 * Registro de auditoría: quién hizo qué, cuándo y con qué valores.
 *
 * Se escribe en toda acción sensible del admin. Es la única forma de responder
 * a "¿quién reembolsó este pedido?" tres meses después, y en caso de disputa
 * con un cliente o una inspección es la prueba de lo que ocurrió.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registrar(entrada: EntradaAuditoria): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          id: newId(),
          action: entrada.action,
          resource: entrada.resource,
          resourceId: entrada.resourceId ?? null,
          actorId: entrada.actorId ?? null,
          actorIp: entrada.actorIp ?? null,
          before: this.limpiar(entrada.before),
          after: this.limpiar(entrada.after),
          metadata: this.limpiar(entrada.metadata),
        },
      });
    } catch (error) {
      // Un fallo al auditar no puede tumbar la operación de negocio: sería
      // peor no poder reembolsar a un cliente porque falló un INSERT de log.
      // Queda en el log de la aplicación para investigarlo.
      this.logger.error(
        `No se ha podido registrar la auditoría de "${entrada.action}": ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /**
   * Elimina recursivamente los campos sensibles antes de persistir.
   * Sin esto, auditar la edición de un usuario guardaría su hash de contraseña
   * en una tabla que consulta medio equipo.
   */
  private limpiar(valor: unknown): Prisma.InputJsonValue | undefined {
    if (valor === undefined || valor === null) return undefined;

    const recorrer = (v: unknown, profundidad = 0): unknown => {
      if (profundidad > 10) return '[demasiado anidado]';
      if (Array.isArray(v)) return v.map((x) => recorrer(x, profundidad + 1));
      if (v !== null && typeof v === 'object') {
        return Object.fromEntries(
          Object.entries(v as Record<string, unknown>).map(([k, val]) => [
            k,
            CAMPOS_SENSIBLES.has(k) ? '[oculto]' : recorrer(val, profundidad + 1),
          ]),
        );
      }
      return v;
    };

    return recorrer(valor) as Prisma.InputJsonValue;
  }

  /**
   * Acciones y recursos que de verdad tienen registros.
   *
   * Se calculan de los datos y no de una lista fija: una lista escrita a mano
   * se queda desactualizada en cuanto alguien añade una acción nueva, y el
   * filtro deja de encontrar cosas que sí están.
   */
  async valoresDeFiltro() {
    const [acciones, recursos] = await Promise.all([
      this.prisma.client.auditLog.groupBy({
        by: ['action'],
        _count: { _all: true },
        orderBy: { _count: { action: 'desc' } },
        take: 100,
      }),
      this.prisma.client.auditLog.groupBy({
        by: ['resource'],
        _count: { _all: true },
        orderBy: { _count: { resource: 'desc' } },
        take: 50,
      }),
    ]);

    return {
      acciones: acciones.map((a) => ({ valor: a.action, registros: a._count._all })),
      recursos: recursos.map((r) => ({ valor: r.resource, registros: r._count._all })),
    };
  }

  /** Consulta paginada para el visor de auditoría del admin. */
  async consultar(filtros: {
    actorId?: string;
    resource?: string;
    resourceId?: string;
    action?: string;
    desde?: Date;
    hasta?: Date;
    limite?: number;
    cursor?: string;
  }) {
    const limite = Math.min(filtros.limite ?? 50, 200);

    const registros = await this.prisma.client.auditLog.findMany({
      where: {
        ...(filtros.actorId ? { actorId: filtros.actorId } : {}),
        ...(filtros.resource ? { resource: filtros.resource } : {}),
        ...(filtros.resourceId ? { resourceId: filtros.resourceId } : {}),
        ...(filtros.action ? { action: { startsWith: filtros.action } } : {}),
        ...(filtros.desde || filtros.hasta
          ? {
              createdAt: {
                ...(filtros.desde ? { gte: filtros.desde } : {}),
                ...(filtros.hasta ? { lte: filtros.hasta } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limite + 1,
      ...(filtros.cursor ? { cursor: { id: filtros.cursor }, skip: 1 } : {}),
      include: {
        actor: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    const hayMas = registros.length > limite;
    const items = hayMas ? registros.slice(0, limite) : registros;

    return { items, nextCursor: hayMas ? (items.at(-1)?.id ?? null) : null };
  }
}
