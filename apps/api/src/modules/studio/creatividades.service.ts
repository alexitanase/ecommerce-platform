import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ecom/db';
import {
  clavePersonalizada,
  documentoAMedida,
  documentoSchema,
  documentoVacio,
  formatoPorClave,
  newId,
} from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import type {
  CrearCreatividadDto,
  CrearVarianteDto,
  GuardarDocumentoDto,
  ListarCreatividadesDto,
} from './dto/studio.dto.js';
import { contenidoDeCreatividad, enlaceDeCreatividad } from './enlaces.js';
import { sanearDocumento } from './saneado.js';
import { motivoRechazo, puedeTransitar, type EstadoCreatividad } from './estados.js';

/**
 * Creatividades y su historial.
 *
 * El documento es la fuente y pesa kilobytes; los archivos exportados son
 * derivados que caducan. Por eso aquí se guarda todo el historial de versiones
 * sin pensárselo: cuesta poco y es lo único que permite volver atrás cuando
 * tres iteraciones seguidas dejan algo peor que lo que había.
 */
@Injectable()
export class CreatividadesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listar(filtros: ListarCreatividadesDto) {
    const where: Prisma.CreativeWhereInput = {
      deletedAt: null,
      ...(filtros.campaignId ? { campaignId: filtros.campaignId } : {}),
      ...(filtros.estado ? { status: filtros.estado } : {}),
      ...(filtros.formato ? { format: filtros.formato } : {}),
    };

    return this.prisma.client.creative.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 300,
      select: {
        id: true,
        campaignId: true,
        name: true,
        kind: true,
        format: true,
        locale: true,
        status: true,
        utmContent: true,
        currentVersion: true,
        variantOfId: true,
        createdAt: true,
        updatedAt: true,
        campaign: { select: { name: true, channel: true } },
      },
    });
  }

  /** La creatividad con su documento vigente, que es lo que abre el editor. */
  async obtener(id: string) {
    const creatividad = await this.prisma.client.creative.findFirst({
      where: { id, deletedAt: null },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            slug: true,
            channel: true,
            brief: true,
            audience: true,
            locales: true,
            landingUrl: true,
            utmSource: true,
            utmMedium: true,
            utmCampaign: true,
          },
        },
      },
    });
    if (!creatividad) throw new NotFoundException('Creatividad no encontrada');

    const version = await this.prisma.client.creativeVersion.findUnique({
      where: {
        creativeId_version: { creativeId: id, version: creatividad.currentVersion },
      },
    });

    return {
      ...creatividad,
      documento: version?.document ?? null,
      enlace: creatividad.campaign.landingUrl
        ? enlaceDeCreatividad(
            creatividad.campaign.landingUrl,
            creatividad.campaign,
            creatividad.utmContent,
          )
        : null,
    };
  }

  async crear(dto: CrearCreatividadDto, ctx: ContextoActor) {
    const campana = await this.prisma.client.campaign.findFirst({
      where: { id: dto.campaignId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!campana) throw new NotFoundException('Campaña no encontrada');
    if (campana.status === 'ARCHIVADA') {
      throw new BadRequestException(
        'La campaña está archivada. Recupérala antes de añadir piezas.',
      );
    }

    // A medida o del catálogo. Si viene una clave, tiene que existir: aceptar
    // una inventada dejaría la pieza sin ficha y sin peso máximo que validar,
    // que es justo lo que el catálogo evita.
    const aMedida = !dto.format && dto.ancho !== undefined && dto.alto !== undefined;
    if (!aMedida && !formatoPorClave(dto.format ?? '')) {
      throw new BadRequestException(
        `El formato «${dto.format ?? ''}» no está en el catálogo. Elige uno de la lista.`,
      );
    }

    const format = aMedida ? clavePersonalizada(dto.ancho!, dto.alto!) : dto.format!;

    const id = newId();
    const documento = await this.documentoInicial(dto.templateId, format, dto.ancho, dto.alto);

    const creatividad = await this.prisma.client.$transaction(async (tx) => {
      const creada = await tx.creative.create({
        data: {
          id,
          campaignId: dto.campaignId,
          name: dto.name,
          kind: dto.kind,
          format,
          locale: dto.locale,
          utmContent: contenidoDeCreatividad(dto.name, id),
          currentVersion: 1,
          createdById: ctx.actorId ?? null,
        },
      });

      await tx.creativeVersion.create({
        data: {
          id: newId(),
          creativeId: id,
          version: 1,
          document: documento as unknown as Prisma.InputJsonValue,
          label: 'Inicial',
          authorId: ctx.actorId ?? null,
        },
      });

      return creada;
    });

    await this.audit.registrar({
      action: 'studio.creative.create',
      resource: 'creative',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { name: dto.name, format, campaignId: dto.campaignId },
    });

    return creatividad;
  }

  /**
   * Guarda una versión nueva del documento.
   *
   * Con control de concurrencia optimista: si en el servidor hay una versión
   * más nueva que la que tenía quien edita, se devuelve un conflicto en vez de
   * pisarla. No hay edición simultánea, pero sí dos pestañas abiertas —y perder
   * media hora de retoques sin que nada avise es de las cosas que hacen que una
   * herramienta se deje de usar.
   */
  async guardarDocumento(id: string, dto: GuardarDocumentoDto, ctx: ContextoActor) {
    const creatividad = await this.prisma.client.creative.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, currentVersion: true, status: true, name: true },
    });
    if (!creatividad) throw new NotFoundException('Creatividad no encontrada');

    if (dto.versionEsperada !== creatividad.currentVersion) {
      throw new ConflictException(
        `Alguien guardó mientras editabas: en el servidor está la versión ${creatividad.currentVersion} y tú partías de la ${dto.versionEsperada}. Abre la última antes de volver a guardar.`,
      );
    }

    // El saneado va aquí, en el guardado, y no en el importador del navegador:
    // una limpieza que solo corre en el cliente no protege de nada —basta
    // llamar a la API directamente— y este marcado se pinta después dentro del
    // panel, en el mismo origen que la sesión con todos los permisos.
    const documento = sanearDocumento(documentoSchema.parse(dto.documento));
    const siguiente = creatividad.currentVersion + 1;

    await this.prisma.client.$transaction(async (tx) => {
      await tx.creativeVersion.create({
        data: {
          id: newId(),
          creativeId: id,
          version: siguiente,
          document: documento as unknown as Prisma.InputJsonValue,
          label: dto.etiqueta ?? null,
          authorId: ctx.actorId ?? null,
          parentVersion: creatividad.currentVersion,
        },
      });

      await tx.creative.update({
        where: { id },
        data: {
          currentVersion: siguiente,
          // Editar algo ya aprobado lo devuelve a borrador: lo que está
          // corriendo en la red es el archivo exportado, y el documento ha
          // dejado de coincidir con él.
          ...(creatividad.status === 'APROBADA' || creatividad.status === 'PUBLICADA'
            ? { status: 'BORRADOR' as const, approvedAt: null, approvedById: null }
            : {}),
        },
      });
    });

    return { version: siguiente, reabierta: creatividad.status !== 'BORRADOR' };
  }

  async versiones(id: string) {
    return this.prisma.client.creativeVersion.findMany({
      where: { creativeId: id },
      orderBy: { version: 'desc' },
      take: 100,
      select: {
        id: true,
        version: true,
        label: true,
        authorId: true,
        authorModel: true,
        prompt: true,
        parentVersion: true,
        createdAt: true,
      },
    });
  }

  async documentoDeVersion(id: string, version: number) {
    const fila = await this.prisma.client.creativeVersion.findUnique({
      where: { creativeId_version: { creativeId: id, version } },
    });
    if (!fila) throw new NotFoundException('Esa versión no existe');
    return fila;
  }

  /**
   * Vuelve a una versión anterior.
   *
   * Copiándola como versión nueva, no borrando las de en medio: deshacer no
   * puede destruir el camino por el que se llegó, entre otras cosas porque a
   * veces se vuelve para comparar y luego se sigue hacia delante.
   */
  async restaurar(id: string, version: number, ctx: ContextoActor) {
    const anterior = await this.documentoDeVersion(id, version);
    const creatividad = await this.prisma.client.creative.findFirst({
      where: { id, deletedAt: null },
      select: { currentVersion: true },
    });
    if (!creatividad) throw new NotFoundException('Creatividad no encontrada');

    return this.guardarDocumento(
      id,
      {
        documento: documentoSchema.parse(anterior.document),
        versionEsperada: creatividad.currentVersion,
        etiqueta: `Recuperada la versión ${version}`,
      },
      ctx,
    );
  }

  async cambiarEstado(
    id: string,
    dto: { estado: EstadoCreatividad; motivo?: string },
    ctx: ContextoActor,
  ) {
    const creatividad = await this.prisma.client.creative.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, name: true },
    });
    if (!creatividad) throw new NotFoundException('Creatividad no encontrada');

    const desde = creatividad.status;
    const hasta = dto.estado;
    if (!puedeTransitar(desde, hasta)) throw new BadRequestException(motivoRechazo(desde, hasta));

    const actualizada = await this.prisma.client.creative.update({
      where: { id },
      data: {
        status: hasta,
        ...(hasta === 'APROBADA'
          ? { approvedAt: new Date(), approvedById: ctx.actorId ?? null }
          : {}),
        ...(hasta === 'PUBLICADA' ? { publishedAt: new Date() } : {}),
        ...(hasta === 'BORRADOR' ? { approvedAt: null, approvedById: null } : {}),
      },
    });

    await this.audit.registrar({
      action: `studio.creative.${hasta.toLowerCase()}`,
      resource: 'creative',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { status: desde },
      after: { status: hasta },
      ...(dto.motivo ? { metadata: { motivo: dto.motivo } } : {}),
    });

    return actualizada;
  }

  /**
   * Una hermana para probar A/B.
   *
   * Copia el documento vigente y cuelga de la original. Lo importante es que
   * lleva su propio `utm_content`: si compartieran marcaje, la prueba no diría
   * nada porque las ventas de las dos irían al mismo sitio.
   */
  async crearVariante(id: string, dto: CrearVarianteDto, ctx: ContextoActor) {
    const original = await this.prisma.client.creative.findFirst({
      where: { id, deletedAt: null },
    });
    if (!original) throw new NotFoundException('Creatividad no encontrada');

    const version = await this.prisma.client.creativeVersion.findUnique({
      where: { creativeId_version: { creativeId: id, version: original.currentVersion } },
    });
    if (!version)
      throw new BadRequestException('La creatividad no tiene ningún documento guardado');

    const nuevoIdVariante = newId();
    const nombre = dto.name ?? `${original.name} · variante`;

    const variante = await this.prisma.client.$transaction(async (tx) => {
      const creada = await tx.creative.create({
        data: {
          id: nuevoIdVariante,
          campaignId: original.campaignId,
          name: nombre,
          kind: original.kind,
          format: original.format,
          locale: original.locale,
          utmContent: contenidoDeCreatividad(nombre, nuevoIdVariante),
          variantOfId: original.variantOfId ?? original.id,
          currentVersion: 1,
          createdById: ctx.actorId ?? null,
        },
      });

      await tx.creativeVersion.create({
        data: {
          id: newId(),
          creativeId: nuevoIdVariante,
          version: 1,
          document: version.document as Prisma.InputJsonValue,
          label: dto.hipotesis ?? `Copia de ${original.name}`,
          authorId: ctx.actorId ?? null,
        },
      });

      return creada;
    });

    await this.audit.registrar({
      action: 'studio.creative.variant',
      resource: 'creative',
      resourceId: nuevoIdVariante,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { variantOf: original.id, name: nombre },
    });

    return variante;
  }

  async archivar(id: string, ctx: ContextoActor) {
    return this.cambiarEstado(id, { estado: 'ARCHIVADA' }, ctx);
  }

  /** El documento con el que nace una creatividad: de plantilla, o vacío. */
  private async documentoInicial(
    templateId: string | undefined,
    formato: string,
    ancho?: number,
    alto?: number,
  ) {
    if (!templateId) {
      return ancho !== undefined && alto !== undefined
        ? documentoAMedida(ancho, alto, newId)
        : documentoVacio(formato, newId);
    }

    const plantilla = await this.prisma.client.studioTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
      select: { document: true },
    });
    if (!plantilla) throw new NotFoundException('Plantilla no encontrada');

    // La plantilla se valida al usarla, no solo al guardarla: una guardada con
    // una versión anterior del esquema tiene que fallar aquí y no al exportar.
    // Y se sanea igual: puede llevar años guardada, de antes de esta regla.
    return sanearDocumento(documentoSchema.parse(plantilla.document));
  }
}
