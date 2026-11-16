import { ErrorProveedor } from './types.js';

/**
 * Cliente HTTP para hablar con proveedores externos.
 *
 * Combina tres protecciones que en dropshipping no son opcionales:
 *
 *  · Limitador de caudal (token bucket) para no superar la cuota del proveedor.
 *    Pasarse de cuota suele acabar en bloqueo temporal de la cuenta, y eso son
 *    horas sin poder enviar pedidos.
 *
 *  · Reintentos con espera creciente y jitter. Sin jitter, cien jobs que fallan
 *    a la vez reintentan a la vez y rematan al proveedor justo cuando se estaba
 *    recuperando.
 *
 *  · Cortacircuitos: si el proveedor lleva varios fallos seguidos, se deja de
 *    llamar durante un rato. Seguir insistiendo contra un servicio caído solo
 *    agota nuestros workers y retrasa el resto de la cola.
 */

export interface OpcionesHttp {
  baseUrl: string;
  /** Peticiones por segundo permitidas. */
  peticionesPorSegundo: number;
  timeoutMs?: number;
  reintentos?: number;
  cabeceras?: Record<string, string>;
  /** Identificador del proveedor, para los mensajes de error. */
  proveedor: string;
  /** Estado compartido entre instancias; inyectable para poder testear. */
  onLog?: (nivel: 'info' | 'warn' | 'error', mensaje: string) => void;
}

interface EstadoCircuito {
  fallosConsecutivos: number;
  abiertoHasta: number;
}

/** Fallos seguidos antes de abrir el circuito. */
const UMBRAL_CIRCUITO = 5;
/** Cuánto permanece abierto antes de dejar pasar una petición de prueba. */
const MS_CIRCUITO_ABIERTO = 30_000;

export class ClienteHttpProveedor {
  private tokens: number;
  private ultimaRecarga = Date.now();
  private readonly circuito: EstadoCircuito = { fallosConsecutivos: 0, abiertoHasta: 0 };

  constructor(private readonly opciones: OpcionesHttp) {
    this.tokens = opciones.peticionesPorSegundo;
  }

  async peticion<T>(
    ruta: string,
    init: RequestInit & { queryParams?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    this.comprobarCircuito();
    await this.esperarTurno();

    const url = this.construirUrl(ruta, init.queryParams);
    const intentosMaximos = (this.opciones.reintentos ?? 3) + 1;

    let ultimoError: ErrorProveedor | undefined;

    for (let intento = 1; intento <= intentosMaximos; intento++) {
      try {
        const respuesta = await fetch(url, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...this.opciones.cabeceras,
            ...(init.headers as Record<string, string> | undefined),
          },
          signal: AbortSignal.timeout(this.opciones.timeoutMs ?? 15_000),
        });

        if (!respuesta.ok) {
          const error = await this.traducirRespuesta(respuesta);
          if (!error.reintentable || intento === intentosMaximos) {
            this.registrarFallo();
            throw error;
          }
          ultimoError = error;
          await this.esperar(this.calcularEspera(intento, error.opciones.esperarMs));
          continue;
        }

        this.registrarExito();
        const texto = await respuesta.text();
        return (texto ? JSON.parse(texto) : {}) as T;
      } catch (error) {
        if (error instanceof ErrorProveedor) {
          if (!error.reintentable || intento === intentosMaximos) throw error;
          ultimoError = error;
        } else {
          const esTimeout = error instanceof Error && error.name === 'TimeoutError';
          ultimoError = new ErrorProveedor(
            esTimeout ? 'RED' : 'DESCONOCIDO',
            esTimeout
              ? `El proveedor ${this.opciones.proveedor} no ha respondido a tiempo`
              : `Error de red con ${this.opciones.proveedor}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
            { proveedor: this.opciones.proveedor, reintentable: true, detalleOriginal: error },
          );

          if (intento === intentosMaximos) {
            this.registrarFallo();
            throw ultimoError;
          }
        }

        await this.esperar(this.calcularEspera(intento));
      }
    }

    this.registrarFallo();
    throw ultimoError ?? new ErrorProveedor('DESCONOCIDO', 'Fallo desconocido');
  }

  // ── Limitador de caudal ───────────────────────────────────

  private async esperarTurno(): Promise<void> {
    // Se recargan tokens de forma proporcional al tiempo transcurrido, en vez
    // de por ventanas fijas: así el caudal es suave y no a ráfagas.
    const ahora = Date.now();
    const transcurrido = (ahora - this.ultimaRecarga) / 1000;
    this.tokens = Math.min(
      this.opciones.peticionesPorSegundo,
      this.tokens + transcurrido * this.opciones.peticionesPorSegundo,
    );
    this.ultimaRecarga = ahora;

    if (this.tokens < 1) {
      const esperaMs = ((1 - this.tokens) / this.opciones.peticionesPorSegundo) * 1000;
      await this.esperar(esperaMs);
      this.tokens = 0;
      this.ultimaRecarga = Date.now();
      return;
    }

    this.tokens -= 1;
  }

  // ── Cortacircuitos ────────────────────────────────────────

  private comprobarCircuito(): void {
    if (this.circuito.abiertoHasta > Date.now()) {
      const segundos = Math.ceil((this.circuito.abiertoHasta - Date.now()) / 1000);
      throw new ErrorProveedor(
        'PROVEEDOR_CAIDO',
        `${this.opciones.proveedor} acumula demasiados fallos; se reintentará en ${segundos} s`,
        { proveedor: this.opciones.proveedor, reintentable: true, esperarMs: segundos * 1000 },
      );
    }
  }

  private registrarFallo(): void {
    this.circuito.fallosConsecutivos++;
    if (this.circuito.fallosConsecutivos >= UMBRAL_CIRCUITO) {
      this.circuito.abiertoHasta = Date.now() + MS_CIRCUITO_ABIERTO;
      this.opciones.onLog?.(
        'error',
        `Cortacircuitos abierto para ${this.opciones.proveedor} tras ${this.circuito.fallosConsecutivos} fallos seguidos`,
      );
    }
  }

  private registrarExito(): void {
    this.circuito.fallosConsecutivos = 0;
    this.circuito.abiertoHasta = 0;
  }

  // ── Utilidades ────────────────────────────────────────────

  /**
   * Espera exponencial con jitter: 1s, 2s, 4s… más un margen aleatorio.
   * El jitter evita que todos los reintentos coincidan en el mismo instante.
   */
  private calcularEspera(intento: number, sugerida?: number): number {
    if (sugerida !== undefined) return sugerida;
    const base = Math.min(1000 * 2 ** (intento - 1), 30_000);
    return base + Math.random() * base * 0.3;
  }

  private esperar(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private construirUrl(ruta: string, params?: Record<string, string | number | undefined>): string {
    const url = new URL(ruta.replace(/^\//, ''), `${this.opciones.baseUrl.replace(/\/$/, '')}/`);
    for (const [clave, valor] of Object.entries(params ?? {})) {
      if (valor !== undefined) url.searchParams.set(clave, String(valor));
    }
    return url.toString();
  }

  /** Traduce el código HTTP del proveedor a nuestro error normalizado. */
  private async traducirRespuesta(respuesta: Response): Promise<ErrorProveedor> {
    const cuerpo = await respuesta.text().catch(() => '');
    const proveedor = this.opciones.proveedor;

    if (respuesta.status === 401 || respuesta.status === 403) {
      return new ErrorProveedor('CREDENCIALES', `Credenciales rechazadas por ${proveedor}`, {
        proveedor,
        reintentable: false,
        detalleOriginal: cuerpo,
      });
    }

    if (respuesta.status === 404) {
      return new ErrorProveedor('NO_ENCONTRADO', `Recurso no encontrado en ${proveedor}`, {
        proveedor,
        reintentable: false,
      });
    }

    if (respuesta.status === 429) {
      // Se respeta Retry-After si el proveedor lo indica: es su propia
      // estimación de cuándo vuelve a admitir tráfico.
      const retryAfter = Number(respuesta.headers.get('retry-after') ?? 0);
      return new ErrorProveedor(
        'LIMITE_PETICIONES',
        `${proveedor} ha limitado nuestras peticiones`,
        {
          proveedor,
          reintentable: true,
          esperarMs: retryAfter > 0 ? retryAfter * 1000 : 5000,
        },
      );
    }

    if (respuesta.status >= 500) {
      return new ErrorProveedor(
        'PROVEEDOR_CAIDO',
        `${proveedor} devuelve error ${respuesta.status}`,
        {
          proveedor,
          reintentable: true,
          detalleOriginal: cuerpo,
        },
      );
    }

    return new ErrorProveedor(
      'DESCONOCIDO',
      `${proveedor} ha devuelto ${respuesta.status}: ${cuerpo.slice(0, 300)}`,
      { proveedor, reintentable: false, detalleOriginal: cuerpo },
    );
  }

  /** Estado actual, para el panel de salud del proveedor. */
  get estado(): {
    circuitoAbierto: boolean;
    fallosConsecutivos: number;
    tokensDisponibles: number;
  } {
    return {
      circuitoAbierto: this.circuito.abiertoHasta > Date.now(),
      fallosConsecutivos: this.circuito.fallosConsecutivos,
      tokensDisponibles: Math.floor(this.tokens),
    };
  }
}
