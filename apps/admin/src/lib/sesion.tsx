import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, guardarToken, post, refrescarSesion, type Usuario } from './api';

// La forma vive en la capa de API, que es quien la recibe; se reexporta
// porque media aplicación la importa desde aquí.
export type { Usuario };

interface Sesion {
  usuario: Usuario | null;
  cargando: boolean;
  entrar: (email: string, password: string, totpCode?: string) => Promise<void>;
  salir: () => Promise<void>;
  /** ¿Tiene TODOS los permisos indicados? */
  puede: (...permisos: string[]) => boolean;
}

const Contexto = createContext<Sesion | null>(null);

export function ProveedorSesion({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

  // Al cargar se intenta recuperar la sesión con el refresh token de la cookie:
  // el access token vive en memoria y se pierde al recargar la página.
  useEffect(() => {
    let cancelado = false;

    void (async () => {
      // Por `refrescarSesion` y no con un fetch propio: es el único sitio que
      // habla con /auth/refresh, y por buenos motivos. Ver su comentario.
      const datos = await refrescarSesion();
      if (cancelado) return;
      if (datos) setUsuario(datos.user);
      setCargando(false);
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  const entrar = useCallback(async (email: string, password: string, totpCode?: string) => {
    const datos = await post<{ accessToken: string; user: Usuario }>('/auth/login', {
      email,
      password,
      ...(totpCode ? { totpCode } : {}),
    });
    guardarToken(datos.accessToken);
    setUsuario(datos.user);
  }, []);

  const salir = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      // Se limpia el estado local pase lo que pase: si el servidor no responde,
      // el usuario igualmente espera haber salido.
      guardarToken(null);
      setUsuario(null);
    }
  }, []);

  const puede = useCallback(
    (...permisos: string[]) => {
      if (!usuario) return false;
      return permisos.every((p) => usuario.permissions.includes(p));
    },
    [usuario],
  );

  return (
    <Contexto.Provider value={{ usuario, cargando, entrar, salir, puede }}>
      {children}
    </Contexto.Provider>
  );
}

export function useSesion(): Sesion {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useSesion debe usarse dentro de ProveedorSesion');
  return ctx;
}
