import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env } from '@ecom/shared';
import { ENV } from '../config/config.module.js';
import type {
  ThrottlerModuleOptions,
  ThrottlerOptionsFactory,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { RedisService } from '../modules/redis/redis.service.js';

/**
 * El paquete no reexporta este tipo desde su índice, así que lo declaramos
 * aquí con la misma forma que espera la interfaz ThrottlerStorage.
 */
interface RegistroThrottler {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Cuántas veces se ensancha el cupo fuera de producción.
 *
 * Cien es de sobra para cualquier tanda de pruebas —registrarse pasa de 5 por
 * hora a 500— y sigue siendo un número: si algo se descontrola de verdad en
 * desarrollo, el límite acaba saltando igual.
 */
const FACTOR_FUERA_DE_PRODUCCION = 100;

/**
 * Almacén del rate limiting en Redis.
 *
 * El almacén por defecto de @nestjs/throttler vive en la memoria del proceso.
 * Con tres instancias de la API detrás de un balanceador, un límite de 10
 * peticiones se convierte de hecho en 30, y además se reinicia en cada
 * despliegue. En Redis el contador es uno solo y compartido.
 */
@Injectable()
export class ThrottlerStorageRedisService implements ThrottlerStorage, ThrottlerOptionsFactory {
  private readonly registro = new Logger(ThrottlerStorageRedisService.name);
  private avisado = false;

  constructor(
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Fuera de producción el cupo se ensancha y los bloqueos se ignoran.
   *
   * Los cupos están puestos para lo que son: frenar a quien crea mil cuentas
   * para agotar cupones o prueba contraseñas a lo bruto. Registrarse son 5 por
   * hora y verificar la edad, 10. Contra internet, correcto.
   *
   * En un portátil es otra cosa. La suite de extremo a extremo registra una
   * cuenta en cada pasada y verifica la edad al empezar, así que a la tercera
   * ejecución de la tarde el cupo estaba agotado y las pruebas fallaban **sin
   * que nada estuviera roto**. Un rojo que no significa nada enseña a ignorar
   * los rojos.
   *
   * Se ensancha en vez de apagarse para que el camino se recorra entero
   * —contador en Redis, ventana, clave por IP— y una configuración rota siga
   * saliendo en desarrollo. Y se ignora el bloqueo ya puesto porque dura una
   * hora: sin eso, pasarse una vez del cupo deja la máquina inservible para
   * probar durante el resto de la tarde.
   *
   * Para ejercitar los límites de verdad, `NODE_ENV=production`.
   */
  private get ensanchado(): boolean {
    if (this.env.NODE_ENV === 'production') return false;

    // Una sola línea, no una por petición: si no, el registro es ilegible.
    if (!this.avisado) {
      this.avisado = true;
      this.registro.warn(
        `Cupos de peticiones multiplicados por ${String(FACTOR_FUERA_DE_PRODUCCION)} y bloqueos ` +
          `ignorados (NODE_ENV=${this.env.NODE_ENV}). En producción se aplican tal cual.`,
      );
    }

    return true;
  }

  createThrottlerOptions(): ThrottlerModuleOptions {
    return {
      throttlers: [
        // Límite general por IP; los endpoints sensibles lo ajustan con @Throttle.
        { name: 'default', ttl: this.env.THROTTLE_TTL_MS, limit: this.env.THROTTLE_LIMIT },
      ],
      storage: this,
      // Salud y métricas las consultan el balanceador y Prometheus cada pocos
      // segundos: contarlas gastaría el cupo y acabaría cortando la
      // monitorización justo cuando hace falta.
      skipIf: (context) => {
        const req = context.switchToHttp().getRequest<{ url?: string }>();
        const url = req.url ?? '';
        return url.startsWith('/health') || url.startsWith('/metrics');
      },
    };
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<RegistroThrottler> {
    const clave = `throttle:${throttlerName}:${key}`;
    const claveBloqueo = `${clave}:bloqueado`;
    const ensanchado = this.ensanchado;
    const cupo = ensanchado ? limit * FACTOR_FUERA_DE_PRODUCCION : limit;

    const bloqueadoHasta = ensanchado ? 0 : await this.redis.client.pttl(claveBloqueo);
    if (bloqueadoHasta > 0) {
      return {
        totalHits: cupo + 1,
        timeToExpire: Math.ceil(bloqueadoHasta / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(bloqueadoHasta / 1000),
      };
    }

    // INCR y EXPIRE en una sola ida y vuelta; el EXPIRE solo se fija en el
    // primer golpe para que la ventana no se renueve con cada petición.
    const respuesta = await this.redis.client.multi().incr(clave).pttl(clave).exec();
    const hits = Number(respuesta?.[0]?.[1] ?? 0);
    const pttl = Number(respuesta?.[1]?.[1] ?? -1);

    if (hits === 1 || pttl < 0) {
      await this.redis.client.pexpire(clave, ttl);
    }

    const restante = hits === 1 || pttl < 0 ? ttl : pttl;

    if (hits > cupo && blockDuration > 0) {
      await this.redis.client.set(claveBloqueo, '1', 'PX', blockDuration);
      return {
        totalHits: hits,
        timeToExpire: Math.ceil(blockDuration / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockDuration / 1000),
      };
    }

    return {
      totalHits: hits,
      timeToExpire: Math.ceil(restante / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
