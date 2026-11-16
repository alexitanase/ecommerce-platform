import { BadRequestException, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@ecom/db';
import { newId, texto, type Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';
import { CryptoService } from '../../common/crypto.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { StorefrontCacheService } from '../cache/storefront-cache.service.js';
import type { ContextoActor } from '../roles/roles.service.js';
import {
  camposQueFaltan,
  definicionDe,
  INTEGRACIONES,
  type DefinicionIntegracion,
  type FamiliaIntegracion,
} from './catalogo.js';

/**
 * Configuración de los servicios externos, desde el panel.
 *
 * Antes vivía en variables de entorno. El problema no era técnico: era que
 * cambiar de pasarela, poner la clave del traductor o corregir el remitente de
 * los correos exigía entrar en el servidor, editar un fichero y reiniciar. Eso
 * lo hace quien despliega, no quien lleva la tienda, así que en la práctica no
 * se hacía.
 *
 * Tres reglas:
 *
 *  1. **Lo que no está activo y completo, no existe.** No se instancia el
 *     cliente, no se ofrece en el checkout, no sale el botón. Media
 *     configuración es peor que ninguna: el cliente la elige y se queda a
 *     mitad de la compra.
 *  2. **Los secretos se guardan cifrados y no vuelven nunca.** El panel enseña
 *     "configurado" o "sin configurar", jamás el valor. Quien tenga acceso a
 *     la base de datos se encuentra un blob AES-256-GCM.
 *  3. **Cada cambio queda en la auditoría**, con qué campos se tocaron y sin
 *     su contenido.
 *
 * Lo que sigue en el entorno: base de datos, Redis, almacenamiento, secretos de
 * sesión y la clave de cifrado. Hacen falta para arrancar —y la última protege
 * a las demás, así que guardarla aquí no tendría sentido.
 */

export interface ConfiguracionIntegracion {
  key: string;
  activa: boolean;
  credenciales: Record<string, string>;
  ajustes: Record<string, unknown>;
  /** Activa y con todos los campos obligatorios puestos. */
  operativa: boolean;
  faltan: string[];
}

@Injectable()
export class IntegracionesService implements OnModuleInit {
  private readonly logger = new Logger(IntegracionesService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly storefront: StorefrontCacheService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.importarDelEntorno();
  }

  /**
   * Trae al panel lo que ya estuviera configurado en el servidor.
   *
   * Se hace una sola vez por integración: si la fila existe, manda la base de
   * datos y el entorno se ignora. Sin esto, al desplegar este cambio una tienda
   * en marcha se quedaría de golpe sin pasarela y sin correo.
   */
  private async importarDelEntorno(): Promise<void> {
    const entorno = this.env as unknown as Record<string, unknown>;

    for (const definicion of INTEGRACIONES) {
      if (!definicion.desdeEntorno) continue;

      const existente = await this.prisma.client.integration.findUnique({
        where: { key: definicion.key },
        select: { id: true },
      });
      if (existente) continue;

      const credenciales: Record<string, string> = {};
      const ajustes: Record<string, unknown> = {};

      for (const [campo, variable] of Object.entries(definicion.desdeEntorno)) {
        const valor = entorno[variable];
        if (valor === undefined || valor === null || valor === '') continue;

        const esSecreto = definicion.credenciales.some((c) => c.clave === campo);
        // Las variables de entorno siempre son texto o valores primitivos ya
        // convertidos por el esquema (números y booleanos); nada de objetos.
        if (esSecreto)
          credenciales[campo] = typeof valor === 'string' ? valor : JSON.stringify(valor);
        else ajustes[campo] = valor;
      }

      const encontrado = Object.keys(credenciales).length + Object.keys(ajustes).length;
      if (encontrado === 0) continue;

      const faltan = camposQueFaltan(definicion, credenciales, ajustes);

      await this.prisma.client.integration.create({
        data: {
          id: newId(),
          key: definicion.key,
          kind: definicion.familia,
          // Se activa solo si venía completa Y está implementada. Importar
          // algo a medias y darlo por bueno es justo lo que esta tabla existe
          // para evitar, y activar lo que aún no existe deja un estado que el
          // panel no sabe explicar: "activa" pero sin funcionar.
          isActive: faltan.length === 0 && definicion.implementada,
          settings: ajustes as Prisma.InputJsonObject,
          ...(Object.keys(credenciales).length > 0
            ? {
                credentials: this.crypto.cifrarObjeto(credenciales),
                credentialsSetAt: new Date(),
              }
            : {}),
          updatedBy: 'importado-del-entorno',
        },
      });

      this.logger.log(
        `Integración "${definicion.key}" importada desde las variables de entorno` +
          (faltan.length > 0 ? ` (incompleta: falta ${faltan.join(', ')})` : ''),
      );
    }
  }

  // ── Lectura para el resto de la aplicación ─────────────────

  /**
   * Configuración de una integración.
   *
   * Devuelve los secretos en claro: es para el servidor, nunca sale de aquí
   * hacia el panel ni hacia la tienda.
   */
  async configuracion(key: string): Promise<ConfiguracionIntegracion | null> {
    const definicion = definicionDe(key);
    if (!definicion) return null;

    const fila = await this.prisma.client.integration.findUnique({ where: { key } });

    const ajustes = this.conValoresPorDefecto(
      definicion,
      (fila?.settings ?? {}) as Record<string, unknown>,
    );
    const credenciales = fila?.credentials
      ? this.crypto.descifrarObjeto<Record<string, string>>(fila.credentials)
      : {};

    const faltan = camposQueFaltan(definicion, credenciales, ajustes);

    return {
      key,
      activa: fila?.isActive ?? false,
      credenciales,
      ajustes,
      operativa: (fila?.isActive ?? false) && faltan.length === 0 && definicion.implementada,
      faltan,
    };
  }

  /** Atajo: ¿se puede usar ahora mismo? */
  async operativa(key: string): Promise<boolean> {
    return (await this.configuracion(key))?.operativa ?? false;
  }

  /**
   * Identificadores de analítica que la tienda debe cargar.
   *
   * Es lo único de las integraciones que se sirve **sin autenticación**, y se
   * puede porque estos identificadores no son secretos: viajan en el HTML de
   * cualquier página y se ven con "ver código fuente". Lo que sí evita este
   * endpoint es lo contrario: que la tienda lleve los identificadores
   * incrustados en el bundle y cargue scripts de terceros aunque nadie los haya
   * configurado.
   *
   * Devuelve solo las que están **operativas**. Una integración con el
   * identificador puesto pero apagada desde el panel no se carga: apagarla
   * tiene que surtir efecto de verdad, no quedarse en una etiqueta gris.
   */
  async analiticaPublica(): Promise<{ ga4?: string; gtm?: string; metaPixel?: string }> {
    const [ga4, gtm, meta] = await Promise.all([
      this.configuracion('ga4'),
      this.configuracion('gtm'),
      this.configuracion('meta_pixel'),
    ]);

    const idGa4 = ga4?.operativa ? texto(ga4.ajustes['measurementId']) : '';
    const idGtm = gtm?.operativa ? texto(gtm.ajustes['containerId']) : '';
    const idMeta = meta?.operativa ? texto(meta.ajustes['pixelId']) : '';

    return {
      ...(idGa4 ? { ga4: idGa4 } : {}),
      ...(idGtm ? { gtm: idGtm } : {}),
      ...(idMeta ? { metaPixel: idMeta } : {}),
    };
  }

  /** Las integraciones operativas de una familia, para ofrecerlas. */
  async operativasDe(familia: FamiliaIntegracion): Promise<string[]> {
    const candidatas = INTEGRACIONES.filter((i) => i.familia === familia);
    const estados = await Promise.all(candidatas.map((i) => this.configuracion(i.key)));

    return estados.filter((e) => e?.operativa).map((e) => e?.key ?? '');
  }

  private conValoresPorDefecto(
    definicion: DefinicionIntegracion,
    guardados: Record<string, unknown>,
  ): Record<string, unknown> {
    const resultado: Record<string, unknown> = { ...guardados };

    for (const campo of definicion.ajustes) {
      if (resultado[campo.clave] === undefined && campo.porDefecto !== undefined) {
        resultado[campo.clave] = campo.porDefecto;
      }
    }

    return resultado;
  }

  // ── Panel ─────────────────────────────────────────────────

  /**
   * Estado de todas las integraciones, sin un solo secreto.
   *
   * De cada credencial solo se dice si está puesta. Devolver el valor "para
   * poder editarlo" es cómo una clave de pasarela acaba en el historial del
   * navegador de quien lleva la tienda.
   */
  async estado() {
    const filas = await this.prisma.client.integration.findMany();
    const porClave = new Map(filas.map((f) => [f.key, f]));

    return Promise.all(
      INTEGRACIONES.map(async (definicion) => {
        const config = await this.configuracion(definicion.key);
        const fila = porClave.get(definicion.key);

        return {
          key: definicion.key,
          familia: definicion.familia,
          nombre: definicion.nombre,
          descripcion: definicion.descripcion,
          donde: definicion.donde ?? null,
          /*
           * Las URLs nuestras que hay que dar de alta en el panel del servicio,
           * compuestas con el dominio real de esta API.
           *
           * Sin darlas de alta, la integración queda «configurada» y no
           * funciona, y el síntoma aparece lejos: Google rechaza el acceso con
           * `redirect_uri_mismatch`, y NOWPayments cobra y no avisa nunca —el
           * pedido se queda esperando un pago que ya se hizo—. Se componen aquí
           * y no en el panel porque el panel no tiene por qué saber en qué
           * dominio vive la API.
           */
          retornos: (definicion.retornos ?? []).map((r) => ({
            tipo: r.tipo,
            url: `${this.env.API_URL}${r.ruta}`,
          })),
          implementada: definicion.implementada,
          activa: config?.activa ?? false,
          operativa: config?.operativa ?? false,
          faltan: config?.faltan ?? [],
          credenciales: definicion.credenciales.map((c) => ({
            ...c,
            configurado: Boolean(config?.credenciales[c.clave]),
          })),
          ajustes: definicion.ajustes.map((a) => ({
            ...a,
            valor: config?.ajustes[a.clave] ?? null,
          })),
          credencialesDesde: fila?.credentialsSetAt ?? null,
          ultimaComprobacion: fila?.lastCheckAt ?? null,
          ultimaComprobacionOk: fila?.lastCheckOk ?? null,
          ultimoError: fila?.lastCheckError ?? null,
        };
      }),
    );
  }

  /**
   * Guarda la configuración de una integración.
   *
   * Las credenciales que no se envían se conservan: el panel no las conoce
   * —nunca se le devuelven— así que mandar el formulario entero borraría las
   * que no se han tocado.
   */
  async guardar(
    key: string,
    datos: {
      activa?: boolean;
      credenciales?: Record<string, string>;
      ajustes?: Record<string, unknown>;
    },
    ctx: ContextoActor,
  ) {
    const definicion = definicionDe(key);
    if (!definicion) throw new BadRequestException(`Integración desconocida: "${key}"`);

    const actual = await this.configuracion(key);

    // Solo los campos declarados: así un cuerpo con basura no acaba guardado.
    const credenciales = { ...actual?.credenciales };
    for (const campo of definicion.credenciales) {
      const nuevo = datos.credenciales?.[campo.clave];
      if (nuevo === undefined) continue;
      // Cadena vacía = borrar esa credencial.
      if (nuevo === '') delete credenciales[campo.clave];
      else credenciales[campo.clave] = nuevo;
    }

    const ajustes = { ...actual?.ajustes };
    for (const campo of definicion.ajustes) {
      const nuevo = datos.ajustes?.[campo.clave];
      if (nuevo !== undefined) ajustes[campo.clave] = nuevo;
    }

    const faltan = camposQueFaltan(definicion, credenciales, ajustes);
    const quiereActiva = datos.activa ?? actual?.activa ?? false;

    if (quiereActiva && faltan.length > 0) {
      throw new BadRequestException(
        `No se puede activar "${definicion.nombre}": falta ${faltan.join(', ')}.`,
      );
    }

    if (quiereActiva && !definicion.implementada) {
      throw new BadRequestException(
        `"${definicion.nombre}" todavía no está implementada: activarla dejaría al cliente a ` +
          'mitad de la compra.',
      );
    }

    const cifradas = Object.keys(credenciales).length > 0;

    await this.prisma.client.integration.upsert({
      where: { key },
      update: {
        isActive: quiereActiva,
        settings: ajustes as Prisma.InputJsonObject,
        credentials: cifradas ? this.crypto.cifrarObjeto(credenciales) : null,
        ...(cifradas ? { credentialsSetAt: new Date() } : { credentialsSetAt: null }),
        updatedBy: ctx.actorId ?? null,
      },
      create: {
        id: newId(),
        key,
        kind: definicion.familia,
        isActive: quiereActiva,
        settings: ajustes as Prisma.InputJsonObject,
        ...(cifradas
          ? { credentials: this.crypto.cifrarObjeto(credenciales), credentialsSetAt: new Date() }
          : {}),
        updatedBy: ctx.actorId ?? null,
      },
    });

    await this.audit.registrar({
      action: 'integration.update',
      resource: 'integration',
      resourceId: key,
      actorId: ctx.actorId,
      actorIp: ctx.actorIp,
      before: { activa: actual?.activa ?? false },
      // Qué campos se tocaron, nunca su contenido.
      after: {
        activa: quiereActiva,
        credencialesModificadas: Object.keys(datos.credenciales ?? {}),
        ajustesModificados: Object.keys(datos.ajustes ?? {}),
      },
    });

    /*
     * La tienda tiene que enterarse ya.
     *
     * La pantalla de acceso pregunta qué accesos sociales hay configurados y
     * cachea la respuesta cinco minutos. Sin purgar, activar «Entrar con Google»
     * no se veía hasta cinco minutos después —y, lo que es peor, desactivarlo
     * dejaba el botón puesto ese rato, llevando al cliente a un error de Google.
     *
     * Es un aviso, no una dependencia: si la tienda no contesta, la caché caduca
     * sola. Nunca puede hacer que guardar una integración falle.
     */
    /*
     * Y `pagos` cuando lo que se ha tocado es una pasarela.
     *
     * El pie de la tienda anuncia qué formas de pago se aceptan, y eso depende
     * de que la pasarela esté encendida **y** tenga credenciales: las dos cosas
     * se configuran en pantallas distintas, así que las dos tienen que purgar.
     * Sin esto, poner las claves de Stripe encendía el cobro al momento y el
     * pie seguía sin anunciar nada durante una hora.
     */
    const familia = definicionDe(key)?.familia;

    await this.storefront.purgar(
      familia === 'pago' ? ['integraciones', 'pagos'] : ['integraciones'],
    );

    return this.estadoDe(key);
  }

  /** Estado de una sola integración, para responder tras guardar. */
  async estadoDe(key: string) {
    return (await this.estado()).find((i) => i.key === key);
  }

  /**
   * Registro de comprobadores.
   *
   * Cada servicio sabe cómo comprobarse: la pasarela llama a su API, el correo
   * abre una conexión SMTP, el almacenamiento pregunta por el cubo. Se
   * registran desde fuera para que este módulo no dependa de los cuatro
   * servicios que lo usan —sería un ciclo de dependencias y una capa que
   * conoce a todo el mundo.
   */
  private readonly comprobadores = new Map<
    string,
    () => Promise<{ ok: boolean; mensaje?: string }>
  >();

  registrarComprobador(key: string, comprobar: () => Promise<{ ok: boolean; mensaje?: string }>) {
    this.comprobadores.set(key, comprobar);
  }

  /** Comprueba una integración contra el servicio real y anota el resultado. */
  async probar(key: string): Promise<{ ok: boolean; mensaje?: string }> {
    const config = await this.configuracion(key);

    if (!config) throw new BadRequestException(`Integración desconocida: "${key}"`);

    if (config.faltan.length > 0) {
      const resultado = { ok: false, mensaje: `Falta configurar: ${config.faltan.join(', ')}.` };
      await this.anotarComprobacion(key, resultado);
      return resultado;
    }

    const definicion = definicionDe(key);

    if (!definicion?.implementada) {
      // Decirlo claro: "configuración completa" en algo que todavía no existe
      // se lee como "listo para usar", y no lo está.
      const resultado = {
        ok: false,
        mensaje: 'Este servicio todavía no está implementado en la plataforma.',
      };
      await this.anotarComprobacion(key, resultado);
      return resultado;
    }

    const comprobador = this.comprobadores.get(key);

    if (!comprobador) {
      // Sin comprobador solo se puede decir que los campos están puestos. Es
      // menos de lo que parece, y decirlo evita que alguien lo lea como "está
      // funcionando".
      const resultado = {
        ok: true,
        mensaje: 'Configuración completa. Este servicio no admite una comprobación en vivo.',
      };
      await this.anotarComprobacion(key, resultado);
      return resultado;
    }

    try {
      const resultado = await comprobador();
      await this.anotarComprobacion(key, resultado);
      return resultado;
    } catch (error) {
      const resultado = {
        ok: false,
        mensaje: error instanceof Error ? error.message : String(error),
      };
      await this.anotarComprobacion(key, resultado);
      return resultado;
    }
  }

  /** Anota el resultado de una comprobación contra el servicio real. */
  async anotarComprobacion(key: string, resultado: { ok: boolean; mensaje?: string }) {
    await this.prisma.client.integration.updateMany({
      where: { key },
      data: {
        lastCheckAt: new Date(),
        lastCheckOk: resultado.ok,
        lastCheckError: resultado.ok ? null : (resultado.mensaje ?? 'Error desconocido'),
      },
    });
  }
}
