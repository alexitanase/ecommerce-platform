import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DIVISA_BASE,
  LOCALES,
  esCodigoDivisa,
  isLocale,
  newId,
  normalizarDivisas,
} from '@ecom/shared';
import type { Prisma } from '@ecom/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import { TipoCambioService } from './tipo-cambio.service.js';

const CLAVE_CACHE = 'ajustes:publicos';

/**
 * Un valor de ajuste, tal cual, dentro de un mensaje de error.
 *
 * Los ajustes son JSON: lo que llega mal puede ser un objeto o un array, y
 * `String()` sobre eso da «[object Object]», que no le dice a nadie qué corregir.
 */
const comoTexto = (valor: unknown): string =>
  typeof valor === 'string' ? valor : JSON.stringify(valor);
const TTL = 300;

/**
 * Ajustes de la plataforma.
 *
 * Los públicos se cachean en Redis porque el storefront los pide en CADA
 * renderizado de página para pintar la marca: sin caché serían miles de
 * consultas a Postgres al día por algo que cambia una vez al mes.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly cambio: TipoCambioService,
  ) {}

  /** Ajustes visibles sin autenticación, en formato plano "namespace.clave". */
  async publicos(): Promise<Record<string, unknown>> {
    const cacheado = await this.redis.client.get(CLAVE_CACHE);
    if (cacheado) return JSON.parse(cacheado) as Record<string, unknown>;

    const ajustes = await this.prisma.client.setting.findMany({ where: { isPublic: true } });
    const plano = Object.fromEntries(ajustes.map((a) => [`${a.namespace}.${a.key}`, a.value]));

    await this.redis.client.set(CLAVE_CACHE, JSON.stringify(plano), 'EX', TTL);
    return plano;
  }

  /**
   * Lo que la tienda necesita para enseñar precios en otra divisa.
   *
   * La lista sale de los ajustes y las tasas del proveedor. Se sirven juntas
   * porque por separado no valen: una divisa activa sin tasa no se puede
   * ofrecer, y una tasa de una divisa desactivada no se debe usar.
   */
  async divisasPublicas(): Promise<{
    activas: string[];
    porDefecto: string;
    tasas: Record<string, number>;
  }> {
    const ajustes = await this.publicos();

    const activas = normalizarDivisas(ajustes['shop.currencies']);
    const guardada = ajustes['shop.defaultCurrency'];
    const porDefecto =
      typeof guardada === 'string' && activas.includes(guardada.toUpperCase())
        ? guardada.toUpperCase()
        : DIVISA_BASE;

    const tasas = await this.cambio.tasas(activas);

    /*
     * Solo se ofrecen las divisas que además tienen tasa.
     *
     * Una activada sin tasa —el proveedor está caído, o dejó de publicarla—
     * saldría en el selector y al elegirla no cambiaría el precio, que se lee
     * como que la tienda está rota. Mejor no ofrecerla.
     */
    const ofrecibles = activas.filter((d) => d === DIVISA_BASE || tasas[d] !== undefined);

    return {
      activas: ofrecibles,
      porDefecto: ofrecibles.includes(porDefecto) ? porDefecto : DIVISA_BASE,
      tasas,
    };
  }

  /**
   * Entre qué divisas puede elegir el panel.
   *
   * Es lo que publica el proveedor de tipo de cambio, sin más filtro: activar una
   * divisa que no tenga tasa no serviría de nada, y se para al elegirla en vez de
   * dejar que se guarde y no se note hasta mirar la tienda.
   */
  divisasDisponibles(): Promise<string[]> {
    return this.cambio.disponibles();
  }

  /** Todos los ajustes, agrupados por espacio de nombres (admin). */
  async todos() {
    const ajustes = await this.prisma.client.setting.findMany({
      orderBy: [{ namespace: 'asc' }, { key: 'asc' }],
    });

    const grupos = new Map<string, { key: string; value: unknown; isPublic: boolean }[]>();
    for (const a of ajustes) {
      const grupo = grupos.get(a.namespace) ?? [];
      grupo.push({ key: a.key, value: a.value, isPublic: a.isPublic });
      grupos.set(a.namespace, grupo);
    }

    return [...grupos.entries()].map(([namespace, items]) => ({ namespace, items }));
  }

  /** Las claves de `shop` cuyo valor no puede ser cualquier cosa. */
  private static readonly CLAVES_IDIOMA_DIVISA = [
    'supportedLocales',
    'defaultLocale',
    'currencies',
    'defaultCurrency',
  ];

  /**
   * Comprueba que los idiomas y las divisas quedan en un estado servible.
   *
   * Se valida aquí y no en el DTO porque la regla es CRUZADA: el idioma por
   * defecto tiene que estar entre los activos, y cada uno puede llegar en una
   * petición distinta. Con la validación en el DTO, guardar solo
   * `supportedLocales` dejaría fuera al `defaultLocale` que ya estaba guardado
   * sin que nada se quejara, y la raíz de la tienda redirigiría a un idioma
   * desactivado: quien entrase por el dominio acabaría en una página que se ha
   * decidido no servir.
   *
   * Se rechaza en vez de corregir en silencio. Corregir sería peor: el panel
   * diría «guardado» y habría guardado otra cosa.
   */
  private async validarIdiomasYDivisas(
    cambios: { namespace: string; key: string; value: unknown }[],
  ): Promise<void> {
    const tocadas = cambios
      .filter((c) => c.namespace === 'shop')
      .map((c) => c.key)
      .filter((k) => SettingsService.CLAVES_IDIOMA_DIVISA.includes(k));

    if (tocadas.length === 0) return;

    // El estado FINAL: lo que ya hay, pisado por lo que llega.
    const guardadas = await this.prisma.client.setting.findMany({
      where: { namespace: 'shop', key: { in: SettingsService.CLAVES_IDIOMA_DIVISA } },
    });
    const estado = new Map<string, unknown>(guardadas.map((a) => [a.key, a.value]));
    for (const c of cambios) {
      if (c.namespace === 'shop') estado.set(c.key, c.value);
    }

    // ── Idiomas ──
    const idiomasCrudos = estado.get('supportedLocales');
    if (!Array.isArray(idiomasCrudos) || idiomasCrudos.length === 0) {
      throw new BadRequestException('Hay que dejar al menos un idioma activo.');
    }
    // `Array.isArray` sobre `unknown` estrecha a `any[]`, y de ahí en adelante
    // todo lo que sale del array deja de estar comprobado. Se vuelve a `unknown`.
    const idiomas = idiomasCrudos as unknown[];
    const desconocido: unknown = idiomas.find((l) => typeof l !== 'string' || !isLocale(l));
    if (desconocido !== undefined) {
      throw new BadRequestException(
        `«${comoTexto(desconocido)}» no es un idioma de la plataforma. Disponibles: ${LOCALES.join(', ')}. ` +
          'Añadir uno nuevo necesita sus ficheros de traducción, no solo activarlo aquí.',
      );
    }

    const porDefecto = estado.get('defaultLocale');
    if (typeof porDefecto !== 'string' || !idiomas.includes(porDefecto)) {
      throw new BadRequestException(
        'El idioma por defecto tiene que estar entre los activos: es el que recibe quien entra por el dominio sin idioma.',
      );
    }

    // ── Divisas ──
    if (estado.has('currencies')) {
      const crudas = estado.get('currencies');
      if (!Array.isArray(crudas)) {
        throw new BadRequestException('Las divisas activas tienen que ser una lista.');
      }
      const malFormada: unknown = (crudas as unknown[]).find((c) => !esCodigoDivisa(c));
      if (malFormada !== undefined) {
        throw new BadRequestException(
          `«${comoTexto(malFormada)}» no tiene forma de divisa: son tres letras (ISO 4217), como EUR o GBP.`,
        );
      }

      /*
       * Y la segunda mitad: que el proveedor la publique.
       *
       * `USD` está bien escrito y `LMN` también; la diferencia es que solo del
       * primero hay tasa, y sin tasa la divisa aparecería en el selector sin
       * cambiar ningún precio. Se para aquí, al guardar, y no en la tienda,
       * porque el sitio donde se puede explicar es el panel.
       *
       * La lista vacía significa «no lo sé» —sin integración de tipo de cambio,
       * o con el proveedor caído y sin copia guardada— y entonces no se valida
       * nada: no se puede tomar una avería de un servicio externo por un error
       * de quien está guardando un ajuste.
       */
      const publicadas = await this.cambio.disponibles();
      if (publicadas.length > 0) {
        const noPublicada = (crudas as string[])
          .map((c) => c.trim().toUpperCase())
          .find((c) => !publicadas.includes(c));

        if (noPublicada !== undefined) {
          throw new BadRequestException(
            `El proveedor de tipo de cambio no publica ninguna tasa para «${noPublicada}», ` +
              'así que la tienda no podría convertir sus precios.',
          );
        }
      }
    }

    const divisas = normalizarDivisas(estado.get('currencies'));
    const divisaDefecto = estado.get('defaultCurrency');
    if (typeof divisaDefecto !== 'string' || !divisas.includes(divisaDefecto.toUpperCase())) {
      throw new BadRequestException(
        `La divisa por defecto tiene que estar entre las activas. El ${DIVISA_BASE} siempre lo está: es la divisa en la que se cobra.`,
      );
    }
  }

  async actualizar(
    cambios: { namespace: string; key: string; value: unknown }[],
    ctx: ContextoActor,
  ) {
    await this.validarIdiomasYDivisas(cambios);

    for (const c of cambios) {
      await this.prisma.client.setting.upsert({
        where: { namespace_key: { namespace: c.namespace, key: c.key } },
        update: { value: c.value as Prisma.InputJsonValue, updatedBy: ctx.actorId },
        create: {
          id: newId(),
          namespace: c.namespace,
          key: c.key,
          value: c.value as Prisma.InputJsonValue,
          isPublic: c.namespace === 'brand' || c.namespace === 'shop',
          updatedBy: ctx.actorId,
        },
      });
    }

    // Sin esto, el storefront seguiría pintando la marca vieja hasta cinco
    // minutos después de guardar: el admin creería que no se ha aplicado.
    await this.redis.client.del(CLAVE_CACHE);

    await this.audit.registrar({
      action: 'settings.update',
      resource: 'settings',
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      after: Object.fromEntries(cambios.map((c) => [`${c.namespace}.${c.key}`, c.value])),
    });

    return this.todos();
  }
}
