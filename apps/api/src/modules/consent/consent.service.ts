import { Injectable, Logger } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Registro de consentimiento de cookies.
 *
 * Existe por una sola razón: el RGPD exige poder **demostrar** que hubo
 * consentimiento. Guardarlo solo en el navegador no acredita nada, porque el
 * usuario puede borrarlo y no queda rastro de que llegó a darse.
 *
 * Y como el registro sirve para acreditar que se respeta la privacidad, sería
 * absurdo que él mismo recogiera de más: la IP se recorta y el visitante se
 * identifica con un valor opaco sin relación con su identidad.
 */
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registrar(datos: {
    visitorId: string;
    userId?: string;
    analiticas: boolean;
    marketing: boolean;
    version: number;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.prisma.client.consentLog.create({
      data: {
        id: newId(),
        visitorId: datos.visitorId,
        userId: datos.userId ?? null,
        analytics: datos.analiticas,
        marketing: datos.marketing,
        policyVersion: datos.version,
        ipTruncated: datos.ip ? truncarIp(datos.ip) : null,
        // Recortado: la cadena completa es bastante identificativa por sí sola.
        userAgent: datos.userAgent?.slice(0, 200) ?? null,
      },
    });
  }

  /** Último consentimiento de un visitante, para acreditarlo si se reclama. */
  async ultimoDe(visitorId: string) {
    return this.prisma.client.consentLog.findFirst({
      where: { visitorId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Retira los registros antiguos.
   *
   * Se conservan tres años: el plazo de prescripción de las infracciones
   * graves del RGPD. Guardarlos indefinidamente sería incumplir la limitación
   * del plazo de conservación en el propio registro que acredita cumplirla.
   */
  async limpiarAntiguos(): Promise<number> {
    const limite = new Date();
    limite.setFullYear(limite.getFullYear() - 3);

    const { count } = await this.prisma.client.consentLog.deleteMany({
      where: { createdAt: { lt: limite } },
    });

    if (count > 0) this.logger.log(`Retirados ${count} registros de consentimiento antiguos`);
    return count;
  }
}

/**
 * Recorta la IP para que deje de identificar a una persona concreta.
 *
 * IPv4: se pone a cero el último octeto (192.168.1.37 → 192.168.1.0), que es
 * lo que la propia AEPD acepta como anonimización razonable.
 * IPv6: se conservan los cuatro primeros grupos, que ubican la red sin señalar
 * al dispositivo.
 */
export function truncarIp(ip: string): string {
  const limpia = ip.replace(/^::ffff:/, '').trim();

  if (limpia.includes('.')) {
    const partes = limpia.split('.');
    if (partes.length !== 4) return '0.0.0.0';
    return `${partes[0]}.${partes[1]}.${partes[2]}.0`;
  }

  if (limpia.includes(':')) {
    const grupos = limpia.split(':').filter(Boolean);
    return `${grupos.slice(0, 4).join(':')}::`;
  }

  return '0.0.0.0';
}
