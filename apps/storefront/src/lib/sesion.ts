'use client';

import { create } from 'zustand';
import { api, ErrorApi } from './api';

/**
 * Sesión del cliente.
 *
 * El *access token* vive **solo en memoria**, en este store, y no se guarda ni
 * en `localStorage` ni en una cookie legible. Es la decisión de seguridad
 * importante de todo el módulo: un token en `localStorage` se lo lleva
 * cualquier script inyectado, y basta un widget de terceros comprometido para
 * regalar la sesión de todos los clientes.
 *
 * Lo que sí sobrevive a recargar la página es el *refresh token*, que la API
 * pone en una cookie `httpOnly` que JavaScript no puede leer. Al arrancar se
 * canjea por un access token nuevo, y por eso hay un momento —`cargando`— en
 * el que todavía no se sabe si hay sesión. Confundir ese momento con "no hay
 * sesión" hace que la cuenta parpadee enseñando la pantalla de entrar a quien
 * ya está dentro.
 */

export interface Usuario {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

interface RespuestaSesion {
  accessToken: string;
  user: Usuario;
}

interface EstadoSesion {
  usuario: Usuario | null;
  token: string | null;
  /** Cierto hasta que se sabe si había sesión. Ni sí ni no: todavía no. */
  cargando: boolean;

  /** Canjea la cookie por un token. Se llama una vez al arrancar. */
  recuperar: () => Promise<string | null>;
  entrar: (datos: { email: string; password: string; totpCode?: string }) => Promise<void>;
  registrar: (datos: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    marketingConsent: boolean;
  }) => Promise<void>;
  salir: () => Promise<void>;
}

/**
 * Error que pide el código de dos factores.
 *
 * La API responde 401 con este mensaje cuando la cuenta tiene 2FA y no ha
 * llegado el código. No es un fallo de credenciales y no se puede tratar como
 * tal: decirle "usuario o contraseña incorrectos" a quien los ha puesto bien
 * es la forma más rápida de que abandone.
 */
export class Necesita2FA extends Error {
  constructor() {
    super('Se necesita el código de verificación');
    this.name = 'Necesita2FA';
  }
}

/** Reconoce la petición de segundo factor por el código, no por el mensaje. */
function pide2FA(error: unknown): boolean {
  return error instanceof ErrorApi && error.codigo === 'TOTP_REQUIRED';
}

/**
 * El refresco en curso, si lo hay.
 *
 * `recuperar()` se llama desde varios sitios —la pantalla de cuenta al montar,
 * el checkout, el formulario de acceso— y nada impedía que dos coincidieran.
 * Coincidir era caro: el servidor rota el refresh token en cada uso, así que la
 * segunda petición llegaba con el token que la primera acababa de gastar y eso
 * es, vista desde fuera, exactamente la firma de un token robado.
 *
 * El servidor ya distingue los dos casos, pero mandar dos peticiones para lo
 * mismo no tiene defensa: quien llegue mientras hay una en vuelo se engancha a
 * ella y todos reciben la misma respuesta.
 */
let refrescoEnVuelo: Promise<string | null> | null = null;

export const useSesion = create<EstadoSesion>((set) => ({
  usuario: null,
  token: null,
  cargando: true,

  recuperar: () => {
    refrescoEnVuelo ??= (async () => {
      try {
        const datos = await api<RespuestaSesion>('/auth/refresh', {
          method: 'POST',
          body: '{}',
        });
        set({ usuario: datos.user, token: datos.accessToken, cargando: false });
        return datos.accessToken;
      } catch {
        // Sin cookie, caducada o revocada: no hay sesión y no es un error que
        // haya que enseñar. Quien no ha entrado nunca pasa por aquí siempre.
        set({ usuario: null, token: null, cargando: false });
        return null;
      } finally {
        // Se suelta aquí y no antes: hasta que no termina, cualquier otra
        // llamada debe engancharse a esta y no arrancar una nueva.
        refrescoEnVuelo = null;
      }
    })();

    return refrescoEnVuelo;
  },

  entrar: async (datos) => {
    try {
      const respuesta = await api<RespuestaSesion>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(datos),
      });
      set({ usuario: respuesta.user, token: respuesta.accessToken, cargando: false });
    } catch (error) {
      if (pide2FA(error)) throw new Necesita2FA();
      throw error;
    }
  },

  registrar: async (datos) => {
    const respuesta = await api<RespuestaSesion>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(datos),
    });
    set({ usuario: respuesta.user, token: respuesta.accessToken, cargando: false });
  },

  salir: async () => {
    // El estado local se limpia pase lo que pase con la petición: si falla la
    // red, lo último que puede quedar es una pantalla que sigue enseñando los
    // pedidos de alguien que ha pulsado "cerrar sesión".
    const token = useSesion.getState().token;
    set({ usuario: null, token: null, cargando: false });

    await api('/auth/logout', {
      method: 'POST',
      body: '{}',
      ...(token ? { token } : {}),
    }).catch(() => undefined);
  },
}));
