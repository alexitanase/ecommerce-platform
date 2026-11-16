/**
 * Cliente de la API para el admin.
 *
 * El access token vive en memoria, no en localStorage: si el admin sufriera un
 * XSS, un token en localStorage sería robado al instante. En memoria se pierde
 * al recargar, pero se recupera con el refresh token de la cookie httpOnly,
 * que JavaScript no puede leer.
 */

let accessToken: string | null = null;

export const guardarToken = (t: string | null) => {
  accessToken = t;
};
export const obtenerToken = () => accessToken;

export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
    readonly campos?: Record<string, string[]>,
    readonly traceId?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

/** Quién ha entrado. Es la forma que devuelve la API al entrar o refrescar. */
export interface Usuario {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  type: string;
  locale: string;
  twoFactorEnabled: boolean;
  permissions: string[];
}

/** Lo que devuelve el refresco cuando hay sesión que recuperar. */
export interface SesionRecuperada {
  accessToken: string;
  user: Usuario;
}

/**
 * Refresco en curso, para que varias peticiones no lo disparen a la vez.
 *
 * No es solo por ahorrar una llamada: el servidor rota el refresh token en
 * cada uso, así que dos refrescos a la vez hacen que el segundo llegue con el
 * token que el primero acaba de gastar —la firma de un token robado—. Por eso
 * este es el ÚNICO sitio del admin que llama a /auth/refresh: quien lo
 * necesite, que use `refrescarSesion`.
 */
let refrescando: Promise<SesionRecuperada | null> | null = null;

export async function refrescarSesion(): Promise<SesionRecuperada | null> {
  refrescando ??= (async () => {
    try {
      const r = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'include',
      });
      if (!r.ok) return null;
      const datos = (await r.json()) as SesionRecuperada;
      guardarToken(datos.accessToken);
      return datos;
    } catch {
      return null;
    } finally {
      refrescando = null;
    }
  })();

  return refrescando;
}

export async function api<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  const hacer = async (): Promise<Response> =>
    fetch(`/api/v1${ruta}`, {
      ...init,
      headers: {
        /*
         * El tipo de contenido SOLO cuando hay contenido.
         *
         * Se ponía siempre, y una petición que declara `application/json` sin
         * cuerpo la rechaza Fastify antes de llegar a la aplicación:
         * «Body cannot be empty when content-type is set to application/json».
         *
         * Reventaba todas las acciones que son un POST sin datos —autorizar un
         * proveedor, cerrar un pedido, liberar uno retenido, aprobar una
         * devolución, probar una pasarela, cerrar sesión, dar de alta el
         * 2FA— con un 400 que además no se veía en pantalla. Parecían botones
         * muertos.
         */
        /*
         * Y tampoco cuando el cuerpo es un formulario: ahí el tipo lo pone
         * `fetch`, que además añade el `boundary` que separa las partes.
         * Escribirlo a mano deja el envío sin boundary y el servidor no puede
         * leer el fichero.
         */
        ...(init.body === undefined || init.body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
      credentials: 'include',
    });

  let respuesta = await hacer();

  // Un 401 puede ser simplemente que el access token ha caducado (15 minutos).
  // Se refresca y se reintenta UNA vez: si vuelve a fallar, la sesión murió.
  if (respuesta.status === 401 && !ruta.startsWith('/auth/')) {
    if (await refrescarSesion()) {
      respuesta = await hacer();
    }
  }

  const texto = await respuesta.text();
  const datos: unknown = texto ? JSON.parse(texto) : null;

  if (!respuesta.ok) {
    const err = datos as {
      message?: string | string[];
      fields?: Record<string, string[]>;
      traceId?: string;
    } | null;

    throw new ErrorApi(
      respuesta.status,
      Array.isArray(err?.message) ? err.message.join(', ') : (err?.message ?? 'Error inesperado'),
      err?.fields,
      err?.traceId,
    );
  }

  return datos as T;
}

export const get = <T>(ruta: string) => api<T>(ruta);
export const post = <T>(ruta: string, cuerpo?: unknown) =>
  api<T>(ruta, { method: 'POST', ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
export const put = <T>(ruta: string, cuerpo: unknown) =>
  api<T>(ruta, { method: 'PUT', body: JSON.stringify(cuerpo) });
export const patch = <T>(ruta: string, cuerpo: unknown) =>
  api<T>(ruta, { method: 'PATCH', body: JSON.stringify(cuerpo) });
export const del = <T>(ruta: string) => api<T>(ruta, { method: 'DELETE' });

/**
 * Sube un fichero grande informando de cuánto lleva.
 *
 * Va con `XMLHttpRequest` y no con `fetch` porque es lo único que da progreso
 * de SUBIDA en los navegadores. Con un catálogo de proveedor —el de Dreamlove
 * son 342 MB— la diferencia es entre una barra que avanza y una pantalla
 * congelada varios minutos en la que nadie sabe si aquello sigue vivo.
 */
export async function subirFichero<T>(
  ruta: string,
  fichero: File,
  opciones: { campo?: string; alProgresar?: (porcentaje: number) => void } = {},
): Promise<T> {
  const enviar = (): Promise<{ estado: number; cuerpo: string }> =>
    new Promise((resolver, rechazar) => {
      const peticion = new XMLHttpRequest();
      const formulario = new FormData();
      formulario.append(opciones.campo ?? 'fichero', fichero);

      peticion.upload.addEventListener('progress', (evento) => {
        if (evento.lengthComputable) {
          opciones.alProgresar?.(Math.round((evento.loaded / evento.total) * 100));
        }
      });

      peticion.addEventListener('load', () =>
        resolver({ estado: peticion.status, cuerpo: peticion.responseText }),
      );
      peticion.addEventListener('error', () =>
        rechazar(new ErrorApi(0, 'No se ha podido conectar con el servidor')),
      );
      peticion.addEventListener('abort', () => rechazar(new ErrorApi(0, 'Subida cancelada')));

      peticion.open('POST', `/api/v1${ruta}`);
      peticion.withCredentials = true;
      if (accessToken) peticion.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      // Sin Content-Type a mano: lo pone el navegador con el `boundary` que
      // separa las partes, y escribirlo deja el envío ilegible para el servidor.
      peticion.send(formulario);
    });

  let respuesta = await enviar();

  // Una subida larga puede empezar con el token vivo y terminar con él
  // caducado. Se refresca y se reintenta una vez, como en el resto del cliente.
  if (respuesta.estado === 401 && (await refrescarSesion())) {
    respuesta = await enviar();
  }

  const datos: unknown = respuesta.cuerpo ? JSON.parse(respuesta.cuerpo) : null;

  if (respuesta.estado < 200 || respuesta.estado >= 300) {
    const err = datos as { message?: string | string[]; traceId?: string } | null;
    throw new ErrorApi(
      respuesta.estado,
      Array.isArray(err?.message) ? err.message.join(', ') : (err?.message ?? 'Error inesperado'),
      undefined,
      err?.traceId,
    );
  }

  return datos as T;
}
