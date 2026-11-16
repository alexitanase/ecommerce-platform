import { api } from './api';

/**
 * Qué accesos sociales puede ofrecer la tienda ahora mismo.
 *
 * Lo decide el servidor: solo lista los que tienen la integración configurada y
 * activa en el panel. Enseñar «Continuar con Google» sin configurar acaba en una
 * pantalla de error de Google, que el cliente lee como un fallo nuestro.
 *
 * Se pregunta en el servidor y con caché corta. No es un dato personal —es el
 * mismo para todo el mundo— y cambia solo cuando alguien toca el panel, así que
 * cinco minutos de caché evitan una petición por cada visita a la pantalla de
 * acceso.
 *
 * Si la API no responde, se devuelve la lista vacía en lugar de propagar el
 * error: la pantalla de entrar tiene que seguir funcionando con email y
 * contraseña aunque el acceso social esté caído.
 */
export async function accesosSociales(): Promise<string[]> {
  const respuesta = await api<{ proveedores: string[] }>('/auth/oauth', {
    revalidar: 300,
    etiquetas: ['integraciones'],
  }).catch(() => ({ proveedores: [] }));

  return respuesta.proveedores;
}

/**
 * Motivos por los que puede fallar un acceso social.
 *
 * Lista cerrada, y el motivo se comprueba contra ella. Llega en la URL, así que
 * se lo puede escribir cualquiera: sin validarlo, un `?error=` inventado buscaría
 * una traducción que no existe y acabaría pintando la clave —o el texto que
 * hubiera puesto quien montara el enlace— dentro de nuestra pantalla de acceso.
 */
export const MOTIVOS_OAUTH = ['cancelado', 'caducado', 'fallido'] as const;
export type MotivoOauth = (typeof MOTIVOS_OAUTH)[number];

export function motivoOauth(valor: string | string[] | undefined): MotivoOauth | null {
  const uno = Array.isArray(valor) ? valor[0] : valor;
  return uno && (MOTIVOS_OAUTH as readonly string[]).includes(uno) ? (uno as MotivoOauth) : null;
}
