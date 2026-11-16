import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { newId, type Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { truncarIp } from '../consent/consent.service.js';
import { caducidadVerificacion, esMayorDeEdad, verificacionVigente } from './edad.js';
import { CABECERA_BUSCADOR, esBuscadorAvisado } from './buscador.js';

/** Nombre de la cookie con el identificador de la verificación. */
export const COOKIE_EDAD = 'age_id';

/**
 * Verificación de edad para el catálogo +18.
 *
 * La comprobación vive en el servidor, no en una ventana modal del navegador:
 * un aviso que se cierra desde las herramientas de desarrollo no verifica
 * nada. Lo que decide si un producto restringido se devuelve o no es el
 * registro que hay aquí.
 */
@Injectable()
export class AgeService {
  private readonly logger = new Logger(AgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * ¿Puede esta petición ver el catálogo +18?
   *
   * Es la pregunta que se hacen todas las rutas del catálogo, y por eso recibe
   * la petición entera: además de la cookie y la sesión, cuenta el aviso de la
   * tienda de que quien mira es Google o Bing verificados por su IP (ver
   * `buscador.ts`). Las fichas +18 se indexan por decisión de negocio.
   */
  async puedeVerAdulto(req: FastifyRequest, userId?: string): Promise<boolean> {
    if (esBuscadorAvisado(req.headers[CABECERA_BUSCADOR], this.env.REVALIDATE_SECRET)) {
      return true;
    }
    return this.estaVerificado(req.cookies[COOKIE_EDAD], userId);
  }

  /**
   * Registra la declaración de edad.
   *
   * Se guarda también cuando NO da la mayoría de edad: dejar constancia de que
   * se preguntó y se denegó es la prueba de que el control existe y funciona.
   */
  async verificar(datos: {
    visitorId: string;
    anioNacimiento: number;
    userId?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ verificado: boolean; expiraEn: Date | null }> {
    const mayor = esMayorDeEdad(datos.anioNacimiento);

    if (!mayor) {
      this.logger.log(`Acceso a catálogo +18 denegado por edad declarada`);
      // No se guarda registro del menor: sería conservar el dato de un menor
      // sin base legítima, justo lo contrario de lo que persigue la norma.
      return { verificado: false, expiraEn: null };
    }

    const expiraEn = caducidadVerificacion();

    await this.prisma.client.ageVerification.upsert({
      where: { visitorId: datos.visitorId },
      create: {
        id: newId(),
        visitorId: datos.visitorId,
        userId: datos.userId ?? null,
        birthYear: datos.anioNacimiento,
        expiresAt: expiraEn,
        ipTruncated: datos.ip ? truncarIp(datos.ip) : null,
        userAgent: datos.userAgent?.slice(0, 200) ?? null,
      },
      update: {
        userId: datos.userId ?? null,
        birthYear: datos.anioNacimiento,
        expiresAt: expiraEn,
      },
    });

    return { verificado: true, expiraEn };
  }

  /**
   * ¿Está verificado este visitante?
   *
   * Se comprueba también por usuario: quien ya se verificó en el móvil no
   * debería tener que repetirlo en el ordenador si ha iniciado sesión.
   */
  async estaVerificado(visitorId?: string, userId?: string): Promise<boolean> {
    if (!visitorId && !userId) return false;

    const registro = await this.prisma.client.ageVerification.findFirst({
      where: {
        OR: [...(visitorId ? [{ visitorId }] : []), ...(userId ? [{ userId }] : [])],
      },
      orderBy: { expiresAt: 'desc' },
      select: { expiresAt: true },
    });

    return verificacionVigente(registro?.expiresAt ?? null);
  }

  /** Retira la verificación: para "no soy yo" en un dispositivo compartido. */
  async retirar(visitorId: string): Promise<void> {
    await this.prisma.client.ageVerification.deleteMany({ where: { visitorId } });
  }

  /** Limpia las caducadas. */
  async limpiarCaducadas(): Promise<number> {
    const { count } = await this.prisma.client.ageVerification.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  }

  /** Comprueba el año antes de tocar la base, para dar un error claro. */
  exigirAnioValido(anio: number): void {
    if (!Number.isInteger(anio)) {
      throw new BadRequestException('El año de nacimiento no es válido');
    }
  }
}
