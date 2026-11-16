import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import crypto from 'node:crypto';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { traduccionPreferida } from '../../common/contenido/traduccion.js';
import { PasswordService } from '../auth/password.service.js';
import { PermissionsService } from '../auth/permissions.service.js';
import { TokensService } from '../auth/tokens.service.js';
import { MailService } from '../mail/mail.service.js';
import type { ContextoActor } from '../roles/roles.service.js';

/** Campos que se devuelven de un usuario. Nunca incluye password ni totpSecret. */
const CAMPOS_PUBLICOS = {
  id: true,
  email: true,
  type: true,
  firstName: true,
  lastName: true,
  phone: true,
  locale: true,
  isActive: true,
  emailVerifiedAt: true,
  totpEnabledAt: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

interface CifrasCliente {
  pedidos: number;
  gastadoCents: number;
  ultimoPedido: Date | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly permisos: PermissionsService,
    private readonly tokens: TokensService,
    private readonly mail: MailService,
  ) {}

  // ── Perfil propio ─────────────────────────────────────────

  async actualizarPerfil(
    userId: string,
    datos: { firstName?: string; lastName?: string; phone?: string; locale?: string },
  ) {
    return this.prisma.client.user.update({
      where: { id: userId },
      data: {
        ...(datos.firstName !== undefined ? { firstName: datos.firstName } : {}),
        ...(datos.lastName !== undefined ? { lastName: datos.lastName } : {}),
        ...(datos.phone !== undefined ? { phone: datos.phone } : {}),
        ...(datos.locale !== undefined ? { locale: datos.locale } : {}),
      },
      select: CAMPOS_PUBLICOS,
    });
  }

  async actualizarConsentimiento(userId: string, acepta: boolean) {
    return this.prisma.client.user.update({
      where: { id: userId },
      // Se guarda CUÁNDO se dio el consentimiento, no solo que se dio: el RGPD
      // exige poder demostrar el momento en que el usuario lo otorgó.
      data: { marketingConsentAt: acepta ? new Date() : null },
      select: { id: true, marketingConsentAt: true },
    });
  }

  // ── Gestión del equipo (admin) ────────────────────────────

  /**
   * Clientes con sus cifras de compra.
   *
   * El valor de vida y el número de pedidos se calculan aquí y no en la
   * pantalla porque son la única forma de distinguir a un cliente habitual de
   * uno que compró una vez, y esa distinción es la que decide cómo se atiende
   * una incidencia.
   *
   * Solo cuenta lo realmente cobrado: incluir pedidos cancelados o pendientes
   * de pago daría un valor de vida inflado que llevaría a tratar como cliente
   * bueno a quien nunca llegó a pagar.
   */
  async listarClientes(filtros: { busqueda?: string; limite?: number; cursor?: string }) {
    const limite = Math.min(filtros.limite ?? 50, 100);

    const clientes = await this.prisma.client.user.findMany({
      where: {
        type: 'CUSTOMER',
        deletedAt: null,
        ...(filtros.busqueda
          ? {
              OR: [
                { email: { contains: filtros.busqueda, mode: 'insensitive' as const } },
                { firstName: { contains: filtros.busqueda, mode: 'insensitive' as const } },
                { lastName: { contains: filtros.busqueda, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        locale: true,
        isActive: true,
        emailVerifiedAt: true,
        marketingConsentAt: true,
        createdAt: true,
        lastLoginAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limite + 1,
      ...(filtros.cursor ? { cursor: { id: filtros.cursor }, skip: 1 } : {}),
    });

    const hayMas = clientes.length > limite;
    const pagina = hayMas ? clientes.slice(0, limite) : clientes;

    const cifras = await this.cifrasDeCompra(pagina.map((c) => c.id));

    return {
      items: pagina.map((c) => ({
        ...c,
        ...(cifras.get(c.id) ?? { pedidos: 0, gastadoCents: 0, ultimoPedido: null }),
      })),
      // `nextCursor` y no `siguienteCursor`: era el único de los cinco
      // listados paginados de la API que usaba otro nombre, y por eso el panel
      // no podía compartir el mismo código de paginación con los demás.
      nextCursor: hayMas ? (pagina.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Pedidos, gasto total y último pedido de varios clientes de una vez.
   *
   * Agrupado en una consulta en vez de una por cliente: con cincuenta filas en
   * pantalla, lo segundo son cincuenta viajes a la base cada vez que alguien
   * abre la lista.
   */
  private async cifrasDeCompra(userIds: string[]) {
    if (userIds.length === 0) return new Map<string, CifrasCliente>();

    const agrupado = await this.prisma.client.order.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        // Solo lo cobrado de verdad.
        paymentStatus: 'PAID',
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
      _count: { _all: true },
      _sum: { totalCents: true },
      _max: { createdAt: true },
    });

    return new Map<string, CifrasCliente>(
      agrupado
        .filter((g): g is typeof g & { userId: string } => g.userId !== null)
        .map((g) => [
          g.userId,
          {
            pedidos: g._count._all,
            gastadoCents: g._sum.totalCents ?? 0,
            ultimoPedido: g._max.createdAt,
          },
        ]),
    );
  }

  /** Ficha completa de un cliente: historial, direcciones y consentimientos. */
  async fichaCliente(id: string) {
    const cliente = await this.prisma.client.user.findFirst({
      where: { id, type: 'CUSTOMER' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        locale: true,
        isActive: true,
        emailVerifiedAt: true,
        marketingConsentAt: true,
        createdAt: true,
        lastLoginAt: true,
        deletedAt: true,
        // Solo para saber si hay acceso con contraseña; se descarta antes de
        // responder, unas líneas más abajo.
        password: true,
        addresses: {
          where: { deletedAt: null },
          select: {
            id: true,
            type: true,
            firstName: true,
            lastName: true,
            line1: true,
            line2: true,
            city: true,
            province: true,
            postalCode: true,
            countryCode: true,
            isDefault: true,
          },
        },
      },
    });

    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    const pedidos = await this.prisma.client.order.findMany({
      where: { userId: id },
      select: {
        id: true,
        number: true,
        status: true,
        paymentStatus: true,
        totalCents: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const cifras = (await this.cifrasDeCompra([id])).get(id) ?? {
      pedidos: 0,
      gastadoCents: 0,
      ultimoPedido: null,
    };

    /*
     * Cómo entró, qué tiene abierto y qué se dejó a medias.
     *
     * Las tres cosas se piden en paralelo porque son independientes, y las tres
     * hacen falta para atender a alguien por teléfono sin tener que entrar en la
     * base de datos:
     *
     *  · **Cómo se registró.** «No me deja entrar con mi contraseña» tiene una
     *    respuesta distinta si la cuenta se creó con Google y nunca tuvo
     *    contraseña. Sin esto era imposible saberlo desde el panel.
     *  · **Sesiones abiertas.** Es lo que se mira cuando alguien dice que le han
     *    entrado en la cuenta, y lo que hay que poder cerrar.
     *  · **Carritos sin comprar.** Es la conversación de venta más directa que
     *    hay: se sabe qué quería y cuánto valía.
     */
    const [identidades, sesiones, carritos] = await Promise.all([
      this.prisma.client.userIdentity.findMany({
        where: { userId: id },
        // El identificador que da el proveedor NO sale: no le sirve a nadie en
        // el panel y es un dato personal más que enseñar sin motivo.
        select: { provider: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.client.session.findMany({
        where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
        // Nunca el hash del refresh token, evidentemente.
        select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true },
        orderBy: { lastUsedAt: 'desc' },
      }),
      this.prisma.client.cart.findMany({
        // Solo los que se quedaron a medias: uno convertido ya es un pedido y
        // está en el historial de abajo.
        where: { userId: id, convertedAt: null, items: { some: {} } },
        select: {
          id: true,
          updatedAt: true,
          expiresAt: true,
          recoveryStage: true,
          recoveryOptOut: true,
          items: {
            select: {
              quantity: true,
              priceWhenAddedCents: true,
              variant: {
                select: {
                  sku: true,
                  product: { select: { translations: { select: { locale: true, name: true } } } },
                },
              },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
    ]);

    /*
     * El hash de la contraseña se queda AQUÍ.
     *
     * Se pide a la base solo para saber si la cuenta tiene acceso con
     * contraseña, y se saca del objeto antes de construir la respuesta: con un
     * `...cliente` a secas viajaría el hash a la interfaz del panel, y de ahí a
     * las herramientas de red de cualquiera que lo abra. Es el mismo criterio
     * de lista blanca que `fichaPublica` del catálogo.
     */
    const { password, ...datos } = cliente;

    return {
      ...datos,
      ...cifras,
      // El ticket medio dice más que el gasto total: distingue a quien compró
      // mucho una vez de quien vuelve cada mes.
      ticketMedioCents: cifras.pedidos > 0 ? Math.round(cifras.gastadoCents / cifras.pedidos) : 0,
      historial: pedidos,
      /*
       * Cómo se registró, resumido para que el panel no tenga que deducirlo.
       *
       * `directo` es tener contraseña propia. Las dos cosas no se excluyen: quien
       * entró con Google y luego se puso contraseña tiene las dos, y saberlo es
       * justo lo que resuelve la llamada.
       */
      acceso: {
        directo: password !== null,
        proveedores: identidades.map((i) => i.provider),
        identidades,
      },
      sesiones,
      carritos: carritos.map((c) => ({
        id: c.id,
        actualizadoEn: c.updatedAt,
        expiraEn: c.expiresAt,
        avisosEnviados: c.recoveryStage,
        sinAvisos: c.recoveryOptOut,
        unidades: c.items.reduce((n, i) => n + i.quantity, 0),
        // Con el precio al que se añadió, que es el que vio quien lo dejó ahí:
        // el de hoy puede ser otro y entonces la conversación no cuadra.
        totalCents: c.items.reduce((n, i) => n + i.priceWhenAddedCents * i.quantity, 0),
        lineas: c.items.map((i) => ({
          sku: i.variant.sku,
          // Con respaldo de idioma: `translations[0]` devolvía la que quisiera la
          // base de datos, así que el panel enseñaba el nombre en catalán.
          nombre: traduccionPreferida(i.variant.product.translations, 'es')?.name ?? i.variant.sku,
          cantidad: i.quantity,
          precioCents: i.priceWhenAddedCents,
        })),
      })),
    };
  }

  /**
   * Cierra todas las sesiones de una cuenta desde el panel.
   *
   * Es lo que hace falta cuando alguien llama diciendo que le han entrado en la
   * cuenta: se cierra todo y solo puede volver a entrar quien sepa la
   * contraseña —o quien pase por el acceso social—. Queda en la auditoría con
   * quién lo hizo, porque expulsar a un cliente de su cuenta es una acción que
   * hay que poder explicar después.
   */
  async cerrarSesiones(id: string, ctx: ContextoActor): Promise<{ cerradas: number }> {
    const usuario = await this.soloCliente(id);

    const cerradas = await this.tokens.revocarTodasLasSesiones(id);

    await this.audit.registrar({
      action: 'user.sessions.revoke',
      resource: 'user',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      metadata: { cerradas, email: usuario.email },
    });

    return { cerradas };
  }

  /**
   * Cierra todas las sesiones de una cuenta del personal.
   *
   * Separado del de clientes por el permiso y por el cerrojo: aquí hace falta
   * `users:write` y la cuenta tiene que ser del personal. Con un solo método
   * para los dos, el permiso de atención al cliente serviría para echar a un
   * administrador del panel.
   */
  async cerrarSesionesPersonal(id: string, ctx: ContextoActor): Promise<{ cerradas: number }> {
    const usuario = await this.prisma.client.user.findFirst({
      where: { id, type: 'STAFF' },
      select: { id: true, email: true },
    });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    const cerradas = await this.tokens.revocarTodasLasSesiones(id);

    await this.audit.registrar({
      action: 'user.sessions.revoke',
      resource: 'user',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      metadata: { cerradas, email: usuario.email, personal: true },
    });

    return { cerradas };
  }

  /**
   * Activar o desactivar la cuenta de un cliente.
   *
   * Existe aparte de `cambiarEstado` por el permiso: aquélla pide `users:write`,
   * que es el del personal, así que quien solo atiende a clientes no podía
   * bloquear una cuenta —y bloquear una cuenta es justo lo que hace falta
   * cuando llegan pedidos fraudulentos desde ella—.
   *
   * Desactivar cierra sus sesiones, igual que en el personal: si no, quien esté
   * dentro sigue comprando hasta que caduque su token.
   */
  async cambiarEstadoCliente(id: string, activo: boolean, ctx: ContextoActor) {
    await this.soloCliente(id);

    const cliente = await this.prisma.client.user.update({
      where: { id },
      data: { isActive: activo },
      select: CAMPOS_PUBLICOS,
    });

    if (!activo) await this.tokens.revocarTodasLasSesiones(id);

    await this.audit.registrar({
      action: activo ? 'customer.activate' : 'customer.deactivate',
      resource: 'user',
      resourceId: id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
    });

    return cliente;
  }

  /**
   * La cuenta existe y es de un cliente, no del personal.
   *
   * Es el cerrojo que mantiene separadas las dos gestiones: sin él, el permiso
   * de atención al cliente serviría para cerrarle la sesión —o desactivar la
   * cuenta— a un administrador, que es justo la escalada que la separación de
   * permisos existe para impedir.
   */
  private async soloCliente(id: string): Promise<{ id: string; email: string | null }> {
    const usuario = await this.prisma.client.user.findFirst({
      where: { id, type: 'CUSTOMER' },
      select: { id: true, email: true },
    });

    if (!usuario) throw new NotFoundException('Cliente no encontrado');

    return usuario;
  }

  async listar(filtros: {
    tipo?: 'CUSTOMER' | 'STAFF';
    busqueda?: string;
    activos?: boolean;
    limite?: number;
    cursor?: string;
  }) {
    const limite = Math.min(filtros.limite ?? 50, 100);

    const usuarios = await this.prisma.client.user.findMany({
      where: {
        deletedAt: null,
        ...(filtros.tipo ? { type: filtros.tipo } : {}),
        ...(filtros.activos !== undefined ? { isActive: filtros.activos } : {}),
        ...(filtros.busqueda
          ? {
              OR: [
                { email: { contains: filtros.busqueda, mode: 'insensitive' as const } },
                { firstName: { contains: filtros.busqueda, mode: 'insensitive' as const } },
                { lastName: { contains: filtros.busqueda, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: {
        ...CAMPOS_PUBLICOS,
        roles: { select: { role: { select: { id: true, key: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: limite + 1,
      ...(filtros.cursor ? { cursor: { id: filtros.cursor }, skip: 1 } : {}),
    });

    const hayMas = usuarios.length > limite;
    const items = (hayMas ? usuarios.slice(0, limite) : usuarios).map((u) => ({
      ...u,
      roles: u.roles.map((r) => r.role),
    }));

    return { items, nextCursor: hayMas ? (items.at(-1)?.id ?? null) : null };
  }

  async detalle(userId: string) {
    const usuario = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        ...CAMPOS_PUBLICOS,
        marketingConsentAt: true,
        roles: { select: { role: { select: { id: true, key: true, name: true } } } },
        _count: { select: { addresses: true, sessions: true } },
        /*
         * Las sesiones abiertas, con qué dispositivo y desde dónde.
         *
         * En una cuenta del personal esto no es una curiosidad: es lo que hay
         * que mirar cuando se sospecha que unas credenciales del panel se han
         * filtrado, y hasta ahora el panel solo decía CUÁNTAS había. Nunca el
         * hash del refresh token, evidentemente.
         */
        sessions: {
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true },
          orderBy: { lastUsedAt: 'desc' },
        },
      },
    });

    if (!usuario || !usuario.isActive) {
      const existe = await this.prisma.client.user.findUnique({ where: { id: userId } });
      if (!existe || existe.deletedAt) throw new NotFoundException('Usuario no encontrado');
    }
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    return { ...usuario, roles: usuario.roles.map((r) => r.role), sesiones: usuario.sessions };
  }

  /**
   * Invita a un miembro del equipo.
   *
   * No se le asigna contraseña: se crea la cuenta y se emite un token de
   * establecimiento. Enviarle una contraseña generada por email significaría
   * que esa contraseña queda escrita en un buzón para siempre.
   */
  async invitar(
    datos: { email: string; firstName?: string; lastName?: string; roleIds: string[] },
    ctx: ContextoActor,
  ) {
    const existe = await this.prisma.client.user.findUnique({
      where: { email: datos.email },
      select: { id: true },
    });
    if (existe) throw new BadRequestException('Ya existe una cuenta con ese email');

    const roles = await this.prisma.client.role.findMany({
      where: { id: { in: datos.roleIds } },
      select: { id: true },
    });
    if (roles.length !== datos.roleIds.length) {
      throw new BadRequestException('Alguno de los roles indicados no existe');
    }

    const usuario = await this.prisma.client.user.create({
      data: {
        id: newId(),
        email: datos.email,
        type: 'STAFF',
        password: null,
        firstName: datos.firstName ?? null,
        lastName: datos.lastName ?? null,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
      select: CAMPOS_PUBLICOS,
    });

    const token = crypto.randomBytes(32).toString('base64url');
    await this.prisma.client.verificationToken.create({
      data: {
        id: newId(),
        userId: usuario.id,
        purpose: 'PASSWORD_RESET',
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
        // Ventana amplia: una invitación al equipo puede tardar en atenderse.
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.audit.registrar({
      action: 'user.invite',
      resource: 'user',
      resourceId: usuario.id,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: { email: usuario.email, roleIds: datos.roleIds },
    });

    void this.mail.invitacionEquipo({ email: datos.email, token }).catch(() => {
      // Se devuelve el token igualmente: si el correo falla, el admin puede
      // pasarlo a mano en lugar de quedarse sin poder invitar a nadie.
    });

    return { usuario, invitacionToken: token };
  }

  /**
   * Edita una cuenta del personal: su nombre y el conjunto de roles que tiene.
   *
   * `roleIds` llega como el conjunto completo que debe quedar, y aquí se
   * reconcilia en una transacción. La alternativa —que el panel fuera pidiendo
   * «asigna este» y «quita ese otro»— deja la cuenta con permisos a medias en
   * cuanto una de las peticiones se pierde, y con permisos a medias alguien se
   * queda fuera de su trabajo o dentro de donde no debía.
   */
  async editar(
    userId: string,
    datos: { firstName?: string; lastName?: string; roleIds?: string[] },
    ctx: ContextoActor,
  ) {
    const antes = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        type: true,
        deletedAt: true,
        firstName: true,
        lastName: true,
        roles: { select: { role: { select: { id: true, key: true, name: true } } } },
      },
    });

    if (!antes || antes.deletedAt) throw new NotFoundException('Usuario no encontrado');
    if (antes.type !== 'STAFF') {
      throw new BadRequestException('Solo las cuentas del personal tienen roles que editar');
    }

    const roleIds = datos.roleIds ? [...new Set(datos.roleIds)] : undefined;

    if (roleIds) {
      const roles = await this.prisma.client.role.findMany({
        where: { id: { in: roleIds } },
        select: { id: true, key: true },
      });
      if (roles.length !== roleIds.length) {
        throw new BadRequestException('Alguno de los roles indicados no existe');
      }

      // Quitar el rol de propietario al último que lo tiene deja la plataforma
      // sin nadie que pueda repartir permisos, y desde el panel ya no hay forma
      // de devolvérselo a nadie: haría falta entrar a la base de datos a mano.
      const eraPropietario = antes.roles.some((r) => r.role.key === 'owner');
      const seguiraSiendolo = roles.some((r) => r.key === 'owner');

      if (eraPropietario && !seguiraSiendolo) {
        const propietariosActivos = await this.prisma.client.userRole.count({
          where: { role: { key: 'owner' }, user: { isActive: true, deletedAt: null } },
        });
        if (propietariosActivos <= 1) {
          throw new BadRequestException(
            'Es el último propietario activo: asigna el rol a otra persona antes de quitárselo.',
          );
        }
      }
    }

    await this.prisma.client.$transaction(async (tx) => {
      if (datos.firstName !== undefined || datos.lastName !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(datos.firstName !== undefined ? { firstName: datos.firstName } : {}),
            ...(datos.lastName !== undefined ? { lastName: datos.lastName } : {}),
          },
        });
      }

      if (roleIds) {
        await tx.userRole.deleteMany({ where: { userId, roleId: { notIn: roleIds } } });
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({ userId, roleId })),
          skipDuplicates: true,
        });
      }
    });

    // Los permisos se sirven de una caché: sin invalidarla, quien acaba de
    // perder un rol lo sigue teniendo hasta que caduque, y quien acaba de
    // ganarlo no lo tiene todavía. Ninguna de las dos cosas se entiende desde
    // el otro lado de la pantalla.
    if (roleIds) await this.permisos.invalidar(userId);

    const despues = await this.detalle(userId);

    await this.audit.registrar({
      action: 'user.update',
      resource: 'user',
      resourceId: userId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: {
        firstName: antes.firstName,
        lastName: antes.lastName,
        roles: antes.roles.map((r) => r.role.key).sort(),
      },
      after: {
        firstName: despues.firstName,
        lastName: despues.lastName,
        roles: despues.roles.map((r) => r.key).sort(),
      },
    });

    return despues;
  }

  async cambiarEstado(userId: string, activo: boolean, ctx: ContextoActor) {
    if (userId === ctx.actorId) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta');
    }

    await this.protegerUltimoPropietario(userId);

    const usuario = await this.prisma.client.user.update({
      where: { id: userId },
      data: { isActive: activo },
      select: CAMPOS_PUBLICOS,
    });

    // Desactivar debe echar al usuario de inmediato, no cuando caduque su token.
    if (!activo) {
      await this.tokens.revocarTodasLasSesiones(userId);
      await this.permisos.invalidar(userId);
    }

    await this.audit.registrar({
      action: activo ? 'user.activate' : 'user.deactivate',
      resource: 'user',
      resourceId: userId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
    });

    return usuario;
  }

  /**
   * Anonimiza al usuario en lugar de borrarlo (derecho de supresión del RGPD).
   *
   * No se puede hacer un DELETE: las facturas emitidas deben conservarse por
   * obligación fiscal y siguen apuntando a este usuario. Se eliminan los datos
   * personales y se deja el registro contable en pie.
   */
  async anonimizar(userId: string, ctx: ContextoActor): Promise<void> {
    if (userId === ctx.actorId) {
      throw new BadRequestException('No puedes anonimizar tu propia cuenta desde aquí');
    }
    await this.protegerUltimoPropietario(userId);

    const anonimo = `anon-${newId().slice(0, 12)}@anonimizado.local`;

    await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: userId },
        data: {
          email: anonimo,
          firstName: null,
          lastName: null,
          phone: null,
          password: null,
          totpSecret: null,
          totpEnabledAt: null,
          recoveryCodes: [],
          marketingConsentAt: null,
          isActive: false,
          deletedAt: new Date(),
        },
      }),
      this.prisma.client.address.updateMany({
        where: { userId },
        data: { deletedAt: new Date() },
      }),
      this.prisma.client.userIdentity.deleteMany({ where: { userId } }),
    ]);

    await this.tokens.revocarTodasLasSesiones(userId);
    await this.permisos.invalidar(userId);

    await this.audit.registrar({
      action: 'user.anonymize',
      resource: 'user',
      resourceId: userId,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      metadata: { motivo: 'Solicitud RGPD de supresión' },
    });
  }

  /** Exporta los datos del usuario en formato legible (portabilidad, RGPD). */
  async exportarDatos(userId: string) {
    const usuario = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        ...CAMPOS_PUBLICOS,
        marketingConsentAt: true,
        addresses: { where: { deletedAt: null } },
        roles: { select: { role: { select: { key: true, name: true } } } },
      },
    });

    return {
      generadoEl: new Date().toISOString(),
      cuenta: {
        email: usuario.email,
        nombre: usuario.firstName,
        apellidos: usuario.lastName,
        telefono: usuario.phone,
        idioma: usuario.locale,
        altaEl: usuario.createdAt,
        ultimoAcceso: usuario.lastLoginAt,
        emailVerificado: usuario.emailVerifiedAt !== null,
        consentimientoMarketing: usuario.marketingConsentAt,
      },
      direcciones: usuario.addresses,
      roles: usuario.roles.map((r) => r.role),
    };
  }

  // ── Internos ──────────────────────────────────────────────

  /** Impide dejar la plataforma sin ningún propietario activo. */
  private async protegerUltimoPropietario(userId: string): Promise<void> {
    const esPropietario = await this.prisma.client.userRole.findFirst({
      where: { userId, role: { key: 'owner' } },
    });
    if (!esPropietario) return;

    const propietariosActivos = await this.prisma.client.userRole.count({
      where: { role: { key: 'owner' }, user: { isActive: true, deletedAt: null } },
    });

    if (propietariosActivos <= 1) {
      throw new BadRequestException(
        'Es el último propietario activo: asigna el rol a otra persona antes de continuar.',
      );
    }
  }

  async establecerPasswordInvitacion(token: string, password: string): Promise<void> {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const registro = await this.prisma.client.verificationToken.findUnique({
      where: { tokenHash: hash },
    });

    if (!registro || registro.usedAt || registro.expiresAt < new Date()) {
      throw new BadRequestException('La invitación no es válida o ha caducado');
    }

    await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: registro.userId },
        data: {
          password: await this.passwords.hash(password),
          emailVerifiedAt: new Date(),
        },
      }),
      this.prisma.client.verificationToken.update({
        where: { id: registro.id },
        data: { usedAt: new Date() },
      }),
    ]);
  }
}
