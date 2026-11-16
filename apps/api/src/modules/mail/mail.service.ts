import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { DEFAULT_LOCALE, type Env, type Locale } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { IntegracionesService } from '../integrations/integraciones.service.js';
import { ajusteBooleano, ajusteNumero, ajusteTexto } from '../integrations/valores.js';
import { conexionCifrada, explicarFallo } from './cifrado-smtp.js';
import { esLocaleValido, type ContenidoEmail, type Marca } from './plantillas/base.js';
import * as plantillas from './plantillas/index.js';

/**
 * Envío de correo transaccional.
 *
 * En desarrollo apunta a Mailpit, que captura todo sin enviar nada fuera: así
 * se pueden probar los emails sin riesgo de escribir por error a un cliente
 * real con datos de prueba.
 *
 * Los envíos NO bloquean la operación que los provoca. Si el servidor de correo
 * está caído, un cliente debe poder seguir comprando: el pedido se registra y
 * el email se reintenta desde la cola.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);

  /**
   * Conexión SMTP, creada a partir de lo configurado en el panel.
   *
   * Se guarda con la configuración que la creó: al cambiar el servidor de
   * correo desde el panel, la siguiente llamada detecta que ya no coincide y
   * abre una conexión nueva. Sin esto habría que reiniciar el servidor para
   * que un cambio de proveedor de correo surtiera efecto.
   */
  private transporte: Transporter | null = null;
  private huellaTransporte = '';

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly settings: SettingsService,
    private readonly integraciones: IntegracionesService,
  ) {}

  /** Conexión al servidor de correo, o `null` si no está configurado. */
  private async conexion(): Promise<{ transporte: Transporter; remitente: string } | null> {
    const config = await this.integraciones.configuracion('smtp');

    if (!config?.operativa) return null;

    const host = ajusteTexto(config, 'host');
    const port = ajusteNumero(config, 'port', 587);
    /*
     * El puerto manda sobre la casilla, y no es un capricho.
     *
     * En el 465 la conversación va cifrada desde el primer byte y en el 587
     * empieza en claro; mezclarlo no da un error, deja la conexión colgada
     * hasta que salta el tiempo de espera. Con la casilla desmarcada de
     * fábrica, configurar un buzón normal —que va en el 465— dejaba la tienda
     * sin mandar un solo correo, con un síntoma que parece de red.
     */
    const secure = conexionCifrada(port, ajusteBooleano(config, 'secure'));
    const user = ajusteTexto(config, 'user');
    const pass = config.credenciales['password'] ?? '';
    const remitente = ajusteTexto(config, 'from', 'Tienda <no-reply@localhost>');

    const huella = `${host}:${String(port)}:${String(secure)}:${user}:${pass ? 'con-clave' : 'sin-clave'}`;

    if (!this.transporte || this.huellaTransporte !== huella) {
      this.transporte?.close();

      this.transporte = nodemailer.createTransport({
        host,
        port,
        secure,
        ...(user ? { auth: { user, pass } } : {}),
        // Mailpit no tiene certificado válido; en producción sí se exige.
        ...(this.env.NODE_ENV === 'development' ? { tls: { rejectUnauthorized: false } } : {}),
        pool: true,
        maxConnections: 3,
      });

      this.huellaTransporte = huella;
    }

    return { transporte: this.transporte, remitente };
  }

  /** Datos de marca para las plantillas, tomados de los ajustes del admin. */
  private async marca(): Promise<Marca> {
    const ajustes = await this.settings.publicos();

    return {
      nombre: typeof ajustes['brand.name'] === 'string' ? ajustes['brand.name'] : 'Tienda',
      colorPrimario:
        typeof ajustes['brand.primaryColor'] === 'string'
          ? ajustes['brand.primaryColor']
          : '#4f46e5',
      logoUrl: typeof ajustes['brand.logoLight'] === 'string' ? ajustes['brand.logoLight'] : null,
      urlTienda: this.env.STOREFRONT_URL,
    };
  }

  private idioma(valor: string | null | undefined): Locale {
    return valor && esLocaleValido(valor) ? valor : DEFAULT_LOCALE;
  }

  /**
   * Envía un correo ya compuesto.
   *
   * Devuelve si se pudo enviar en lugar de lanzar: quien llama decide si eso
   * debe abortar su operación, y en la práctica casi nunca debe.
   */
  private async enviar(destino: string, contenido: ContenidoEmail): Promise<boolean> {
    const conexion = await this.conexion();

    // Sin correo configurado no se intenta enviar: se deja constancia y se
    // sigue. Un pedido no puede fallar porque falte el servidor de correo, y
    // que el log lo diga con claridad ahorra media hora de búsqueda cuando
    // alguien pregunte por qué no llegan las confirmaciones.
    if (!conexion) {
      this.logger.warn(
        `Correo no configurado: "${contenido.asunto}" para ${destino} no se ha enviado. ` +
          'Actívalo en Ajustes → Integraciones.',
      );
      await this.anotarFallo(
        'El correo saliente no está configurado o está desactivado, así que NO se está ' +
          'enviando ningún email: ni confirmaciones de pedido, ni avisos de envío, ni ' +
          'recuperación de contraseña.',
      );
      return false;
    }

    try {
      // sendMail devuelve `any` en los tipos de nodemailer; solo usamos el
      // messageId para poder rastrear el envío en el log del servidor SMTP.
      const info = (await conexion.transporte.sendMail({
        from: conexion.remitente,
        to: destino,
        subject: contenido.asunto,
        text: contenido.texto,
        html: contenido.html,
      })) as { messageId?: string };

      this.logger.log(
        `Email "${contenido.asunto}" enviado a ${destino} (${info.messageId ?? 'sin id'})`,
      );

      // Un envío bueno limpia el aviso anterior: si no, el panel se quedaría
      // en rojo para siempre por un fallo puntual ya resuelto.
      await this.anotarExito();
      return true;
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);

      this.logger.error(`No se ha podido enviar "${contenido.asunto}" a ${destino}: ${motivo}`);
      await this.anotarFallo(`El último correo no salió: ${motivo}`);
      return false;
    }
  }

  /**
   * Deja constancia EN EL PANEL de que el correo no está saliendo.
   *
   * Hasta ahora, un correo que no salía dejaba una línea en el registro del
   * servidor y nada más. El resultado en producción fue el peor posible: la
   * tienda llevaba tiempo sin mandar un solo email —ni confirmaciones, ni
   * avisos de envío, ni recuperación de contraseña— y desde fuera todo parecía
   * normal, porque un pedido no falla porque falle su correo. Se descubrió
   * porque una persona lo echó de menos.
   *
   * Escribirlo donde el panel ya lo enseña convierte eso en un aviso rojo en
   * Ajustes → Integraciones, sin esperar a que alguien pulse «probar conexión».
   *
   * No propaga errores: esto es el registro del fallo, y un fallo registrando
   * un fallo no puede tumbar el envío de un pedido.
   */
  private async anotarFallo(mensaje: string): Promise<void> {
    await this.integraciones
      .anotarComprobacion('smtp', { ok: false, mensaje })
      .catch(() => undefined);
  }

  private async anotarExito(): Promise<void> {
    await this.integraciones.anotarComprobacion('smtp', { ok: true }).catch(() => undefined);
  }

  // ── Cuenta ────────────────────────────────────────────────

  async verificarEmail(datos: {
    email: string;
    nombre: string | null;
    token: string;
    locale: string;
  }): Promise<boolean> {
    const locale = this.idioma(datos.locale);
    const url = `${this.env.STOREFRONT_URL}/${locale}/verificar-email?token=${datos.token}`;

    return this.enviar(
      datos.email,
      plantillas.verificarEmail(await this.marca(), {
        nombre: datos.nombre ?? '',
        url,
        locale,
      }),
    );
  }

  /** Correo del doble opt-in: sin este clic no hay suscripción. */
  async confirmarNewsletter(datos: {
    email: string;
    token: string;
    locale: string;
    horas: number;
  }): Promise<boolean> {
    const locale = this.idioma(datos.locale);
    const url = `${this.env.STOREFRONT_URL}/${locale}/preferencias/confirmar?token=${datos.token}`;

    return this.enviar(
      datos.email,
      plantillas.confirmarNewsletter(await this.marca(), { url, locale, horas: datos.horas }),
    );
  }

  /**
   * Cupón ganado por un referido, a cada una de las dos partes.
   *
   * Sin este correo el programa no existe: el cupón queda emitido en la base
   * de datos y nadie se entera de que lo tiene.
   */
  async premioReferido(datos: {
    email: string;
    locale: string;
    esReferidor: boolean;
    codigo: string;
    importeCents: number;
    minimoCents: number;
    dias: number;
  }): Promise<boolean> {
    const locale = this.idioma(datos.locale);

    return this.enviar(
      datos.email,
      plantillas.premioReferido(await this.marca(), {
        locale,
        esReferidor: datos.esReferidor,
        codigo: datos.codigo,
        importeCents: datos.importeCents,
        minimoCents: datos.minimoCents,
        dias: datos.dias,
        url: `${this.env.STOREFRONT_URL}/${locale}`,
      }),
    );
  }

  async restablecerPassword(datos: {
    email: string;
    nombre: string | null;
    token: string;
    locale: string;
  }): Promise<boolean> {
    const locale = this.idioma(datos.locale);
    const url = `${this.env.STOREFRONT_URL}/${locale}/restablecer?token=${datos.token}`;

    return this.enviar(
      datos.email,
      plantillas.restablecerPassword(await this.marca(), {
        nombre: datos.nombre ?? '',
        url,
        locale,
      }),
    );
  }

  async invitacionEquipo(datos: {
    email: string;
    token: string;
    locale?: string;
  }): Promise<boolean> {
    const locale = this.idioma(datos.locale);
    const url = `${this.env.ADMIN_URL}/aceptar-invitacion?token=${datos.token}`;

    return this.enviar(
      datos.email,
      plantillas.invitacionEquipo(await this.marca(), { url, locale }),
    );
  }

  // ── Pedidos ───────────────────────────────────────────────

  async confirmacionPedido(datos: {
    email: string;
    nombre: string | null;
    numero: string;
    lineas: { nombre: string; cantidad: number; totalCents: number }[];
    totalCents: number;
    direccion: string;
    locale: string;
    /** Clave de seguimiento del pedido. */
    token: string;
  }): Promise<boolean> {
    const locale = this.idioma(datos.locale);
    // Al seguimiento del pedido, no a "mi cuenta": quien compra como invitado
    // no tiene cuenta y ese enlace le dejaba en una pantalla de acceso sin
    // forma de ver lo que acababa de comprar.
    const url = `${this.env.STOREFRONT_URL}/${locale}/pedido/${datos.token}`;

    return this.enviar(
      datos.email,
      plantillas.confirmacionPedido(await this.marca(), {
        nombre: datos.nombre ?? '',
        numero: datos.numero,
        lineas: datos.lineas,
        totalCents: datos.totalCents,
        direccion: datos.direccion,
        url,
        locale,
      }),
    );
  }

  async pedidoEnviado(datos: {
    email: string;
    nombre: string | null;
    numero: string;
    transportista: string;
    seguimiento: string;
    urlSeguimiento: string;
    locale: string;
  }): Promise<boolean> {
    const locale = this.idioma(datos.locale);

    return this.enviar(
      datos.email,
      plantillas.pedidoEnviado(await this.marca(), {
        nombre: datos.nombre ?? '',
        numero: datos.numero,
        transportista: datos.transportista,
        seguimiento: datos.seguimiento,
        urlSeguimiento: datos.urlSeguimiento,
        locale,
      }),
    );
  }

  async pedidoEntregado(datos: {
    email: string;
    nombre: string | null;
    numero: string;
    locale: string;
  }): Promise<boolean> {
    const locale = this.idioma(datos.locale);
    const url = `${this.env.STOREFRONT_URL}/${locale}/cuenta`;

    return this.enviar(
      datos.email,
      plantillas.pedidoEntregado(await this.marca(), {
        nombre: datos.nombre ?? '',
        numero: datos.numero,
        url,
        locale,
      }),
    );
  }

  /**
   * Pide la opinión de lo comprado, unos días después de la entrega.
   *
   * Los enlaces van a la FICHA de cada producto y no al área de cliente: es
   * donde está el formulario de valoración, y ahorrar tres clics es lo que
   * decide si alguien valora o cierra el correo.
   */
  async pedirValoracion(datos: {
    email: string;
    nombre: string | null;
    numero: string;
    locale: string;
    /** Cada producto con su slug YA resuelto en el idioma del pedido. */
    productos: { nombre: string; slug: string }[];
  }): Promise<boolean> {
    const locale = this.idioma(datos.locale);

    if (datos.productos.length === 0) return false;

    return this.enviar(
      datos.email,
      plantillas.pedirValoracion(await this.marca(), {
        nombre: datos.nombre ?? '',
        numero: datos.numero,
        locale,
        productos: datos.productos.map((p) => ({
          nombre: p.nombre,
          // A la FICHA, no al área de cliente: es donde está el formulario de
          // valoración, y ahorrar tres clics es lo que decide si alguien
          // valora o cierra el correo.
          url: `${this.env.STOREFRONT_URL}/${locale}/producto/${p.slug}`,
        })),
      }),
    );
  }

  // ── Avisos internos ───────────────────────────────────────

  // ── Recuperación ──────────────────────────────────────────

  /**
   * Recordatorio de carrito abandonado.
   *
   * El enlace lleva el token del carrito: al abrirlo, la tienda lo recupera
   * aunque el cliente entre desde otro dispositivo, que es justo lo que pasa
   * cuando alguien mira en el móvil y compra en el portátil.
   */
  async carritoAbandonado(datos: {
    email: string;
    nombre: string | null;
    token: string;
    /** Token de la dirección para el centro de preferencias. */
    tokenBaja: string;
    lineas: { nombre: string; cantidad: number; totalCents: number }[];
    totalCents: number;
    cupon?: { codigo: string; descripcion: string };
    locale: string;
  }): Promise<boolean> {
    const locale = this.idioma(datos.locale);
    const url = `${this.env.STOREFRONT_URL}/${locale}/carrito?recuperar=${datos.token}`;
    // Al centro de preferencias y no a una baja a ciegas: quien no quiere los
    // recordatorios del carrito muchas veces sí quiere los avisos de pedido, y
    // darle un único botón de "fuera todo" es perder al cliente entero.
    const urlBaja = `${this.env.STOREFRONT_URL}/${locale}/preferencias?token=${datos.tokenBaja}`;

    return this.enviar(
      datos.email,
      plantillas.carritoAbandonado(await this.marca(), {
        nombre: datos.nombre ?? '',
        lineas: datos.lineas,
        totalCents: datos.totalCents,
        url,
        urlBaja,
        ...(datos.cupon ? { cupon: datos.cupon } : {}),
        locale,
      }),
    );
  }

  /** El cobro caducó sin completarse y el pedido sigue esperando. */
  async pagoCaducado(datos: {
    email: string;
    nombre: string | null;
    numero: string;
    token: string;
    esCripto: boolean;
    locale: string;
  }): Promise<boolean> {
    const locale = this.idioma(datos.locale);

    return this.enviar(
      datos.email,
      plantillas.pagoCaducado(await this.marca(), {
        nombre: datos.nombre ?? '',
        numero: datos.numero,
        url: `${this.env.STOREFRONT_URL}/${locale}/pedido/${datos.token}`,
        esCripto: datos.esCripto,
        locale,
      }),
    );
  }

  /**
   * Aviso al equipo de una incidencia.
   *
   * Va a la dirección de contacto configurada; si no hay ninguna, solo queda
   * en el log en lugar de fallar silenciosamente.
   */
  async avisoIncidencia(datos: { numero: string; motivo: string }): Promise<boolean> {
    const ajustes = await this.settings.publicos();
    const destino = ajustes['shop.contactEmail'];

    if (typeof destino !== 'string' || !destino) {
      this.logger.warn(
        `Incidencia en ${datos.numero} sin avisar por email: falta configurar ` +
          `el correo de contacto en Ajustes → Tienda. Motivo: ${datos.motivo}`,
      );
      return false;
    }

    return this.enviar(
      destino,
      plantillas.avisoIncidencia(await this.marca(), {
        numero: datos.numero,
        motivo: datos.motivo,
        url: `${this.env.ADMIN_URL}/kanban?soloIncidencias=true`,
      }),
    );
  }

  /** Comprueba que el servidor de correo responde, para el panel de salud. */
  async verificarConexion(): Promise<{ ok: boolean; mensaje?: string }> {
    const config = await this.integraciones.configuracion('smtp');
    const conexion = await this.conexion();

    if (!conexion) {
      return { ok: false, mensaje: 'El correo no está configurado o está desactivado.' };
    }

    try {
      await conexion.transporte.verify();
      return { ok: true };
    } catch (error) {
      // Con el mensaje de la librería a secas —«Greeting never received»— no
      // hay por dónde empezar. Se dice qué mirar.
      return {
        ok: false,
        mensaje: explicarFallo(
          error,
          ajusteTexto(config, 'host'),
          ajusteNumero(config, 'port', 587),
        ),
      };
    }
  }

  onModuleDestroy(): void {
    // Puede no haberse abierto nunca: sin correo configurado, la conexión no
    // llega a crearse.
    this.transporte?.close();
  }
}
