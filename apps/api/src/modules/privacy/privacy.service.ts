import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@ecom/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import {
  explicarPlan,
  RETENCIONES,
  planDeSupresion,
  plazoDeRespuesta,
  type CategoriaDato,
  type ElementoConFecha,
  type PlanSupresion,
} from './retencion-datos.js';

/**
 * Derechos RGPD del cliente.
 *
 * La persona se identifica **por email**, no por cuenta de usuario. Es la
 * diferencia entre cumplir y aparentar que se cumple: en una tienda nueva la
 * mayoría compra sin registrarse, y su nombre, dirección y teléfono están en
 * los pedidos aunque no exista ninguna fila de usuario. Anonimizar solo la
 * cuenta deja intactos justo los datos de quien no tiene cuenta.
 *
 * Por el mismo motivo la exportación recorre pedidos, facturas y
 * consentimientos: un volcado con el nombre y poco más no es el "acceso a los
 * datos personales" del art. 15, es un extracto de la ficha de usuario.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private normalizar(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Todo lo que la tienda guarda sobre una persona (arts. 15 y 20).
   *
   * En JSON estructurado porque el art. 20 pide un formato "de uso común y
   * lectura mecánica": un PDF cumpliría el acceso pero no la portabilidad.
   */
  async exportar(email: string) {
    const correo = this.normalizar(email);

    const usuario = await this.prisma.client.user.findFirst({
      where: { email: correo },
      include: {
        addresses: true,
        roles: { select: { role: { select: { key: true, name: true } } } },
      },
    });

    const pedidos = await this.prisma.client.order.findMany({
      where: { email: correo },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    });

    // El consentimiento y la comprobación de edad se registran contra un
    // identificador de visita, no contra el email: son seudónimos a propósito.
    // Solo se pueden vincular a una persona si llegó a tener cuenta, y decirlo
    // forma parte de responder con honestidad qué se guarda de ella.
    const porUsuario = usuario ? { userId: usuario.id } : { userId: '' };

    const [facturas, consentimientos, verificaciones, resenas] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: { orderId: { in: pedidos.map((p) => p.id) } },
        orderBy: { issuedAt: 'asc' },
      }),
      this.prisma.client.consentLog.findMany({
        where: porUsuario,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.client.ageVerification.findMany({
        where: porUsuario,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.client.review.findMany({
        where: porUsuario,
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      generadoEl: new Date().toISOString(),
      sobre: correo,
      // Se dice explícitamente si hay cuenta: quien compró como invitado tiene
      // datos personales igualmente y merece saber cuáles.
      tieneCuenta: usuario !== null,
      cuenta: usuario
        ? {
            email: usuario.email,
            nombre: usuario.firstName,
            apellidos: usuario.lastName,
            telefono: usuario.phone,
            idioma: usuario.locale,
            altaEl: usuario.createdAt,
            ultimoAcceso: usuario.lastLoginAt,
            emailVerificado: usuario.emailVerifiedAt !== null,
            consentimientoMarketing: usuario.marketingConsentAt,
            roles: usuario.roles.map((r) => r.role.name),
          }
        : null,
      direcciones: usuario?.addresses ?? [],
      pedidos: pedidos.map((p) => ({
        numero: p.number,
        fecha: p.createdAt,
        estado: p.status,
        totalCents: p.totalCents,
        moneda: p.currency,
        direccionEnvio: p.shippingAddress,
        direccionFacturacion: p.billingAddress,
        telefono: p.phone,
        notaDelCliente: p.customerNote,
        lineas: p.items.map((i) => ({
          producto: i.name,
          variante: i.variantName,
          sku: i.sku,
          cantidad: i.quantity,
          totalCents: i.totalCents,
        })),
      })),
      facturas: facturas.map((f) => ({
        numero: f.fullNumber,
        fecha: f.issuedAt,
        totalCents: f.totalCents,
        datosFiscales: f.customerSnapshot,
      })),
      consentimientos: consentimientos.map((c) => ({
        fecha: c.createdAt,
        analitica: c.analytics,
        marketing: c.marketing,
        versionDeLaPolitica: c.policyVersion,
        // La IP truncada forma parte de la prueba del consentimiento y es dato
        // personal suyo: también le corresponde.
        ipTruncada: c.ipTruncated,
      })),
      verificacionesDeEdad: verificaciones.map((v) => ({
        fecha: v.createdAt,
        metodo: v.method,
        anioDeNacimientoDeclarado: v.birthYear,
      })),
      resenas: resenas.map((r) => ({
        fecha: r.createdAt,
        puntuacion: r.rating,
        titulo: r.title,
        texto: r.body,
      })),
    };
  }

  /**
   * Qué pasaría si esta persona pidiera la supresión.
   *
   * Se puede consultar sin ejecutar nada: permite responderle antes de borrar,
   * que es lo que evita la discusión de después.
   */
  async previsualizarSupresion(email: string): Promise<{
    plan: PlanSupresion;
    explicacion: string;
    plazoRespuesta: Date;
  }> {
    const plan = planDeSupresion(await this.inventario(this.normalizar(email)));

    return {
      plan,
      explicacion: explicarPlan(plan),
      plazoRespuesta: plazoDeRespuesta(new Date()),
    };
  }

  /**
   * Ejecuta el derecho de supresión.
   *
   * Lo que está en plazo legal no se borra: se **bloquea**, que es el término
   * del art. 32 de la LOPDGDD. Queda conservado a disposición de jueces y
   * administraciones y fuera de cualquier otro uso. Aquí eso se traduce en
   * marcar el pedido como bloqueado y en que ninguna consulta comercial vuelva
   * a tocarlo.
   */
  async suprimir(email: string, ctx: ContextoActor) {
    const correo = this.normalizar(email);
    const inventario = await this.inventario(correo);
    const plan = planDeSupresion(inventario);

    const idsDe = (categoria: CategoriaDato): string[] =>
      plan.borrarAhora.find((b) => b.categoria === categoria)?.ids ?? [];

    const seudonimo = `anon-${Buffer.from(correo).toString('base64url').slice(0, 10)}@anonimizado.local`;

    await this.prisma.client.$transaction(async (tx) => {
      const usuario = await tx.user.findFirst({ where: { email: correo } });

      if (usuario) {
        await tx.user.update({
          where: { id: usuario.id },
          data: {
            email: seudonimo,
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
        });

        await tx.address.deleteMany({ where: { userId: usuario.id } });
        await tx.userIdentity.deleteMany({ where: { userId: usuario.id } });
        await tx.cart.deleteMany({ where: { userId: usuario.id } });

        // La reseña se queda publicada pero deja de apuntar a nadie: el
        // contenido es de la tienda, la autoría es dato personal.
        await tx.review.updateMany({
          where: { userId: usuario.id },
          data: { userId: null },
        });
      }

      await tx.cart.deleteMany({ where: { email: correo } });

      // Pedidos ya liberados del plazo: se les quita todo lo personal.
      const liberados = idsDe('PEDIDOS');
      if (liberados.length > 0) {
        await tx.order.updateMany({
          where: { id: { in: liberados } },
          data: {
            email: seudonimo,
            phone: null,
            customerNote: null,
            shippingAddress: this.direccionAnonima(),
            billingAddress: Prisma.DbNull,
          },
        });
      }

      // Los que siguen en plazo se marcan bloqueados: conservados por
      // obligación legal y fuera de cualquier uso comercial.
      const retenidos = plan.conservar.find((c) => c.categoria === 'PEDIDOS')?.ids ?? [];
      if (retenidos.length > 0) {
        await tx.order.updateMany({
          where: { id: { in: retenidos } },
          data: { personalDataBlockedAt: new Date() },
        });
      }
    });

    const explicacion = explicarPlan(plan);

    await this.audit.registrar({
      action: 'privacy.erasure',
      resource: 'privacy',
      resourceId: seudonimo,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: {
        borrado: plan.borrarAhora.map((b) => `${b.categoria}:${String(b.ids.length)}`),
        conservado: plan.conservar.map((c) => `${c.categoria}:${String(c.ids.length)}`),
      },
    });

    this.logger.log(`Supresión RGPD ejecutada; ${plan.conservar.length} categorías en plazo legal`);

    return { plan, explicacion };
  }

  /**
   * Purga de datos que han cumplido su plazo de conservación.
   *
   * El art. 5.1.e del RGPD limita la conservación al tiempo necesario: cumplido
   * el plazo, el dato sobra **aunque nadie lo haya pedido**. Sin una tarea que
   * lo aplique sola, una tienda acumula direcciones de hace diez años y el
   * incumplimiento crece con el tiempo sin que nadie lo decida.
   *
   * Dos criterios que la hacen segura de dejar corriendo a diario:
   *
   *  · **No se borran filas contables.** De las facturas caducadas se quitan
   *    los datos personales, pero la factura se queda: borrarla dejaría un
   *    hueco en la numeración correlativa, que es lo primero que mira una
   *    inspección. Se pierde a la persona, no el registro fiscal.
   *  · **Se puede simular.** Una purga que borra en silencio y sin poder
   *    comprobarla antes es la clase de tarea que un día se lleva por delante
   *    algo que no tocaba.
   *
   * @param opciones.simulacion cuenta lo que haría sin tocar nada
   */
  async purgar(opciones: { simulacion?: boolean } = {}, ahora = new Date()) {
    const simulacion = opciones.simulacion ?? false;

    const limite = (categoria: CategoriaDato) =>
      this.haceAnios(RETENCIONES[categoria].anios, ahora);

    // Pedidos con los datos ya bloqueados por una solicitud de supresión y con
    // el plazo cumplido: ahora sí se pueden vaciar del todo.
    const pedidos = await this.prisma.client.order.findMany({
      where: {
        createdAt: { lt: limite('PEDIDOS') },
        personalDataBlockedAt: { not: null },
        // Los ya anonimizados quedan fuera. Sin esta condición la purga los
        // vuelve a contar cada noche: reescribe los mismos valores, pero
        // informa a diario de un borrado que se hizo hace años y deja una
        // entrada de auditoría falsa cada vez.
        NOT: { email: { endsWith: '@anonimizado.local' } },
      },
      select: { id: true },
    });

    // Facturas fuera de plazo cuyos datos fiscales siguen identificando a una
    // persona. `customerSnapshot` es obligatorio, así que se sustituye por una
    // marca en lugar de vaciarlo.
    const facturas = await this.prisma.client.invoice.findMany({
      where: { issuedAt: { lt: limite('FACTURAS') } },
      select: { id: true, customerSnapshot: true },
    });
    const facturasPorAnonimizar = facturas.filter((f) => {
      const c = f.customerSnapshot as Record<string, unknown> | null;
      return c !== null && c['anonimizada'] !== true;
    });

    const [consentimientos, verificaciones, auditoria, carritos, sesiones, tokens] =
      await Promise.all([
        this.contar('consentLog', { createdAt: { lt: limite('CONSENTIMIENTOS') } }),
        this.contar('ageVerification', { createdAt: { lt: limite('VERIFICACION_EDAD') } }),
        this.contar('auditLog', { createdAt: { lt: limite('AUDITORIA') } }),
        // Un carrito caducado no respalda nada y lleva el email de quien lo
        // dejó a medias.
        this.contar('cart', { expiresAt: { lt: ahora }, convertedAt: null }),
        // Sesiones y tokens caducados guardan IP y agente: son datos personales
        // que ya no sirven para nada.
        this.contar('session', { expiresAt: { lt: ahora } }),
        this.contar('verificationToken', { expiresAt: { lt: ahora } }),
      ]);

    const resumen = {
      simulacion,
      pedidos: pedidos.length,
      facturas: facturasPorAnonimizar.length,
      consentimientos,
      verificacionesDeEdad: verificaciones,
      auditoria,
      carritos,
      sesiones,
      tokens,
    };

    if (simulacion) return resumen;

    await this.prisma.client.$transaction(async (tx) => {
      if (pedidos.length > 0) {
        await tx.order.updateMany({
          where: { id: { in: pedidos.map((p) => p.id) } },
          data: {
            email: 'anonimizado@anonimizado.local',
            phone: null,
            customerNote: null,
            shippingAddress: this.direccionAnonima(),
            billingAddress: Prisma.DbNull,
          },
        });
      }

      for (const f of facturasPorAnonimizar) {
        await tx.invoice.update({
          where: { id: f.id },
          data: {
            customerSnapshot: { anonimizada: true, motivo: 'Plazo de conservación cumplido' },
          },
        });
      }

      await tx.consentLog.deleteMany({ where: { createdAt: { lt: limite('CONSENTIMIENTOS') } } });
      await tx.ageVerification.deleteMany({
        where: { createdAt: { lt: limite('VERIFICACION_EDAD') } },
      });
      await tx.auditLog.deleteMany({ where: { createdAt: { lt: limite('AUDITORIA') } } });
      await tx.cart.deleteMany({ where: { expiresAt: { lt: ahora }, convertedAt: null } });
      await tx.session.deleteMany({ where: { expiresAt: { lt: ahora } } });
      await tx.verificationToken.deleteMany({ where: { expiresAt: { lt: ahora } } });
    });

    const total = Object.entries(resumen)
      .filter(([k]) => k !== 'simulacion')
      .reduce((a, [, v]) => a + (typeof v === 'number' ? v : 0), 0);

    if (total > 0) {
      this.logger.log(`Purga por plazo de conservación: ${JSON.stringify(resumen)}`);

      // Queda en auditoría aunque no haya actor: es un borrado de datos
      // personales y hay que poder demostrar cuándo y sobre qué se hizo.
      await this.audit.registrar({
        action: 'privacy.purge',
        resource: 'privacy',
        resourceId: 'periodica',
        after: resumen,
      });
    }

    return resumen;
  }

  /** Cuenta filas de un modelo con datos ya fuera de plazo. */
  private async contar(
    modelo:
      'consentLog' | 'ageVerification' | 'auditLog' | 'cart' | 'session' | 'verificationToken',
    where: Record<string, unknown>,
  ): Promise<number> {
    const cliente = this.prisma.client as unknown as Record<
      string,
      { count: (args: { where: unknown }) => Promise<number> }
    >;
    const tabla = cliente[modelo];
    return tabla ? tabla.count({ where }) : 0;
  }

  // ── Internos ──────────────────────────────────────────────

  private haceAnios(n: number, desde: Date): Date {
    const f = new Date(desde);
    f.setFullYear(f.getFullYear() - n);
    return f;
  }

  /** Qué hay guardado sobre esta persona, con fechas, para calcular el plan. */
  private async inventario(
    correo: string,
  ): Promise<Partial<Record<CategoriaDato, ElementoConFecha[]>>> {
    const usuario = await this.prisma.client.user.findFirst({
      where: { email: correo },
      select: { id: true, createdAt: true, addresses: { select: { id: true, createdAt: true } } },
    });

    const pedidos = await this.prisma.client.order.findMany({
      where: { email: correo },
      select: { id: true, createdAt: true },
    });

    // `Invoice` guarda el pedido como clave suelta, sin relación declarada:
    // hay que buscar por la lista de identificadores.
    const porUsuario = { userId: usuario?.id ?? '' };

    const [facturas, consentimientos, verificaciones] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: { orderId: { in: pedidos.map((p) => p.id) } },
        select: { id: true, issuedAt: true },
      }),
      this.prisma.client.consentLog.findMany({
        where: porUsuario,
        select: { id: true, createdAt: true },
      }),
      this.prisma.client.ageVerification.findMany({
        where: porUsuario,
        select: { id: true, createdAt: true },
      }),
    ]);

    const conFecha = <T extends { id: string }>(items: T[], fecha: (t: T) => Date) =>
      items.map((i) => ({ id: i.id, creadoEl: fecha(i) }));

    return {
      ...(usuario ? { CUENTA: [{ id: usuario.id, creadoEl: usuario.createdAt }] } : {}),
      ...(usuario && usuario.addresses.length > 0
        ? { DIRECCIONES: conFecha(usuario.addresses, (a) => a.createdAt) }
        : {}),
      PEDIDOS: conFecha(pedidos, (p) => p.createdAt),
      FACTURAS: conFecha(facturas, (f) => f.issuedAt),
      CONSENTIMIENTOS: conFecha(consentimientos, (c) => c.createdAt),
      VERIFICACION_EDAD: conFecha(verificaciones, (v) => v.createdAt),
    };
  }

  private direccionAnonima(): Prisma.InputJsonValue {
    // Se conserva el país: es dato del pedido, no de la persona, y sin él los
    // informes por zona de un histórico ya anonimizado dejarían de cuadrar.
    return { anonimizada: true, country: 'ES' };
  }
}
