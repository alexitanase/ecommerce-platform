import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LOCALES, newId, type Locale } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CacheService } from '../cache/cache.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { IntegracionesService } from '../integrations/integraciones.service.js';
import { ajusteTexto } from '../integrations/valores.js';
import { MotorDeepL, MotorLibre, MotorNinguno, type MotorTraduccion } from './motores.js';
import { costeEnCaracteres, mereceTraducirse, slugTraducido, trocear } from './preparar-texto.js';

/**
 * Traducción de las fichas importadas.
 *
 * Lo que sale del traductor **no se publica**: se guarda en una cola de
 * revisión y solo pasa al catálogo cuando alguien la aprueba. Es la diferencia
 * entre una tienda con fichas en tres idiomas y una tienda con fichas que
 * parecen escritas por una máquina, que es exactamente la impresión que hace
 * que alguien no compre.
 *
 * Al ir a una tabla aparte, ninguna consulta de la tienda necesita acordarse
 * de filtrar: lo que está publicado, está aprobado.
 */
@Injectable()
export class TraduccionService {
  private readonly logger = new Logger(TraduccionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    private readonly integraciones: IntegracionesService,
  ) {}

  /**
   * Motor configurado, o el que no traduce.
   *
   * Se resuelve en cada uso y no al arrancar: activar DeepL desde el panel
   * tiene que valer para la siguiente importación, no para el siguiente
   * reinicio. Son dos consultas a una tabla diminuta, y las importaciones no
   * son un camino caliente.
   */
  private async motorActual(): Promise<MotorTraduccion> {
    const deepl = await this.integraciones.configuracion('deepl');
    if (deepl?.operativa) {
      return new MotorDeepL(deepl.credenciales['apiKey'], ajusteTexto(deepl, 'url') || undefined);
    }

    const libre = await this.integraciones.configuracion('libretranslate');
    if (libre?.operativa) {
      return new MotorLibre(ajusteTexto(libre, 'url'), libre.credenciales['apiKey']);
    }

    return new MotorNinguno();
  }

  /** ¿Hay traductor listo para usarse? */
  async estaActiva(): Promise<boolean> {
    return (await this.motorActual()).disponible();
  }

  /**
   * Traduce un producto a los idiomas que le falten.
   *
   * Nunca pisa una traducción existente: si alguien ya escribió la ficha en
   * catalán a mano, la máquina no tiene nada que aportar ahí.
   *
   * @returns a qué idiomas se ha traducido
   */
  async traducirProducto(productId: string, destinos?: Locale[]): Promise<Locale[]> {
    const motor = await this.motorActual();
    if (!motor.disponible()) return [];

    const producto = await this.prisma.client.product.findUnique({
      where: { id: productId },
      include: { translations: true, translationDrafts: true },
    });

    if (!producto) throw new NotFoundException('Producto no encontrado');

    const original = producto.translations[0];
    if (!original) return [];

    const origen = original.locale as Locale;
    const pendientes = (destinos ?? LOCALES).filter(
      (l) =>
        l !== origen &&
        !producto.translations.some((t) => t.locale === l) &&
        !producto.translationDrafts.some((d) => d.locale === l),
    );

    if (pendientes.length === 0) return [];

    const hechas: Locale[] = [];

    for (const destino of pendientes) {
      try {
        const borrador = await this.traducirFicha(
          motor,
          {
            name: original.name,
            shortDescription: original.shortDescription,
            description: original.description,
          },
          destino,
          origen,
        );

        await this.prisma.client.productTranslationDraft.create({
          data: {
            id: newId(),
            productId,
            locale: destino,
            name: borrador.name,
            // El sufijo sale del handle, que ya es único por producto.
            slug: slugTraducido(borrador.name, producto.handle.slice(-6)),
            shortDescription: borrador.shortDescription,
            description: borrador.description,
            engine: motor.nombre,
          },
        });

        hechas.push(destino);
      } catch (error) {
        // Un idioma que falla no puede tumbar los demás ni la importación: la
        // ficha ya existe en su idioma original y se puede vender.
        this.logger.error(
          `No se ha podido traducir ${productId} a ${destino}: ${(error as Error).message}`,
        );
      }
    }

    return hechas;
  }

  /** Traduce los tres campos de una ficha, troceando lo que no quepa. */
  private async traducirFicha(
    motor: MotorTraduccion,
    ficha: { name: string; shortDescription: string | null; description: string | null },
    destino: Locale,
    origen: Locale,
  ): Promise<{ name: string; shortDescription: string | null; description: string | null }> {
    // Se manda todo junto: el nombre, el resumen y cada trozo de la
    // descripción. Una sola llamada por idioma en vez de tres.
    const trozosDescripcion = mereceTraducirse(ficha.description)
      ? trocear(ficha.description ?? '')
      : [];

    const traducirResumen = mereceTraducirse(ficha.shortDescription);

    const lote = [
      ficha.name,
      ...(traducirResumen ? [ficha.shortDescription ?? ''] : []),
      ...trozosDescripcion,
    ];

    const resultado = await motor.traducir(lote, destino, origen);

    let i = 0;
    const nombre = resultado[i++] ?? ficha.name;
    const resumen = traducirResumen
      ? (resultado[i++] ?? ficha.shortDescription)
      : ficha.shortDescription;
    const descripcion =
      trozosDescripcion.length > 0 ? resultado.slice(i).join('\n\n') : ficha.description;

    return {
      name: nombre.slice(0, 200),
      shortDescription: resumen?.slice(0, 500) ?? null,
      description: descripcion,
    };
  }

  // ── Cola de revisión ──────────────────────────────────────

  /** Traducciones pendientes de repasar, las más antiguas primero. */
  async pendientes(limite = 50) {
    const borradores = await this.prisma.client.productTranslationDraft.findMany({
      orderBy: { createdAt: 'asc' },
      take: Math.min(limite, 200),
      include: {
        product: {
          select: {
            id: true,
            handle: true,
            status: true,
            translations: true,
            media: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
          },
        },
      },
    });

    return borradores.map((b) => {
      const original = b.product.translations[0];

      return {
        id: b.id,
        productId: b.productId,
        locale: b.locale,
        motor: b.engine,
        creadaEn: b.createdAt,
        imagen: b.product.media[0]?.url ?? null,
        estadoProducto: b.product.status,
        propuesta: {
          name: b.name,
          slug: b.slug,
          shortDescription: b.shortDescription,
          description: b.description,
        },
        // El original al lado: revisar una traducción sin ver de qué viene es
        // adivinar, y así se detecta lo que el traductor se ha inventado.
        original: original
          ? {
              locale: original.locale,
              name: original.name,
              shortDescription: original.shortDescription,
              description: original.description,
            }
          : null,
      };
    });
  }

  async cuantasPendientes(): Promise<number> {
    return this.prisma.client.productTranslationDraft.count();
  }

  /**
   * Aprueba una traducción y la publica.
   *
   * Se admiten correcciones: quien revisa casi siempre cambia algo, y
   * obligarle a aprobar primero y editar después en otra pantalla es la forma
   * segura de que nadie corrija nada.
   */
  async aprobar(
    borradorId: string,
    correcciones: {
      name?: string;
      slug?: string;
      shortDescription?: string | null;
      description?: string | null;
    },
    ctx: ContextoActor,
  ) {
    const borrador = await this.prisma.client.productTranslationDraft.findUnique({
      where: { id: borradorId },
    });

    if (!borrador) throw new NotFoundException('Esa traducción ya no está pendiente');

    const datos = {
      name: (correcciones.name ?? borrador.name).trim(),
      slug: (correcciones.slug ?? borrador.slug).trim(),
      shortDescription:
        correcciones.shortDescription !== undefined
          ? correcciones.shortDescription
          : borrador.shortDescription,
      description:
        correcciones.description !== undefined ? correcciones.description : borrador.description,
    };

    if (!datos.name) throw new BadRequestException('La traducción necesita un título');

    const publicada = await this.prisma.client.$transaction(async (tx) => {
      const creada = await tx.productTranslation.upsert({
        where: { productId_locale: { productId: borrador.productId, locale: borrador.locale } },
        update: datos,
        create: {
          id: newId(),
          productId: borrador.productId,
          locale: borrador.locale,
          ...datos,
        },
      });

      await tx.productTranslationDraft.delete({ where: { id: borradorId } });
      return creada;
    });

    // La ficha del producto está cacheada por idioma; sin invalidar, la
    // traducción recién aprobada no se vería hasta cinco minutos después.
    await this.cache.invalidarEspacio('producto');

    await this.audit.registrar({
      action: 'translation.approve',
      resource: 'product',
      resourceId: borrador.productId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: {
        locale: borrador.locale,
        motor: borrador.engine,
        // Queda constancia de si se corrigió: es el dato que dice si el motor
        // vale para algo o hay que cambiarlo.
        corregida: datos.name !== borrador.name || datos.description !== borrador.description,
      },
    });

    return publicada;
  }

  /** Descarta una traducción sin publicarla. */
  async descartar(borradorId: string, ctx: ContextoActor): Promise<void> {
    const borrador = await this.prisma.client.productTranslationDraft.findUnique({
      where: { id: borradorId },
      select: { productId: true, locale: true, engine: true },
    });

    if (!borrador) return;

    await this.prisma.client.productTranslationDraft.delete({ where: { id: borradorId } });

    await this.audit.registrar({
      action: 'translation.discard',
      resource: 'product',
      resourceId: borrador.productId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { locale: borrador.locale, motor: borrador.engine },
    });
  }

  /**
   * Cuánto costaría traducir lo que hay pendiente.
   *
   * Se pregunta antes de lanzar una importación grande: mil fichas pasan del
   * medio millón de caracteres del plan gratuito de DeepL sin despeinarse.
   */
  async presupuesto(productIds: string[]): Promise<{ caracteres: number; idiomas: number }> {
    const productos = await this.prisma.client.product.findMany({
      where: { id: { in: productIds.slice(0, 500) } },
      include: { translations: true },
    });

    const caracteres = productos.reduce((suma, p) => {
      const t = p.translations[0];
      if (!t) return suma;
      return suma + costeEnCaracteres([t.name, t.shortDescription, t.description]);
    }, 0);

    const idiomas = Math.max(LOCALES.length - 1, 1);
    return { caracteres: caracteres * idiomas, idiomas };
  }
}
