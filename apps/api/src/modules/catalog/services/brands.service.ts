import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import type { ContextoActor } from '../../roles/roles.service.js';

/**
 * Marcas de producto.
 *
 * El fabricante de lo que se vende: SATISFYER, BATHMATE, PRETTY LOVE. Es un
 * dato que el proveedor nos da en cada artículo y que hasta ahora se tiraba a
 * la basura, aunque la tabla existiera en la base de datos desde el principio.
 *
 * No tiene traducciones a propósito: una marca es un nombre propio y se escribe
 * igual en las tres lenguas de la tienda. Añadir una tabla de traducción para
 * repetir «SATISFYER» tres veces sería trabajo de mantenimiento a cambio de
 * nada.
 */
@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Las marcas del catálogo con cuántos productos tienen.
   *
   * `soloVendibles` cambia QUÉ se cuenta, no qué marcas salen: en el panel
   * interesa el total —incluidos borradores, que es lo que se está preparando—
   * y en la tienda solo lo que se puede comprar. Con el recuento de todo, la
   * página pública de marcas anunciaba «Satisfyer · 50 productos» y al entrar
   * salían tres, porque los otros 47 estaban sin publicar.
   */
  async listar(soloActivas = false, soloVendibles = false) {
    const marcas = await this.prisma.client.brand.findMany({
      where: soloActivas ? { isActive: true } : {},
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            products: soloVendibles ? { where: { status: 'ACTIVE', deletedAt: null } } : true,
          },
        },
      },
    });

    return marcas.map((m) => ({
      id: m.id,
      handle: m.handle,
      name: m.name,
      logoUrl: m.logoUrl,
      isActive: m.isActive,
      productos: m._count.products,
      createdAt: m.createdAt,
    }));
  }

  async crear(datos: { name: string; logoUrl?: string }, ctx: ContextoActor) {
    const nombre = datos.name.trim();
    const handle = identificadorDeMarca(nombre);

    const existente = await this.prisma.client.brand.findUnique({ where: { handle } });
    if (existente) {
      throw new BadRequestException(
        `Ya existe la marca «${existente.name}». Dos marcas con el mismo nombre partirían sus productos en dos listas.`,
      );
    }

    const marca = await this.prisma.client.brand.create({
      data: { id: newId(), handle, name: nombre, logoUrl: datos.logoUrl ?? null },
    });

    await this.audit.registrar({
      action: 'brand.create',
      resource: 'brand',
      resourceId: marca.id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { name: nombre, handle },
    });

    return marca;
  }

  async actualizar(
    id: string,
    datos: { name?: string; logoUrl?: string | null; isActive?: boolean },
    ctx: ContextoActor,
  ) {
    const antes = await this.exigir(id);

    /*
     * El identificador NO se recalcula al renombrar.
     *
     * Es la clave con la que la tienda enlaza la marca y con la que el
     * importador la reconoce; cambiarlo al corregir una tilde rompería los
     * enlaces publicados y crearía una marca nueva en la siguiente importación,
     * dejando los productos repartidos entre las dos.
     */
    const marca = await this.prisma.client.brand.update({
      where: { id },
      data: {
        ...(datos.name !== undefined ? { name: datos.name.trim() } : {}),
        ...(datos.logoUrl !== undefined ? { logoUrl: datos.logoUrl } : {}),
        ...(datos.isActive !== undefined ? { isActive: datos.isActive } : {}),
      },
    });

    await this.audit.registrar({
      action: 'brand.update',
      resource: 'brand',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { name: antes.name, isActive: antes.isActive, logoUrl: antes.logoUrl },
      after: { name: marca.name, isActive: marca.isActive, logoUrl: marca.logoUrl },
    });

    return marca;
  }

  async eliminar(id: string, ctx: ContextoActor): Promise<void> {
    const marca = await this.prisma.client.brand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!marca) throw new NotFoundException('Marca no encontrada');

    if (marca._count.products > 0) {
      // Borrarla dejaría esos productos sin marca de golpe y sin forma de
      // saber cuál tenían. Desactivarla la esconde de la tienda sin perder el
      // enlace.
      throw new BadRequestException(
        `«${marca.name}» tiene ${marca._count.products} producto(s). Desactívala en lugar de borrarla, ` +
          'o cámbiales antes la marca.',
      );
    }

    await this.prisma.client.brand.delete({ where: { id } });

    await this.audit.registrar({
      action: 'brand.delete',
      resource: 'brand',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { name: marca.name, handle: marca.handle },
    });
  }

  /**
   * La marca con ese nombre, creándola si hace falta.
   *
   * Es lo que usa el importador: el proveedor manda «SATISFYER» y aquí sale la
   * marca, exista ya o no. La clave es el identificador normalizado, así que
   * «SATISFYER», «Satisfyer» y «satisfyer » son la misma y no tres.
   *
   * Se resuelve con un `upsert` y no con un «busca y si no crea» porque dos
   * importaciones a la vez —o dos productos seguidos de la misma marca— llegan
   * aquí al mismo tiempo: comprobar y crear después deja una ventana en la que
   * las dos creen que no existe y la segunda revienta contra el índice único.
   */
  async asegurar(nombre: string): Promise<{ id: string; name: string } | null> {
    const limpio = nombre.trim();
    const handle = identificadorDeMarca(limpio);
    // Un nombre que se queda sin identificador —solo signos, o vacío— no es una
    // marca: se ignora en vez de crear una fila con handle en blanco.
    if (!limpio || !handle) return null;

    const marca = await this.prisma.client.brand.upsert({
      where: { handle },
      // Si ya está no se toca: puede tener el nombre corregido a mano y un
      // logotipo subido, y el proveedor no tiene por qué pisarlos.
      update: {},
      create: { id: newId(), handle, name: limpio },
      select: { id: true, name: true },
    });

    return marca;
  }

  private async exigir(id: string) {
    const marca = await this.prisma.client.brand.findUnique({ where: { id } });
    if (!marca) throw new NotFoundException('Marca no encontrada');
    return marca;
  }
}

/**
 * El identificador estable de una marca a partir de su nombre.
 *
 * Es también la clave con la que se decide si dos nombres son la misma marca,
 * así que tiene que aplanar lo que en la práctica varía: mayúsculas, tildes,
 * espacios de sobra y signos. «SATISFYER », «Satisfyer» y «satisfyer» son una.
 */
export function identificadorDeMarca(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
