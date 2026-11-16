import { Injectable, Logger } from '@nestjs/common';
import { DIVISA_BASE, esCodigoDivisa, tasasUtiles } from '@ecom/shared';
import { RedisService } from '../redis/redis.service.js';
import { IntegracionesService } from '../integrations/integraciones.service.js';

/**
 * Tipos de cambio para enseñar precios en otra divisa.
 *
 * Tres decisiones que explican todo lo de abajo:
 *
 * **1. Solo se usa para mostrar.** El pedido, la factura y el IVA siguen en
 * euros. Por eso una tasa vieja o ausente no es un fallo grave: se enseña el
 * precio en euros y ya está. Si esto decidiera lo que se cobra, cada una de las
 * decisiones siguientes tendría que ser la contraria.
 *
 * **2. Se cachea un día.** El BCE publica una vez por día laborable, así que
 * pedirlo en cada visita sería gastar cuota y latencia para recibir el mismo
 * número. La caché va en Redis y no en memoria porque la API corre replicada:
 * en memoria, cada réplica enseñaría una tasa distinta y el mismo producto
 * costaría dos precios según a quién le tocara atender.
 *
 * **3. Si el proveedor falla, se sirve lo último que se supo.** Y si no se supo
 * nada, no se convierte. Enseñar un precio inventado es peor que enseñarlo en
 * euros, y dejar la ficha sin precio mientras un servicio externo está caído es
 * lo peor de todo.
 */
@Injectable()
export class TipoCambioService {
  private readonly logger = new Logger(TipoCambioService.name);

  /** Un día: el BCE publica una vez por día laborable. */
  private static readonly TTL = 24 * 60 * 60;
  private static readonly CLAVE = 'divisas:tasas';
  /**
   * Copia sin caducidad de lo último que respondió el proveedor.
   *
   * Es la red de seguridad del punto 3: cuando la entrada con TTL caduca y el
   * proveedor no contesta, se sirve esto. Una tasa de ayer difiere en decimales;
   * no tener ninguna quita el selector de divisa de golpe a mitad de una visita.
   */
  private static readonly CLAVE_ULTIMA = 'divisas:tasas:ultima';
  private static readonly TIEMPO_ESPERA = 5000;

  constructor(
    private readonly redis: RedisService,
    private readonly integraciones: IntegracionesService,
  ) {}

  /**
   * Tasas listas para usar: unidades por euro, solo de las divisas que se piden.
   *
   * Devuelve `{}` cuando no hay nada que convertir —sin integración activa, o con
   * el euro como única divisa—, y quien llama debe entenderlo como «solo euros».
   */
  async tasas(divisasActivas: readonly string[]): Promise<Record<string, number>> {
    const pedidas = divisasActivas.filter((d) => d !== DIVISA_BASE);
    if (pedidas.length === 0) return {};

    const crudas = await this.crudas();
    return crudas ? tasasUtiles(crudas, pedidas) : {};
  }

  /**
   * Las divisas que el proveedor publica ahora mismo, para poder elegirlas.
   *
   * Es la otra mitad de la validación de un código de divisa: `shared` comprueba
   * la forma —tres letras— y esto comprueba que exista de verdad y se pueda
   * convertir. Se separan porque la forma se puede comprobar en cualquier sitio
   * y la disponibilidad solo aquí, que es donde se sabe qué contesta el servicio.
   *
   * El euro entra siempre aunque el proveedor no lo publique: es la base, va con
   * tasa 1 y no depende de nadie. Muchos proveedores lo omiten justamente por
   * eso cuando se les pide `base=EUR`.
   *
   * Devuelve la lista vacía cuando no hay nada que ofrecer —sin integración, o
   * con el proveedor caído y sin copia—. Vacío significa «no lo sé», no «no hay
   * ninguna», y quien llama tiene que tratarlo así: dar por inválida una divisa
   * porque el servicio esté caído convertiría una avería temporal en un ajuste
   * que no se deja guardar.
   */
  async disponibles(): Promise<string[]> {
    const crudas = await this.crudas();
    if (!crudas) return [];

    const codigos = Object.entries(crudas)
      .filter(([codigo, tasa]) => esCodigoDivisa(codigo) && typeof tasa === 'number' && tasa > 0)
      .map(([codigo]) => codigo.toUpperCase());

    return [...new Set([DIVISA_BASE, ...codigos])].sort();
  }

  /** Todo lo que publicó el proveedor, cacheado. `null` si no hay nada. */
  private async crudas(): Promise<Record<string, unknown> | null> {
    const cacheado = await this.redis.client.get(TipoCambioService.CLAVE);
    if (cacheado) return JSON.parse(cacheado) as Record<string, unknown>;

    const frescas = await this.descargar();

    if (frescas) {
      await this.redis.client.set(
        TipoCambioService.CLAVE,
        JSON.stringify(frescas),
        'EX',
        TipoCambioService.TTL,
      );
      await this.redis.client.set(TipoCambioService.CLAVE_ULTIMA, JSON.stringify(frescas));
      return frescas;
    }

    const ultima = await this.redis.client.get(TipoCambioService.CLAVE_ULTIMA);
    if (ultima) {
      this.logger.warn('Tipos de cambio: el proveedor no responde, se sirve la última copia.');
      return JSON.parse(ultima) as Record<string, unknown>;
    }

    return null;
  }

  private async descargar(): Promise<Record<string, unknown> | null> {
    const config = await this.integraciones.configuracion('tipo_cambio');
    if (!config?.operativa) return null;

    const base = typeof config.ajustes['url'] === 'string' ? config.ajustes['url'] : '';
    if (base === '') return null;

    const apiKey = config.credenciales['apiKey'];

    try {
      const url = new URL(base);
      // `base=EUR` porque todo lo que guardamos está en euros: la tasa que hace
      // falta es «cuántas unidades de la otra divisa por un euro».
      url.searchParams.set('base', DIVISA_BASE);
      if (apiKey) url.searchParams.set('apikey', apiKey);

      const respuesta = await fetch(url, {
        signal: AbortSignal.timeout(TipoCambioService.TIEMPO_ESPERA),
        headers: apiKey ? { apikey: apiKey } : {},
      });

      if (!respuesta.ok) {
        this.logger.warn(`Tipos de cambio: el proveedor respondió ${String(respuesta.status)}.`);
        return null;
      }

      const cuerpo = (await respuesta.json()) as { rates?: unknown };
      if (!cuerpo.rates || typeof cuerpo.rates !== 'object') {
        this.logger.warn('Tipos de cambio: la respuesta no trae un objeto "rates".');
        return null;
      }

      return cuerpo.rates as Record<string, unknown>;
    } catch (error) {
      // No se relanza: quedarse sin conversión es un degradado aceptable, y
      // tumbar la ficha de producto porque un servicio externo tarde no lo es.
      this.logger.warn(
        `Tipos de cambio: no se han podido traer (${error instanceof Error ? error.message : 'sin detalle'}).`,
      );
      return null;
    }
  }

  /**
   * Comprobación para el botón «Probar conexión» del panel.
   *
   * Se salta la caché a propósito: probar una integración tiene que hablar con el
   * servicio de verdad, o diría «funciona» leyendo lo que se guardó ayer.
   */
  async probar(): Promise<{ ok: boolean; mensaje?: string }> {
    const tasas = await this.descargar();
    if (!tasas) {
      return { ok: false, mensaje: 'No se han podido traer los tipos de cambio de esa dirección.' };
    }

    const cuantas = Object.keys(tasas).length;
    if (cuantas === 0) {
      return { ok: false, mensaje: 'El proveedor ha respondido sin ninguna tasa.' };
    }

    await this.redis.client.set(
      TipoCambioService.CLAVE,
      JSON.stringify(tasas),
      'EX',
      TipoCambioService.TTL,
    );
    await this.redis.client.set(TipoCambioService.CLAVE_ULTIMA, JSON.stringify(tasas));

    return { ok: true, mensaje: `${String(cuantas)} divisas disponibles.` };
  }
}
