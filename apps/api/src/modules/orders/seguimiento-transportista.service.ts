import { Injectable, Logger } from '@nestjs/common';
import { IntegracionesService } from '../integrations/integraciones.service.js';
import { ajusteBooleano } from '../integrations/valores.js';
import { codigoDeSeguimiento } from './enlaces-seguimiento.js';

/**
 * Dónde está el paquete, preguntado al transportista.
 *
 * Hasta ahora el seguimiento solo se le pedía al PROVEEDOR, y eso deja fuera
 * justo los envíos que más importan: los de Dreamlove, que no tiene API, y
 * cualquiera cuyo número se haya anotado a mano desde la web del proveedor. En
 * esos casos el pedido se quedaba en «enviado al proveedor» para siempre —o
 * hasta que alguien se acordaba de moverlo— mientras el paquete llegaba,
 * volvía o se perdía sin que constara en ninguna parte.
 *
 * Esto pregunta por el número, que es el único dato que siempre tenemos.
 *
 * **Por qué un agregador y no la API de cada transportista.** Nacex, SEUR y
 * Correos Express entregan su webservice al firmar un contrato, con
 * credenciales y documentación privadas, y responden únicamente por los envíos
 * facturados a esa cuenta. Nuestros paquetes los factura el proveedor, así que
 * sus APIs no nos devolverían nada ni teniendo las claves. 17TRACK consulta por
 * número, sin contrato con nadie, y cubre los tres.
 */

/** Base de la API. La versión va en la ruta y no se negocia por cabecera. */
const BASE = 'https://api.17track.net/track/v2.2';

/**
 * Cuántos números caben en una consulta.
 *
 * Su límite son 40. Se consulta por lotes y no de uno en uno porque el límite
 * de frecuencia es de 3 peticiones por segundo: con cien envíos activos, de uno
 * en uno son 33 segundos de espera y un puñado de 429.
 */
const POR_LOTE = 40;

/**
 * Lo que nos interesa de un envío, ya traducido a nuestro vocabulario.
 *
 * `estado` usa los mismos valores que devuelven los adaptadores de proveedor
 * para que `propagarEstado` no tenga que distinguir de dónde vino el dato: al
 * pedido le da igual quién le ha dicho que el paquete está entregado.
 */
export interface EstadoDelEnvio {
  numero: string;
  estado: 'ENVIADO' | 'ENTREGADO' | 'INCIDENCIA' | 'DESCONOCIDO';
  /** Lo último que ha pasado, tal y como lo cuenta el transportista. */
  descripcion?: string;
  ubicacion?: string;
  fecha?: Date;
}

/**
 * Traduce el estado de 17TRACK al nuestro.
 *
 * Se queda fuera un caso a propósito: `NotFound`. Significa «el transportista
 * todavía no sabe nada de este número», que es lo normal durante las primeras
 * horas —y también lo que se ve cuando alguien ha tecleado mal el número—. No
 * se puede distinguir una cosa de la otra desde aquí, así que se devuelve
 * DESCONOCIDO y el pedido no se mueve: dar por bueno cualquiera de los dos
 * significados acabaría en un pedido mal marcado.
 */
export function traducirEstado(estado: string): EstadoDelEnvio['estado'] {
  switch (estado) {
    case 'Delivered':
      return 'ENTREGADO';
    case 'InTransit':
    case 'OutForDelivery':
    case 'AvailableForPickup':
    case 'InfoReceived':
      return 'ENVIADO';
    /*
     * Los tres que necesitan a una persona.
     *
     * `Exception` es aduanas, dirección incorrecta o daño; `DeliveryFailure` es
     * que se intentó entregar y no se pudo; `Expired` es que lleva demasiado
     * tiempo sin un solo movimiento. Ninguno se arregla solo y en los tres el
     * cliente se está quedando sin su pedido, así que valen para que aparezcan
     * en la cola de revisión en vez de para mover el pedido de estado.
     */
    case 'Exception':
    case 'DeliveryFailure':
    case 'Expired':
      return 'INCIDENCIA';
    default:
      return 'DESCONOCIDO';
  }
}

interface RespuestaRegistro {
  data?: {
    accepted?: { number: string }[];
    rejected?: { number: string; error?: { code?: number; message?: string } }[];
  };
}

interface RespuestaConsulta {
  data?: {
    accepted?: {
      number: string;
      track_info?: {
        latest_status?: { status?: string };
        latest_event?: {
          time_iso?: string;
          description?: string;
          location?: string;
        };
      };
    }[];
  };
}

@Injectable()
export class SeguimientoTransportistaService {
  private readonly logger = new Logger(SeguimientoTransportistaService.name);

  constructor(private readonly integraciones: IntegracionesService) {}

  /**
   * La clave, o `null` si no está configurada.
   *
   * `null` no es un error: es una tienda que todavía no ha contratado el
   * seguimiento automático. Todo lo de este servicio no hace nada en ese caso y
   * la tienda sigue funcionando exactamente como antes —con el enlace de
   * seguimiento en el correo—, que es la misma regla que sigue el buscador.
   */
  private async clave(): Promise<string | null> {
    const config = await this.integraciones.configuracion('17track');
    if (!config?.operativa) return null;
    return config.credenciales['apiKey'] ?? null;
  }

  /** ¿Está configurado el seguimiento automático? */
  async disponible(): Promise<boolean> {
    return (await this.clave()) !== null;
  }

  /** ¿Hay que avisar al cliente de cada movimiento, o solo del primero? */
  async avisaCadaMovimiento(): Promise<boolean> {
    const config = await this.integraciones.configuracion('17track');
    return ajusteBooleano(config, 'avisarEnTransito', false);
  }

  /**
   * Comprueba que la clave sirve, para el botón del panel.
   *
   * Se consulta un número inventado a propósito. No hace falta que exista: lo
   * que se está comprobando es que la clave se acepta, y eso se ve en el
   * código HTTP. Un 401 dice «la clave no vale» y un 200 dice que sí, aunque el
   * cuerpo responda que ese envío no lo conoce nadie.
   *
   * Se usa `gettrackinfo` y no `register` porque registrar gasta cuota, y
   * gastar una consulta de las cien del mes gratuito cada vez que alguien pulsa
   * «comprobar» es una forma tonta de quedarse sin ellas.
   */
  async probar(): Promise<{ ok: boolean; mensaje?: string }> {
    const clave = await this.clave();
    if (!clave) return { ok: false, mensaje: 'Falta la clave de API.' };

    try {
      const respuesta = await fetch(`${BASE}/gettrackinfo`, {
        method: 'POST',
        headers: { '17token': clave, 'content-type': 'application/json' },
        body: JSON.stringify([{ number: 'PRUEBA000000000' }]),
        signal: AbortSignal.timeout(10_000),
      });

      if (respuesta.status === 401 || respuesta.status === 403) {
        return { ok: false, mensaje: 'La clave de API no es válida.' };
      }
      if (!respuesta.ok) {
        return { ok: false, mensaje: `17TRACK ha respondido ${respuesta.status}.` };
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        mensaje: `No se ha podido contactar con 17TRACK: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  /**
   * Da de alta un número para que lo sigan.
   *
   * Hay que hacerlo una vez por envío: a partir de ahí ellos lo actualizan
   * solos y consultarlo no vuelve a costar cuota. Por eso se llama al anotar el
   * seguimiento y no en cada repaso.
   *
   * Se le manda el transportista cuando lo conocemos. Su detección automática
   * acierta con los formatos internacionales y falla con los nacionales: un
   * albarán de Nacex son ocho dígitos sin prefijo, indistinguible del de otras
   * cinco empresas.
   */
  async registrar(
    numero: string,
    transportista: string | null,
    referencia?: string,
  ): Promise<boolean> {
    const clave = await this.clave();
    if (!clave) return false;

    const codigo = transportista ? codigoDeSeguimiento(transportista) : undefined;

    const cuerpo = [
      {
        number: numero,
        ...(codigo ? { carrier: codigo } : {}),
        ...(referencia ? { order_no: referencia } : {}),
        // El idioma de las descripciones de los eventos. Es lo que acaba
        // viendo el cliente en el seguimiento de su pedido.
        lang: 'es',
      },
    ];

    const respuesta = await this.pedir<RespuestaRegistro>('/register', cuerpo, clave);
    if (!respuesta) return false;

    const rechazado = respuesta.data?.rejected?.[0];
    if (rechazado) {
      /*
       * Un rechazo no se reintenta ni se propaga como error.
       *
       * El motivo más común es «ya estaba registrado», que no es un problema:
       * el número ya se está siguiendo. Los otros —cuota agotada, número
       * inválido— tampoco se arreglan reintentando, y tumbar por esto el
       * guardado del seguimiento dejaría al cliente sin su correo de envío por
       * un servicio auxiliar.
       */
      this.logger.warn(
        `17TRACK no ha aceptado el número ${numero}: ` +
          `${rechazado.error?.message ?? 'sin motivo'} (${rechazado.error?.code ?? '?'})`,
      );
      return false;
    }

    return true;
  }

  /**
   * El estado de varios envíos de una vez.
   *
   * Devuelve solo los que ha sabido responder: un número que no reconoce
   * simplemente no sale en la lista, y el pedido se queda como estaba.
   */
  async consultar(
    envios: { numero: string; transportista: string | null }[],
  ): Promise<EstadoDelEnvio[]> {
    const clave = await this.clave();
    if (!clave || envios.length === 0) return [];

    const resultados: EstadoDelEnvio[] = [];

    for (let i = 0; i < envios.length; i += POR_LOTE) {
      const lote = envios.slice(i, i + POR_LOTE);
      const cuerpo = lote.map((e) => {
        const codigo = e.transportista ? codigoDeSeguimiento(e.transportista) : undefined;
        return { number: e.numero, ...(codigo ? { carrier: codigo } : {}) };
      });

      const respuesta = await this.pedir<RespuestaConsulta>('/gettrackinfo', cuerpo, clave);
      if (!respuesta) continue;

      for (const envio of respuesta.data?.accepted ?? []) {
        const ultimo = envio.track_info?.latest_event;
        const fecha = ultimo?.time_iso ? new Date(ultimo.time_iso) : undefined;

        resultados.push({
          numero: envio.number,
          estado: traducirEstado(envio.track_info?.latest_status?.status ?? ''),
          ...(ultimo?.description ? { descripcion: ultimo.description } : {}),
          ...(ultimo?.location ? { ubicacion: ultimo.location } : {}),
          // Una fecha inválida es peor que ninguna: se guardaría como
          // `Invalid Date` y rompería cualquier cálculo posterior.
          ...(fecha && !Number.isNaN(fecha.getTime()) ? { fecha } : {}),
        });
      }
    }

    return resultados;
  }

  /**
   * Una llamada a su API.
   *
   * Devuelve `null` ante cualquier problema en vez de lanzar. El seguimiento es
   * información de apoyo: que su servicio esté caído no puede hacer fallar el
   * repaso de envíos —que atiende también a los proveedores que sí responden—
   * ni el guardado de un número de seguimiento.
   */
  private async pedir<T>(ruta: string, cuerpo: unknown, clave: string): Promise<T | null> {
    try {
      const respuesta = await fetch(`${BASE}${ruta}`, {
        method: 'POST',
        headers: { '17token': clave, 'content-type': 'application/json' },
        body: JSON.stringify(cuerpo),
        // Diez segundos: es un repaso en segundo plano, no una petición de
        // nadie esperando. Sin tope, un servicio colgado deja el trabajo de la
        // cola bloqueado hasta que BullMQ lo da por muerto a los cinco minutos.
        signal: AbortSignal.timeout(10_000),
      });

      if (!respuesta.ok) {
        this.logger.warn(`17TRACK ${ruta} respondió ${respuesta.status}`);
        return null;
      }

      return (await respuesta.json()) as T;
    } catch (error) {
      this.logger.warn(
        `No se ha podido consultar 17TRACK (${ruta}): ` +
          (error instanceof Error ? error.message : String(error)),
      );
      return null;
    }
  }
}
