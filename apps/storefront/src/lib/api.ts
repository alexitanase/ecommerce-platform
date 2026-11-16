/**
 * Cliente de la API.
 *
 * Se escribe a mano en lugar de generar el SDK desde el OpenAPI porque en
 * componentes de servidor hace falta controlar el caché de Next con precisión
 * (`revalidate`, `tags`), y los clientes generados no lo exponen.
 */
import type { EnlaceResuelto } from '@ecom/shared';

const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export interface OpcionesPeticion extends RequestInit {
  /** Segundos de caché. 0 = sin caché (datos de usuario, carrito). */
  revalidar?: number;
  /** Etiquetas para invalidar el caché cuando cambie el catálogo. */
  etiquetas?: string[];
  token?: string;
  /**
   * Cookies a reenviar a la API desde un componente de servidor.
   *
   * `credentials: 'include'` no sirve en el servidor: ahí no hay navegador que
   * adjunte cookies. Sin reenviarlas a mano, la API ve al visitante como
   * anónimo y la verificación de edad o la sesión no le constan.
   */
  cookies?: string;
}

export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
    readonly campos?: Record<string, string[]>,
    readonly traceId?: string,
    /**
     * Código estable del error, tal cual lo manda la API: `TOTP_REQUIRED`,
     * `ValidationError`…
     *
     * Es lo que hay que mirar para decidir qué hacer, nunca el mensaje. El
     * mensaje está escrito para leerlo, cambia con cualquier retoque de
     * redacción y además está traducido: un `if` sobre él funciona hasta que
     * alguien corrige una tilde.
     */
    readonly codigo?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

export async function api<T>(ruta: string, opciones: OpcionesPeticion = {}): Promise<T> {
  const { revalidar, etiquetas, token, cookies: reenviarCookies, ...init } = opciones;

  const respuesta = await fetch(`${BASE}/api/v1${ruta}`, {
    ...init,
    headers: {
      /*
       * Solo cuando se manda algo.
       *
       * Fastify rechaza con un 400 —«Body cannot be empty when content-type is
       * set to application/json»— cualquier petición que declare JSON y no
       * lleve cuerpo. Es justo el caso de un `DELETE`, y con la cabecera fija
       * borrar una dirección respondía un error que no tenía nada que ver con
       * la dirección.
       */
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(reenviarCookies ? { cookie: reenviarCookies } : {}),
      ...init.headers,
    },
    // La cookie del refresh token debe viajar en las peticiones de sesión.
    credentials: 'include',
    ...(revalidar !== undefined || etiquetas
      ? {
          next: {
            ...(revalidar !== undefined ? { revalidate: revalidar } : {}),
            ...(etiquetas ? { tags: etiquetas } : {}),
          },
        }
      : {}),
  });

  const texto = await respuesta.text();
  const datos = texto ? (JSON.parse(texto) as unknown) : null;

  if (!respuesta.ok) {
    const err = datos as {
      message?: string | string[];
      fields?: Record<string, string[]>;
      traceId?: string;
      error?: string;
    } | null;

    throw new ErrorApi(
      respuesta.status,
      Array.isArray(err?.message) ? err.message.join(', ') : (err?.message ?? 'Error inesperado'),
      err?.fields,
      err?.traceId,
      err?.error,
    );
  }

  return datos as T;
}

/**
 * El menú de la sub-barra, ya resuelto en un idioma.
 *
 * Entra en todas las páginas, así que va con caché y con etiqueta: cuando se
 * edita en el panel, la API purga `menu` y se ve al momento en lugar de esperar
 * a que caduque.
 *
 * Si la API no responde se devuelve una lista vacía. La sub-barra desaparece,
 * que es fastidioso, pero la tienda sigue vendiendo; propagar el error dejaría
 * sin cabecera **todas** las páginas.
 */
export async function menuNavegacion(locale: string): Promise<EnlaceResuelto[]> {
  try {
    const { enlaces } = await api<{ enlaces: EnlaceResuelto[] }>(`/content/menu/${locale}`, {
      revalidar: 600,
      etiquetas: ['menu'],
    });
    return enlaces;
  } catch {
    return [];
  }
}

/** Ajustes públicos de la tienda: marca, idiomas, umbral de envío gratis… */
export async function ajustesPublicos(): Promise<Record<string, unknown>> {
  try {
    return await api<Record<string, unknown>>('/settings/public', { revalidar: 300 });
  } catch {
    // La tienda debe seguir funcionando aunque falle el endpoint de ajustes:
    // se usan los valores por defecto.
    return {};
  }
}

/**
 * Las pasarelas de cobro que están funcionando ahora mismo.
 *
 * Se pide sin pedido: así devuelve las que están encendidas y con credenciales,
 * sin aplicar los límites por importe, que es justo lo que hace falta para
 * anunciar en el pie qué se acepta.
 *
 * Con caché larga porque cambia cuando alguien configura una pasarela, no cuando
 * alguien navega, y esto entra en TODAS las páginas. Si falla se devuelve vacío
 * y el pie no pinta la fila: es un adorno de confianza, no puede tumbar nada.
 */
export async function pasarelasActivas(): Promise<{ key: string }[]> {
  try {
    return await api<{ key: string }[]>('/payments/methods', {
      revalidar: 3600,
      etiquetas: ['pagos'],
    });
  } catch {
    return [];
  }
}
