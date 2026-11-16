import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionsService } from '../auth/permissions.service.js';

export interface ContextoActor {
  /**
   * Quién del equipo hace la acción.
   *
   * Opcional porque hay acciones que hace el propio cliente sobre su pedido
   * —cancelar, cambiar su dirección— y ahí no hay ningún miembro del equipo
   * detrás. Inventarse uno para que el tipo cuadre haría que el registro de
   * auditoría atribuyera a una persona algo que no hizo.
   */
  actorId?: string | undefined;
  actorIp?: string | undefined;
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permisos: PermissionsService,
  ) {}

  async listarPermisos() {
    const permisos = await this.prisma.client.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });

    // Agrupados por recurso: así el admin puede pintar la matriz de permisos
    // por bloques en lugar de una lista plana de treinta y tres casillas.
    const porRecurso = new Map<string, typeof permisos>();
    for (const p of permisos) {
      const grupo = porRecurso.get(p.resource) ?? [];
      grupo.push(p);
      porRecurso.set(p.resource, grupo);
    }

    return {
      total: permisos.length,
      grupos: [...porRecurso.entries()].map(([resource, items]) => ({ resource, items })),
    };
  }

  async listarRoles() {
    const roles = await this.prisma.client.role.findMany({
      orderBy: { key: 'asc' },
      include: {
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
    });

    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      usuarios: r._count.users,
      permissions: r.permissions.map((p) => p.permission.key).sort(),
    }));
  }

  async crearRol(
    datos: { key: string; name: string; description?: string; permissions: string[] },
    ctx: ContextoActor,
  ) {
    const existe = await this.prisma.client.role.findUnique({ where: { key: datos.key } });
    if (existe) throw new BadRequestException(`Ya existe un rol con la clave "${datos.key}"`);

    await this.validarPermisos(datos.permissions);

    const rol = await this.prisma.client.role.create({
      data: {
        id: newId(),
        key: datos.key,
        name: datos.name,
        description: datos.description ?? null,
        isSystem: false,
      },
    });

    await this.asignarPermisos(rol.id, datos.permissions);

    await this.audit.registrar({
      action: 'role.create',
      resource: 'role',
      resourceId: rol.id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { key: rol.key, name: rol.name, permissions: datos.permissions },
    });

    return this.detalleRol(rol.id);
  }

  async actualizarRol(
    roleId: string,
    datos: { name?: string; description?: string; permissions?: string[] },
    ctx: ContextoActor,
  ) {
    const antes = await this.detalleRol(roleId);

    // Los roles del sistema pueden renombrarse pero no cambiar sus permisos:
    // si alguien vacía "owner" por error, nadie puede volver a entrar a arreglarlo.
    if (antes.isSystem && datos.permissions) {
      throw new BadRequestException(
        'Los permisos de un rol del sistema no se pueden modificar. Crea un rol propio si necesitas otra combinación.',
      );
    }

    if (datos.permissions) {
      await this.validarPermisos(datos.permissions);
    }

    await this.prisma.client.role.update({
      where: { id: roleId },
      data: {
        ...(datos.name ? { name: datos.name } : {}),
        ...(datos.description !== undefined ? { description: datos.description } : {}),
      },
    });

    if (datos.permissions) {
      await this.prisma.client.rolePermission.deleteMany({ where: { roleId } });
      await this.asignarPermisos(roleId, datos.permissions);
      // Sin esto, los usuarios con este rol seguirían con los permisos viejos
      // hasta que caducara su caché.
      await this.permisos.invalidarPorRol(roleId);
    }

    const despues = await this.detalleRol(roleId);

    await this.audit.registrar({
      action: 'role.update',
      resource: 'role',
      resourceId: roleId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: antes,
      after: despues,
    });

    return despues;
  }

  async eliminarRol(roleId: string, ctx: ContextoActor): Promise<void> {
    const rol = await this.detalleRol(roleId);

    if (rol.isSystem) {
      throw new BadRequestException('Los roles del sistema no se pueden eliminar');
    }
    if (rol.usuarios > 0) {
      throw new BadRequestException(
        `El rol tiene ${rol.usuarios} usuario(s) asignados. Reasígnalos antes de eliminarlo.`,
      );
    }

    await this.prisma.client.role.delete({ where: { id: roleId } });

    await this.audit.registrar({
      action: 'role.delete',
      resource: 'role',
      resourceId: roleId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: rol,
    });
  }

  async asignarRolAUsuario(userId: string, roleId: string, ctx: ContextoActor): Promise<void> {
    await this.prisma.client.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId },
    });

    await this.permisos.invalidar(userId);

    await this.audit.registrar({
      action: 'user.role_assigned',
      resource: 'user',
      resourceId: userId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { roleId },
    });
  }

  async quitarRolAUsuario(userId: string, roleId: string, ctx: ContextoActor): Promise<void> {
    const rol = await this.prisma.client.role.findUniqueOrThrow({ where: { id: roleId } });

    // No puede quedarse la plataforma sin nadie que administre roles.
    if (rol.key === 'owner') {
      const propietarios = await this.prisma.client.userRole.count({ where: { roleId } });
      if (propietarios <= 1) {
        throw new BadRequestException(
          'No se puede quitar el último propietario: la plataforma quedaría sin nadie que pueda gestionar permisos.',
        );
      }
    }

    await this.prisma.client.userRole.deleteMany({ where: { userId, roleId } });
    await this.permisos.invalidar(userId);

    await this.audit.registrar({
      action: 'user.role_removed',
      resource: 'user',
      resourceId: userId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { roleId },
    });
  }

  // ── Internos ──────────────────────────────────────────────

  private async detalleRol(roleId: string) {
    const rol = await this.prisma.client.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
    });

    if (!rol) throw new NotFoundException('Rol no encontrado');

    return {
      id: rol.id,
      key: rol.key,
      name: rol.name,
      description: rol.description,
      isSystem: rol.isSystem,
      usuarios: rol._count.users,
      permissions: rol.permissions.map((p) => p.permission.key).sort(),
    };
  }

  private async validarPermisos(claves: string[]): Promise<void> {
    const existentes = await this.prisma.client.permission.findMany({
      where: { key: { in: claves } },
      select: { key: true },
    });

    const encontradas = new Set(existentes.map((p) => p.key));
    const desconocidas = claves.filter((k) => !encontradas.has(k));

    if (desconocidas.length > 0) {
      throw new BadRequestException(`Permisos desconocidos: ${desconocidas.join(', ')}`);
    }
  }

  private async asignarPermisos(roleId: string, claves: string[]): Promise<void> {
    const permisos = await this.prisma.client.permission.findMany({
      where: { key: { in: claves } },
      select: { id: true },
    });

    await this.prisma.client.rolePermission.createMany({
      data: permisos.map((p) => ({ roleId, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
}
