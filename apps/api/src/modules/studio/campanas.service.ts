import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ecom/db';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CANALES, canalPorClave } from '../channels/canales.js';
import type { ContextoActor } from '../roles/roles.service.js';
import type { ActualizarCampanaDto, CrearCampanaDto, ListarCampanasDto } from './dto/studio.dto.js';
import { enlaceDeCreatividad, marcajeDeCampana } from './enlaces.js';

/** Si hay alguna pieza de la que traerse el documento. */
const creativesConDocumento = (creatives: { id: string }[]): boolean => creatives.length > 0;

/**
 * Campañas del Studio.
 *
 * Una campaña es el paraguas de todo lo demás: objetivo, canal, fechas,
 * presupuesto y marcaje. Existe antes que las creatividades porque es lo que
 * les da contexto —el asistente de IA lo lee, los enlaces lo heredan y el
 * informe agrupa por ella—, y porque sin ella cada pieza sería un archivo
 * suelto sin nada que explique para qué se hizo.
 */
@Injectable()
export class CampanasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listar(filtros: ListarCampanasDto) {
    const where: Prisma.CampaignWhereInput = {
      deletedAt: null,
      ...(filtros.estado ? { status: filtros.estado } : {}),
      ...(filtros.canal ? { channel: filtros.canal } : {}),
      ...(filtros.texto ? { name: { contains: filtros.texto, mode: 'insensitive' as const } } : {}),
    };

    const campanas = await this.prisma.client.campaign.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { creatives: true } } },
      take: 200,
    });

    return campanas.map((c) => ({
      ...c,
      creatividades: c._count.creatives,
      canal: canalPorClave(c.channel)?.nombre ?? c.channel,
    }));
  }

  async obtener(id: string) {
    const campana = await this.prisma.client.campaign.findFirst({
      where: { id, deletedAt: null },
      include: {
        creatives: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            kind: true,
            format: true,
            locale: true,
            status: true,
            utmContent: true,
            currentVersion: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!campana) throw new NotFoundException('Campaña no encontrada');

    /*
     * El documento vigente de cada pieza, para poder pintar la vista previa en
     * la lista sin abrir el editor.
     *
     * Se piden en una sola consulta con los pares (pieza, versión) y no una por
     * creatividad: una campaña con veinte piezas serían veinte viajes a la base
     * para pintar una rejilla.
     */
    const versiones = creativesConDocumento(campana.creatives)
      ? await this.prisma.client.creativeVersion.findMany({
          where: {
            OR: campana.creatives.map((c) => ({
              creativeId: c.id,
              version: c.currentVersion,
            })),
          },
          select: { creativeId: true, document: true },
        })
      : [];

    const porPieza = new Map(versiones.map((v) => [v.creativeId, v.document]));

    const { creatives, ...resto } = campana;
    return {
      ...resto,
      canal: canalPorClave(campana.channel)?.nombre ?? campana.channel,
      marcaje: marcajeDeCampana(campana),
      // El enlace ya montado, pieza a pieza. Se compone aquí y no en el panel
      // porque la sintaxis del marcaje vive en un solo sitio: un `utm_` mal
      // escrito no da ningún error, solo hace que esa creatividad no aparezca
      // en el informe y parezca que no funcionó.
      creatividades: creatives.map((c) => ({
        ...c,
        documento: porPieza.get(c.id) ?? null,
        enlace: campana.landingUrl
          ? enlaceDeCreatividad(campana.landingUrl, campana, c.utmContent)
          : null,
      })),
    };
  }

  async crear(dto: CrearCampanaDto, ctx: ContextoActor) {
    this.comprobarCanal(dto.channel);
    this.comprobarFechas(dto.startsAt, dto.endsAt);

    const id = newId();
    const campana = await this.prisma.client.campaign.create({
      data: {
        id,
        name: dto.name,
        slug: await this.slugLibre(dto.name),
        objective: dto.objective,
        channel: dto.channel,
        brief: dto.brief ?? null,
        audience: dto.audience ?? null,
        locales: dto.locales,
        landingUrl: dto.landingUrl ?? null,
        budgetCents: dto.budgetCents ?? null,
        utmSource: dto.utmSource ?? null,
        utmMedium: dto.utmMedium ?? null,
        utmCampaign: dto.utmCampaign ?? null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        createdById: ctx.actorId ?? null,
      },
    });

    await this.audit.registrar({
      action: 'studio.campaign.create',
      resource: 'campaign',
      resourceId: campana.id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { name: campana.name, channel: campana.channel },
    });

    return campana;
  }

  async actualizar(id: string, dto: ActualizarCampanaDto, ctx: ContextoActor) {
    const antes = await this.prisma.client.campaign.findFirst({ where: { id, deletedAt: null } });
    if (!antes) throw new NotFoundException('Campaña no encontrada');

    if (dto.channel !== undefined) this.comprobarCanal(dto.channel);

    this.comprobarFechas(
      dto.startsAt ?? antes.startsAt?.toISOString(),
      dto.endsAt ?? antes.endsAt?.toISOString(),
    );

    const campana = await this.prisma.client.campaign.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.objective !== undefined ? { objective: dto.objective } : {}),
        ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.brief !== undefined ? { brief: dto.brief } : {}),
        ...(dto.audience !== undefined ? { audience: dto.audience } : {}),
        ...(dto.locales !== undefined ? { locales: dto.locales } : {}),
        ...(dto.landingUrl !== undefined ? { landingUrl: dto.landingUrl } : {}),
        ...(dto.budgetCents !== undefined ? { budgetCents: dto.budgetCents } : {}),
        ...(dto.utmSource !== undefined ? { utmSource: dto.utmSource } : {}),
        ...(dto.utmMedium !== undefined ? { utmMedium: dto.utmMedium } : {}),
        ...(dto.utmCampaign !== undefined ? { utmCampaign: dto.utmCampaign } : {}),
        ...(dto.startsAt !== undefined ? { startsAt: new Date(dto.startsAt) } : {}),
        ...(dto.endsAt !== undefined ? { endsAt: new Date(dto.endsAt) } : {}),
      },
    });

    await this.audit.registrar({
      action: 'studio.campaign.update',
      resource: 'campaign',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { status: antes.status, channel: antes.channel, name: antes.name },
      after: { status: campana.status, channel: campana.channel, name: campana.name },
    });

    return campana;
  }

  /**
   * Archiva la campaña.
   *
   * No se borra nunca: sus creatividades y su gasto son el histórico con el que
   * se decide la siguiente campaña, y borrarlo es empezar de cero cada vez.
   */
  async archivar(id: string, ctx: ContextoActor) {
    const campana = await this.prisma.client.campaign.findFirst({ where: { id, deletedAt: null } });
    if (!campana) throw new NotFoundException('Campaña no encontrada');

    await this.prisma.client.campaign.update({ where: { id }, data: { status: 'ARCHIVADA' } });

    await this.audit.registrar({
      action: 'studio.campaign.archive',
      resource: 'campaign',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
    });

    return { ok: true };
  }

  /**
   * El canal tiene que existir en el catálogo.
   *
   * Antes se aceptaba cualquier cadena con la forma correcta, y eso deja
   * campañas apuntando a un canal que no existe: el informe las agrupa bajo una
   * clave suelta y el formulario de edición no puede ni enseñar cuál es, porque
   * no está entre las opciones. Falla claro y con la lista delante.
   */
  private comprobarCanal(clave: string) {
    if (canalPorClave(clave)) return;
    throw new BadRequestException(
      `El canal «${clave}» no está en el catálogo. Opciones: ${CANALES.map((c) => c.clave).join(', ')}.`,
    );
  }

  private comprobarFechas(desde?: string | null, hasta?: string | null) {
    if (!desde || !hasta) return;
    if (new Date(hasta) < new Date(desde)) {
      throw new BadRequestException('La campaña no puede terminar antes de empezar.');
    }
  }

  /**
   * Slug único.
   *
   * Va en el `utm_campaign` por defecto, así que dos campañas con el mismo slug
   * mezclarían sus ventas en el informe. Se resuelve con un sufijo en vez de
   * rechazar el nombre: repetir «rebajas» cada temporada es lo normal.
   */
  private async slugLibre(nombre: string): Promise<string> {
    const base =
      nombre
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'campana';

    const parecidos = await this.prisma.client.campaign.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    const ocupados = new Set(parecidos.map((c) => c.slug));

    if (!ocupados.has(base)) return base;
    for (let i = 2; i < 100; i++) {
      const candidato = `${base}-${i}`;
      if (!ocupados.has(candidato)) return candidato;
    }
    return `${base}-${newId().slice(-6)}`;
  }
}
