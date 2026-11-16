import crypto from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { truncarIp } from './consent.service.js';

/**
 * Qué correos quiere recibir cada dirección.
 *
 * Tres cosas que la ley exige y que aquí se cumplen a la vez:
 *
 *  1. **Enlace de baja en todo correo comercial** (art. 21 LSSI): un token
 *     opaco que funciona sin iniciar sesión, porque la mayoría compra como
 *     invitado y no tiene cuenta donde entrar.
 *  2. **Consentimiento expreso para publicidad** (RGPD art. 6.1.a): ofertas y
 *     newsletter empiezan en `false`; nadie queda suscrito por comprar.
 *  3. **Poder demostrarlo** (RGPD art. 7.1): cada cambio queda registrado con
 *     cuándo, desde dónde y a qué. "Nos dijo que sí" no vale como prueba.
 *
 * Los avisos del pedido no aparecen: son ejecución del contrato, no marketing,
 * y dejarlos apagar sería incumplir con quien está esperando su paquete.
 */

export type CanalComunicacion = 'cartRecovery' | 'reviewInvites' | 'offers' | 'newsletter';

export const CANALES: CanalComunicacion[] = [
  'cartRecovery',
  'reviewInvites',
  'offers',
  'newsletter',
];

/** De dónde vino el cambio; queda en el registro para poder acreditarlo. */
export type OrigenCambio = 'checkout' | 'email_link' | 'account' | 'admin';

export interface ContextoConsentimiento {
  origen: OrigenCambio;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class PreferenciasService {
  private readonly logger = new Logger(PreferenciasService.name);

  constructor(private readonly prisma: PrismaService) {}

  private nuevoToken(): string {
    // 32 bytes: el enlace de baja viaja en correos que se reenvían y quedan en
    // buzones ajenos, así que tiene que ser imposible de adivinar.
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Preferencias de una dirección, creándolas con los valores por defecto.
   *
   * Se crean al vuelo porque hacen falta antes de que nadie las toque: el pie
   * de cada correo necesita ya el token de baja.
   */
  async de(email: string, userId?: string) {
    const direccion = email.toLowerCase().trim();

    const existente = await this.prisma.client.communicationPreference.findUnique({
      where: { email: direccion },
    });

    if (existente) {
      // Al identificarse se enlaza con la cuenta, sin tocar sus elecciones.
      if (userId && !existente.userId) {
        return this.prisma.client.communicationPreference.update({
          where: { id: existente.id },
          data: { userId },
        });
      }
      return existente;
    }

    return this.prisma.client.communicationPreference.create({
      data: {
        id: newId(),
        email: direccion,
        userId: userId ?? null,
        unsubscribeToken: this.nuevoToken(),
      },
    });
  }

  /** Preferencias desde el enlace del correo. */
  async porToken(token: string) {
    const preferencia = await this.prisma.client.communicationPreference.findUnique({
      where: { unsubscribeToken: token },
    });

    if (!preferencia) throw new NotFoundException('Este enlace ya no es válido');
    return preferencia;
  }

  /** ¿Se le puede escribir por este canal? */
  async puedeEnviar(email: string, canal: CanalComunicacion): Promise<boolean> {
    const preferencia = await this.prisma.client.communicationPreference.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { cartRecovery: true, reviewInvites: true, offers: true, newsletter: true },
    });

    // Sin registro se aplican los valores por defecto: el recordatorio del
    // carrito y la invitación a valorar sí, la publicidad no.
    if (!preferencia) return canal === 'cartRecovery' || canal === 'reviewInvites';

    return preferencia[canal];
  }

  /**
   * Cambia las preferencias y deja constancia de cada canal tocado.
   *
   * Solo se registran los canales que cambian de verdad: repetir en el
   * historial "sigue diciendo que no" cada vez que alguien abre la pantalla
   * llenaría el registro de ruido y haría inútil el dato que sí importa.
   */
  async actualizar(
    email: string,
    cambios: Partial<Record<CanalComunicacion, boolean>>,
    contexto: ContextoConsentimiento,
    userId?: string,
  ) {
    const actual = await this.de(email, userId);

    const efectivos = CANALES.filter(
      (canal) => cambios[canal] !== undefined && cambios[canal] !== actual[canal],
    );

    if (efectivos.length === 0) return actual;

    const actualizada = await this.prisma.client.communicationPreference.update({
      where: { id: actual.id },
      data: Object.fromEntries(efectivos.map((c) => [c, cambios[c]])),
    });

    await this.prisma.client.communicationConsentLog.createMany({
      data: efectivos.map((canal) => ({
        id: newId(),
        preferenceId: actual.id,
        channel: canal,
        granted: cambios[canal] ?? false,
        source: contexto.origen,
        ipTruncated: contexto.ip ? truncarIp(contexto.ip) : null,
        userAgent: contexto.userAgent?.slice(0, 200) ?? null,
      })),
    });

    return actualizada;
  }

  /** Baja de todo lo comercial de una vez, desde el enlace del correo. */
  async bajaDeTodo(token: string, contexto: ContextoConsentimiento) {
    const preferencia = await this.porToken(token);

    return this.actualizar(
      preferencia.email,
      { cartRecovery: false, reviewInvites: false, offers: false, newsletter: false },
      contexto,
    );
  }

  /**
   * Historial de consentimiento de una dirección.
   *
   * Es lo que se enseña si alguien reclama haber recibido publicidad sin
   * haberla pedido, y lo que se entrega en una solicitud de acceso.
   */
  async historial(email: string) {
    const preferencia = await this.prisma.client.communicationPreference.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { logs: { orderBy: { createdAt: 'desc' }, take: 100 } },
    });

    if (!preferencia) return { email, preferencias: null, historial: [] };

    return {
      email: preferencia.email,
      preferencias: Object.fromEntries(CANALES.map((c) => [c, preferencia[c]])),
      historial: preferencia.logs.map((l) => ({
        canal: l.channel,
        aceptado: l.granted,
        origen: l.source,
        fecha: l.createdAt,
      })),
    };
  }
}
