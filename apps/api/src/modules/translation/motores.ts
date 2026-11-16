import { Logger } from '@nestjs/common';
import type { Locale } from '@ecom/shared';

/**
 * Motores de traducción.
 *
 * Misma idea que con las pasarelas de pago y los proveedores: una interfaz y
 * varios adaptadores, para que cambiar de servicio sea cambiar una variable de
 * entorno y no reescribir el importador.
 *
 * El motor por defecto no traduce. Es deliberado: sin servicio contratado,
 * dejar la ficha en el idioma del proveedor es mejor que inventar una
 * traducción. Una ficha en inglés se entiende; una traducción mala hace
 * desconfiar de la tienda entera.
 */

export interface MotorTraduccion {
  readonly nombre: string;
  /** Si está listo para usarse (credenciales, URL…). */
  disponible(): boolean;
  /**
   * Traduce varios textos de una vez.
   *
   * En lote y no de uno en uno porque los servicios cobran y limitan por
   * petición, no por carácter suelto: una ficha son tres textos y mandarlos
   * juntos cuesta un tercio en llamadas.
   */
  traducir(textos: string[], destino: Locale, origen?: Locale): Promise<string[]>;
}

/** Códigos de idioma tal y como los espera cada servicio. */
const CODIGOS_DEEPL: Record<Locale, string> = {
  es: 'ES',
  en: 'EN-GB',
  // DeepL no tiene catalán. Se pide español y queda pendiente de repaso, que
  // es justo para lo que existe la cola de revisión: es más fácil corregir un
  // texto en español que escribirlo en catalán desde cero.
  ca: 'ES',
};

const CODIGOS_LIBRE: Record<Locale, string> = { es: 'es', en: 'en', ca: 'ca' };

/** No traduce nada. El comportamiento por defecto sin servicio configurado. */
export class MotorNinguno implements MotorTraduccion {
  readonly nombre = 'ninguno';

  disponible(): boolean {
    return false;
  }

  traducir(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

/**
 * DeepL.
 *
 * El recomendado para español, catalán e inglés: su plan gratuito da 500.000
 * caracteres al mes —unas mil fichas— y la calidad en estos idiomas es
 * claramente mejor que la de las alternativas libres.
 *
 * Las claves gratuitas terminan en `:fx` y usan otro dominio; se detecta solo
 * para que nadie tenga que acordarse de configurarlo.
 */
export class MotorDeepL implements MotorTraduccion {
  readonly nombre = 'deepl';
  private readonly logger = new Logger(MotorDeepL.name);

  constructor(
    private readonly apiKey: string | undefined,
    private readonly url: string | undefined,
  ) {}

  disponible(): boolean {
    return Boolean(this.apiKey);
  }

  private get base(): string {
    if (this.url) return this.url.replace(/\/$/, '');
    return this.apiKey?.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  }

  async traducir(textos: string[], destino: Locale, origen?: Locale): Promise<string[]> {
    if (textos.length === 0) return [];

    const respuesta = await fetch(`${this.base}/v2/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${this.apiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: textos,
        target_lang: CODIGOS_DEEPL[destino],
        ...(origen ? { source_lang: CODIGOS_DEEPL[origen].split('-')[0] } : {}),
        // Las fichas de producto no llevan etiquetas, pero sí saltos de línea
        // que separan características: sin esto se juntan en un párrafo.
        preserve_formatting: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!respuesta.ok) {
      const cuerpo = await respuesta.text().catch(() => '');

      // 456 es "cuota agotada". Merece un mensaje propio: es lo que va a pasar
      // en mitad de una importación grande, y el error genérico no dice qué
      // hacer.
      if (respuesta.status === 456) {
        throw new Error(
          'Cuota de traducción agotada en DeepL. Las fichas quedan en el idioma del proveedor ' +
            'hasta que se renueve el plan o se amplíe.',
        );
      }

      throw new Error(`DeepL respondió ${String(respuesta.status)}: ${cuerpo.slice(0, 200)}`);
    }

    const datos = (await respuesta.json()) as { translations?: { text: string }[] };
    const traducciones = datos.translations ?? [];

    if (traducciones.length !== textos.length) {
      this.logger.warn(
        `DeepL devolvió ${String(traducciones.length)} traducciones para ${String(textos.length)} textos`,
      );
    }

    // Si falta alguna, se queda el original en su sitio: mejor un texto sin
    // traducir que una ficha con los campos descolocados.
    return textos.map((original, i) => traducciones[i]?.text ?? original);
  }
}

/**
 * LibreTranslate.
 *
 * Se puede alojar uno mismo, así que no cuesta por carácter y ningún texto de
 * la tienda sale hacia un tercero. A cambio, la calidad es sensiblemente peor:
 * encaja si el volumen es alto y las fichas se van a repasar igualmente.
 */
export class MotorLibre implements MotorTraduccion {
  readonly nombre = 'libre';

  constructor(
    private readonly url: string | undefined,
    private readonly apiKey: string | undefined,
  ) {}

  disponible(): boolean {
    return Boolean(this.url);
  }

  async traducir(textos: string[], destino: Locale, origen?: Locale): Promise<string[]> {
    if (textos.length === 0) return [];

    const respuesta = await fetch(`${(this.url ?? '').replace(/\/$/, '')}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: textos,
        source: origen ? CODIGOS_LIBRE[origen] : 'auto',
        target: CODIGOS_LIBRE[destino],
        format: 'text',
        ...(this.apiKey ? { api_key: this.apiKey } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!respuesta.ok) {
      const cuerpo = await respuesta.text().catch(() => '');
      throw new Error(
        `LibreTranslate respondió ${String(respuesta.status)}: ${cuerpo.slice(0, 200)}`,
      );
    }

    const datos = (await respuesta.json()) as { translatedText?: string | string[] };
    const traducido = datos.translatedText;

    // Con un solo texto devuelve una cadena; con varios, un array.
    if (typeof traducido === 'string') return [traducido];
    return textos.map((original, i) => traducido?.[i] ?? original);
  }
}
