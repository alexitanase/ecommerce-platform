import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { asignarVariante, leerResultado, type Experimento, type Variante } from './experimentos.js';

/**
 * Pruebas A/B ligeras.
 *
 * "Ligeras" quiere decir que no hay servicio externo ni script de terceros: el
 * reparto se calcula en el servidor y los datos se quedan en casa. Con
 * catálogo +18 no es una preferencia, es lo único posible —las plataformas de
 * experimentación al uso viven de la misma publicidad que no acepta este
 * catálogo— y además evita meter otro script en una tienda que ya tiene que
 * pedir consentimiento por cada uno.
 *
 * El reparto y la lectura estadística viven en `experimentos.ts`, que es puro y
 * está probado caso a caso. Aquí solo se guarda y se consulta.
 */
@Injectable()
export class ExperimentsService {
  private readonly logger = new Logger(ExperimentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Qué le toca ver a quien está navegando.
   *
   * Devuelve solo los experimentos activos. La asignación se guarda al
   * vuelo porque es lo único que permite después atribuir un pedido a la
   * variante que esa persona vio.
   */
  async paraVisitante(
    visitorId: string,
  ): Promise<{ clave: string; variante: string; valor: unknown }[]> {
    const activos = await this.prisma.client.experiment.findMany({ where: { status: 'ACTIVO' } });
    if (activos.length === 0) return [];

    const salida: { clave: string; variante: string; valor: unknown }[] = [];

    for (const experimento of activos) {
      const variantes = this.variantesDe(experimento.variants);
      const elegida = asignarVariante(visitorId, { clave: experimento.key, variantes });
      if (!elegida) continue;

      // Se anota la exposición. `upsert` porque la misma persona vuelve a
      // cargar la página muchas veces y cada visita no puede contar como una
      // persona distinta: eso hincharía el denominador y haría que ninguna
      // diferencia llegara nunca a ser significativa.
      await this.prisma.client.experimentAssignment
        .upsert({
          where: {
            experimentId_visitorId: { experimentId: experimento.id, visitorId },
          },
          update: {},
          create: {
            id: newId(),
            experimentId: experimento.id,
            visitorId,
            variant: elegida.clave,
          },
        })
        .catch((error: unknown) => {
          // Que falle el registro no puede dejar la tienda sin pintar. Se
          // pierde un dato de una prueba; no se pierde una visita.
          this.logger.warn(
            `No se ha podido anotar la exposición de ${experimento.key}: ` +
              (error instanceof Error ? error.message : ''),
          );
        });

      salida.push({ clave: experimento.key, variante: elegida.clave, valor: elegida.valor });
    }

    return salida;
  }

  /**
   * Atribuye un pedido a las variantes que vio quien lo hizo.
   *
   * Se llama al cobrar, no al crear el pedido: un pedido sin pagar no es una
   * conversión, y contarlo como tal haría ganar a la variante que más carritos
   * abandonados produce.
   */
  async registrarConversion(visitorId: string, orderId: string, totalCents: number): Promise<void> {
    const asignaciones = await this.prisma.client.experimentAssignment.findMany({
      where: { visitorId, convertedAt: null },
      include: { experiment: { select: { status: true } } },
    });

    for (const a of asignaciones) {
      // Solo cuenta si el experimento seguía activo: atribuir una venta a una
      // prueba ya parada mueve el resultado de algo que ya se decidió.
      if (a.experiment.status !== 'ACTIVO') continue;

      await this.prisma.client.experimentAssignment.update({
        where: { id: a.id },
        data: { convertedAt: new Date(), orderId, revenueCents: totalCents },
      });
    }
  }

  /** Listado para el panel, cada uno con su lectura. */
  async listar() {
    const experimentos = await this.prisma.client.experiment.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(experimentos.map((e) => this.conResultado(e.id)));
  }

  /** Un experimento con sus cifras y su veredicto. */
  async conResultado(id: string) {
    const experimento = await this.prisma.client.experiment.findUnique({ where: { id } });
    if (!experimento) throw new NotFoundException('Ese experimento no existe.');

    const variantes = this.variantesDe(experimento.variants);

    const conteos = await this.prisma.client.experimentAssignment.groupBy({
      by: ['variant'],
      where: { experimentId: id },
      _count: { _all: true },
      _sum: { revenueCents: true },
    });

    const conversiones = await this.prisma.client.experimentAssignment.groupBy({
      by: ['variant'],
      where: { experimentId: id, NOT: { convertedAt: null } },
      _count: { _all: true },
    });

    const convertidasPor = new Map(conversiones.map((c) => [c.variant, c._count._all]));

    const lectura = leerResultado(
      variantes.map((v) => {
        const c = conteos.find((x) => x.variant === v.clave);
        return {
          clave: v.clave,
          visitas: c?._count._all ?? 0,
          conversiones: convertidasPor.get(v.clave) ?? 0,
          ingresoCents: c?._sum.revenueCents ?? 0,
        };
      }),
    );

    return {
      id: experimento.id,
      key: experimento.key,
      name: experimento.name,
      hypothesis: experimento.hypothesis,
      status: experimento.status,
      variantes,
      startedAt: experimento.startedAt,
      endedAt: experimento.endedAt,
      winner: experimento.winner,
      lectura,
    };
  }

  async crear(
    datos: { key: string; name: string; hypothesis?: string; variantes: Variante[] },
    ctx: ContextoActor,
  ) {
    this.validarVariantes(datos.variantes);

    const experimento = await this.prisma.client.experiment.create({
      data: {
        id: newId(),
        key: datos.key,
        name: datos.name,
        ...(datos.hypothesis ? { hypothesis: datos.hypothesis } : {}),
        variants: datos.variantes as never,
        status: 'BORRADOR',
      },
    });

    await this.audit.registrar({
      action: 'experiment.create',
      resource: 'experiment',
      resourceId: experimento.id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { key: datos.key, variantes: datos.variantes },
    });

    return this.conResultado(experimento.id);
  }

  /**
   * Arranca, para o cierra un experimento.
   *
   * Las variantes no se pueden tocar una vez arrancado: cambiar el reparto o
   * el contenido a mitad mezcla dos experimentos distintos en las mismas
   * cifras, y el resultado deja de significar nada.
   */
  async cambiarEstado(id: string, estado: 'ACTIVO' | 'PARADO' | 'BORRADOR', ctx: ContextoActor) {
    const experimento = await this.prisma.client.experiment.findUnique({ where: { id } });
    if (!experimento) throw new NotFoundException('Ese experimento no existe.');

    if (estado === 'BORRADOR' && experimento.startedAt) {
      throw new BadRequestException(
        'Un experimento que ya ha arrancado no puede volver a borrador: sus cifras dejarían de ser comparables.',
      );
    }

    await this.prisma.client.experiment.update({
      where: { id },
      data: {
        status: estado,
        ...(estado === 'ACTIVO' && !experimento.startedAt ? { startedAt: new Date() } : {}),
        ...(estado === 'PARADO' ? { endedAt: new Date() } : {}),
      },
    });

    await this.audit.registrar({
      action: 'experiment.status',
      resource: 'experiment',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { status: experimento.status },
      after: { status: estado },
    });

    return this.conResultado(id);
  }

  /**
   * Da por ganadora una variante.
   *
   * No se comprueba que la lectura sea concluyente: a veces se cierra un
   * experimento por motivos que no están en los números —una variante que da
   * problemas de accesibilidad, una promoción que termina— y bloquearlo
   * obligaría a falsear el motivo. Lo que sí queda es registrado con la
   * confianza que había en ese momento, para que después se pueda revisar con
   * qué evidencia se decidió.
   */
  async declararGanadora(id: string, variante: string, ctx: ContextoActor) {
    const actual = await this.conResultado(id);

    if (!actual.variantes.some((v) => v.clave === variante)) {
      throw new BadRequestException('Esa variante no es de este experimento.');
    }

    await this.prisma.client.experiment.update({
      where: { id },
      data: { winner: variante, status: 'PARADO', endedAt: new Date() },
    });

    await this.audit.registrar({
      action: 'experiment.winner',
      resource: 'experiment',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      // La confianza que había al decidir: es lo que permite revisar después
      // si la decisión estaba respaldada o fue una corazonada.
      metadata: {
        variante,
        confianza: actual.lectura.confianza,
        motivo: actual.lectura.motivo,
      },
    });

    return this.conResultado(id);
  }

  async eliminar(id: string, ctx: ContextoActor): Promise<void> {
    await this.prisma.client.experiment.delete({ where: { id } });

    await this.audit.registrar({
      action: 'experiment.delete',
      resource: 'experiment',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
    });
  }

  private variantesDe(bruto: unknown): Variante[] {
    if (!Array.isArray(bruto)) return [];

    return bruto.flatMap((v): Variante[] => {
      if (typeof v !== 'object' || v === null) return [];
      const o = v as Record<string, unknown>;
      if (typeof o['clave'] !== 'string') return [];

      return [
        {
          clave: o['clave'],
          peso: typeof o['peso'] === 'number' ? o['peso'] : 0,
          valor: o['valor'],
        },
      ];
    });
  }

  private validarVariantes(variantes: Variante[]): void {
    if (variantes.length < 2) {
      throw new BadRequestException('Un experimento necesita al menos dos variantes que comparar.');
    }

    const claves = new Set(variantes.map((v) => v.clave));
    if (claves.size !== variantes.length) {
      throw new BadRequestException('Hay variantes con la misma clave.');
    }

    if (variantes.every((v) => v.peso <= 0)) {
      throw new BadRequestException('Al menos una variante tiene que tener peso.');
    }
  }
}

/** Reexportado para que el resto de la aplicación no dependa del módulo puro. */
export type { Experimento, Variante };
