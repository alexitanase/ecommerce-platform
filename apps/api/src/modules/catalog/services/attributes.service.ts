import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { newId, objeto } from '@ecom/shared';
import type { Prisma } from '@ecom/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { SearchService } from '../../search/search.service.js';
import type { ContextoActor } from '../../roles/roles.service.js';

/**
 * Atributos del catálogo ("material", "impermeable", "talla de pantalla").
 *
 * Definen las **facetas** por las que el cliente filtra en el listado. Un
 * catálogo grande sin facetas obliga a recorrer páginas hasta encontrar algo,
 * que es la forma más rápida de perder una venta que ya estaba decidida.
 *
 * El tipo no es decorativo: decide cómo se filtra. Un número admite rangos
 * ("de 40 a 60 €"), un SELECT admite marcar varias opciones, y un texto libre
 * no admite faceta ninguna porque cada producto tendría la suya.
 */
@Injectable()
export class AttributesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly search: SearchService,
  ) {}

  async listar() {
    const atributos = await this.prisma.client.attribute.findMany({
      orderBy: [{ position: 'asc' }, { key: 'asc' }],
      include: { _count: { select: { products: true, categories: true } } },
    });

    return atributos.map((a) => ({
      id: a.id,
      key: a.key,
      type: a.type,
      unit: a.unit,
      isFilterable: a.isFilterable,
      isVisible: a.isVisible,
      position: a.position,
      options: a.options,
      labels: a.labels,
      productos: a._count.products,
      categorias: a._count.categories,
    }));
  }

  async crear(
    datos: {
      key: string;
      type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SELECT' | 'MULTISELECT';
      unit?: string;
      isFilterable?: boolean;
      isVisible?: boolean;
      options?: string[];
      labels?: Record<string, string>;
    },
    ctx: ContextoActor,
  ) {
    const existente = await this.prisma.client.attribute.findUnique({
      where: { key: datos.key },
      select: { id: true },
    });

    if (existente) {
      throw new BadRequestException(`Ya existe un atributo con la clave "${datos.key}"`);
    }

    // Un SELECT sin opciones no puede filtrar nada: es un atributo muerto que
    // aparece en el formulario de producto sin nada que elegir.
    if (
      (datos.type === 'SELECT' || datos.type === 'MULTISELECT') &&
      (!datos.options || datos.options.length === 0)
    ) {
      throw new BadRequestException(
        'Un atributo de tipo lista necesita al menos una opción para poder filtrar por él.',
      );
    }

    const atributo = await this.prisma.client.attribute.create({
      data: {
        id: newId(),
        key: datos.key,
        type: datos.type,
        unit: datos.unit ?? null,
        isFilterable: datos.isFilterable ?? true,
        isVisible: datos.isVisible ?? true,
        ...(datos.options ? { options: datos.options } : {}),
        ...(datos.labels ? { labels: objeto(datos.labels) as Prisma.InputJsonValue } : {}),
      },
    });

    await this.audit.registrar({
      action: 'attribute.create',
      resource: 'attribute',
      resourceId: atributo.id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { key: atributo.key, type: atributo.type },
    });

    return atributo;
  }

  async actualizar(
    id: string,
    datos: {
      unit?: string | null;
      isFilterable?: boolean;
      isVisible?: boolean;
      position?: number;
      options?: string[];
      labels?: Record<string, string>;
    },
    ctx: ContextoActor,
  ) {
    const antes = await this.prisma.client.attribute.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException('Atributo no encontrado');

    const atributo = await this.prisma.client.attribute.update({
      where: { id },
      data: {
        ...(datos.unit !== undefined ? { unit: datos.unit } : {}),
        ...(datos.isFilterable !== undefined ? { isFilterable: datos.isFilterable } : {}),
        ...(datos.isVisible !== undefined ? { isVisible: datos.isVisible } : {}),
        ...(datos.position !== undefined ? { position: datos.position } : {}),
        ...(datos.options ? { options: datos.options } : {}),
        ...(datos.labels ? { labels: objeto(datos.labels) as Prisma.InputJsonValue } : {}),
      },
    });

    await this.audit.registrar({
      action: 'attribute.update',
      resource: 'attribute',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { isFilterable: antes.isFilterable, isVisible: antes.isVisible },
      after: { isFilterable: atributo.isFilterable, isVisible: atributo.isVisible },
    });

    // Cambiar si un atributo filtra obliga a reconfigurar el buscador: si no,
    // la faceta nueva no aparece hasta el siguiente reindexado completo.
    if (antes.isFilterable !== atributo.isFilterable) {
      void this.search.configurarIndices().catch(() => {
        // El reindexado periódico lo recupera.
      });
    }

    return atributo;
  }

  async eliminar(id: string, ctx: ContextoActor): Promise<void> {
    const atributo = await this.prisma.client.attribute.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });

    if (!atributo) throw new NotFoundException('Atributo no encontrado');

    // Borrarlo se lleva por delante el valor que tuviera en cada producto, y
    // eso no se recupera: hay que decirlo antes, no después.
    if (atributo._count.products > 0) {
      throw new BadRequestException(
        `El atributo "${atributo.key}" está en uso en ${atributo._count.products} producto(s). ` +
          `Quítalo de esos productos antes de eliminarlo.`,
      );
    }

    await this.prisma.client.attribute.delete({ where: { id } });

    await this.audit.registrar({
      action: 'attribute.delete',
      resource: 'attribute',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { key: atributo.key },
    });
  }
}
