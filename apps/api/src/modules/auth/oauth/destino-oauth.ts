/**
 * A dónde se devuelve al cliente después de entrar con Google o Apple.
 *
 * El proveedor no vuelve a la tienda: vuelve a la API, porque es la API la que
 * tiene el `client_secret` para canjear el código. Así que alguien tiene que
 * llevar al cliente de vuelta, y ese destino lo propone la tienda al empezar el
 * flujo.
 *
 * Aquí está la parte delicada. Un destino que llega de fuera y se usa tal cual
 * en una redirección es un **salto abierto**: `…/auth/oauth/google?redirect=https://malo.example`
 * convierte un enlace de nuestro dominio en un envío a la página de quien
 * quiera, que es la forma clásica de montar un phishing con una URL de
 * confianza delante. Y en este caso concreto sería peor de lo habitual, porque
 * el salto ocurre justo después de dejar la sesión abierta.
 *
 * Por eso solo se aceptan **rutas de la propia tienda**: algo que empieza por
 * una barra y no por dos. Cualquier otra cosa —una URL absoluta, `//malo.example`,
 * un `javascript:`— se descarta y se va a la cuenta del cliente, que es a donde
 * quería llegar de todas formas.
 */

/** Donde acaba quien entra sin pedir nada concreto. */
const RUTA_POR_DEFECTO = '/cuenta';

/**
 * ¿Es una ruta interna de la tienda?
 *
 * `//malo.example` empieza por barra y el navegador lo entiende como un dominio
 * externo —protocolo relativo—, así que la comprobación de la doble barra no es
 * un detalle: es la mitad del control.
 */
function esRutaInterna(ruta: string): boolean {
  if (!ruta.startsWith('/') || ruta.startsWith('//')) return false;
  // `/\malo.example` lo normalizan algunos navegadores como `//malo.example`.
  if (ruta.startsWith('/\\')) return false;
  // Un salto de línea o un retorno de carro permitiría inyectar cabeceras.
  return !/[\r\n]/.test(ruta);
}

/**
 * URL absoluta a la que redirigir tras el acceso social.
 *
 * `base` es la URL de la tienda que tiene configurada el servidor, nunca una que
 * llegue en la petición: es lo que garantiza que el destino final sea nuestro
 * dominio incluso si `ruta` es una barbaridad.
 */
export function destinoTrasOAuth(base: string, ruta?: string | null): string {
  const limpia = ruta && esRutaInterna(ruta) ? ruta : RUTA_POR_DEFECTO;
  return `${base.replace(/\/+$/, '')}${limpia}`;
}

/**
 * Idioma en el que hablarle a quien vuelve con un error.
 *
 * Se deduce del destino que pidió la tienda —`/ca/cuenta` → `ca`— porque cuando
 * el acceso falla no hay sesión de la que sacar el idioma, y mandar a un
 * catalanohablante a la página en español es el remate de un error.
 */
export function idiomaDelDestino(
  ruta: string | null | undefined,
  idiomas: readonly string[],
  porDefecto: string,
): string {
  const primero = (ruta ?? '').split('/')[1] ?? '';
  return idiomas.includes(primero) ? primero : porDefecto;
}

/**
 * A dónde va quien vuelve de un acceso social que ha fallado.
 *
 * A la pantalla de entrar y con el motivo en la URL, no a la página de error
 * genérica: quien acaba de pulsar «Continuar con Google» necesita el formulario
 * de siempre delante para poder entrar de otra manera.
 *
 * El motivo es un código corto y cerrado, no el mensaje del error. Un mensaje de
 * la API en la URL se lo puede escribir cualquiera y aparecería pintado en la
 * pantalla de acceso: un texto ajeno dentro de nuestra página es media suplantación.
 */
export type MotivoFalloOAuth = 'cancelado' | 'caducado' | 'fallido';

export function destinoDeFallo(base: string, idioma: string, motivo: MotivoFalloOAuth): string {
  return `${base.replace(/\/+$/, '')}/${idioma}/entrar?error=${motivo}`;
}
